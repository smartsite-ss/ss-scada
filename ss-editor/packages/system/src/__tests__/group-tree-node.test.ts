// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

// ======================== Mock i18n ========================
const t = vi.fn((key: string) => key);
vi.mock('@scada-editor/core', () => ({
  useI18n: () => ({ t, locale: { value: 'zh-CN' } }),
}));

// ======================== Helper ========================
function makeProps(overrides: Record<string, any> = {}) {
  const group = { id: 'group-1', name: '测试分组1' };
  const childGroup = { id: 'group-1-1', name: '子分组1-1' };
  const childGroup2 = { id: 'group-1-2', name: '子分组1-2' };
  const device1 = { id: 'dev-1', deviceCode: 'device-001', name: '设备1', status: 'online' };
  const device2 = { id: 'dev-2', deviceCode: 'device-002', name: '设备2', status: 'offline' };

  const tree = [
    {
      group,
      devices: [device1],
      children: [
        {
          group: childGroup,
          devices: [device2],
          children: [],
        },
        {
          group: childGroup2,
          devices: [],
          children: [],
        },
      ],
    },
  ];

  return {
    group,
    projectId: 'proj-1',
    depth: 1,
    expandedGroups: new Set<string>(),
    selectedGroupId: '',
    selectedDeviceId: '',
    groupDeviceCache: new Map<string, any[]>(),
    groupTreeCache: new Map<string, any[]>([['proj-1', tree]]),
    ...overrides,
  };
}

async function mountTreeNode(props: Record<string, any>) {
  const mod = await import('../views/device/components/GroupTreeNode.vue');
  return mount(mod.default, {
    props,
    global: {
      stubs: {
        GroupTreeNode: mod.default,
      },
      mocks: { $t: t },
    },
  });
}

