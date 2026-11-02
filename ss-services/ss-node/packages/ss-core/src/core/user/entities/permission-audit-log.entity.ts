// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Permission-change audit-log table - added in v7.0
 * Records role-permission modifications, authorization changes, etc.
 */
@Entity('sys_permission_audit_logs')
export class PermissionAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Operator ID */
  @Column({ name: 'operator_id' })
  @Index('idx_pal_operator')
  operatorId: string;

  /** Operator username */
  @Column({ name: 'operator_name' })
  operatorName: string;

  /**
   * Operation type:
   *   grant_role     - grant a role
   *   revoke_role    - revoke a role
   *   update_permissions - update permission codes
   *   update_auth    - update data authorization
   */
  @Column()
  @Index('idx_pal_action')
  action: string;

  /**
   * Target type:
   *   role / user / project_auth / group_auth / device_auth
   */
  @Column({ name: 'target_type' })
  targetType: string;

  /** Target ID */
  @Column({ name: 'target_id' })
  @Index('idx_pal_target')
  targetId: string;

  /** Change details (JSON), e.g. { before: [...], after: [...] } */
  @Column({ type: 'simple-json', nullable: true })
  changes: Record<string, unknown> | null;

  /** Operation IP */
  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
