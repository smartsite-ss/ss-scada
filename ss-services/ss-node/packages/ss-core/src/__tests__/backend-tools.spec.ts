// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Backend MCP tools - dictionary management tools unit tests
 *
 * Covers 5 dictionary tools:
 *   dict_list, dict_detail, dict_create, dict_addItems, dict_search
 */

import {
  createDictListTool,
  createDictDetailTool,
  createDictCreateTool,
  createDictAddItemsTool,
  createDictSearchTool,
  createAllBackendTools,
  BackendToolServices,
} from '../ai/backend-tools';

// mock dictionary data
const mockDictItems = [
  { value: 'modbus_tcp', label: 'Modbus TCP', sortOrder: 1, description: 'Modbus TCP 协议' },
  { value: 'opc_ua', label: 'OPC UA', sortOrder: 2, description: 'OPC UA 协议' },
  { value: 'mqtt', label: 'MQTT', sortOrder: 3, description: 'MQTT 协议' },
];

const mockCategories = [
  {
    category: 'system',
    tables: [
      { dictId: 'protocolType', dictName: '协议类型', version: '1.0', itemCount: 3 },
      { dictId: 'alarmLevel', dictName: '报警级别', version: '1.0', itemCount: 3 },
    ],
  },
  {
    category: 'device',
    tables: [{ dictId: 'dataType', dictName: '数据类型', version: '1.0', itemCount: 5 }],
  },
];

const mockDict = {
  dictId: 'protocolType',
  dictName: '协议类型',
  category: 'system',
  description: '工业采集协议类型定义',
  version: '1.0',
  items: mockDictItems,
};

function makeMockServices(overrides?: Partial<BackendToolServices>): BackendToolServices {
  return {
    dictService: {
      getAllCategories: jest.fn().mockReturnValue(mockCategories),
      getDict: jest.fn().mockImplementation((dictId: string) => {
        if (dictId === 'protocolType') return mockDict;
        return undefined;
      }),
      createTable: jest.fn(),
      updateTable: jest.fn(),
      getAllDicts: jest.fn().mockReturnValue([mockDict]),
    },
    ...overrides,
  };
}

