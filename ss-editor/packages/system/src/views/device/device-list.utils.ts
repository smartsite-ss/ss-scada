// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { Device, DeviceGroup, DeviceTree } from '../../types/api';

export interface DeviceGroupSection {
  id: string;
  name: string;
  devices: Device[];
}

export const UNASSIGNED_GROUP_KEY = '__unassigned__';

/** A selected tree node also owns all of its descendant groups. */
export function collectGroupBranchIds(rootId: string, tree: DeviceTree[]): Set<string> {
  const ids = new Set<string>([rootId]);
  const visit = (items: DeviceTree[], inside: boolean) => {
    for (const item of items) {
      const id = item.group?.id;
      const matched = inside || id === rootId;
      if (matched && id) ids.add(id);
      if (item.children?.length) visit(item.children, matched);
    }
  };
  visit(tree, false);
  return ids;
}

/** Bucket devices by group, following the tree order and keeping ungrouped devices last. */
export function buildDeviceGroupSections(
  devices: Device[],
  groups: DeviceGroup[],
  ungroupedLabel: string,
  resolveGroupName: (groupId: string) => string,
): DeviceGroupSection[] {
  const buckets = new Map<string, Device[]>();
  for (const device of devices) {
    const key = device.groupId || UNASSIGNED_GROUP_KEY;
    const list = buckets.get(key) || [];
    list.push(device);
    buckets.set(key, list);
  }

  const sections: DeviceGroupSection[] = [];
  for (const group of groups) {
    const list = buckets.get(group.id);
    if (list?.length) sections.push({ id: group.id, name: group.name, devices: list });
  }
  const unassigned = buckets.get(UNASSIGNED_GROUP_KEY);
  if (unassigned?.length) {
    sections.push({ id: UNASSIGNED_GROUP_KEY, name: ungroupedLabel, devices: unassigned });
  }
  // Groups missing from the tree (e.g. tree not loaded yet) still need to be visible
  for (const [id, list] of buckets) {
    if (id === UNASSIGNED_GROUP_KEY || sections.some((section) => section.id === id)) continue;
    sections.push({ id, name: resolveGroupName(id), devices: list });
  }
  return sections;
}
