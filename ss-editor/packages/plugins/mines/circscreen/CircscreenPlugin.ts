// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { circscreenPropertySchema } from './circscreenPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type CircscreenProps = InferSchemaProps<typeof circscreenPropertySchema> & {
  /** Device UUID primary key (for binding echo / reverse lookup) */
  deviceId: string;
  /** Device code (user-readable, for display) */
  deviceCode: string;
  /** Device name (for display) */
  deviceName: string;
  /** Tag ID (unique identifier for runtime subscription) */
  tagId: string;
  /** Tag name (for display) */
  tagName: string;
  /** Tag data type (used for formatting decisions) */
  dataType: string;
};

const defaults: CircscreenProps = {
  ...buildDefaultsFromSchema(circscreenPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as CircscreenProps;


@Graphic({
  type: 'circscreen', name: i18n.global.t('circscreen.label'),
  category: 'mines', primaryCategory: 'mining',
  description: i18n.global.t('circscreen.description'),
  defaultProps: defaults, defaultWidth: 120, defaultHeight: 120,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
})
export class CircscreenPlugin extends BasePlugin<CircscreenProps> {
  componentName = 'CircscreenGraphic';
  getComponentProps = () => ({ w: this.getSize().width, h: this.getSize().height, ...this.pluginProps });
  protected render(_dc: DrawContext): void { }
  constructor(x = 0, y = 0, w = 120, h = 120) { super('circscreen', x, y, w, h); this.setDefaultProps({ ...defaults }); }
}
