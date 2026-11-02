// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Conversation persistence Service unit tests - P2-T08
 */

import { ConversationService, ContextWindowConfig } from '../conversation.service';
import { AiMessage } from '../entities/ai-conversation.entity';

function makeService() {
  const mockConvRepo: any = {
    create: jest.fn((dto) => ({ ...dto, id: 'conv-1' })),
    save: jest.fn((entity) => Promise.resolve(entity)),
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
    update: jest.fn(() => Promise.resolve({})),
    delete: jest.fn(() => Promise.resolve({})),
    increment: jest.fn(() => Promise.resolve({})),
  };

  const mockMsgRepo: any = {
    create: jest.fn((dto) => ({ ...dto, id: 'msg-1' })),
    save: jest.fn((entity) => Promise.resolve(entity)),
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(null)),
    delete: jest.fn(() => Promise.resolve({})),
    maximum: jest.fn(() => Promise.resolve(0)),
  };

  return { service: new ConversationService(mockConvRepo, mockMsgRepo), mockConvRepo, mockMsgRepo };
}

describe('ConversationService — session CRUD', () => {
  it('Should create a session', async () => {
    const { service, mockConvRepo } = makeService();
    const conv = await service.createConversation({
      projectId: 'proj-1',
      userId: 'user-1',
      title: 'Test session',
    });
    expect(conv.title).toBe('Test session');
    expect(mockConvRepo.save).toHaveBeenCalledTimes(1);
  });

  it('Should list sessions', async () => {
    const { service, mockConvRepo } = makeService();
    mockConvRepo.find = jest.fn(() =>
      Promise.resolve([
        { id: 'conv-1', title: 'A', archived: 0 },
        { id: 'conv-2', title: 'B', archived: 0 },
      ]),
    );
    const list = await service.listConversations('user-1', 'proj-1');
    expect(list.length).toBe(2);
  });

  it('Should get the session', async () => {
    const { service, mockConvRepo } = makeService();
    mockConvRepo.findOne = jest.fn(() => Promise.resolve({ id: 'conv-1', title: 'X' }));
    const conv = await service.getConversation('conv-1');
    expect(conv?.title).toBe('X');
  });

  it('Should update the title', async () => {
    const { service, mockConvRepo } = makeService();
    await service.updateTitle('conv-1', '新标题');
    expect(mockConvRepo.update).toHaveBeenCalledWith('conv-1', { title: '新标题' });
  });

  it('Should archive the session', async () => {
    const { service, mockConvRepo } = makeService();
    await service.archiveConversation('conv-1', true);
    expect(mockConvRepo.update).toHaveBeenCalledWith('conv-1', { archived: 1 });
  });

  it('Should delete the session and its messages', async () => {
    const { service, mockConvRepo, mockMsgRepo } = makeService();
    await service.deleteConversation('conv-1');
    expect(mockMsgRepo.delete).toHaveBeenCalledWith({ conversationId: 'conv-1' });
    expect(mockConvRepo.delete).toHaveBeenCalledWith('conv-1');
  });
});

describe('ConversationService — message CRUD', () => {
  it('Should append messages', async () => {
    const { service, mockMsgRepo } = makeService();
    await service.appendMessage('conv-1', { role: 'user', content: 'hello' });
    expect(mockMsgRepo.save).toHaveBeenCalled();
    expect(mockMsgRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hello', seq: 1 }),
    );
  });

  it('Should batch-save messages', async () => {
    const { service, mockMsgRepo } = makeService();
    const msgs = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ];
    await service.saveMessages('conv-1', msgs);
    expect(mockMsgRepo.save).toHaveBeenCalledTimes(1);
    expect(mockMsgRepo.create).toHaveBeenCalledTimes(2);
  });

  it('Should get messages', async () => {
    const { service, mockMsgRepo } = makeService();
    mockMsgRepo.find = jest.fn(() =>
      Promise.resolve([
        { seq: 1, role: 'user', content: 'hi' },
        { seq: 2, role: 'assistant', content: 'hello' },
      ]),
    );
    const msgs = await service.getMessages('conv-1');
    expect(msgs.length).toBe(2);
  });
});

describe('ConversationService — context window management', () => {
  function makeMessages(count: number): AiMessage[] {
    return Array.from(
      { length: count },
      (_, i) =>
        ({
          id: `msg-${i}`,
          conversationId: 'conv-1',
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message ${i}`,
          toolCalls: null,
          toolCallId: null,
          toolName: null,
          tokens: 10,
          seq: i + 1,
          createdAt: new Date(),
        }) as AiMessage,
    );
  }

  it('The FIFO strategy should keep the most recent N entries', async () => {
    const { service, mockMsgRepo } = makeService();
    const allMsgs = makeMessages(60);
    mockMsgRepo.find = jest.fn(() => Promise.resolve(allMsgs));

    const config: Partial<ContextWindowConfig> = {
      strategy: 'fifo',
      maxMessages: 10,
      maxTokens: 99999,
      summaryRatio: 0.3,
    };
    const history = await service.getConversationHistory('conv-1', config);
    expect(history.length).toBeLessThanOrEqual(10);
    // the last entry should be kept
    expect(history[history.length - 1].content).toContain('59');
  });

  it('When the message count is within the limit, return all', async () => {
    const { service, mockMsgRepo } = makeService();
    const allMsgs = makeMessages(5);
    mockMsgRepo.find = jest.fn(() => Promise.resolve(allMsgs));

    const history = await service.getConversationHistory('conv-1');
    expect(history.length).toBe(5);
  });

  it('The Sliding strategy should keep head+tail', async () => {
    const { service, mockMsgRepo } = makeService();
    const allMsgs = makeMessages(30);
    mockMsgRepo.find = jest.fn(() => Promise.resolve(allMsgs));

    const config: Partial<ContextWindowConfig> = {
      strategy: 'sliding',
      maxMessages: 10,
      maxTokens: 99999,
      summaryRatio: 0.3,
    };
    const history = await service.getConversationHistory('conv-1', config);
    expect(history.length).toBeLessThanOrEqual(10);
  });

  it('The Summary strategy should keep proportions', async () => {
    const { service, mockMsgRepo } = makeService();
    const allMsgs = makeMessages(20);
    mockMsgRepo.find = jest.fn(() => Promise.resolve(allMsgs));

    const config: Partial<ContextWindowConfig> = {
      strategy: 'summary',
      maxMessages: 10,
      maxTokens: 99999,
      summaryRatio: 0.3,
    };
    const history = await service.getConversationHistory('conv-1', config);
    expect(history.length).toBeLessThanOrEqual(10);
  });

  it('Token-based truncation should limit the message count', () => {
    const { service } = makeService();
    const messages = makeMessages(20).map((_m) => ({
      role: 'user' as const,
      content: 'x'.repeat(100),
    }));

    const truncated = service.truncateByTokens(messages, 50);
    expect(truncated.length).toBeLessThan(20);
  });

  it('Should auto-generate the title (truncate when too long)', async () => {
    const { service, mockConvRepo } = makeService();
    // exceeds the 30-character limit
    const longMsg = '这是一段非常非常长的用户输入文本消息用来测试标题自动截断功能是否能够正常工作';
    await service.autoGenerateTitle('conv-1', longMsg);
    expect(mockConvRepo.update).toHaveBeenCalledWith('conv-1', {
      title: longMsg.substring(0, 30) + '...',
    });
  });
});
