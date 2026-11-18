// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import { collectGroupBranchIds, buildDeviceGroupSections, UNASSIGNED_GROUP_KEY } from '../views/device/device-list.utils';
import type { Device, DeviceGroup, DeviceTree } from '../types/api';

const device = (id: string, groupId?: string): Device =>
  ({ id, deviceCode: id, deviceName: id, type: 'modbus', status: 'online', projectId: 'p1', groupId }) as Device;

const node = (id: string, children: DeviceTree[] = []): DeviceTree =>
  ({ group: { id, name: id, sortOrder: 0 }, children, devices: [] }) as DeviceTree;

const groups: DeviceGroup[] = [
  { id: 'g1', name: 'Group 1', projectId: 'p1', sortOrder: 1 },
  { id: 'g1-1', name: 'Group 1.1', projectId: 'p1', parentId: 'g1', sortOrder: 1 },
  { id: 'g2', name: 'Group 2', projectId: 'p1', sortOrder: 2 },
];

describe('collectGroupBranchIds', () => {
  it('should only return the selected leaf group', () => {
    const tree = [node('g1', [node('g1-1')]), node('g2')];

    expect([...collectGroupBranchIds('g1-1', tree)]).toEqual(['g1-1']);
  });

  it('should include descendant groups of the selected node', () => {
    const tree = [node('g1', [node('g1-1', [node('g1-1-1')])]), node('g2')];

    expect([...collectGroupBranchIds('g1', tree)].sort()).toEqual(['g1', 'g1-1', 'g1-1-1']);
  });

  it('should return only the root id when the tree is empty', () => {
    expect([...collectGroupBranchIds('missing', [])]).toEqual(['missing']);
  });
});

describe('buildDeviceGroupSections', () => {
  it('should group devices in tree order and place ungrouped devices last', () => {
    const result = buildDeviceGroupSections(
      [device('d0'), device('d2', 'g2'), device('d11', 'g1-1'), device('d1', 'g1')],
      groups,
      'No Group',
      (id) => id,
    );

    expect(result.map((section) => section.id)).toEqual(['g1', 'g1-1', 'g2', UNASSIGNED_GROUP_KEY]);
    expect(result[0].devices.map((d) => d.id)).toEqual(['d1']);
    expect(result[3].name).toBe('No Group');
  });

  it('should keep devices whose group is missing from the tree', () => {
    const result = buildDeviceGroupSections([device('dx', 'orphan')], groups, 'No Group', (id) => 'Resolved ' + id);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('orphan');
    expect(result[0].name).toBe('Resolved orphan');
  });

  it('should skip groups without devices', () => {
    const result = buildDeviceGroupSections([device('d2', 'g2')], groups, 'No Group', (id) => id);

    expect(result.map((section) => section.id)).toEqual(['g2']);
  });
});
