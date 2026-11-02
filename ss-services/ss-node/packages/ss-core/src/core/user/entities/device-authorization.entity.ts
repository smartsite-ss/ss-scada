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

@Entity('sys_device_authorizations')
@Index('idx_da_role_device', ['roleId', 'projectId', 'deviceId'], { unique: true })
export class DeviceAuthorization {
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

  /** Device ID */
  @Column({ name: 'device_id' })
  deviceId: string;

  /** Permission level: read | write */
  @Column({ default: 'read' })
  permission: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
