// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { waterpumpPropertySchema } from './waterpumpPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type WaterpumpProps = InferSchemaProps<typeof waterpumpPropertySchema> & {
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

const defaultWaterpumpProps: WaterpumpProps = {
  ...buildDefaultsFromSchema(waterpumpPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as WaterpumpProps;

@Graphic({
  type: 'waterpump',
  name: i18n.global.t('waterpump.label'),
  category: 'industrial',
  primaryCategory: 'industrial',
  description: i18n.global.t('waterpump.description'),
  defaultProps: defaultWaterpumpProps,
  defaultWidth: 120,
  defaultHeight: 60,
  minWidth: 60,
  minHeight: 40,
  features: { resizable: true, rotatable: false, cloneable: true, groupable: true, dataBindable: true, animatable: true },
  themeColors: {
    bodyColor: { light: '#5D6D7E', dark: '#7F8C8D' },
    impellerColor: { light: '#2C3E50', dark: '#34495E' },
  },
})
export class WaterpumpPlugin extends BasePlugin<WaterpumpProps> {
  componentName = 'WaterpumpGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  constructor(x = 0, y = 0, w = 120, h = 60) {
    super('waterpump', x, y, w, h);
    this.setDefaultProps({ ...defaultWaterpumpProps });
  }

  onThemeChanged(themeName: string): void {
    if (themeName === 'dark') {
      this.setPluginProps({ bodyColor: '#7F8C8D', impellerColor: '#34495E' } as any);
    } else {
      this.setPluginProps({ bodyColor: defaultWaterpumpProps.bodyColor, impellerColor: defaultWaterpumpProps.impellerColor } as any);
    }
  }

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer (see WaterpumpGraphic.vue)
  }
}
