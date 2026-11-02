// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

// ======================== Mock vue-i18n ========================
const t = vi.fn((key: string, _params?: any) => key);
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t, locale: { value: 'zh-CN' } }),
  createI18n: vi.fn(() => ({ global: { t }, locale: { value: 'zh-CN' } })),
}));

// ======================== Mock messageBox ========================
const showConfirm = vi.fn().mockResolvedValue(true);
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('../utils/messageBox', () => ({
  showConfirm,
  showSuccess,
  showError,
}));

// ======================== Mock baseServicesApi ========================
const mockServiceStatus = (overrides: Record<string, any> = {}) => ({
  id: 'svc-1',
  name: 'redis',
  displayName: 'Redis',
  status: 'stopped',
  portReachable: false,
  processRunning: false,
  binaryExists: true,
  configExists: true,
  dataDirExists: true,
  logDirExists: true,
  autoStart: false,
  processGuard: false,
  ...overrides,
});

const mockServiceConfig = (overrides: Record<string, any> = {}) => ({
  id: 'svc-1',
  name: 'redis',
  displayName: 'Redis',
  description: 'Redis 缓存服务',
  binaryPath: 'C:/redis/redis-server.exe',
  startArgs: '',
  configPath: 'C:/redis/redis.conf',
  logDir: 'C:/redis/logs',
  dataDir: 'C:/redis/data',
  processName: 'redis-server.exe',
  port: 6379,
  startScript: '',
  stopScript: '',
  enabled: true,
  autoStart: false,
  processGuard: false,
  sortOrder: 1,
  ...overrides,
});

const mockBaseServicesApi = {
  list: vi.fn().mockResolvedValue({ data: [] }),
  listConfig: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn().mockResolvedValue({ data: {} }),
  update: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockResolvedValue({ data: { success: true } }),
  getStatus: vi.fn(),
  start: vi.fn().mockResolvedValue({ data: { success: true, name: 'redis', action: 'start', message: 'ok', durationMs: 100 } }),
  stop: vi.fn().mockResolvedValue({ data: { success: true, name: 'redis', action: 'stop', message: 'ok', durationMs: 100 } }),
  restart: vi.fn().mockResolvedValue({ data: { success: true, name: 'redis', action: 'restart', message: 'ok', durationMs: 100 } }),
  getConfig: vi.fn().mockResolvedValue({ data: { content: 'bind 127.0.0.1', path: 'C:/redis.conf', size: 100 } }),
  saveConfig: vi.fn().mockResolvedValue({ data: { success: true, path: 'C:/redis.conf' } }),
  getLogs: vi.fn().mockResolvedValue({ data: [] }),
  clearLogs: vi.fn().mockResolvedValue({ data: { cleared: ['redis.log'] } }),
};

vi.mock('../api/modules/base-services.api', () => ({
  baseServicesApi: mockBaseServicesApi,
}));

// ======================== Helper: mount component ========================
async function mountView() {
  const mod = await import('../views/settings/BaseServicesView.vue');
  return mount(mod.default, {
    global: {
      mocks: {
        $t: t,
      },
    },
  });
}

