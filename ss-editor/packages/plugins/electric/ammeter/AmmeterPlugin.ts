// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { ammeterPropertySchema } from './ammeterPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type AmmeterProps = InferSchemaProps<typeof ammeterPropertySchema> & {
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

const defaults: AmmeterProps = {
  ...buildDefaultsFromSchema(ammeterPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as AmmeterProps;

@Graphic({
  type: 'ammeter',
  name: i18n.global.t('ammeter.label'),
  category: 'electric',
  primaryCategory: 'electric',
  description: i18n.global.t('ammeter.description'),
  defaultProps: defaults,
  defaultWidth: 50,
  defaultHeight: 50,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class AmmeterPlugin extends BasePlugin<AmmeterProps> {
  componentName = 'AmmeterGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 50, h = 50) {
    super('ammeter', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
