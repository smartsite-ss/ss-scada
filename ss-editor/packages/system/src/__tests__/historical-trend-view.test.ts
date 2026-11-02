// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// ======================== Mock i18n ========================
const t = vi.fn((key: string, params?: any) => {
  if (params && typeof params === 'object') {
    return key + JSON.stringify(params);
  }
  return key;
});
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>();
  return {
    ...actual,
    useI18n: () => ({ t, locale: { value: 'zh-CN' } }),
  };
});

// ======================== Mock SsLoading ========================
vi.mock('@scada-editor/shared', () => ({
  SsLoading: {
    name: 'SsLoading',
    props: ['text', 'size'],
    template: '<div class="ss-loading-mock">{{ text }}</div>',
  },
  TimeRangePicker: {
    name: 'TimeRangePicker',
    props: ['startTime', 'endTime', 'presetRange'],
    emits: ['update:startTime', 'update:endTime', 'update:presetRange', 'change'],
    template: '<div class="time-range-picker-mock"></div>',
  },
}));

// ======================== Mock messageBox ========================
const mockShowError = vi.fn();
vi.mock('../utils/messageBox', () => ({
  showError: mockShowError,
}));

// ======================== Mock APIs ========================
const mockProjectApi = {
  list: vi.fn(),
};
const mockDeviceApi = {
  list: vi.fn(),
  getById: vi.fn(),
};
const mockDataQueryApi = {
  queryTrend: vi.fn(),
};
const mockTrendQuerySchemeApi = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../api/modules/device.api', () => ({
  deviceApi: mockDeviceApi,
}));
vi.mock('../api/modules/project.api', () => ({
  projectApi: mockProjectApi,
}));
vi.mock('../api/modules/data-query.api', () => ({
  dataQueryApi: mockDataQueryApi,
}));
vi.mock('../api/modules/trend-query-scheme.api', () => ({
  trendQuerySchemeApi: mockTrendQuerySchemeApi,
}));
// Also mock the barrel file for any direct imports
vi.mock('../api/modules', () => ({
  projectApi: mockProjectApi,
  deviceApi: mockDeviceApi,
  dataQueryApi: mockDataQueryApi,
  trendQuerySchemeApi: mockTrendQuerySchemeApi,
}));

// ======================== Helpers ========================
const mockProjects = [
  { projectId: 'proj-1', projectName: '测试项目1' },
  { projectId: 'proj-2', projectName: '测试项目2' },
];

const mockDevices = [
  { id: 'dev-1', deviceName: '设备1' },
  { id: 'dev-2', deviceName: '设备2' },
];

const mockTags = [
  { id: 'tag-1', name: '温度', address: '40001', dataType: 'float32' },
  { id: 'tag-2', name: '湿度', address: '40002', dataType: 'float32' },
  { id: 'tag-3', name: '压力', address: '40003', dataType: 'float32' },
];

const mockDeviceDetail = (overrides: Record<string, any> = {}) => ({
  id: 'dev-1',
  deviceName: '设备1',
  tags: mockTags,
  ...overrides,
});

const mockTrendData = [
  {
    tagId: 'tag-1',
    data: [
      { timestamp: '2026-07-22T10:00:00.000Z', value: 25.5 },
      { timestamp: '2026-07-22T10:05:00.000Z', value: 26.0 },
      { timestamp: '2026-07-22T10:10:00.000Z', value: 25.8 },
    ],
  },
  {
    tagId: 'tag-2',
    data: [
      { timestamp: '2026-07-22T10:00:00.000Z', value: 60.0 },
      { timestamp: '2026-07-22T10:05:00.000Z', value: 62.5 },
      { timestamp: '2026-07-22T10:10:00.000Z', value: 61.0 },
    ],
  },
];

// Canvas-related mocks - must be set before component imports
const mockResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
global.ResizeObserver = mockResizeObserver as any;

// ======================== Mount Helper ========================
async function mountHistoricalTrendView() {
  const mod = await import('../views/historical-trend/HistoricalTrendView.vue');
  return mount(mod.default, {
    global: {
      mocks: {
        $t: t,
      },
    },
  });
}

