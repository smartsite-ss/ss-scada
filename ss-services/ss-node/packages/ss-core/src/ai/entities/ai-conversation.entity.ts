// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI conversation and session-message entity - P2-T08 conversation persistence
 *
 * sys_ai_conversations: session list (isolated by project + user)
 * sys_ai_messages:     messages within a session (role/content/tool_calls)
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sys_ai_conversations')
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Session title (auto-generated or user-defined) */
  @Column({ type: 'varchar', length: 200, default: '新对话' })
  title: string;

  /** Related project ID (isolated by project) */
  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId: string;

  /** Creating user ID */
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  /** Task type (chat/codegen/scene_create/analysis) */
  @Column({ name: 'task_type', type: 'varchar', length: 32, default: 'chat' })
  taskType: string;

  /** Model used (e.g. deepseek-chat) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string;

  /** Stats: message count */
  @Column({ name: 'message_count', type: 'integer', default: 0 })
  messageCount: number;

  /** Stats: total token consumption */
  @Column({ name: 'total_tokens', type: 'integer', default: 0 })
  totalTokens: number;

  /** Whether archived */
  @Column({ type: 'integer', default: 0 })
  archived: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('sys_ai_messages')
export class AiMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Related session ID */
  @Column({ name: 'conversation_id', type: 'varchar', length: 36 })
  conversationId: string;

  /** Message role (system/user/assistant/tool) */
  @Column({ type: 'varchar', length: 16 })
  role: string;

  /** Message content */
  @Column({ type: 'text', nullable: true })
  content: string;

  /** Tool call record (JSON string) */
  @Column({ name: 'tool_calls', type: 'text', nullable: true })
  toolCalls: string;

  /** Tool call ID (for tool role) */
  @Column({ name: 'tool_call_id', type: 'varchar', length: 64, nullable: true })
  toolCallId: string;

  /** Tool name (for tool role) */
  @Column({ name: 'tool_name', type: 'varchar', length: 64, nullable: true })
  toolName: string;

  /** Token consumption */
  @Column({ type: 'integer', default: 0 })
  tokens: number;

  /** Message sequence number (ordering within session) */
  @Column({ name: 'seq', type: 'integer', default: 0 })
  seq: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
