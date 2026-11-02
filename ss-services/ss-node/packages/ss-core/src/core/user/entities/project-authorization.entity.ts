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

@Entity('sys_project_authorizations')
@Index('idx_pa_role_project', ['roleId', 'projectId'], { unique: true })
export class ProjectAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Which role is authorized */
  @Column({ name: 'role_id' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  /** Project name (the project name in projectinfo.json) */
  @Column({ name: 'project_id' })
  projectId: string;

  /** Permission level: read | write | admin */
  @Column({ default: 'read' })
  permission: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
