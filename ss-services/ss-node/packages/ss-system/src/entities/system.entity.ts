// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sys_error_logs')
export class ErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  level: string;

  @Column()
  message: string;

  @Column({ nullable: true, type: 'text' })
  stack: string;

  @Column({ nullable: true })
  context: string;

  @Column({ nullable: true })
  url: string;

  @Column({ nullable: true })
  method: string;

  @Column({ nullable: true, type: 'varchar', length: 36 })
  userId: string;

  @Column({ nullable: true })
  ip: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('sys_configs')
export class SystemConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: 'string' })
  type: string;

  @CreateDateColumn()
  updatedAt: Date;
}

@Entity('sys_operation_logs')
export class OperationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string;

  @Column()
  resource: string;

  @Column({ nullable: true })
  resourceId: string;

  @Column({ nullable: true, type: 'varchar', length: 36 })
  userId: string;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  ip: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ nullable: true, type: 'text' })
  details: string;

  @Column({ default: 'success' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}

/** Backup log table — records each backup operation, distinguishing global/project and automatic/manual */
@Entity('sys_backup_logs')
export class BackupLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'db_type', type: 'varchar', length: 16 })
  dbType: 'system' | 'project';

  @Column({ name: 'backup_type', type: 'varchar', length: 16 })
  backupType: 'auto' | 'manual';

  @Column({ name: 'project_name', type: 'varchar', length: 128, nullable: true })
  projectName: string | null;

  @Column({ name: 'filename', type: 'varchar', length: 256 })
  filename: string;

  @Column({ name: 'file_path', type: 'varchar', length: 512, nullable: true })
  filePath: string | null;

  @Column({ name: 'size_bytes', type: 'integer', default: 0 })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 16, default: 'success' })
  status: 'success' | 'failed';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'backup_location', type: 'varchar', length: 512, nullable: true })
  backupLocation: string | null;

  @Column({ name: 'triggered_by', type: 'varchar', length: 64, nullable: true })
  triggeredBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

/** Menu item table — each row is an independent menu item, with hierarchy built via parent_id */
@Entity('sys_menus')
export class Menu {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ name: 'parent_id', type: 'varchar', length: 64, nullable: true })
  parentId: string | null;

  @Column({ name: 'label_key', type: 'varchar', length: 128 })
  labelKey: string;

  @Column({ type: 'varchar', length: 256, default: '' })
  path: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  icon: string;

  /** JSON array string, e.g. '["admin","user"]'; NULL means all roles can access */
  @Column({ type: 'simple-json', nullable: true })
  roles: string[] | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  /** Whether this is a detail route (not shown in the menu) */
  @Column({ name: 'is_detail', type: 'integer', default: 0 })
  isDetail: number;

  /** Subsystem identifier; NULL means a global menu (visible in all subsystems) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  subsystem: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** Menu button table — operation buttons and permission codes associated with menu items */
@Entity('sys_menu_buttons')
export class MenuButton {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ name: 'menu_id', type: 'varchar', length: 64 })
  menuId: string;

  @Column({ name: 'label_key', type: 'varchar', length: 128 })
  labelKey: string;

  @Column({ name: 'permission_code', type: 'varchar', length: 64 })
  permissionCode: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