// ======================== Tests ========================
describe('BaseServicesView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Reset the default mock return values
    mockBaseServicesApi.list.mockResolvedValue({ data: [] });
    mockBaseServicesApi.listConfig.mockResolvedValue({ data: [] });
    mockBaseServicesApi.start.mockResolvedValue({ data: { success: true, name: 'redis', action: 'start', message: 'ok', durationMs: 100 } });
    mockBaseServicesApi.stop.mockResolvedValue({ data: { success: true, name: 'redis', action: 'stop', message: 'ok', durationMs: 100 } });
    mockBaseServicesApi.restart.mockResolvedValue({ data: { success: true, name: 'redis', action: 'restart', message: 'ok', durationMs: 100 } });
  });

  // ================ Rendering tests ================
  describe('rendering', () => {
    it('TC-BSV-001: should render the page title and action buttons', async () => {
      const wrapper = await mountView();
      await flushPromises();
      expect(wrapper.find('.page-title').text()).toContain('system.baseServices.title');
      expect(wrapper.find('.header-actions').exists()).toBe(true);
    });

    it('TC-BSV-002: should show the empty state when there are no services', async () => {
      mockBaseServicesApi.list.mockResolvedValue({ data: [] });
      const wrapper = await mountView();
      await flushPromises();
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.find('.empty-state').text()).toContain('system.baseServices.noServices');
    });

    it('TC-BSV-003: should render the service card list', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const cards = wrapper.findAll('.service-card');
      expect(cards.length).toBe(1);
      expect(cards[0].find('.svc-name').text()).toBe('Redis');
    });

    it('TC-BSV-004: service cards should show status badges', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ status: 'running' })],
      });
      const wrapper = await mountView();
      await flushPromises();
      expect(wrapper.find('.status-badge').classes()).toContain('badge-running');
    });

    it('TC-BSV-005: should render the add-service button', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      expect(addBtn).toBeDefined();
    });

    it('TC-BSV-006: should render the refresh button', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const refreshBtn = wrapper.findAll('.sys-btn-secondary').find((b) => b.text().includes('refresh'));
      expect(refreshBtn).toBeDefined();
    });

    it('TC-BSV-007: service cards should include start/stop/config/logs/edit/delete buttons', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus()],
      });
      const wrapper = await mountView();
      await flushPromises();
      const actions = wrapper.find('.card-actions');
      const btns = actions.findAll('button');
      const texts = btns.map((b) => b.text());
      expect(texts.some((t) => t.includes('start'))).toBe(true);
      expect(texts.some((t) => t.includes('stop'))).toBe(true);
      expect(texts.some((t) => t.includes('restart'))).toBe(true);
      expect(texts.some((t) => t.includes('config'))).toBe(true);
      expect(texts.some((t) => t.includes('logs'))).toBe(true);
      expect(texts.some((t) => t.includes('edit'))).toBe(true);
      expect(texts.some((t) => t.includes('delete'))).toBe(true);
    });
  });

  // ================ Add/Edit service modal ================
  describe('form modal', () => {
    it('TC-BSV-010: clicking the add button should open the modal', async () => {
      const wrapper = await mountView();
      await flushPromises();
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      await addBtn!.trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('.modal-title').text()).toContain('addService');
    });

    it('TC-BSV-011: the modal should contain all required fields', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      await addBtn!.trigger('click');
      const modal = wrapper.find('.modal-overlay');
      expect(modal.find('input[placeholder]').exists()).toBe(true);
      // Verify there are multiple form-field elements
      expect(modal.findAll('.form-field').length).toBeGreaterThanOrEqual(10);
    });

    it('TC-BSV-012: saving with empty required fields should show an error', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      await addBtn!.trigger('click');
      // Fill in nothing and click save directly
      const saveBtn = wrapper.findAll('.modal-footer button').find((b) => b.text().includes('save'));
      await saveBtn!.trigger('click');
      await flushPromises();
      expect(showError).toHaveBeenCalledWith('system.baseServices.requiredFields');
    });

    it('TC-BSV-013: saving with valid data should call the create API', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      await addBtn!.trigger('click');

      // Fill in the form
      const inputs = wrapper.findAll('.form-input');
      // name field
      await inputs[0].setValue('nginx');
      // displayName field
      await inputs[1].setValue('Nginx');

      const saveBtn = wrapper.findAll('.modal-footer button').find((b) => b.text().includes('save'));
      await saveBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'nginx', displayName: 'Nginx' }),
      );
      expect(showSuccess).toHaveBeenCalledWith('system.baseServices.createSuccess');
    });

    it('TC-BSV-014: clicking the edit button should load the config and fill the form', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      mockBaseServicesApi.listConfig.mockResolvedValue({
        data: [mockServiceConfig()],
      });
      const wrapper = await mountView();
      await flushPromises();

      const editBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('edit'));
      await editBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.listConfig).toHaveBeenCalled();
      expect(wrapper.find('.modal-title').text()).toContain('editService');
    });

    it('TC-BSV-015: the name field should be disabled in edit mode', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      mockBaseServicesApi.listConfig.mockResolvedValue({
        data: [mockServiceConfig()],
      });
      const wrapper = await mountView();
      await flushPromises();

      const editBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('edit'));
      await editBtn!.trigger('click');
      await flushPromises();

      const nameInput = wrapper.findAll('.form-input')[0];
      expect((nameInput.element as HTMLInputElement).disabled).toBe(true);
    });

    it('TC-BSV-015a: saving in edit mode should strip the name field', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      mockBaseServicesApi.listConfig.mockResolvedValue({
        data: [mockServiceConfig()],
      });
      const wrapper = await mountView();
      await flushPromises();

      const editBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('edit'));
      await editBtn!.trigger('click');
      await flushPromises();

      // Modify displayName
      const inputs = wrapper.findAll('.form-input');
      await inputs[1].setValue('Redis Updated');

      const saveBtn = wrapper.findAll('.modal-footer button').find((b) => b.text().includes('save'));
      await saveBtn!.trigger('click');
      await flushPromises();

      // Verify the update call does not include the name field
      const updateCall = mockBaseServicesApi.update.mock.calls[0];
      expect(updateCall[0]).toBe('redis'); // URL param
      expect(updateCall[1]).not.toHaveProperty('name'); // should not include name in the body
      expect(updateCall[1]).toHaveProperty('displayName', 'Redis Updated');
    });

    it('TC-BSV-016: the cancel button should close the modal', async () => {
      const wrapper = await mountView();
      await flushPromises();
      const addBtn = wrapper.findAll('.sys-btn-primary').find((b) => b.text().includes('addService'));
      await addBtn!.trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);

      const cancelBtn = wrapper.findAll('.modal-footer button').find((b) => b.text().includes('cancel'));
      await cancelBtn!.trigger('click');
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });
  });

  // ================ Service operations ================
  describe('service actions', () => {
    it('TC-BSV-020: clicking the start button should call the start API', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'stopped' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const startBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('start') && !b.attributes('disabled'));
      expect(startBtn).toBeDefined();
      await startBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.start).toHaveBeenCalledWith('redis');
      expect(showSuccess).toHaveBeenCalled();
    });

    it('TC-BSV-021: a failed start should show an error', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'stopped' })],
      });
      mockBaseServicesApi.start.mockResolvedValue({
        data: { success: false, name: 'redis', action: 'start', message: '端口被占用', durationMs: 0 },
      });
      const wrapper = await mountView();
      await flushPromises();

      const startBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('start') && !b.attributes('disabled'));
      await startBtn!.trigger('click');
      await flushPromises();

      expect(showError).toHaveBeenCalled();
    });

    it('TC-BSV-022: clicking the stop button should show a confirmation dialog', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'running' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const stopBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('stop') && !b.attributes('disabled'));
      expect(stopBtn).toBeDefined();
      await stopBtn!.trigger('click');
      await flushPromises();

      expect(showConfirm).toHaveBeenCalled();
    });

    it('TC-BSV-023: after confirming stop, the stop API should be called', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'running' })],
      });
      showConfirm.mockResolvedValueOnce(true);
      const wrapper = await mountView();
      await flushPromises();

      const stopBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('stop') && !b.attributes('disabled'));
      await stopBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.stop).toHaveBeenCalledWith('redis');
    });

    it('TC-BSV-024: canceling the stop confirmation should not call the stop API', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'running' })],
      });
      showConfirm.mockResolvedValueOnce(false);
      const wrapper = await mountView();
      await flushPromises();

      const stopBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('stop') && !b.attributes('disabled'));
      await stopBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.stop).not.toHaveBeenCalled();
    });

    it('TC-BSV-025: clicking the restart button should show a confirmation dialog', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', status: 'running' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const restartBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('restart') && !b.attributes('disabled'));
      await restartBtn!.trigger('click');
      await flushPromises();

      expect(showConfirm).toHaveBeenCalled();
    });

    it('TC-BSV-026: clicking the delete button should show a confirmation dialog', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const deleteBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('delete'));
      await deleteBtn!.trigger('click');
      await flushPromises();

      expect(showConfirm).toHaveBeenCalled();
    });

    it('TC-BSV-027: after confirming delete, the remove API should be called', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      showConfirm.mockResolvedValueOnce(true);
      const wrapper = await mountView();
      await flushPromises();

      const deleteBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('delete'));
      await deleteBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.remove).toHaveBeenCalledWith('redis');
      expect(showSuccess).toHaveBeenCalledWith('system.baseServices.deleteSuccess');
    });
  });

  // ================ Config file modal ================
  describe('config modal', () => {
    it('TC-BSV-030: clicking the config button should open the config modal', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const configBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('config'));
      await configBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.getConfig).toHaveBeenCalledWith('redis');
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('.modal-title').text()).toContain('configTitle');
    });

    it('TC-BSV-031: saving the config should call the saveConfig API', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const configBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('config'));
      await configBtn!.trigger('click');
      await flushPromises();

      const saveBtn = wrapper.findAll('.modal-footer button').find((b) => b.text().includes('save'));
      await saveBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.saveConfig).toHaveBeenCalled();
      expect(showSuccess).toHaveBeenCalledWith('system.baseServices.configSaved');
    });
  });

  // ================ Log modal ================
  describe('logs modal', () => {
    it('TC-BSV-040: clicking the logs button should open the logs modal', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis', displayName: 'Redis' })],
      });
      const wrapper = await mountView();
      await flushPromises();

      const logsBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('logs'));
      await logsBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.getLogs).toHaveBeenCalledWith('redis', 200);
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.find('.modal-title').text()).toContain('logsTitle');
    });

    it('TC-BSV-041: should show the empty state when there are no logs', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      mockBaseServicesApi.getLogs.mockResolvedValue({ data: [] });
      const wrapper = await mountView();
      await flushPromises();

      const logsBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('logs'));
      await logsBtn!.trigger('click');
      await flushPromises();

      const modal = wrapper.find('.modal-overlay');
      expect(modal.find('.empty-state').exists()).toBe(true);
    });

    it('TC-BSV-042: should render log entries when logs exist', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      mockBaseServicesApi.getLogs.mockResolvedValue({
        data: [
          { filename: 'redis.log', size: 100, lines: ['line1', 'line2'], totalLines: 2 },
        ],
      });
      const wrapper = await mountView();
      await flushPromises();

      const logsBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('logs'));
      await logsBtn!.trigger('click');
      await flushPromises();

      const modal = wrapper.find('.modal-overlay');
      expect(modal.findAll('.log-tab-btn').length).toBe(1);
      expect(modal.find('.tab-filename').text()).toBe('redis.log');
      expect(modal.find('.log-content').text()).toContain('line1');
    });

    it('TC-BSV-043: clearing logs should show a confirmation dialog', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      mockBaseServicesApi.getLogs.mockResolvedValue({
        data: [{ filename: 'redis.log', size: 100, lines: ['line1'], totalLines: 1 }],
      });
      const wrapper = await mountView();
      await flushPromises();

      const logsBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('logs'));
      await logsBtn!.trigger('click');
      await flushPromises();

      const clearBtn = wrapper.findAll('.modal-overlay button').find((b) => b.text().includes('clearLogs'));
      await clearBtn!.trigger('click');
      await flushPromises();

      expect(showConfirm).toHaveBeenCalled();
    });

    it('TC-BSV-044: after confirming cleanup, the clearLogs API should be called', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ name: 'redis' })],
      });
      mockBaseServicesApi.getLogs.mockResolvedValue({
        data: [{ filename: 'redis.log', size: 100, lines: ['line1'], totalLines: 1 }],
      });
      showConfirm.mockResolvedValueOnce(true);
      const wrapper = await mountView();
      await flushPromises();

      const logsBtn = wrapper.findAll('.card-actions button').find((b) => b.text().includes('logs'));
      await logsBtn!.trigger('click');
      await flushPromises();

      const clearBtn = wrapper.findAll('.modal-overlay button').find((b) => b.text().includes('clearLogs'));
      await clearBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.clearLogs).toHaveBeenCalledWith('redis');
    });
  });

  // ================ Data loading ================
  describe('data loading', () => {
    it('TC-BSV-050: the list API should be called on mount', async () => {
      await mountView();
      await flushPromises();
      expect(mockBaseServicesApi.list).toHaveBeenCalled();
    });

    it('TC-BSV-051: a failed list API should show an error', async () => {
      mockBaseServicesApi.list.mockRejectedValue(new Error('网络错误'));
      await mountView();
      await flushPromises();
      expect(showError).toHaveBeenCalled();
    });

    it('TC-BSV-052: clicking the refresh button should reload the list', async () => {
      mockBaseServicesApi.list.mockClear();
      const wrapper = await mountView();
      await flushPromises();
      const initialCallCount = mockBaseServicesApi.list.mock.calls.length;

      const refreshBtn = wrapper.findAll('.sys-btn-secondary').find((b) => b.text().includes('refresh'));
      await refreshBtn!.trigger('click');
      await flushPromises();

      expect(mockBaseServicesApi.list.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  // ================ Status display ================
  describe('status display', () => {
    it('TC-BSV-060: the running status should show the corresponding badge style', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ status: 'running' })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const card = wrapper.find('.service-card');
      expect(card.classes()).toContain('status-running');
      expect(card.find('.status-badge').classes()).toContain('badge-running');
    });

    it('TC-BSV-061: the stopped status should show the corresponding badge style', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ status: 'stopped' })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const card = wrapper.find('.service-card');
      expect(card.classes()).toContain('status-stopped');
    });

    it('TC-BSV-062: should show the process running status', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ processRunning: true })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const processRow = wrapper.findAll('.status-row').find((r) => r.text().includes('processRunning'));
      expect(processRow).toBeDefined();
      expect(processRow!.find('.row-value.ok').exists()).toBe(true);
    });

    it('TC-BSV-063: should show port info', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ port: 6379 })],
      });
      const wrapper = await mountView();
      await flushPromises();
      expect(wrapper.find('.svc-port').text()).toBe(':6379');
    });

    it('TC-BSV-064: should show file check results', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ binaryExists: true, configExists: false })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const checks = wrapper.findAll('.check-item');
      expect(checks.length).toBeGreaterThanOrEqual(3);
      expect(checks[0].classes()).toContain('ok'); // binary exists
      expect(checks[1].classes()).toContain('fail'); // config does not exist
    });

    it('TC-BSV-065: should show the autoStart flag label', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ autoStart: true, processGuard: false })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const flagRow = wrapper.findAll('.status-row').find((r) => r.text().includes('flags'));
      expect(flagRow).toBeDefined();
      expect(flagRow!.find('.flag-tag.flag-auto').exists()).toBe(true);
      expect(flagRow!.find('.flag-tag.flag-guard').exists()).toBe(false);
    });

    it('TC-BSV-066: should show the processGuard flag label', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ autoStart: false, processGuard: true })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const flagRow = wrapper.findAll('.status-row').find((r) => r.text().includes('flags'));
      expect(flagRow).toBeDefined();
      expect(flagRow!.find('.flag-tag.flag-guard').exists()).toBe(true);
      expect(flagRow!.find('.flag-tag.flag-auto').exists()).toBe(false);
    });

    it('TC-BSV-067: should not show the flag row when both autoStart and processGuard are false', async () => {
      mockBaseServicesApi.list.mockResolvedValue({
        data: [mockServiceStatus({ autoStart: false, processGuard: false })],
      });
      const wrapper = await mountView();
      await flushPromises();
      const flagRow = wrapper.findAll('.status-row').find((r) => r.text().includes('flags'));
      expect(flagRow).toBeUndefined();
    });
  });
});
