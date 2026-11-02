// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { gaspipePropertySchema } from './gaspipePropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type GaspipeProps = InferSchemaProps<typeof gaspipePropertySchema> & {
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

const defaults: GaspipeProps = {
  ...buildDefaultsFromSchema(gaspipePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as GaspipeProps;


@Graphic({
  type: 'gaspipe', name: i18n.global.t('gaspipe.label'),
  category: 'mines', primaryCategory: 'mining',
  description: i18n.global.t('gaspipe.description'),
  defaultProps: defaults, defaultWidth: 200, defaultHeight: 16,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
})
export class GaspipePlugin extends BasePlugin<GaspipeProps> {
  componentName = 'GaspipeGraphic';
  getComponentProps = () => ({ w: this.getSize().width, h: this.getSize().height, ...this.pluginProps });
  protected render(_dc: DrawContext): void { }
  constructor(x = 0, y = 0, w = 200, h = 16) { super('gaspipe', x, y, w, h); this.setDefaultProps({ ...defaults }); }
}
