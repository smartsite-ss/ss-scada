// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { i18n, registerLocaleModules } from '@scada-editor/core';
import { eventPanelPropertySchema } from './eventPanelPropertySchema';

// Dynamically scan the locales directory; adding a new language only requires adding the corresponding json file, no changes to this file needed
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import pkg from './package.json';

export type EventPanelProps = InferSchemaProps<typeof eventPanelPropertySchema> & {
  /** Project ID (empty = all events, including system-level) */
  projectId: string;
  /** Event type filter (empty = all types) */
  eventType: string;
  /** Event status filter (empty = all statuses) */
  status: string;
};

const defaults: EventPanelProps = {
  ...buildDefaultsFromSchema(eventPanelPropertySchema),
  projectId: '',
  eventType: '',
  status: '',
} as EventPanelProps;

@Graphic({
  type: 'event-panel',
  name: i18n.global.t('eventPanel.label'),
  category: 'system',
  version: pkg.version,
  description: i18n.global.t('eventPanel.description'),
  defaultProps: defaults,
  defaultWidth: 480,
  defaultHeight: 320,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: false,
    animatable: false,
  },
})
export class EventPanelPlugin extends BasePlugin<EventPanelProps> {
  componentName = 'EventPanelGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer
  }

  constructor(x = 0, y = 0, w = 480, h = 320) {
    super('event-panel', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
