// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI usage and cost log entity - P2-T08 cost monitoring and budget circuit-breaker
 *
 * sys_ai_usage_logs: token and cost records for each LLM call
 */

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('sys_ai_usage_logs')
export class AiUsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Provider ID (deepseek/zhipu/openai, etc.) */
  @Column({ name: 'provider_id', type: 'varchar', length: 32 })
  @Index()
  providerId: string;

  /** Model name */
  @Column({ type: 'varchar', length: 64 })
  @Index()
  model: string;

  /** Task type (chat/codegen/scene_create/analysis) */
  @Column({ name: 'task_type', type: 'varchar', length: 32, default: 'chat' })
  @Index()
  taskType: string;

  /** User ID */
  @Column({ name: 'user_id', type: 'varchar', length: 36, nullable: true })
  @Index()
  userId: string;

  /** Project ID */
  @Column({ name: 'project_id', type: 'varchar', length: 64, nullable: true })
  projectId: string;

  /** Session ID */
  @Column({ name: 'conversation_id', type: 'varchar', length: 36, nullable: true })
  conversationId: string;

  /** Request token count */
  @Column({ name: 'prompt_tokens', type: 'integer', default: 0 })
  promptTokens: number;

  /** Response token count */
  @Column({ name: 'completion_tokens', type: 'integer', default: 0 })
  completionTokens: number;

  /** Total token count */
  @Column({ name: 'total_tokens', type: 'integer', default: 0 })
  totalTokens: number;

  /** Estimated cost (USD) */
  @Column({ name: 'estimated_cost', type: 'decimal', precision: 12, scale: 8, default: 0 })
  estimatedCost: number;

  /** Whether successful */
  @Column({ type: 'integer', default: 1 })
  success: number;

  /** Error message */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  /** Response latency (ms) */
  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
