// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Pure functions such as event type grouping and status badge mapping.
 * Aligned with the backend PERSISTED_EVENTS whitelist and the frontend EventLogListView grouping for easy unit testing.
 */

import type { SubscriberRecord } from '@scada-editor/system';

export type EventTypeGroupId = 'device' | 'project' | 'alarm' | 'config' | 'plugin';

export interface EventTypeGroup {
  id: EventTypeGroupId;
  label: string;
  labelKey: string;
  items: string[];
}

/** Event type grouping (aligned with the backend persisted events whitelist) */
export const EVENT_TYPE_GROUPS: EventTypeGroup[] = [
  {
    id: 'device',
    label: '设备',
    labelKey: 'eventPanel.groups.device',
    items: [
      'device.created',
      'device.updated',
      'device.deleted',
      'device.tagsChanged',
      'device.enabled',
      'device.disabled',
    ],
  },
  {
    id: 'project',
    label: '项目',
    labelKey: 'eventPanel.groups.project',
    items: [
      'project.created',
      'project.imported',
      'project:enabled',
      'project:disabled',
      'project.beforeDelete',
    ],
  },
  {
    id: 'alarm',
    label: '告警',
    labelKey: 'eventPanel.groups.alarm',
    items: ['alarm.triggered', 'alarm_acknowledged', 'alarm.cleared'],
  },
  {
    id: 'config',
    label: '配置与定时器',
    labelKey: 'eventPanel.groups.config',
    items: ['config_changed', 'protocol.config.updated', 'timer:configChanged'],
  },
  {
    id: 'plugin',
    label: '插件',
    labelKey: 'eventPanel.groups.plugin',
    items: ['plugin.activated', 'plugin.deactivated', 'plugin.updated'],
  },
];

/** Real-time status list of event logs (not yet closed: only emitted/processing, aligned with EventLogStatus) */
export const EVENT_STATUS_LIST = ['emitted', 'processing'] as const;

/** Event type → domain CSS class (colored by domain, consistent with EventLogListView) */
export function getEventTypeClass(eventType: string): string {
  if (eventType.startsWith('device.')) return 'event-type-device';
  if (eventType.startsWith('project') || eventType.startsWith('project:')) return 'event-type-project';
  if (eventType.startsWith('alarm')) return 'event-type-alarm';
  if (eventType.startsWith('plugin.')) return 'event-type-plugin';
  if (
    eventType.startsWith('config') ||
    eventType.startsWith('protocol.') ||
    eventType.startsWith('timer:')
  ) {
    return 'event-type-config';
  }
  return 'event-type-other';
}

/** Event status → CSS class (badge coloring) */
export function getStatusClass(status: string): string {
  return `status-${status}`;
}

/** Compute the max subscriber duration (ms); returns '-' when there are no subscribers */
export function getMaxDuration(subscribers?: SubscriberRecord[]): string {
  if (!subscribers || subscribers.length === 0) return '-';
  const max = subscribers.reduce((maxDuration, subscriber) => {
    return subscriber.duration !== undefined && subscriber.duration > maxDuration
      ? subscriber.duration
      : maxDuration;
  }, 0);
  return max > 0 ? `${max}ms` : '-';
}

/** Success rate (e.g. '2/3') → CSS class (all success / partial success / all failure) */
export function getRatioClass(ratio: string): string {
  const match = ratio.match(/^(\d+)\/(\d+)$/);
  if (!match) return '';
  const success = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  if (success === total) return 'ratio-success';
  if (success === 0) return 'ratio-failed';
  return 'ratio-partial';
}
