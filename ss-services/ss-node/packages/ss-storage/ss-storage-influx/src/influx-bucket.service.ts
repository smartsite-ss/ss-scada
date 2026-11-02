// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';

/**
 * InfluxDB bucket management service
 *
 * Responsibilities:
 * - Automatically create an InfluxDB bucket per project (naming: {INFLUXDB_BUCKET}_{projectId})
 * - Bucket existence check (idempotent; duplicate creation does not error)
 * - Write routing: projectId → bucket name mapping
 * - Fallback: fall back to the default bucket when bucket creation fails / InfluxDB is unavailable
 * - CODE-04: periodic health check so influxAvailable flips back to true after InfluxDB recovers
 */
@Injectable()
export class InfluxBucketService implements OnModuleInit, OnModuleDestroy {
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

  /** CODE-05: regular API fetch timeout (ms) */
  private readonly fetchTimeoutMs = 5000;

  constructor(
    private readonly eventBus: EventBusService,
    @Optional() private readonly eventLogService?: EventLogService,
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

    // CODE-04: start the periodic health check so influxAvailable can flip back to true after InfluxDB recovers
    // (the original implementation never called markAvailable() automatically, so one failure permanently fell back to the default bucket)
    this.startHealthCheck();
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * CODE-04: periodic health probe — InfluxDB /health returning 200 restores influxAvailable,
   * so subsequent bucket creation requests are no longer skipped. Only fetches when unavailable, avoiding extra load in the healthy state.
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      if (this.influxAvailable) return; // already available, no probing needed
      try {
        const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
        const response = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
        });
        if (response.ok) {
          this.logger.warn(
            'InfluxDB health check passed — restoring influxAvailable, bucket creation will resume',
          );
          this.influxAvailable = true;
        }
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

    // Fallback: if InfluxDB is known to be unavailable, return the default bucket directly
    if (!this.influxAvailable) {
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

  /** Reset the availability flag (for retry after the health check recovers) */
  markAvailable(): void {
    this.influxAvailable = true;
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
        this.influxAvailable = false;
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
      this.logger.error(
        `Failed to create bucket "${bucket}": HTTP ${response.status} ${errorBody}`,
      );
      this.influxAvailable = false;
      return false;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`InfluxDB bucket creation error for "${bucket}": ${errorMsg}`);
      this.influxAvailable = false;
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