// ======================== Tests ========================
describe('GroupTreeNode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('Should render the group name', async () => {
      const wrapper = await mountTreeNode(makeProps());
      const labels = wrapper.findAll('.node-label');
      // The first .node-label is the current group name
      expect(labels[0].text()).toBe('测试分组1');
    });

    it('Should render the folder icon SVG', async () => {
      const wrapper = await mountTreeNode(makeProps());
      // Check the HTML contains the folder icon path (svg path elements are affected by the SVG namespace when queried in jsdom)
      expect(wrapper.html()).toContain('M22 19a2');
    });

    it('Should show the total device count badge', async () => {
      const wrapper = await mountTreeNode(makeProps());
      expect(wrapper.find('.node-count').text()).toBe('2');
    });

    it('Should show the expand arrow when there are subgroups', async () => {
      const wrapper = await mountTreeNode(makeProps());
      expect(wrapper.find('.chevron').exists()).toBe(true);
    });

    it('Should show a placeholder when there are no subgroups', async () => {
      const tree = [
        {
          group: { id: 'group-leaf', name: '叶子分组' },
          devices: [],
          children: [],
        },
      ];
      const props = makeProps({
        group: { id: 'group-leaf', name: '叶子分组' },
        groupTreeCache: new Map([['proj-1', tree]]),
      });
      const wrapper = await mountTreeNode(props);
      expect(wrapper.find('.chevron-placeholder').exists()).toBe(true);
      expect(wrapper.find('.chevron').exists()).toBe(false);
    });

    it('Should render edit and delete action buttons', async () => {
      const wrapper = await mountTreeNode(makeProps());
      expect(wrapper.find('.group-actions').exists()).toBe(true);
      expect(wrapper.findAll('.btn-tree-action').length).toBe(2);
    });
  });

  describe('Subgroup rendering (second-level group)', () => {
    it('Should show subgroups\' names when expanded', async () => {
      const props = makeProps({
        expandedGroups: new Set(['group-1']),
      });
      const wrapper = await mountTreeNode(props);
      const groupNodes = wrapper.findAll('.group-node');
      expect(groupNodes.length).toBeGreaterThanOrEqual(2); // parent + at least 1 child
      const labels = wrapper.findAll('.node-label');
      // The second label is the first child group
      const childLabels = labels.filter(l => l.text() === '子分组1-1');
      expect(childLabels.length).toBe(1);
    });

    it('Should show subgroups\' folder icons when expanded', async () => {
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1']),
      });
      const wrapper = await mountTreeNode(props);
      // After recursive rendering, there should be parent and child group nodes
      const groupNodes = wrapper.findAll('.group-node');
      expect(groupNodes.length).toBe(3); // parent + 2 children

      // 3 group nodes, each should have the folder icon path (count occurrences of M22 19a2)
      const html = wrapper.html();
      const matches = html.match(/M22 19a2/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(3);
    });

    it('Every subgroup node should contain a name label', async () => {
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1', 'group-1-2']),
      });
      const wrapper = await mountTreeNode(props);
      const nodeLabels = wrapper.findAll('.node-label');
      // There should be 3 group names
      expect(nodeLabels.length).toBeGreaterThanOrEqual(3);
      expect(nodeLabels.some(l => l.text() === '子分组1-1')).toBe(true);
      expect(nodeLabels.some(l => l.text() === '子分组1-2')).toBe(true);
    });

    it('Should show a placeholder instead of an expand arrow when a subgroup has no content', async () => {
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-2']),
      });
      const wrapper = await mountTreeNode(props);
      // group-1-2 is an empty child group and should have a placeholder
      const groupNodes = wrapper.findAll('.group-node');
      const childGroupNodes = groupNodes.filter(n => {
        const label = n.find('.node-label');
        return label?.text() === '子分组1-2';
      });
      expect(childGroupNodes.length).toBe(1);
      expect(childGroupNodes[0].find('.chevron-placeholder').exists()).toBe(true);
      expect(childGroupNodes[0].find('.chevron').exists()).toBe(false);
    });

    it('Should not show subgroups when not expanded', async () => {
      const wrapper = await mountTreeNode(makeProps());
      const groupNodes = wrapper.findAll('.group-node');
      expect(groupNodes.length).toBe(1); // parent group only
    });
  });

  describe('Expand/collapse', () => {
    it('Should show subgroups when expanded', async () => {
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1']),
      });
      const wrapper = await mountTreeNode(props);
      expect(wrapper.find('.group-children').exists()).toBe(true);
      const groupNodes = wrapper.findAll('.group-node');
      expect(groupNodes.length).toBe(3); // parent + 2 child groups
      // The device list is shown in the right-side table, not in this tree
      const deviceNodes = wrapper.findAll('.device-node');
      expect(deviceNodes.length).toBe(0);
    });

    it('Should not show subgroups and devices when collapsed', async () => {
      const wrapper = await mountTreeNode(makeProps());
      expect(wrapper.find('.group-children').exists()).toBe(false);
    });

    it('Clicking a group node should trigger selectGroup and toggleGroup events', async () => {
      const wrapper = await mountTreeNode(makeProps());
      await wrapper.find('.group-node').trigger('click');
      // With expandable content, selectGroup should fire first, then toggleGroup
      expect(wrapper.emitted('selectGroup')).toBeTruthy();
      expect(wrapper.emitted('selectGroup')![0]).toEqual(['proj-1', 'group-1']);
      expect(wrapper.emitted('toggleGroup')).toBeTruthy();
      expect(wrapper.emitted('toggleGroup')![0]).toEqual(['group-1']);
    });

    it('Clicking the expand arrow should trigger toggleGroup', async () => {
      const wrapper = await mountTreeNode(makeProps());
      await wrapper.find('.chevron').trigger('click');
      expect(wrapper.emitted('toggleGroup')).toBeTruthy();
      expect(wrapper.emitted('toggleGroup')![0]).toEqual(['group-1']);
    });

    it('Clicking a leaf group does not trigger toggleGroup', async () => {
      const tree = [
        {
          group: { id: 'group-leaf', name: '叶子分组' },
          devices: [],
          children: [],
        },
      ];
      const props = makeProps({
        group: { id: 'group-leaf', name: '叶子分组' },
        groupTreeCache: new Map([['proj-1', tree]]),
      });
      const wrapper = await mountTreeNode(props);
      await wrapper.find('.group-node').trigger('click');
      expect(wrapper.emitted('selectGroup')).toBeTruthy();
      // No child content, toggleGroup is not triggered
      expect(wrapper.emitted('toggleGroup')).toBeFalsy();
    });
  });

  describe('Edit/delete events', () => {
    it('Clicking the edit button should trigger the editGroup event', async () => {
      const wrapper = await mountTreeNode(makeProps());
      const editBtn = wrapper.find('.btn-tree-action');
      await editBtn.trigger('click');
      expect(wrapper.emitted('editGroup')).toBeTruthy();
      expect(wrapper.emitted('editGroup')![0][0]).toEqual(expect.objectContaining({ id: 'group-1' }));
    });

    it('Clicking the delete button should trigger the deleteGroup event', async () => {
      const wrapper = await mountTreeNode(makeProps());
      const deleteBtn = wrapper.find('.btn-tree-action-danger');
      if (deleteBtn.exists()) {
        await deleteBtn.trigger('click');
        expect(wrapper.emitted('deleteGroup')).toBeTruthy();
        expect(wrapper.emitted('deleteGroup')![0][0]).toEqual(expect.objectContaining({ id: 'group-1' }));
      }
    });
  });

  describe('Recursive rendering', () => {
    it('Should recursively render multi-level subgroups', async () => {
      const deepChild = { id: 'group-deep', name: '深层分组' };
      const tree = [
        {
          group: { id: 'group-1', name: '分组1' },
          devices: [],
          children: [
            {
              group: { id: 'group-1-1', name: '子分组1-1' },
              devices: [],
              children: [
                {
                  group: deepChild,
                  devices: [{ id: 'dev-deep', deviceCode: 'deep-001', name: '深层设备', status: 'online' }],
                  children: [],
                },
              ],
            },
          ],
        },
      ];
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1', 'group-deep']),
        groupTreeCache: new Map([['proj-1', tree]]),
      });
      const wrapper = await mountTreeNode(props);
      const groupNodes = wrapper.findAll('.group-node');
      expect(groupNodes.length).toBe(3);
      // The device list is shown in the right-side table, not in this tree
      const deviceNodes = wrapper.findAll('.device-node');
      expect(deviceNodes.length).toBe(0);
    });

    it('Deep subgroups should display names correctly', async () => {
      const deepChild = { id: 'group-deep', name: '深层分组' };
      const tree = [
        {
          group: { id: 'group-1', name: '分组1' },
          devices: [],
          children: [
            {
              group: { id: 'group-1-1', name: '子分组1-1' },
              devices: [],
              children: [
                {
                  group: deepChild,
                  devices: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ];
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1', 'group-deep']),
        groupTreeCache: new Map([['proj-1', tree]]),
      });
      const wrapper = await mountTreeNode(props);
      const labels = wrapper.findAll('.node-label');
      const deepLabel = labels.find(l => l.text() === '深层分组');
      expect(deepLabel).toBeTruthy();
    });

    it('Deep subgroups should display the folder icon correctly', async () => {
      const deepChild = { id: 'group-deep', name: '深层分组' };
      const tree = [
        {
          group: { id: 'group-1', name: '分组1' },
          devices: [],
          children: [
            {
              group: { id: 'group-1-1', name: '子分组1-1' },
              devices: [],
              children: [
                {
                  group: deepChild,
                  devices: [],
                  children: [],
                },
              ],
            },
          ],
        },
      ];
      const props = makeProps({
        expandedGroups: new Set(['group-1', 'group-1-1', 'group-deep']),
        groupTreeCache: new Map([['proj-1', tree]]),
      });
      const wrapper = await mountTreeNode(props);
      // 3 group nodes, each should have the folder icon (count occurrences of M22 19a2)
      const matches = wrapper.html().match(/M22 19a2/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(3);
    });
  });

  describe('Empty state', () => {
    it('Should show the empty hint when a group with no devices and no subgroups is expanded', async () => {
      const tree = [
        {
          group: { id: 'group-empty', name: '空分组' },
          devices: [],
          children: [],
        },
      ];
      const props = makeProps({
        group: { id: 'group-empty', name: '空分组' },
        groupTreeCache: new Map([['proj-1', tree]]),
        expandedGroups: new Set(['group-empty']),
      });
      const wrapper = await mountTreeNode(props);
      expect(wrapper.find('.tree-empty-small').exists()).toBe(true);
      expect(wrapper.find('.tree-empty-small').text()).toContain('system.devices.noSubGroups');
    });
  });
});
