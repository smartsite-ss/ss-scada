// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { gaugePropertySchema } from './gaugePropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type GaugeProps = InferSchemaProps<typeof gaugePropertySchema> & {
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

const defaultGaugeProps: GaugeProps = {
  ...buildDefaultsFromSchema(gaugePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as GaugeProps;

@Graphic({
  type: 'gauge',
  name: i18n.global.t('gauge.label'),
  category: 'industrial',
  primaryCategory: 'industrial',
  description: i18n.global.t('gauge.description'),
  defaultProps: defaultGaugeProps,
  defaultWidth: 120,
  defaultHeight: 120,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true },
})
export class GaugePlugin extends BasePlugin<GaugeProps> {
  componentName = 'GaugeGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  constructor(x = 0, y = 0, w = 120, h = 120) {
    super('gauge', x, y, w, h);
    this.setDefaultProps({ ...defaultGaugeProps });
  }

  onThemeChanged(themeName: string): void {
    if (themeName === 'dark') {
      this.setPluginProps({ faceColor: '#2A3A4A', rimColor: '#5D6D7E' } as any);
    } else {
      this.setPluginProps({ faceColor: defaultGaugeProps.faceColor, rimColor: defaultGaugeProps.rimColor } as any);
    }
  }

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer (see GaugeGraphic.vue)
  }
}
