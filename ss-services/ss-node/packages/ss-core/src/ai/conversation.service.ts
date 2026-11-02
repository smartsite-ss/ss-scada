// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI conversation persistence Service - P2-T08
 *
 * Provides:
 *   1. Session CRUD (create/list/detail/archive/delete)
 *   2. Message CRUD (append/batch-save/query)
 *   3. Context-window management (FIFO/Sliding/Summary truncation strategies)
 *   4. Session history recovery (ChatMessage[] format, consumed directly by the LLM)
 *
 * Data is isolated by project and filtered by user.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation, AiMessage } from './entities/ai-conversation.entity';
import { ChatMessage } from './llm.types';

/** Context-window truncation strategy */
export type TruncationStrategy = 'fifo' | 'sliding' | 'summary';

/** Context-window config */
export interface ContextWindowConfig {
  /** Truncation strategy */
  strategy: TruncationStrategy;
  /** Maximum message count */
  maxMessages: number;
  /** Maximum token count (approx, estimated as 1 token ≈ 4 chars) */
  maxTokens: number;
  /** Summary ratio (summary mode: fraction of leading messages to keep, 0-1) */
  summaryRatio: number;
}

const DEFAULT_WINDOW_CONFIG: ContextWindowConfig = {
  strategy: 'sliding',
  maxMessages: 50,
  maxTokens: 8000,
  summaryRatio: 0.3,
};

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(AiConversation)
    private readonly convRepo: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly msgRepo: Repository<AiMessage>,
  ) {}

  // ============================================================
  //  Session CRUD
  // ============================================================

  /** Create a new session */
  async createConversation(data: {
    title?: string;
    projectId: string;
    userId: string;
    taskType?: string;
    model?: string;
  }): Promise<AiConversation> {
    const conv = this.convRepo.create({
      title: data.title || '新对话',
      projectId: data.projectId,
      userId: data.userId,
      taskType: data.taskType || 'chat',
      model: data.model,
    });
    return this.convRepo.save(conv);
  }

  /** Get the user's session list (projectId optional; when omitted, returns sessions across all the user's projects) */
  async listConversations(userId: string, projectId?: string): Promise<AiConversation[]> {
    return this.convRepo.find({
      where: projectId
        ? { userId, projectId, archived: 0 }
        : { userId, archived: 0 },
      order: { updatedAt: 'DESC' },
    });
  }

  /** Get session details */
  async getConversation(id: string): Promise<AiConversation | null> {
    return this.convRepo.findOne({ where: { id } });
  }

  /** Update session title */
  async updateTitle(id: string, title: string): Promise<void> {
    await this.convRepo.update(id, { title });
  }

  /** Archive/unarchive a session */
  async archiveConversation(id: string, archived: boolean): Promise<void> {
    await this.convRepo.update(id, { archived: archived ? 1 : 0 });
  }

  /** Delete a session and its messages */
  async deleteConversation(id: string): Promise<void> {
    await this.msgRepo.delete({ conversationId: id });
    await this.convRepo.delete(id);
  }

  // ============================================================
  //  Message CRUD
  // ============================================================

  /** Append a message to a session */
  async appendMessage(
    conversationId: string,
    msg: {
      role: string;
      content?: string;
      toolCalls?: string;
      toolCallId?: string;
      toolName?: string;
      tokens?: number;
    },
  ): Promise<AiMessage> {
    // get the current max seq
    const maxSeq = (await this.msgRepo.maximum('seq', { conversationId })) || 0;
    const message = this.msgRepo.create({
      conversationId,
      role: msg.role,
      content: msg.content || null,
      toolCalls: msg.toolCalls || null,
      toolCallId: msg.toolCallId || null,
      toolName: msg.toolName || null,
      tokens: msg.tokens || 0,
      seq: (maxSeq as number) + 1,
    });
    const saved = await this.msgRepo.save(message);

    // update session statistics
    await this.convRepo.increment({ id: conversationId }, 'messageCount', 1);
    if (msg.tokens) {
      await this.convRepo.increment({ id: conversationId }, 'totalTokens', msg.tokens);
    }

    return saved;
  }

  /** Batch-save messages (for first save or recovery) */
  async saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    let seq = 0;
    const entities = messages.map((m) => {
      seq++;
      return this.msgRepo.create({
        conversationId,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : null,
        toolCallId: null,
        tokens: 0,
        seq,
      });
    });
    await this.msgRepo.save(entities);
    await this.convRepo.update(conversationId, { messageCount: seq });
  }

  /** Get all messages of a session */
  async getMessages(conversationId: string): Promise<AiMessage[]> {
    return this.msgRepo.find({
      where: { conversationId },
      order: { seq: 'ASC' },
    });
  }

  /** Get the latest N messages of a session */
  async getRecentMessages(conversationId: string, limit: number): Promise<AiMessage[]> {
    return this.msgRepo
      .find({
        where: { conversationId },
        order: { seq: 'DESC' },
        take: limit,
      })
      .then((msgs) => msgs.reverse());
  }

  // ============================================================
  //  Context-window management
  // ============================================================

  /**
   * Get session history (ChatMessage[] format) with context-window truncation applied
   *
   * @param conversationId session ID
   * @param config window config (optional; defaults to sliding / 50 messages / 8000 tokens)
   * @returns ChatMessage[] (can be passed directly to the LLM API)
   */
  async getConversationHistory(
    conversationId: string,
    config?: Partial<ContextWindowConfig>,
  ): Promise<ChatMessage[]> {
    const cfg = { ...DEFAULT_WINDOW_CONFIG, ...config };
    const allMessages = await this.getMessages(conversationId);

    if (allMessages.length <= cfg.maxMessages) {
      return this.toChatMessages(allMessages);
    }

    switch (cfg.strategy) {
      case 'sliding':
        return this.slidingWindow(allMessages, cfg);
      case 'summary':
        return this.summaryWindow(allMessages, cfg);
      case 'fifo':
      default:
        return this.fifoWindow(allMessages, cfg);
    }
  }

  /** FIFO strategy: keep the most recent messages */
  private fifoWindow(messages: AiMessage[], config: ContextWindowConfig): ChatMessage[] {
    return this.toChatMessages(messages.slice(-config.maxMessages));
  }

  /** Sliding strategy: keep the first N/5 messages + the most recent 4N/5 messages */
  private slidingWindow(messages: AiMessage[], config: ContextWindowConfig): ChatMessage[] {
    const keepHead = Math.ceil(config.maxMessages / 5);
    const keepTail = config.maxMessages - keepHead;
    const head = messages.slice(0, keepHead);
    const tail = messages.slice(-keepTail);
    return this.toChatMessages([...head, ...tail]);
  }

  /** Summary strategy: keep a fraction of the beginning + the most recent (requires summarization capability; currently simplified) */
  private summaryWindow(messages: AiMessage[], config: ContextWindowConfig): ChatMessage[] {
    const headCount = Math.ceil(config.maxMessages * config.summaryRatio);
    const tailCount = config.maxMessages - headCount;
    const head = messages.slice(0, headCount);
    const tail = messages.slice(-tailCount);
    return this.toChatMessages([...head, ...tail]);
  }

  /** AiMessage[] → ChatMessage[] */
  private toChatMessages(messages: AiMessage[]): ChatMessage[] {
    return messages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: m.content || '',
      ...(m.toolCalls ? { toolCalls: JSON.parse(m.toolCalls) } : {}),
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    }));
  }

  /**
   * Truncate by token budget (simplified: estimated by character count)
   */
  truncateByTokens(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    let tokenCount = 0;
    const result: ChatMessage[] = [];
    // keep from the end backwards (keep the most recent)
    for (let i = messages.length - 1; i >= 0; i--) {
      const contentStr =
        typeof messages[i].content === 'string'
          ? messages[i].content
          : JSON.stringify(messages[i].content);
      const estimatedTokens = Math.ceil(contentStr.length / 4);
      if (tokenCount + estimatedTokens > maxTokens && result.length > 0) {
        break;
      }
      tokenCount += estimatedTokens;
      result.unshift(messages[i]);
    }
    return result;
  }

  /** Auto-generate a title from the conversation content */
  async autoGenerateTitle(conversationId: string, firstUserMessage: string): Promise<void> {
    // use the first 30 characters of the user's first message as the title
    const title =
      firstUserMessage.length > 30 ? firstUserMessage.substring(0, 30) + '...' : firstUserMessage;
    await this.convRepo.update(conversationId, { title });
  }
}