describe('BackendTools — dictionary management', () => {
  describe('createDictListTool', () => {
    const services = makeMockServices();

    it('TC-DICT-TOOL-001: returns null without dictService', () => {
      const tool = createDictListTool({});
      expect(tool).toBeNull();
    });

    it('TC-DICT-TOOL-002: returns the category tree structure', async () => {
      const tool = createDictListTool(services)!;
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('dict_list');
      expect(tool.category).toBe('dict');
      expect(tool.frontend).toBe(false);

      const result = await tool.execute({ locale: 'zh-CN' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.total).toBe(3);
      expect(parsed.categories).toHaveLength(2);
      expect(parsed.categories[0].tables[0].dictId).toBe('protocolType');
    });

    it('TC-DICT-TOOL-003: default language is zh-CN', async () => {
      const tool = createDictListTool(services)!;
      const result = await tool.execute({});
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('createDictDetailTool', () => {
    const services = makeMockServices();

    it('TC-DICT-TOOL-004: returns null without dictService', () => {
      const tool = createDictDetailTool({});
      expect(tool).toBeNull();
    });

    it('TC-DICT-TOOL-005: query an existing dictionary table\'s details', async () => {
      const tool = createDictDetailTool(services)!;
      const result = await tool.execute({ dictId: 'protocolType' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.dict.dictId).toBe('protocolType');
      expect(parsed.dict.dictName).toBe('协议类型');
      expect(parsed.dict.items).toHaveLength(3);
      expect(parsed.dict.items[0].value).toBe('modbus_tcp');
    });

    it('TC-DICT-TOOL-006: querying a non-existent dictionary table returns an error', async () => {
      const tool = createDictDetailTool(services)!;
      const result = await tool.execute({ dictId: 'nonexistent' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('不存在');
    });
  });

  describe('createDictCreateTool', () => {
    const services = makeMockServices();

    it('TC-DICT-TOOL-007: returns null without dictService', () => {
      const tool = createDictCreateTool({});
      expect(tool).toBeNull();
    });

    it('TC-DICT-TOOL-008: creating a new dictionary table succeeds', async () => {
      const tool = createDictCreateTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'priorityLevel',
        dictName: '优先级',
        category: 'system',
        description: '报警优先级定义',
        items: [
          { value: 'high', label: '高', sortOrder: 1, description: '高优先级' },
          { value: 'low', label: '低', sortOrder: 2, description: '低优先级' },
        ],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.dict.dictId).toBe('priorityLevel');
      expect(parsed.dict.itemCount).toBe(2);
      expect(parsed.message).toBe('字典表已创建');
      expect(services.dictService!.createTable).toHaveBeenCalled();
    });

    it('TC-DICT-TOOL-009: returns an error when items is an empty array', async () => {
      const tool = createDictCreateTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'empty',
        dictName: 'Empty dictionary',
        category: 'system',
        items: [],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('非空数组');
    });

    it('TC-DICT-TOOL-010: returns an error when items is missing', async () => {
      const tool = createDictCreateTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'noItems',
        dictName: '无条目',
        category: 'system',
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
    });
  });

  describe('createDictAddItemsTool', () => {
    const services = makeMockServices();

    it('TC-DICT-TOOL-011: returns null without dictService', () => {
      const tool = createDictAddItemsTool({});
      expect(tool).toBeNull();
    });

    it('TC-DICT-TOOL-012: appending entries to an existing dictionary succeeds', async () => {
      const tool = createDictAddItemsTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'protocolType',
        category: 'system',
        items: [{ value: 'bacnet', label: 'BACnet', sortOrder: 4, description: 'BACnet 协议' }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.addedCount).toBe(1);
      expect(parsed.totalCount).toBe(4); // 3 existing + 1 new
      expect(services.dictService!.updateTable).toHaveBeenCalled();
    });

    it('TC-DICT-TOOL-013: appending entries to a non-existent dictionary returns an error', async () => {
      const tool = createDictAddItemsTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'nonexistent',
        category: 'system',
        items: [{ value: 'test', label: '测试' }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('不存在');
    });

    it('TC-DICT-TOOL-014: returns an error when items is an empty array', async () => {
      const tool = createDictAddItemsTool(services)!;
      const result = await tool.execute({
        locale: 'zh-CN',
        dictId: 'protocolType',
        category: 'system',
        items: [],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
    });
  });

  describe('createDictSearchTool', () => {
    const services = makeMockServices();

    it('TC-DICT-TOOL-015: returns null without dictService', () => {
      const tool = createDictSearchTool({});
      expect(tool).toBeNull();
    });

    it('TC-DICT-TOOL-016: searching by label matches entries', async () => {
      const tool = createDictSearchTool(services)!;
      const result = await tool.execute({ keyword: 'TCP' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.results[0].dictId).toBe('protocolType');
      expect(parsed.results[0].item.value).toBe('modbus_tcp');
    });

    it('TC-DICT-TOOL-017: searching by value matches entries', async () => {
      const tool = createDictSearchTool(services)!;
      const result = await tool.execute({ keyword: 'opc_ua' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.results.length).toBeGreaterThan(0);
      expect(parsed.results[0].item.label).toBe('OPC UA');
    });

    it('TC-DICT-TOOL-018: returns an empty result when the keyword does not match', async () => {
      const tool = createDictSearchTool(services)!;
      const result = await tool.execute({ keyword: 'xyz_unknown' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.results).toHaveLength(0);
      expect(parsed.total).toBe(0);
    });

    it('TC-DICT-TOOL-019: search limited to a category', async () => {
      const tool = createDictSearchTool(services)!;
      const result = await tool.execute({ keyword: 'TCP', category: 'device' });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      // the device category has no TCP-related entries, should be empty
      expect(parsed.results).toHaveLength(0);
    });

    it('TC-DICT-TOOL-020: pageSize limit', async () => {
      // use a dict containing multiple matching items
      const multiItemServices = makeMockServices();
      (multiItemServices.dictService!.getAllDicts as jest.Mock).mockReturnValue([
        {
          ...mockDict,
          items: [
            { value: 'a_tcp', label: 'A TCP', sortOrder: 1, description: '' },
            { value: 'b_tcp', label: 'B TCP', sortOrder: 2, description: '' },
            { value: 'c_tcp', label: 'C TCP', sortOrder: 3, description: '' },
            { value: 'd_tcp', label: 'D TCP', sortOrder: 4, description: '' },
          ],
        },
      ]);
      const tool = createDictSearchTool(multiItemServices)!;
      const result = await tool.execute({ keyword: 'TCP', pageSize: 2 });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('createAllBackendTools — integration', () => {
    it('TC-DICT-TOOL-021: batch creation with the dictionary service should include dict tools', () => {
      const services = makeMockServices();
      const tools = createAllBackendTools(services);
      const dictTools = tools.filter((t) => t.category === 'dict');
      expect(dictTools).toHaveLength(5);
      expect(dictTools.map((t) => t.name).sort()).toEqual([
        'dict_addItems',
        'dict_create',
        'dict_detail',
        'dict_list',
        'dict_search',
      ]);
    });

    it('TC-DICT-TOOL-022: should not include dict tools without the dictionary service', () => {
      const tools = createAllBackendTools({});
      const dictTools = tools.filter((t) => t.category === 'dict');
      expect(dictTools).toHaveLength(0);
    });
  });
});
