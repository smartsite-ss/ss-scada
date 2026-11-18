// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as fs from 'fs';
import * as path from 'path';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { EventBusService, EventLogService, PathResolverService } from '@ss-node/ss-core';

/** Result counters of one project-bucket provisioning pass */
export interface ProjectBucketProvisionSummary {
  total: number;
  ready: number;
  failed: number;
}

/**
 * InfluxDB bucket management service
 *
 * Responsibilities:
 * - Automatically create an InfluxDB bucket per project (naming: {INFLUXDB_BUCKET}_{projectId})
 * - Bucket existence check (idempotent; duplicate creation does not error)
 * - Write routing: projectId → bucket name mapping
 * - Fallback: fall back to the default bucket when bucket creation fails / InfluxDB is unavailable
 * - CODE-04: periodic health check so influxAvailable flips back to true after InfluxDB recovers
 * - Provisioning triggers: startup, project.created, InfluxDB base service (re)started / setup,
 *   health-check recovery and a periodic sweep (self-heals projects added while it was down)
 */
@Injectable()
export class InfluxBucketService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InfluxBucketService.name);

  /** Cache of known-existing buckets, avoiding repeated HTTP checks */
  private readonly knownBuckets = new Set<string>();

  /** Buckets currently being created (prevents concurrent duplicate creation) */
  private readonly pendingCreations = new Map<string, Promise<boolean>>();

  /** Whether InfluxDB is available (marked false after the first request failure, avoiding ongoing useless requests) */
  private influxAvailable = true;

  /** CODE-04: health check timer; automatically markAvailable after InfluxDB recovers */
  private healthCheckTimer: NodeJS.Timeout | null = null;
  /** CODE-04: health check interval (ms) */
  private readonly healthCheckIntervalMs = 60_000;
  /** CODE-04: health check per-fetch timeout (ms) */
  private readonly healthCheckTimeoutMs = 5000;

  /** Periodic provisioning sweep: creates buckets for projects added while InfluxDB was down */
  private provisionSweepTimer: NodeJS.Timeout | null = null;
  /** Provisioning sweep interval (ms) */
  private readonly provisionSweepIntervalMs = 5 * 60_000;
  /** In-flight provisioning pass (single-flight so concurrent triggers share one pass) */
  private provisioning: Promise<ProjectBucketProvisionSummary> | null = null;

  /** Set when InfluxDB rejects INFLUXDB_TOKEN (HTTP 401/403): retries pause until the token is fixed */
  private authRejected = false;
  /** The token rejection has already been logged (avoids per-minute log spam) */
  private authErrorLogged = false;

  /** CODE-05: regular API fetch timeout (ms) */
  private readonly fetchTimeoutMs = 5000;

  constructor(
    private readonly eventBus: EventBusService,
    @Optional() private readonly eventLogService?: EventLogService,
    @Optional() private readonly pathResolver?: PathResolverService,
  ) {}

  onModuleInit(): void {
    // wrap helper: EventLogService.wrapSubscriber automatically tracks handling results and business effects
    const wrap = <T extends any[]>(
      eventType: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ): ((...args: T) => Promise<void>) => {
      const traced = this.eventLogService
        ? this.eventLogService.wrapSubscriber(eventType, 'InfluxBucketService', handler)
        : async (...args: T) => { await handler(...args); };
      return async (...args: T) => {
        try { await traced(...args); }
        catch (err) { this.logger.error(`Handler for ${eventType} failed: ${(err as Error).message}`); }
      };
    };

    // Listen for project-created events and automatically create the corresponding InfluxDB bucket
    this.eventBus.on('project.created', wrap('project.created', async (payload: { projectId: string; tenantId?: string }) => {
      const projectId = payload.projectId;
      if (projectId) {
        this.logger.log(`project.created event received, ensuring bucket for: ${projectId}`);
        const created = await this.ensureBucket(projectId);
        return { bucketCreated: created, bucketName: this.getBucketName(projectId) };
      }
    }));
    this.logger.log('InfluxBucketService initialized — listening for project.created');

    // InfluxDB started/restarted (or finished one-click setup) from the base-services page:
    // provision immediately instead of waiting for the next write or sweep
    this.eventBus.on('base-service.started', (payload: { name?: string; reason?: string }) => {
      if (payload?.name !== 'influxdb') return;
      void this.handleInfluxServiceStarted(payload.reason || 'start');
    });

    // CODE-04: start the periodic health check so influxAvailable can flip back to true after InfluxDB recovers
    // (the original implementation never called markAvailable() automatically, so one failure permanently fell back to the default bucket)
    this.startHealthCheck();

    // Self-heal: pick up projects whose bucket creation was skipped while InfluxDB was unreachable
    this.startProvisionSweep();
  }

  /**
   * Provision one bucket per existing project at startup.
   *
   * Runs in the background on purpose: bucket HTTP calls must never delay or block
   * application startup. Creation is idempotent — existing buckets are detected and
   * reused, only missing ones are created.
   */
  onApplicationBootstrap(): void {
    void this.provisionProjectBuckets('startup').catch((err: Error) => {
      this.logger.warn(`Startup bucket provisioning failed: ${err.message}`);
    });
  }

  /**
   * React to an InfluxDB base-service (re)start or completed setup.
   *
   * A (re)started instance may come with a fresh data dir / token, so the previous
   * auth-rejection state is dropped and provisioning runs again.
   */
  private async handleInfluxServiceStarted(reason: string): Promise<void> {
    this.influxAvailable = true;
    this.authRejected = false;
    this.authErrorLogged = false;
    this.logger.log(
      `InfluxDB service ${reason === 'setup' ? 'setup completed' : 'started'} — provisioning project buckets`,
    );

    try {
      await this.provisionProjectBuckets(`base-service-${reason}`);
    } catch (err) {
      this.logger.warn(
        `Bucket provisioning after InfluxDB ${reason} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Run one provisioning pass without overlapping an already running one.
   *
   * Triggers (startup, project.created, base-service.started, health recovery, sweep)
   * may fire close together; sharing a single pass keeps the HTTP footprint small.
   */
  async provisionProjectBuckets(reason: string): Promise<ProjectBucketProvisionSummary> {
    if (this.provisioning) return this.provisioning;

    this.logger.debug(`Project bucket provisioning pass started (${reason})`);
    const pass = this.ensureBucketsForAllProjects().finally(() => {
      // Only clear our own pass (a newer one may have been registered while awaiting)
      if (this.provisioning === pass) this.provisioning = null;
    });

    this.provisioning = pass;
    return pass;
  }

  /**
   * Ensure a bucket exists for every project directory.
   *
   * @returns summary counters for logging/testing
   */
  async ensureBucketsForAllProjects(): Promise<ProjectBucketProvisionSummary> {
    const summary: ProjectBucketProvisionSummary = { total: 0, ready: 0, failed: 0 };

    if (!(process.env.INFLUXDB_TOKEN || '')) {
      this.logger.warn(
        'INFLUXDB_TOKEN not configured — skipping project bucket provisioning',
      );
      return summary;
    }

    // The token was rejected by the running instance: retrying every project only spams
    // errors. Retries resume after the service is restarted/re-initialized or the token
    // is accepted again by the health probe.
    if (this.authRejected) {
      this.logger.debug('INFLUXDB_TOKEN rejected earlier — skipping project bucket provisioning');
      return summary;
    }

    const projectIds = this.listProjectIds();
    summary.total = projectIds.length;
    if (projectIds.length === 0) {
      this.logger.debug('No project directories found — nothing to provision');
      return summary;
    }

    for (const projectId of projectIds) {
      // Stop hammering a dead backend: the health check will restore availability later
      if (!this.influxAvailable) {
        summary.failed += 1;
        continue;
      }
      const ready = await this.ensureBucket(projectId);
      if (ready) summary.ready += 1;
      else summary.failed += 1;
    }

    this.logger.log(
      `Project bucket provisioning: ${summary.ready}/${summary.total} project bucket(s) ready` +
        (summary.failed > 0 ? `, ${summary.failed} failed` : ''),
    );
    return summary;
  }

  /**
   * Enumerate project ids by scanning PROJECTS_DIR for directories that contain
   * projectinfo.json (same marker used by ss-project's scanProjects).
   */
  private listProjectIds(): string[] {
    const configuredRaw = process.env.PROJECTS_DIR || './data/projects';
    // PROJECTS_DIR may reference other vars (e.g. ${DATA_DIR}/projects); expand defensively
    // in case the value reached process.env unexpanded
    const configured = configuredRaw.replace(
      /\$\{(\w+)\}/g,
      (_match: string, name: string) => process.env[name] || '',
    );
    let projectsDir: string;
    try {
      projectsDir = this.pathResolver ? this.pathResolver.resolve(configured) : path.resolve(configured);
    } catch {
      projectsDir = path.resolve(configured);
    }

    if (!fs.existsSync(projectsDir)) {
      this.logger.debug(`Projects directory not found: ${projectsDir}`);
      return [];
    }

    try {
      return fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            fs.existsSync(path.join(projectsDir, entry.name, 'projectinfo.json')),
        )
        .map((entry) => entry.name);
    } catch (err) {
      this.logger.warn(`Failed to scan projects directory: ${(err as Error).message}`);
      return [];
    }
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.provisionSweepTimer) {
      clearInterval(this.provisionSweepTimer);
      this.provisionSweepTimer = null;
    }
  }

  /**
   * Periodic provisioning sweep.
   *
   * Covers the cases the event-driven triggers cannot see: InfluxDB was started before the
   * backend (so the startup pass failed), a project directory was created without emitting
   * project.created, or the previous pass hit a transient error. Project ids already known to
   * have a bucket are served from the in-memory cache, so a healthy sweep issues no HTTP calls.
   */
  private startProvisionSweep(): void {
    this.provisionSweepTimer = setInterval(() => {
      void this.provisionProjectBuckets('periodic-sweep').catch((err: Error) => {
        this.logger.warn(`Periodic bucket provisioning failed: ${err.message}`);
      });
    }, this.provisionSweepIntervalMs);
    // The sweep must not prevent the process from exiting normally
    if (this.provisionSweepTimer.unref) {
      this.provisionSweepTimer.unref();
    }
  }

  /**
   * CODE-04: periodic health probe — InfluxDB /health returning 200 restores influxAvailable,
   * so subsequent bucket creation requests are no longer skipped. Only fetches when unavailable, avoiding extra load in the healthy state.
   *
   * When the token was rejected the probe additionally verifies an authenticated request:
   * /health answers 200 even with a bad token, so without this check the service would flap
   * between "available" and "auth rejected" every minute. After recovery a provisioning pass
   * runs immediately so buckets that were skipped while InfluxDB was down are created.
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      // Probe while unreachable, and also while the token is rejected (the token may have been fixed)
      if (this.influxAvailable && !this.authRejected) return;
      try {
        const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
        const response = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
        });
        if (!response.ok) return;

        if (this.authRejected) {
          if (!(await this.probeAuthorization())) return; // token still rejected, stay quiet
          this.authRejected = false;
          this.authErrorLogged = false;
          this.logger.warn('InfluxDB token accepted again — resuming project bucket provisioning');
        }

        const wasUnavailable = !this.influxAvailable;
        this.influxAvailable = true;
        if (wasUnavailable) {
          this.logger.warn(
            'InfluxDB health check passed — restoring influxAvailable, bucket creation will resume',
          );
        }

        // Create the buckets that were skipped while InfluxDB was unreachable
        void this.provisionProjectBuckets('health-recovered').catch((err: Error) => {
          this.logger.warn(`Bucket provisioning after recovery failed: ${err.message}`);
        });
      } catch {
        // Still unreachable, keep influxAvailable=false and wait for the next probe
      }
    }, this.healthCheckIntervalMs);
    // The health check must not prevent the process from exiting normally
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  // ──────────── Public API ────────────

  /**
   * Get the InfluxDB bucket name for a project
   * Ensures the bucket exists on first call (lazy creation)
   */
  async getBucket(projectId: string): Promise<string> {
    const bucket = this.getBucketName(projectId);

    // Fallback: if InfluxDB is unavailable (or the token is rejected), return the default bucket
    // directly — retrying on every write batch would only spam errors
    if (!this.influxAvailable || this.authRejected) {
      return this.getDefaultBucket();
    }

    // Lazy creation: try creating buckets not in knownBuckets
    if (!this.knownBuckets.has(bucket)) {
      const created = await this.ensureBucket(projectId);
      if (!created) {
        return this.getDefaultBucket();
      }
    }

    return bucket;
  }

  /** Get the default bucket name (fallback) */
  getDefaultBucket(): string {
    return process.env.INFLUXDB_BUCKET || 'ss_node_data';
  }

  /** Reset the availability flags (retry after the health check recovers or the service restarts) */
  markAvailable(): void {
    this.influxAvailable = true;
    this.authRejected = false;
    this.authErrorLogged = false;
  }

  // ──────────── Internal methods ────────────

  private getBucketName(projectId: string): string {
    const base = process.env.INFLUXDB_BUCKET || 'ss_node_data';
    // Replace special characters in projectId (bucket names only allow [a-zA-Z0-9_-])
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${base}_${safeId}`;
  }

  /**
   * Ensure the given project's bucket exists (idempotent)
   * @returns true = bucket ready, false = creation failed (caller should fall back to the default bucket)
   */
  async ensureBucket(projectId: string): Promise<boolean> {
    const bucket = this.getBucketName(projectId);

    // Already cached → return directly
    if (this.knownBuckets.has(bucket)) {
      return true;
    }

    // Creation in progress → wait for the result
    const pending = this.pendingCreations.get(bucket);
    if (pending) {
      return pending;
    }

    const promise = this.createBucketIfNotExists(bucket);
    this.pendingCreations.set(bucket, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingCreations.delete(bucket);
    }
  }

  private async createBucketIfNotExists(bucket: string): Promise<boolean> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';

    if (!token) {
      this.influxAvailable = false;
      this.logger.warn(`InfluxDB TOKEN not configured, skipping bucket creation for "${bucket}"`);
      return false;
    }

    try {
      // Step 1: check whether the bucket already exists
      const exists = await this.bucketExists(url, token, org, bucket);
      if (exists) {
        this.knownBuckets.add(bucket);
        this.logger.debug(`Bucket "${bucket}" already exists`);
        return true;
      }

      // Step 2: create the bucket
      const orgId = await this.getOrgId(url, token, org);
      if (!orgId) {
        await this.handleProvisionFailure(bucket, `cannot resolve org "${org}"`);
        return false;
      }

      // CODE-05: add a 5s timeout to fetch, avoiding indefinite waits on a hung request
      const response = await fetch(`${url}/api/v2/buckets`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgID: orgId,
          name: bucket,
          retentionRules: [], // unlimited retention; data lifecycle is managed at the application layer
        }),
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
      });

      if (response.ok || response.status === 201) {
        this.knownBuckets.add(bucket);
        this.logger.log(`Bucket "${bucket}" created successfully`);
        return true;
      }

      // 409 Conflict: duplicate caused by concurrent creation, treated as success
      if (response.status === 409) {
        this.knownBuckets.add(bucket);
        this.logger.log(`Bucket "${bucket}" already exists (409)`);
        return true;
      }

      const errorBody = await response.text().catch(() => 'unknown');
      await this.handleProvisionFailure(
        bucket,
        `bucket creation returned HTTP ${response.status} ${errorBody}`,
        response.status,
      );
      return false;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`InfluxDB bucket creation error for "${bucket}": ${errorMsg}`);
      this.influxAvailable = false;
      return false;
    }
  }

  /**
   * Handle a failed bucket-provisioning request.
   *
   * A rejected token (401/403) must not fall back into the normal "unreachable" retry loop:
   * /health keeps answering 200, so the service would flip back to available every minute and
   * retry every project. Auth failures are therefore reported once and only retried when the
   * service is restarted/re-initialized or the health probe confirms the token works again.
   */
  private async handleProvisionFailure(
    bucket: string,
    detail: string,
    status?: number,
  ): Promise<void> {
    this.influxAvailable = false;

    // 401/403 is auth by definition; a failed org lookup is ambiguous, so ask /api/v2/me
    const authSuspected =
      status === 401 || status === 403 || (!status && !(await this.probeAuthorization()));

    if (!authSuspected) {
      this.logger.error(`Failed to create bucket "${bucket}": ${detail}`);
      return;
    }

    this.authRejected = true;
    if (this.authErrorLogged) return;

    this.authErrorLogged = true;
    this.logger.error(
      `InfluxDB rejected the configured INFLUXDB_TOKEN (org="${process.env.INFLUXDB_ORG || 'ss-org'}") — ` +
        `project buckets cannot be created (${detail}). Verify INFLUXDB_TOKEN matches the running ` +
        `InfluxDB instance or re-run the one-click InfluxDB setup; provisioning is paused until then.`,
    );
  }

  /**
   * Verify that INFLUXDB_TOKEN is accepted by the running InfluxDB instance.
   * GET /api/v2/me is authenticated, unlike /health.
   */
  private async probeAuthorization(): Promise<boolean> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    if (!token) return false;

    try {
      const response = await fetch(`${url}/api/v2/me`, {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async bucketExists(
    url: string,
    token: string,
    org: string,
    bucketName: string,
  ): Promise<boolean> {
    try {
      // CODE-05: add a 5s timeout to fetch
      const response = await fetch(
        `${url}/api/v2/buckets?org=${encodeURIComponent(org)}&name=${encodeURIComponent(bucketName)}`,
        {
          headers: { Authorization: `Token ${token}` },
          signal: AbortSignal.timeout(this.fetchTimeoutMs),
        },
      );
      if (!response.ok) return false;
      const data = await response.json();
      return (data.buckets?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async getOrgId(url: string, token: string, org: string): Promise<string | null> {
    try {
      // CODE-05: add a 5s timeout to fetch
      const response = await fetch(`${url}/api/v2/orgs?org=${encodeURIComponent(org)}`, {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.orgs?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}
