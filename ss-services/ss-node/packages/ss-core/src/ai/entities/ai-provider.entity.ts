// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Provider config entity - global database table sys_ai_providers
 *
 * Stores the configuration of each LLM provider (API key, models, switch, etc.),
 * read and initialized by LLMProxyService at runtime.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Provider type */
export type AiProviderType = 'deepseek' | 'zhipu' | 'openai' | 'custom';

@Entity('sys_ai_providers')
export class AiProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Provider type identifier */
  @Column({ name: 'provider_id', type: 'varchar', length: 32 })
  providerId: string;

  /** Display name */
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** API key (encrypted storage, ENC: prefix) */
  @Column({ name: 'api_key', type: 'text' })
  apiKey: string;

  /** API base URL */
  @Column({ name: 'api_base', type: 'varchar', length: 256 })
  apiBase: string;

  /** Default model */
  @Column({ name: 'default_model', type: 'varchar', length: 64 })
  defaultModel: string;

  /** Available model list (JSON array string) */
  @Column({ type: 'text', default: '[]' })
  models: string;

  /** Whether enabled */
  @Column({ type: 'integer', default: 1 })
  enabled: number;

  /** Sort order */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  /** Extension config (JSON string: timeout, maxRetries, codegenModel, etc.) */
  @Column({ type: 'text', default: '{}' })
  config: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
