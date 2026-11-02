// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { converterPropertySchema } from './converterPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type ConverterProps = InferSchemaProps<typeof converterPropertySchema> & {
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

const defaults: ConverterProps = {
  ...buildDefaultsFromSchema(converterPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as ConverterProps;


@Graphic({
  type: 'converter', name: i18n.global.t('converter.label'),
  category: 'mines', primaryCategory: 'mining',
  description: i18n.global.t('converter.description'),
  defaultProps: defaults, defaultWidth: 110, defaultHeight: 90,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
})
export class ConverterPlugin extends BasePlugin<ConverterProps> {
  componentName = 'ConverterGraphic';
  getComponentProps = () => ({ w: this.getSize().width, h: this.getSize().height, ...this.pluginProps });
  protected render(_dc: DrawContext): void { }
  constructor(x = 0, y = 0, w = 110, h = 90) { super('converter', x, y, w, h); this.setDefaultProps({ ...defaults }); }
}
