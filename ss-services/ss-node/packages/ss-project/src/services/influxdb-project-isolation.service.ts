// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * InfluxDB bucket metadata
 */
export interface InfluxBucketInfo {
  /** Bucket name */
  name: string;
  /** The corresponding project ID */
  projectId: string;
  /** Organization name */
  org: string;
  /** Creation time */
  createdAt: string;
  /** Data retention policy (hours); 0 means permanent retention */
  retentionHours: number;
}

/**
 * InfluxDB data-point routing info
 */
export interface DataPointRoute {
  /** Target bucket name */
  bucket: string;
  /** Target organization */
  org: string;
  /** Measurement name */
  measurement: string;
  /** Tags */
  tags: Record<string, string>;
  /** Field values */
  fields: Record<string, number | string | boolean>;
  /** Timestamp (ISO 8601) */
  timestamp?: string;
}

/**
 * InfluxDB project-bucket isolation service
 *
 * Responsibilities:
 * 1. Create an independent InfluxDB bucket for each project
 * 2. Bucket naming convention: project-{projectId}
 * 3. Auto-route data to the corresponding bucket by projectId
 * 4. Clean the corresponding bucket and data on project deletion
 */
@Injectable()
export class InfluxdbProjectIsolationService implements OnModuleDestroy {
  private readonly logger = new Logger(InfluxdbProjectIsolationService.name);

  /** Project ID -> bucket-info map */
  private readonly bucketRegistry = new Map<string, InfluxBucketInfo>();

  /** InfluxDB connection config */
  private readonly influxUrl: string;
  private readonly influxToken: string;
  private readonly influxOrg: string;
  private readonly defaultRetentionHours: number;

  constructor(private readonly configService: ConfigService) {
    this.influxUrl = this.configService.get<string>('INFLUXDB_URL') || 'http://localhost:8086';
    this.influxToken = this.configService.get<string>('INFLUXDB_TOKEN') || '';
    this.influxOrg = this.configService.get<string>('INFLUXDB_ORG') || 'ss-org';
    this.defaultRetentionHours = this.configService.get<number>('INFLUXDB_RETENTION_HOURS') || 0;
  }

  /**
   * Get a project's InfluxDB bucket name
   * Naming convention: project-{projectId}
   */
  getBucketName(projectId: string): string {
    return `project-${projectId}`;
  }

  /**
   * Create a project's InfluxDB bucket
   *
   * Creates the bucket via the InfluxDB v2 API; skips if the bucket already exists
   *
   * @param projectId   project ID
   * @param options     optional config (retention policy etc.)
   */
  async createProjectBucket(
    projectId: string,
    options?: { retentionHours?: number; org?: string },
  ): Promise<InfluxBucketInfo> {
    const bucketName = this.getBucketName(projectId);
    const org = options?.org || this.influxOrg;
    const retentionHours = options?.retentionHours ?? this.defaultRetentionHours;

    // Check whether already registered
    const existing = this.bucketRegistry.get(projectId);
    if (existing) {
      this.logger.log(`Bucket "${bucketName}" already registered for project ${projectId}`);
      return existing;
    }

    try {
      // Check whether the bucket already exists
      const existingBucket = await this.findBucketByName(bucketName, org);
      if (existingBucket) {
        this.logger.log(`Bucket "${bucketName}" already exists in InfluxDB, registering locally`);
        const info: InfluxBucketInfo = {
          name: bucketName,
          projectId,
          org,
          createdAt: existingBucket.createdAt || new Date().toISOString(),
          retentionHours,
        };
        this.bucketRegistry.set(projectId, info);
        return info;
      }

      // Create the bucket via the InfluxDB API
      const bucket = await this.callInfluxApi('/api/v2/buckets', 'POST', {
        orgID: await this.getOrgId(org),
        name: bucketName,
        retentionRules:
          retentionHours > 0 ? [{ type: 'expire', everySeconds: retentionHours * 3600 }] : [],
      });

      const info: InfluxBucketInfo = {
        name: bucketName,
        projectId,
        org,
        createdAt: bucket.createdAt || new Date().toISOString(),
        retentionHours,
      };

      this.bucketRegistry.set(projectId, info);
      this.logger.log(
        `Bucket "${bucketName}" created for project ${projectId}` +
          (retentionHours > 0 ? ` (retention: ${retentionHours}h)` : ''),
      );
      return info;
    } catch (err) {
      this.logger.error(
        `Failed to create bucket "${bucketName}" for project ${projectId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Route a data point to the correct project bucket
   *
   * @param projectId   project ID
   * @param measurement measurement name
   * @param fields      field values
   * @param tags        tags (optional)
   * @param timestamp   timestamp (optional)
   */
  routeDataPoint(
    projectId: string,
    measurement: string,
    fields: Record<string, number | string | boolean>,
    tags?: Record<string, string>,
    timestamp?: string,
  ): DataPointRoute {
    const bucketName = this.getBucketName(projectId);

    return {
      bucket: bucketName,
      org: this.influxOrg,
      measurement,
      tags: {
        projectId,
        ...(tags || {}),
      },
      fields,
      timestamp,
    };
  }

  /**
   * Batch-route data points to project buckets
   *
   * @param projectId project ID
   * @param points    data-point array
   */
  routeDataPoints(
    projectId: string,
    points: Array<{
      measurement: string;
      fields: Record<string, number | string | boolean>;
      tags?: Record<string, string>;
      timestamp?: string;
    }>,
  ): DataPointRoute[] {
    return points.map((point) =>
      this.routeDataPoint(projectId, point.measurement, point.fields, point.tags, point.timestamp),
    );
  }

  /**
   * Get a project's bucket info
   */
  getBucketInfo(projectId: string): InfluxBucketInfo | undefined {
    return this.bucketRegistry.get(projectId);
  }

  /**
   * Get all registered bucket info
   */
  getAllBuckets(): InfluxBucketInfo[] {
    return Array.from(this.bucketRegistry.values());
  }

  /**
   * Get the registered bucket count
   */
  get bucketCount(): number {
    return this.bucketRegistry.size;
  }

  /**
   * Delete a project's InfluxDB bucket
   *
   * @param projectId project ID
   */
  async deleteProjectBucket(projectId: string): Promise<void> {
    const bucketName = this.getBucketName(projectId);
    const info = this.bucketRegistry.get(projectId);

    try {
      // Try to delete the bucket via the API
      const existingBucket = await this.findBucketByName(bucketName, this.influxOrg);
      if (existingBucket && existingBucket.id) {
        await this.callInfluxApi(`/api/v2/buckets/${existingBucket.id}`, 'DELETE');
        this.logger.log(`Bucket "${bucketName}" deleted from InfluxDB`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to delete bucket "${bucketName}" from InfluxDB: ${(err as Error).message}`,
      );
    }

    this.bucketRegistry.delete(projectId);
    if (info) {
      this.logger.log(`Bucket "${bucketName}" unregistered for project ${projectId}`);
    }
  }

