// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { earcfurnacePropertySchema } from './earcfurnacePropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type EarcfurnaceProps = InferSchemaProps<typeof earcfurnacePropertySchema> & {
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

const defaults: EarcfurnaceProps = {
  ...buildDefaultsFromSchema(earcfurnacePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as EarcfurnaceProps;


@Graphic({
  type: 'earcfurnace', name: i18n.global.t('earcfurnace.label'),
  category: 'mines', primaryCategory: 'mining',
  description: i18n.global.t('earcfurnace.description'),
  defaultProps: defaults, defaultWidth: 130, defaultHeight: 100,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
})
export class EarcfurnacePlugin extends BasePlugin<EarcfurnaceProps> {
  componentName = 'EarcfurnaceGraphic';
  getComponentProps = () => ({ w: this.getSize().width, h: this.getSize().height, ...this.pluginProps });
  protected render(_dc: DrawContext): void { }
  constructor(x = 0, y = 0, w = 130, h = 100) { super('earcfurnace', x, y, w, h); this.setDefaultProps({ ...defaults }); }
}
