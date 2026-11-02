// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Cost-monitor Service unit tests - P2-T08
 */

import { CostMonitorService, estimateCost, MODEL_PRICES } from '../cost-monitor.service';

function makeService(monthlyBudget = 100) {
  const mockLogRepo: any = {
    create: jest.fn((dto) => ({ ...dto, id: 'log-1' })),
    save: jest.fn((e) => Promise.resolve({ ...e, id: e.id || 'log-1' })),
    find: jest.fn(() => Promise.resolve([])),
  };

  const mockConfig: any = {
    get: jest.fn((key: string) => {
      if (key === 'AI_MONTHLY_BUDGET') return String(monthlyBudget);
      return undefined;
    }),
  };

  return { service: new CostMonitorService(mockLogRepo, mockConfig), mockLogRepo, mockConfig };
}

describe('estimateCost', () => {
  it('Should compute costs correctly', () => {
    const cost = estimateCost('deepseek-chat', 1000000, 1000000);
    // prompt: 0.27, completion: 1.10 → 1.37
    expect(cost).toBeCloseTo(1.37, 1);
  });

  it('Unknown models should use default pricing', () => {
    const cost = estimateCost('unknown-model', 1000000, 1000000);
    expect(cost).toBeCloseTo(3.0, 1); // 1+2
  });

  it('Zero tokens should return zero cost', () => {
    const cost = estimateCost('deepseek-chat', 0, 0);
    expect(cost).toBe(0);
  });
});

describe('MODEL_PRICES', () => {
  it('Should include known model pricing', () => {
    expect(MODEL_PRICES['deepseek-chat']).toBeDefined();
    expect(MODEL_PRICES['gpt-4o']).toBeDefined();
    expect(MODEL_PRICES['claude-3-opus']).toBeDefined();
    expect(MODEL_PRICES['default']).toBeDefined();
  });
});

describe('CostMonitorService — log recording', () => {
  it('Should write logs', async () => {
    const { service, mockLogRepo } = makeService();
    await service.logUsage({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      taskType: 'chat',
      promptTokens: 1000,
      completionTokens: 500,
      success: true,
    });
    expect(mockLogRepo.save).toHaveBeenCalledTimes(1);
    expect(mockLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        totalTokens: 1500,
        success: 1,
      }),
    );
  });

  it('Should write failure logs', async () => {
    const { service, mockLogRepo } = makeService();
    await service.logUsage({
      providerId: 'deepseek',
      model: 'deepseek-chat',
      taskType: 'chat',
      promptTokens: 500,
      completionTokens: 0,
      success: false,
      errorMessage: 'timeout',
    });
    expect(mockLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success: 0,
        errorMessage: 'timeout',
      }),
    );
  });
});

describe('CostMonitorService — budget check', () => {
  it('Should allow continuing when the budget is sufficient', async () => {
    const { service, mockLogRepo } = makeService(100);
    // simulate 50 already spent this month
    mockLogRepo.find = jest.fn(() =>
      Promise.resolve([
        {
          totalTokens: 10000000,
          estimatedCost: 50,
          success: 1,
          providerId: 'd',
          taskType: 'chat',
          model: 'm',
        },
      ]),
    );
    const result = await service.canProceed();
    expect(result.allowed).toBe(true);
  });

  it('Should trip the circuit breaker at 100%', async () => {
    const { service, mockLogRepo } = makeService(100);
    mockLogRepo.find = jest.fn(() =>
      Promise.resolve([
        {
          totalTokens: 20000000,
          estimatedCost: 110,
          success: 1,
          providerId: 'd',
          taskType: 'chat',
          model: 'm',
        },
      ]),
    );
    const result = await service.canProceed();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('已耗尽');
  });

  it('Should alarm at 80% without blocking', async () => {
    const { service, mockLogRepo } = makeService(100);
    mockLogRepo.find = jest.fn(() =>
      Promise.resolve([
        {
          totalTokens: 15000000,
          estimatedCost: 85,
          success: 1,
          providerId: 'd',
          taskType: 'chat',
          model: 'm',
        },
      ]),
    );
    const result = await service.canProceed();
    expect(result.allowed).toBe(true);
  });
});

describe('CostMonitorService — model pricing', () => {
  it('Should get known model pricing', () => {
    const { service } = makeService();
    const price = service.getModelPrice('deepseek-chat');
    expect(price.prompt).toBe(0.27);
    expect(price.completion).toBe(1.1);
  });

  it('Should get all model pricing', () => {
    const { service } = makeService();
    const all = service.getAllModelPrices();
    expect(all['deepseek-chat']).toBeDefined();
    expect(all['default']).toBeDefined();
  });
});

describe('CostMonitorService — statistics', () => {
  it('Should return the current month\'s statistics', async () => {
    const { service, mockLogRepo } = makeService();
    mockLogRepo.find = jest.fn(() =>
      Promise.resolve([
        {
          totalTokens: 1000,
          estimatedCost: 0.05,
          success: 1,
          providerId: 'deepseek',
          taskType: 'chat',
          model: 'm',
        },
        {
          totalTokens: 500,
          estimatedCost: 0.02,
          success: 0,
          providerId: 'deepseek',
          taskType: 'codegen',
          model: 'm',
        },
      ]),
    );
    const stats = await service.getCurrentMonthStats();
    expect(stats.totalTokens).toBe(1500);
    expect(stats.totalCost).toBe(0.07);
    expect(stats.totalCalls).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.byProvider['deepseek'].tokens).toBe(1500);
    expect(stats.byTaskType['chat'].calls).toBe(1);
    expect(stats.byTaskType['codegen'].calls).toBe(1);
  });
});
