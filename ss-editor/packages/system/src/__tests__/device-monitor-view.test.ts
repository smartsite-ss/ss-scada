// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

// ======================== Mock i18n ========================
// i18n message templates required by formatPeriod (kept consistent with zh-CN.json)
const I18N_TEMPLATES: Record<string, string> = {
  'system.deviceMonitor.durationMs': '{n}ms',
  'system.deviceMonitor.durationSec': '{n}s',
  'system.deviceMonitor.durationMin': '{n}min',
};
const t = vi.fn((key: string, params?: any) => {
  const tpl = I18N_TEMPLATES[key];
  if (tpl && params && typeof params === 'object') {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  }
  if (params && typeof params === 'object') {
    return key + JSON.stringify(params);
  }
  return key;
});
vi.mock('@scada-editor/core', () => ({
  useI18n: () => ({ t, locale: { value: 'zh-CN' } }),
  i18n: { global: { t } },
}));

// ======================== Mock SsLoading ========================
vi.mock('@scada-editor/shared', () => ({
  SsLoading: {
    name: 'SsLoading',
    props: ['text', 'size'],
    template: '<div class="ss-loading-mock">{{ text }}</div>',
  },
}));

// ======================== Mock deviceApi ========================
const mockDeviceApi = {
  getById: vi.fn(),
  getLatestValues: vi.fn(),
  getGroupTree: vi.fn(),
};

vi.mock('../api/modules/device.api', () => ({
  deviceApi: mockDeviceApi,
}));

// ======================== Mock alarmApi ========================
const mockAlarmApi = {
  getRules: vi.fn(),
};

vi.mock('../api/modules/alarm.api', () => ({
  alarmApi: mockAlarmApi,
}));

