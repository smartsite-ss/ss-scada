// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { pumpPropertySchema } from './pumpPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type PumpProps = InferSchemaProps<typeof pumpPropertySchema> & {
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

const defaultPumpProps: PumpProps = {
  ...buildDefaultsFromSchema(pumpPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as PumpProps;

@Graphic({
  type: 'pump',
  name: i18n.global.t('pump.label'),
  category: 'industrial',
  primaryCategory: 'industrial',
  description: i18n.global.t('pump.description'),
  defaultProps: defaultPumpProps,
  defaultWidth: 80,
  defaultHeight: 80,
  minWidth: 40,
  minHeight: 50,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
  themeColors: {
    bodyColor: { light: '#4A90A4', dark: '#6BA5B8' },
    impellerColor: { light: '#2E6B7D', dark: '#3E7D8F' },
  },
})
export class PumpPlugin extends BasePlugin<PumpProps> {
  componentName = 'PumpGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  constructor(x = 0, y = 0, w = 80, h = 80) {
    super('pump', x, y, w, h);
    this.setDefaultProps({ ...defaultPumpProps });
  }

  onThemeChanged(themeName: string): void {
    if (themeName === 'dark') {
      this.setPluginProps({ bodyColor: '#6BA5B8', impellerColor: '#3E7D8F' } as any);
    } else {
      this.setPluginProps({ bodyColor: defaultPumpProps.bodyColor, impellerColor: defaultPumpProps.impellerColor } as any);
    }
  }

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer (see PumpGraphic.vue)
  }
}