  /**
   * Empty a project bucket's data (keeping the bucket structure)
   *
   * @param projectId  project ID
   * @param startTime  start time (ISO 8601, optional)
   * @param stopTime   end time (ISO 8601, optional)
   */
  async purgeProjectData(projectId: string, startTime?: string, stopTime?: string): Promise<void> {
    const bucketName = this.getBucketName(projectId);

    try {
      const predicate = `_measurement =~ /.*/`;
      const timePredicate =
        startTime && stopTime ? ` AND _time >= ${startTime} AND _time <= ${stopTime}` : '';

      // Delete data using the InfluxDB delete API
      await this.callInfluxApi(
        '/api/v2/delete',
        'POST',
        {
          predicate: `${predicate}${timePredicate}`,
          start: startTime || '1970-01-01T00:00:00Z',
          stop: stopTime || new Date().toISOString(),
        },
        {
          'Content-Type': 'application/json',
        },
      );

      this.logger.log(`Data purged from bucket "${bucketName}" for project ${projectId}`);
    } catch (err) {
      this.logger.error(
        `Failed to purge data from bucket "${bucketName}": ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Check whether a project bucket exists
   */
  async bucketExists(projectId: string): Promise<boolean> {
    const bucketName = this.getBucketName(projectId);
    const existing = await this.findBucketByName(bucketName, this.influxOrg);
    return existing !== null;
  }

  /**
   * Build InfluxDB Line Protocol write data
   *
   * @param route the routed data point
   * @returns the InfluxDB line-protocol string
   */
  buildLineProtocol(route: DataPointRoute): string {
    const { measurement, tags, fields, timestamp } = route;

    const tagStr = Object.entries(tags)
      .map(([k, v]) => `${k}=${this.escapeTagValue(String(v))}`)
      .join(',');

    const fieldStr = Object.entries(fields)
      .map(([k, v]) => {
        if (typeof v === 'string') {
          return `${k}="${v.replace(/"/g, '\\"')}"`;
        }
        if (typeof v === 'boolean') {
          return `${k}=${v ? 'true' : 'false'}`;
        }
        return `${k}=${v}`;
      })
      .join(',');

    const tagPart = tagStr ? `,${tagStr}` : '';
    const timePart = timestamp ? ` ${new Date(timestamp).getTime() * 1000000}` : '';

    return `${measurement}${tagPart} ${fieldStr}${timePart}`;
  }

  // ============================================================
  // Private helper methods
  // ============================================================

  /**
   * Find a bucket by name
   */
  private async findBucketByName(
    bucketName: string,
    org: string,
  ): Promise<{ id: string; name: string; createdAt: string } | null> {
    try {
      const orgId = await this.getOrgId(org);
      const buckets = await this.callInfluxApi(
        `/api/v2/buckets?orgID=${orgId}&name=${encodeURIComponent(bucketName)}`,
        'GET',
      );

      if (buckets?.buckets && buckets.buckets.length > 0) {
        const b = buckets.buckets[0];
        return { id: b.id, name: b.name, createdAt: b.createdAt };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the organization ID
   */
  private async getOrgId(org: string): Promise<string> {
    const orgs = await this.callInfluxApi(`/api/v2/orgs?org=${encodeURIComponent(org)}`, 'GET');

    if (orgs?.orgs && orgs.orgs.length > 0) {
      return orgs.orgs[0].id;
    }

    throw new Error(`Organization "${org}" not found in InfluxDB`);
  }

  /**
   * Call the InfluxDB v2 API
   */
  private async callInfluxApi(
    path: string,
    method: string,
    body?: any,
    extraHeaders?: Record<string, string>,
  ): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Token ${this.influxToken}`,
      ...(extraHeaders || {}),
    };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.influxUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`InfluxDB API error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    if (method === 'DELETE' || response.status === 204) {
      return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * Escape special characters in tag values
   */
  private escapeTagValue(value: string): string {
    return value.replace(/ /g, '\\ ').replace(/,/g, '\\,').replace(/=/g, '\\=');
  }

  /**
   * Clean up on module destroy
   */
  onModuleDestroy(): void {
    this.bucketRegistry.clear();
    this.logger.log('InfluxDB project isolation service destroyed');
  }
}
