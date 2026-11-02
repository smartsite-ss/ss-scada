// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column } from 'typeorm';

/**
 * Base entity - fields shared by all entities
 * Contains id, createdAt, updatedAt
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}

/**
 * Project-scoped entity - extends BaseEntity, additionally contains the projectId field
 * For business entities isolated by project (Device, DataTag, Alarm, etc.)
 */
export abstract class ProjectScopedEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  projectId: string;
}
