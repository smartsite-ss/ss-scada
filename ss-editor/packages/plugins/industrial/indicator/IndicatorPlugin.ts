// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { indicatorPropertySchema } from './indicatorPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type IndicatorProps = InferSchemaProps<typeof indicatorPropertySchema> & {
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

const defaultIndicatorProps: IndicatorProps = {
  ...buildDefaultsFromSchema(indicatorPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as IndicatorProps;

@Graphic({
  type: 'indicator',
  name: i18n.global.t('indicator.label'),
  category: 'industrial',
  primaryCategory: 'industrial',
  description: i18n.global.t('indicator.description'),
  defaultProps: defaultIndicatorProps,
  defaultWidth: 40,
  defaultHeight: 40,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true },
})
export class IndicatorPlugin extends BasePlugin<IndicatorProps> {
  componentName = 'IndicatorGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  constructor(x = 0, y = 0, w = 40, h = 40) {
    super('indicator', x, y, w, h);
    this.setDefaultProps({ ...defaultIndicatorProps });
  }

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer (see IndicatorGraphic.vue)
  }
}