// ======================== Tests ========================
describe('HistoricalTrendView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockShowError.mockClear();

    // Default mock return values
    mockProjectApi.list.mockResolvedValue({ data: mockProjects });
    mockDeviceApi.list.mockResolvedValue({ data: mockDevices });
    mockDeviceApi.getById.mockResolvedValue({ data: mockDeviceDetail() });
    mockDataQueryApi.queryTrend.mockResolvedValue({ data: { data: mockTrendData } });
    mockTrendQuerySchemeApi.list.mockResolvedValue([]);

    // Reset
    mockResizeObserver.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Project loading', () => {
    it('Should load the project list after mount', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      // projectStore.fetchProjects() defaults to pageSize=20
      expect(mockProjectApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 20, keyword: undefined });
      const vm = wrapper.vm as any;
      expect(vm.projectStore.projects.length).toBe(2);
      expect(vm.projectStore.projects[0].projectId).toBe('proj-1');
    });

    it('Project list load failure should be handled silently', async () => {
      mockProjectApi.list.mockRejectedValue(new Error('网络错误'));
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.projectStore.projects.length).toBe(0);
    });
  });

  describe('Device loading - pageSize fix verification', () => {
    it('After selecting a project, the device list should load with pageSize=100 (fix validation overflow)', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      await vm.onProjectChange();
      await flushPromises();

      // Verify pageSize is 100, avoiding the backend @Max(100) "must not be greater than 100" error
      expect(mockDeviceApi.list).toHaveBeenCalledWith('proj-1', { page: 1, pageSize: 100 });
      expect(vm.devices.length).toBe(2);
      expect(vm.devices[0].deviceName).toBe('设备1');
    });

    it('Device list load failure should be handled silently', async () => {
      mockDeviceApi.list.mockRejectedValue(new Error('Backend error'));
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      await vm.onProjectChange();
      await flushPromises();

      expect(vm.devices.length).toBe(0);
    });

    it('The device dropdown should be disabled when no project is selected', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const deviceSelect = wrapper.findAll('select')[1];
      expect((deviceSelect.element as HTMLSelectElement).disabled).toBe(true);
    });
  });

  describe('Tag loading - device.tags fix verification', () => {
    it('After selecting a device, tags should be loaded from device.tags (fix dataTags→tags)', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      await vm.onDeviceChange();
      await flushPromises();

      // Verify device details are fetched via getById
      expect(mockDeviceApi.getById).toHaveBeenCalledWith('proj-1', 'dev-1');
      // Verify tags are loaded from device.tags
      expect(vm.allTags.length).toBe(3);
      expect(vm.allTags[0].name).toBe('温度');
      expect(vm.allTags[0].address).toBe('40001');
    });

    it('Should load an empty list when the device has no tags', async () => {
      mockDeviceApi.getById.mockResolvedValue({
        data: { id: 'dev-1', deviceName: '设备1', tags: [] },
      });

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      await vm.onDeviceChange();
      await flushPromises();

      expect(vm.allTags.length).toBe(0);
    });

    it('Should degrade safely to an empty list when the device has no tags property', async () => {
      mockDeviceApi.getById.mockResolvedValue({
        data: { id: 'dev-1', deviceName: '设备1' }, // no tags
      });

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      await vm.onDeviceChange();
      await flushPromises();

      expect(vm.allTags.length).toBe(0);
    });

    it('Should load tags correctly when the API returns a bare array format (no data wrapper)', async () => {
      mockDeviceApi.getById.mockResolvedValue({
        id: 'dev-1',
        deviceName: '设备1',
        tags: mockTags,
      });

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      await vm.onDeviceChange();
      await flushPromises();

      expect(vm.allTags.length).toBe(3);
    });
  });

  describe('Cascade reset', () => {
    it('Switching projects should clear devices, tags and charts', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      // Set the state first
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.allTags = [...mockTags];
      vm.chartSeries = [{ tagId: 'tag-1', tagName: '温度', data: [] }];

      // Switch to another project
      vm.selectedProjectId = 'proj-2';
      await vm.onProjectChange();
      await flushPromises();

      expect(vm.selectedDeviceId).toBe('');
      expect(vm.selectedTagIds).toEqual([]);
      expect(vm.allTags).toEqual([]);
      expect(vm.chartSeries).toEqual([]);
      expect(vm.devices.length).toBe(2); // newly loaded devices
    });

    it('Switching devices should clear tags and chart data', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.allTags = [...mockTags];
      vm.chartSeries = [{ tagId: 'tag-1', tagName: '温度', data: [] }];

      vm.selectedDeviceId = 'dev-2';
      await vm.onDeviceChange();
      await flushPromises();

      expect(vm.selectedTagIds).toEqual([]);
      expect(vm.allTags.length).toBe(3); // new device tags loaded
      expect(vm.chartSeries).toEqual([]);
    });
  });

  describe('Query button status', () => {
    it('The query button should be disabled when no project is selected', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const queryBtn = wrapper.find('.sys-btn-primary');
      expect((queryBtn.element as HTMLButtonElement).disabled).toBe(true);
    });

    it('Queryable after full selection', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.startTime = '2026-07-22T10:00';
      vm.endTime = '2026-07-22T11:00';
      vm.allTags = mockTags;

      await flushPromises();

      // The query button should not be disabled
      const queryBtn = wrapper.find('.sys-btn-primary');
      expect((queryBtn.element as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('Tag selector interaction', () => {
    it('Clicking the tag button should expand the selector', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.allTags = mockTags;

      await flushPromises();

      // The tag selection button should exist
      const tagBtn = wrapper.find('.tag-select-wrapper button');
      expect(tagBtn.exists()).toBe(true);
    });

    it('Select all / deselect all', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allTags = mockTags;
      vm.selectedTagIds = [];
      vm.showTagPicker = true;
      await flushPromises();

      // Select all
      vm.toggleAllTags();
      expect(vm.selectedTagIds.length).toBe(3);

      // Deselect all
      vm.toggleAllTags();
      expect(vm.selectedTagIds.length).toBe(0);
    });

    it('allTagsSelected is false when partially selected', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allTags = mockTags;
      vm.selectedTagIds = ['tag-1'];
      expect(vm.allTagsSelected).toBe(false);
    });

    it('allTagsSelected is true when all are selected', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allTags = mockTags;
      vm.selectedTagIds = ['tag-1', 'tag-2', 'tag-3'];
      expect(vm.allTagsSelected).toBe(true);
    });

    it('Tag search filtering', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allTags = mockTags;
      vm.tagSearch = '温度';
      await flushPromises();

      expect(vm.filteredTags.length).toBe(1);
      expect(vm.filteredTags[0].name).toBe('温度');

      vm.tagSearch = '40002';
      await flushPromises();
      expect(vm.filteredTags.length).toBe(1);
      expect(vm.filteredTags[0].address).toBe('40002');
    });

    it('Show the empty hint when search has no results', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.allTags = mockTags;
      vm.tagSearch = '不存在的标签';
      vm.showTagPicker = true;
      await flushPromises();

      expect(vm.filteredTags.length).toBe(0);
    });

    it('toggleTag correctly adds/removes tags', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedTagIds = [];

      vm.toggleTag('tag-1');
      expect(vm.selectedTagIds).toContain('tag-1');

      vm.toggleTag('tag-1');
      expect(vm.selectedTagIds).not.toContain('tag-1');
    });
  });

  describe('Time presets', () => {
    it('applyPresetRange 1h should compute correctly', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-22T12:00:00'));
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.presetRange = '1h';
      vm.applyPresetRange();

      expect(vm.endTime).toContain('2026-07-22');
      expect(vm.startTime).toContain('2026-07-22');
    });

    it('applyPresetRange 24h should compute correctly', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-22T12:00:00'));
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.presetRange = '24h';
      vm.applyPresetRange();

      expect(vm.startTime).toContain('2026-07-21');
      expect(vm.endTime).toContain('2026-07-22');
    });

    it('With custom time, endTime resets to now while startTime stays unchanged', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-22T12:00:00'));
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.presetRange = '';
      vm.startTime = '2026-07-20T08:00';
      vm.endTime = '2026-07-22T08:00';
      vm.applyPresetRange();

      // startTime should not be overwritten (no matching preset)
      expect(vm.startTime).toBe('2026-07-20T08:00');
      // endTime is always reset to the current time
      expect(vm.endTime).toBe('2026-07-22T12:00');
    });
  });

  describe('Query trend data', () => {
    it('Should generate chartSeries after a successful query', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1', 'tag-2'];
      vm.allTags = mockTags;
      vm.startTime = '2026-07-22T10:00';
      vm.endTime = '2026-07-22T11:00';

      await vm.queryTrendData();
      await flushPromises();

      expect(mockDataQueryApi.queryTrend).toHaveBeenCalledWith(expect.objectContaining({
        tagIds: ['tag-1', 'tag-2'],
        startTime: expect.any(String),
        endTime: expect.any(String),
        maxPoints: 2000,
        projectId: 'proj-1',
      }));
      expect(vm.chartSeries.length).toBe(2);
      expect(vm.chartSeries[0].tagName).toBe('温度');
      expect(vm.visibleSeries.size).toBe(2);
    });

    it('Query failure should call showError', async () => {
      mockDataQueryApi.queryTrend.mockRejectedValue({
        _errorHandled: false,
        message: 'Server error',
      });

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.allTags = mockTags;
      vm.startTime = '2026-07-22T10:00';
      vm.endTime = '2026-07-22T11:00';

      await vm.queryTrendData();
      await flushPromises();

      expect(mockShowError).toHaveBeenCalledWith('Server error');
      expect(vm.queryLoading).toBe(false);
    });

    it('When empty data is returned, chartSeries is empty', async () => {
      mockDataQueryApi.queryTrend.mockResolvedValue({ data: { data: [] } });

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.allTags = mockTags;
      vm.startTime = '2026-07-22T10:00';
      vm.endTime = '2026-07-22T11:00';

      await vm.queryTrendData();
      await flushPromises();

      expect(vm.chartSeries.length).toBe(0);
    });

    it('Show loading state while querying', async () => {
      // Use a deferred promise to test the loading state
      let resolvePromise: any;
      const deferred = new Promise((resolve) => { resolvePromise = resolve; });
      mockDataQueryApi.queryTrend.mockReturnValue(deferred);

      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedProjectId = 'proj-1';
      vm.selectedDeviceId = 'dev-1';
      vm.selectedTagIds = ['tag-1'];
      vm.allTags = mockTags;
      vm.startTime = '2026-07-22T10:00';
      vm.endTime = '2026-07-22T11:00';

      const queryPromise = vm.queryTrendData();
      await nextTick();
      expect(vm.queryLoading).toBe(true);

      resolvePromise({ data: { data: mockTrendData } });
      await queryPromise;
      await flushPromises();

      expect(vm.queryLoading).toBe(false);
    });
  });

  describe('Legend interaction', () => {
    it('toggleSeries should toggle visibility', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.chartSeries = [
        { tagId: 'tag-1', tagName: '温度', data: [] },
        { tagId: 'tag-2', tagName: '湿度', data: [] },
      ];
      vm.visibleSeries = new Set(['tag-1', 'tag-2']);

      vm.toggleSeries('tag-1');
      expect(vm.visibleSeries.has('tag-1')).toBe(false);
      expect(vm.visibleSeries.has('tag-2')).toBe(true);

      vm.toggleSeries('tag-1');
      expect(vm.visibleSeries.has('tag-1')).toBe(true);
    });
  });

  describe('Canvas chart rendering', () => {
    it('Should register ResizeObserver on mount', async () => {
      const _wrapper = await mountHistoricalTrendView();
      await flushPromises();

      expect(mockResizeObserver).toHaveBeenCalled();
    });

    it('Should clean up ResizeObserver on unmount', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      wrapper.unmount();
      // ResizeObserver disconnect should be called
      const instance = mockResizeObserver.mock.results[0]?.value;
      expect(instance?.disconnect).toHaveBeenCalled();
    });
  });

  describe('toLocalDatetime', () => {
    it('Should format dates correctly', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      const d = new Date('2026-07-22T12:05:30');
      const result = vm.toLocalDatetime(d);
      expect(result).toBe('2026-07-22T12:05');
    });

    it('Single-digit months/days/hours/minutes should be zero-padded', async () => {
      const wrapper = await mountHistoricalTrendView();
      await flushPromises();

      const vm = wrapper.vm as any;
      const d = new Date('2026-01-05T03:07:00');
      const result = vm.toLocalDatetime(d);
      expect(result).toBe('2026-01-05T03:07');
    });
  });
});
