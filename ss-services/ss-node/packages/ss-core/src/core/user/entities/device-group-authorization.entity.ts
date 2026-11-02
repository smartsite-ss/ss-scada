// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Role } from './role.entity';

/**
 * Device-group authorization table - added in v7.0
 * Controls a role's access to device groups
 */
@Entity('sys_device_group_authorizations')
@Index('idx_dga_role_group', ['roleId', 'projectId', 'groupId'], { unique: true })
export class DeviceGroupAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Which role is authorized */
  @Column({ name: 'role_id' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  /** Owning project */
  @Column({ name: 'project_id' })
  projectId: string;

  /** Device-group ID */
  @Column({ name: 'group_id' })
  groupId: string;

  /** Permission level: read | write */
  @Column({ default: 'read' })
  permission: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
