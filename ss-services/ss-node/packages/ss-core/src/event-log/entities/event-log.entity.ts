// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../core/entities/base.entity';

/**
 * Subscriber processing record - embedded in the EventLog.subscribers array
 */
export interface SubscriberRecord {
  /** Subscriber class name (e.g. 'DeviceConfigWatcher') */
  name: string;
  /** Processing status */
  status: 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';
  /** Processing start time (ISO string) */
  startedAt?: string;
  /** Completion time (ISO string) */
  completedAt?: string;
  /** Processing duration (ms) */
  duration?: number;
  /** Error message (filled when status=failed) */
  error?: string;
  /** Business effect (e.g. { connectionId, tagsLoaded, tasksRegistered }) */
  result?: Record<string, any>;
}

/**
 * Event-log status enum
 */
export type EventLogStatus =
  | 'emitted'        // emitted, waiting for subscribers to process
  | 'processing'     // subscribers processing
  | 'processed'     // all subscribers processed
  | 'partial'       // some subscribers succeeded, some failed
  | 'failed'        // all subscribers failed
  | 'no_subscribers'; // no subscribers

/**
 * Event-log entity - config-change event persistence + subscriber tracing
 *
 * Stored in the global ss-node.db (following the SystemEvent pattern), not isolated per project.
 * Stores only config-change events (21 types); high-frequency data events (data_point_changed) are not persisted.
 *
 * Design points:
 * 1. Extends BaseEntity (with id / createdAt / updatedAt, no projectId)
 * 2. projectId is optional; system-level events may be null
 * 3. The subscribers field records each subscriber's processing status and business effect
 * 4. The status field marks the event's overall lifecycle
 */
@Entity('evt_event_log')
@Index(['projectId', 'createdAt'])   // query by project + time descending (most common)
@Index(['eventType', 'createdAt'])   // filter by type + time
@Index(['emittedBy', 'createdAt'])    // filter by operator (user audit)
@Index(['status', 'createdAt'])      // filter by status (find failures)
@Index(['traceId'])                   // query the event chain by traceId (reserved for #7)
export class EventLog extends BaseEntity {
  /** Event type (e.g. 'device.created', 'project:enabled') */
  @Column({ type: 'varchar', length: 64 })
  eventType: string;

  /** Project ID (optional: null for system-level events; project-level events carry projectId for filtering) */
  @Column({ name: 'project_id', type: 'varchar', length: 36, nullable: true })
  projectId?: string | null;

  /** Event payload (simple-json serialization, keeps the full payload) */
  @Column({ type: 'simple-json' })
  payload: Record<string, any>;

  /** Event initiator (user ID / system service name)
   * Source priority: payload.userId > payload.emittedBy > payload.sourceInstance > null */
  @Column({ name: 'emitted_by', type: 'varchar', length: 64, nullable: true })
  emittedBy?: string | null;

  /** Event source (rest_api / pipeline / scheduler / system / websocket) */
  @Column({ type: 'varchar', length: 20, default: 'rest_api' })
  source: string;

  /** The event's own timestamp (uniformly stored as datetime) */
  @Column({ name: 'event_timestamp', type: 'datetime' })
  eventTimestamp: Date;

  /** Subscriber processing records (JSON array; each element records one subscriber's result) */
  @Column({ type: 'simple-json', nullable: true })
  subscribers: SubscriberRecord[];

  /** Event overall status */
  @Column({ type: 'varchar', length: 20, default: 'emitted' })
  status: EventLogStatus;

  /** Subscriber success count / total (e.g. "2/3"), for quickly querying partially failed events */
  @Column({ name: 'success_ratio', type: 'varchar', length: 10, nullable: true })
  successRatio?: string | null;

  /** Error message (filled when status=failed/partial) */
  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  /** Event trace ID (reserved for #7 optimization; currently may be null) */
  @Column({ name: 'trace_id', type: 'varchar', length: 36, nullable: true })
  traceId?: string | null;
}
