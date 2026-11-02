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
 * Tag-level authorization table - added in v7.0 (implemented in 3.6)
 *
 * Controls a role's access to specific data tags.
 * When a role has no explicit tag authorization, fall back to the owning device's authorization (fallback to device-level).
 *
 * @see device-management design doc section 11
 */
@Entity('sys_tag_authorizations')
@Index('idx_ta_role_tag', ['roleId', 'projectId', 'tagId'], { unique: true })
export class TagAuthorization {
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

  /** Data-tag ID */
  @Column({ name: 'tag_id' })
  tagId: string;

  /** Permission level: read | write */
  @Column({ default: 'read' })
  permission: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
