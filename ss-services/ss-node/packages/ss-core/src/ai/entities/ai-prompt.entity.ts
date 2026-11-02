// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Prompt version-management entity - P2-T08 Prompt version management
 *
 * sys_ai_prompts:        Prompt template definitions (by task type)
 * sys_ai_prompt_versions: Prompt version history (draft->active->archived)
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Prompt version status */
export type PromptVersionStatus = 'draft' | 'active' | 'archived';

@Entity('sys_ai_prompts')
export class AiPrompt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Prompt identifier key (e.g. scene_creation, plugin_gen, script_gen) */
  @Column({ type: 'varchar', length: 64, unique: true })
  key: string;

  /** Display name */
  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** Task type */
  @Column({ name: 'task_type', type: 'varchar', length: 32, default: 'chat' })
  taskType: string;

  /** Description */
  @Column({ type: 'varchar', length: 512, nullable: true })
  description: string;

  /** Current active version ID */
  @Column({ name: 'active_version_id', type: 'varchar', length: 36, nullable: true })
  activeVersionId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('sys_ai_prompt_versions')
export class AiPromptVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Related Prompt ID */
  @Column({ name: 'prompt_id', type: 'varchar', length: 36 })
  promptId: string;

  /** Version number (e.g. v1.0, v1.1) */
  @Column({ type: 'varchar', length: 16 })
  version: string;

  /** Version status (draft/active/archived) */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: PromptVersionStatus;

  /** System Prompt template content (supports {{variable}} template syntax) */
  @Column({ name: 'system_prompt', type: 'text' })
  systemPrompt: string;

  /** Template variable list (JSON array string) */
  @Column({ type: 'text', nullable: true })
  variables: string;

  /** Suggested LLM config (JSON: model/temperature/maxTokens) */
  @Column({ type: 'text', nullable: true })
  llmConfig: string;

  /** Change description */
  @Column({ type: 'varchar', length: 512, nullable: true })
  changelog: string;

  /** Evaluation metrics (JSON: tests passed, accuracy, average latency, etc.) */
  @Column({ type: 'text', nullable: true })
  metrics: string;

  /** Creating user ID */
  @Column({ name: 'created_by', type: 'varchar', length: 36, nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