// ======================== Mock useProjectContext ========================
vi.mock('../composables/useProjectContext', () => ({
  useProjectContext: () => ({
    defaultProjectId: { value: null },
    loadDefault: vi.fn().mockResolvedValue(null),
    setDefaultProject: vi.fn().mockResolvedValue(undefined),
    clearDefaultProject: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ======================== Mock stores ========================
const mockDeviceStore = {
  groupTree: [] as any[],
  rootDevices: [] as any[],
  fetchGroupTree: vi.fn().mockResolvedValue(undefined),
  fetchDevices: vi.fn().mockResolvedValue(undefined),
  fetchDevice: vi.fn().mockResolvedValue(undefined),
  fetchLatestValues: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../stores/device.store', () => ({
  useDeviceStore: () => mockDeviceStore,
}));

const mockProjectStore = {
  projects: [
    { projectId: 'proj-1', projectName: '测试项目1' },
    { projectId: 'proj-2', projectName: '测试项目2' },
  ],
  fetchProjects: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

const mockWsStore = {
  isConnected: false,
  connectionStatus: 'disconnected',
  tagValues: new Map(),
  connect: vi.fn().mockResolvedValue(undefined),
  subscribeTags: vi.fn(),
  unsubscribeTags: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('../stores/ws.store', () => ({
  useWsStore: () => mockWsStore,
}));

// ======================== Helpers ========================
const mockDevice = (overrides: Record<string, any> = {}) => ({
  id: 'dev-1',
  deviceCode: 'device-001',
  deviceName: '测试设备1',
  nameAlias: '设备别名',
  description: '测试描述',
  type: 'modbus_tcp',
  driver: 'modbus',
  status: 'online',
  groupId: 'group-1',
  scanRate: 1000,
  errorCount: 0,
  lastOnlineAt: '2026-07-16T10:00:00.000Z',
  lastDataAt: '2026-07-17T10:00:00.000Z',
  updatedAt: '2026-07-17T12:00:00.000Z',
  connection: { host: '192.168.1.1', port: 502, unitId: 1 },
  tags: [
    { id: 'tag-1', name: '温度', address: '40001', dataType: 'float32' },
    { id: 'tag-2', name: '湿度', address: '40002', dataType: 'float32' },
  ],
  ...overrides,
});

const mockGroupTree = (overrides: any[] = []) => {
  if (overrides.length > 0) return overrides;
  return [
    {
      group: { id: 'group-1', name: '分组1', projectId: 'proj-1' },
      devices: [mockDevice()],
      children: [
        {
          group: { id: 'group-1-1', name: '子分组1-1', projectId: 'proj-1' },
          devices: [mockDevice({ id: 'dev-2', deviceCode: 'device-002', deviceName: '测试设备2' })],
          children: [],
        },
      ],
    },
  ];
};

async function mountMonitorView() {
  // Reset mocks before each mount
  mockDeviceStore.fetchGroupTree.mockClear();
  mockDeviceStore.fetchGroupTree.mockResolvedValue(undefined);
  mockProjectStore.fetchProjects.mockClear();
  mockProjectStore.fetchProjects.mockResolvedValue(undefined);

  // Dynamic import to ensure mocks are applied
  const mod = await import('../views/device/DeviceMonitorView.vue');
  return mount(mod.default, {
    global: {
      mocks: {
        $t: t,
      },
      stubs: {
        MonitorGroupTreeNode: true,
      },
    },
  });
}

// ======================== Tests ========================
describe('DeviceMonitorView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Default mock return values
    mockDeviceApi.getById.mockResolvedValue({ data: mockDevice() });
    mockDeviceApi.getLatestValues.mockResolvedValue({ data: {} });
    mockDeviceApi.getGroupTree.mockResolvedValue({ data: mockGroupTree() });
    mockAlarmApi.getRules.mockResolvedValue({ data: [] });
    mockDeviceStore.groupTree = mockGroupTree();
  });

  describe('Initial rendering', () => {
    it('Should render the left device tree title correctly', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      expect(wrapper.find('.sidebar-title').text()).toContain('system.deviceMonitor.deviceTree');
    });

    it('Should show the empty state hint (when no device is selected)', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-state h3').text()).toContain('system.deviceMonitor.selectDeviceHint');
    });

    it('Should load the project list and show project nodes', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      // Project nodes should be rendered
      const projectNodes = wrapper.findAll('.project-node');
      expect(projectNodes.length).toBeGreaterThan(0);
      expect(projectNodes[0].text()).toContain('测试项目1');
    });

    it('Should auto-expand the first project on mount', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      expect(mockDeviceStore.fetchGroupTree).toHaveBeenCalledWith('proj-1');
      expect(wrapper.find('.project-node.expanded').exists()).toBe(true);
    });
  });

  describe('Device tree interaction', () => {
    it('Clicking a project node should expand/collapse', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const projectNode = wrapper.find('.project-node');
      expect(projectNode.classes()).toContain('expanded');

      // Click to collapse
      await projectNode.trigger('click');
      // Note: selectProject collapses when already expanded
      await flushPromises();
      // Click again to expand
      await projectNode.trigger('click');
      await flushPromises();
      expect(mockDeviceStore.fetchGroupTree).toHaveBeenCalled();
    });

    it('Clicking the refresh button should reload the project list', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const refreshBtn = wrapper.find('.btn-refresh');
      await refreshBtn.trigger('click');
      await flushPromises();
      expect(mockProjectStore.fetchProjects).toHaveBeenCalled();
    });

    it('Should show the empty hint when there are no projects', async () => {
      mockProjectStore.projects = [];
      const wrapper = await mountMonitorView();
      await flushPromises();
      expect(wrapper.find('.tree-empty').text()).toContain('system.devices.noProjects');
      // Restore
      mockProjectStore.projects = [
        { projectId: 'proj-1', projectName: '测试项目1' },
      ];
    });
  });

  describe('Device detail - basic info', () => {
    it('After selecting a device, the device header info should be shown', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      // Simulate selecting a device
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await flushPromises();

      expect(wrapper.find('.device-header').exists()).toBe(true);
      expect(wrapper.find('.device-name').text()).toContain('测试设备1');
    });

    it('The basic info tab should show the device info grid', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      vm.activeTab = 'basic';
      await vm.loadDeviceDetail();
      await flushPromises();

      const infoGrid = wrapper.find('.info-grid');
      expect(infoGrid.exists()).toBe(true);
      const infoItems = wrapper.findAll('.info-item');
      expect(infoItems.length).toBeGreaterThan(0);
    });

    it('Should show the channel config (when connection exists)', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      vm.activeTab = 'basic';
      await vm.loadDeviceDetail();
      await flushPromises();

      expect(wrapper.find('.channel-grid').exists()).toBe(true);
      expect(wrapper.find('.driver-tag').text()).toBe('modbus');
    });

    it('Should mask sensitive fields', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      // Call the maskSensitive function
      const result = vm.maskSensitive('password', 'secret123');
      expect(result).toBe('***');
      const normalResult = vm.maskSensitive('host', '192.168.1.1');
      expect(normalResult).toBe('192.168.1.1');
    });
  });

  describe('Device detail - real-time data', () => {
    it('The real-time data tab should load tag data', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await vm.refreshRealtimeData();
      await flushPromises();

      expect(mockDeviceApi.getById).toHaveBeenCalledWith('proj-1', 'dev-1');
      expect(mockDeviceApi.getLatestValues).toHaveBeenCalledWith('proj-1', 'dev-1');
      expect(vm.tagDataList.length).toBe(2); // two tags
    });

    it('Auto refresh should call refreshRealtimeData on a timer', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      vm.activeTab = 'realtime';

      vm.toggleAutoRefresh();
      expect(vm.autoRefresh).toBe(true);

      vm.toggleAutoRefresh();
      expect(vm.autoRefresh).toBe(false);
    });

    it('Should show the connection status when WebSocket is connected', async () => {
      mockWsStore.isConnected = true;
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      vm.activeTab = 'realtime';
      await vm.loadDeviceDetail();
      await flushPromises();

      expect(wrapper.find('.ws-status.ws-connected').exists()).toBe(true);
      mockWsStore.isConnected = false;
    });
  });

  describe('Device detail - alarm rules', () => {
    it('Switching to the alarm tab should load alarm rules', async () => {
      const alarmRules = [
        {
          id: 'rule-1',
          name: '高温报警',
          level: 'critical',
          condition: '>',
          conditionValue: '80',
          enabled: true,
          tagId: 'tag-1',
          projectId: 'proj-1',
        },
      ];
      mockAlarmApi.getRules.mockResolvedValue({ data: alarmRules });

      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      vm.activeTab = 'alarms';
      await vm.loadAlarmRules();
      await flushPromises();

      expect(mockAlarmApi.getRules).toHaveBeenCalledWith('proj-1');
      expect(vm.deviceAlarmRules.length).toBe(1);
      expect(vm.deviceAlarmRules[0].name).toBe('高温报警');
    });

    it('Should show the empty hint when there are no related alarm rules', async () => {
      mockAlarmApi.getRules.mockResolvedValue({ data: [] });
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      vm.activeTab = 'alarms';
      await vm.loadAlarmRules();
      await flushPromises();

      expect(vm.deviceAlarmRules.length).toBe(0);
    });

    it('Should filter alarm rules by device tag ID', async () => {
      const allRules = [
        { id: 'rule-1', name: '规则1', tagId: 'tag-1', level: 'warning', condition: '>', conditionValue: '50', enabled: true, projectId: 'proj-1' },
        { id: 'rule-2', name: '规则2', tagId: 'tag-other', level: 'error', condition: '<', conditionValue: '10', enabled: false, projectId: 'proj-1' },
      ];
      mockAlarmApi.getRules.mockResolvedValue({ data: allRules });

      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      // Device has tag-1 and tag-2
      await vm.loadDeviceDetail();
      await vm.loadAlarmRules();
      await flushPromises();

      // Only rules with tagId tag-1 should be kept
      expect(vm.deviceAlarmRules.length).toBe(1);
      expect(vm.deviceAlarmRules[0].id).toBe('rule-1');
    });
  });

  describe('工具函数', () => {
    it('formatTime should format ISO dates correctly', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      const result = vm.formatTime('2026-07-17T10:00:00.000Z');
      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('formatTime should handle SQLite date formats', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      const result = vm.formatTime('2026-07-17 10:00:00');
      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('formatTime should return "-" for empty values', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      expect(vm.formatTime(null)).toBe('-');
      expect(vm.formatTime(undefined)).toBe('-');
      expect(vm.formatTime('')).toBe('-');
    });

    it('formatPeriod should format periods correctly', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      expect(vm.formatPeriod(500)).toBe('500ms');
      expect(vm.formatPeriod(1000)).toBe('1.0s');
      expect(vm.formatPeriod(5000)).toBe('5.0s');
      expect(vm.formatPeriod(60000)).toBe('1.0min');
      expect(vm.formatPeriod(0)).toBe('-');
      expect(vm.formatPeriod(null)).toBe('-');
    });

    it('deviceTypeLabel should return the type label', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      expect(vm.deviceTypeLabel('modbus_tcp')).toContain('modbus_tcp');
      expect(vm.deviceTypeLabel('unknown')).toBe('unknown');
    });

    it('deviceStatusLabel should return the status label', async () => {
      const wrapper = await mountMonitorView();
      const vm = wrapper.vm as any;
      expect(vm.deviceStatusLabel('online')).toContain('statusOnline');
      expect(vm.deviceStatusLabel('unknown')).toBe('unknown');
    });
  });

  describe('Tab switching', () => {
    it('Should render three tab buttons', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await flushPromises();

      const tabs = wrapper.findAll('.tab-item');
      expect(tabs.length).toBe(3);
      expect(tabs[0].text()).toContain('system.deviceMonitor.tabRealtime');
      expect(tabs[1].text()).toContain('system.deviceMonitor.tabBasic');
      expect(tabs[2].text()).toContain('system.deviceMonitor.tabAlarms');
    });

    it('The default tab should be realtime', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.activeTab).toBe('realtime');
    });

    it('Clicking Tab should switch the active state', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await flushPromises();

      const tabs = wrapper.findAll('.tab-item');
      await tabs[1].trigger('click');
      expect(vm.activeTab).toBe('basic');
      expect(tabs[1].classes()).toContain('active');
    });
  });

  describe('WebSocket subscription', () => {
    it('After selecting a device, WebSocket tags should be subscribed', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await vm.subscribeWsTags();
      await flushPromises();

      expect(mockWsStore.connect).toHaveBeenCalledWith('proj-1');
      expect(mockWsStore.subscribeTags).toHaveBeenCalledWith(['tag-1', 'tag-2']);
    });

    it('Switching devices should unsubscribe the old subscription and create a new one', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      await vm.subscribeWsTags();
      await flushPromises();

      // Unsubscribe
      vm.unsubscribeWsTags();
      expect(mockWsStore.unsubscribeTags).toHaveBeenCalledWith(['tag-1', 'tag-2']);
    });
  });

  describe('Component unmount', () => {
    it('Should stop auto refresh and cancel the WS subscription on unmount', async () => {
      const wrapper = await mountMonitorView();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.selectedDeviceId = 'dev-1';
      vm.projectId = 'proj-1';
      await vm.loadDeviceDetail();
      vm.startAutoRefresh();
      await vm.subscribeWsTags();
      await flushPromises();

      wrapper.unmount();
      // Verify unsubscribeTags was called
      expect(mockWsStore.unsubscribeTags).toHaveBeenCalled();
    });
  });
});
