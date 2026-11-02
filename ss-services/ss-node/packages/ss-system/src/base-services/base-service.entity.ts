// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Base-service entity — manages third-party software configuration
 * Stored in the global database ss-data.db
 */
@Entity('sys_base_services')
export class BaseServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique software identifier name (used as the API path parameter, e.g. redis / influxdb / nginx) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** Display name */
  @Column({ type: 'varchar', length: 128 })
  displayName: string;

  /** Description */
  @Column({ type: 'text', nullable: true })
  description: string;

  /** Executable file path (run path) */
  @Column({ name: 'binary_path', type: 'text', nullable: true })
  binaryPath: string;

  /** Start arguments (space-separated, e.g. --port 6379) */
  @Column({ name: 'start_args', type: 'text', nullable: true })
  startArgs: string;

  /** Configuration file path */
  @Column({ name: 'config_path', type: 'text', nullable: true })
  configPath: string;

  /** Log directory path */
  @Column({ name: 'log_dir', type: 'text', nullable: true })
  logDir: string;

  /** Data directory path */
  @Column({ name: 'data_dir', type: 'text', nullable: true })
  dataDir: string;

  /** Process name (used for status monitoring, e.g. redis-server.exe) */
  @Column({ name: 'process_name', type: 'varchar', length: 128, nullable: true })
  processName: string;

  /** Occupied port (0 means no port check) */
  @Column({ name: 'port', type: 'integer', nullable: true, default: 0 })
  port: number;

  /** Start script (when empty, binaryPath + startArgs are used to start) */
  @Column({ name: 'start_script', type: 'text', nullable: true })
  startScript: string;

  /** Stop script (when empty, taskkill /F /IM <processName> is used by default) */
  @Column({ name: 'stop_script', type: 'text', nullable: true })
  stopScript: string;

  /** Whether enabled */
  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  /** Whether to auto-start (started automatically when the backend starts) */
  @Column({ name: 'auto_start', type: 'boolean', default: false })
  autoStart: boolean;

  /** Whether process guarding is enabled (periodic check; auto-starts the process when missing) */
  @Column({ name: 'process_guard', type: 'boolean', default: false })
  processGuard: boolean;

  /** Sort weight */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
