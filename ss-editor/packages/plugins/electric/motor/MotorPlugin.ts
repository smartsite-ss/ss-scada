// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { motorPropertySchema } from './motorPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type MotorProps = InferSchemaProps<typeof motorPropertySchema> & {
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

const defaults: MotorProps = {
  ...buildDefaultsFromSchema(motorPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as MotorProps;

@Graphic({
  type: 'motor',
  name: i18n.global.t('motor.label'),
  category: 'electric',
  primaryCategory: 'electric',
  description: i18n.global.t('motor.description'),
  defaultProps: defaults,
  defaultWidth: 56,
  defaultHeight: 56,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class MotorPlugin extends BasePlugin<MotorProps> {
  componentName = 'MotorGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 56, h = 56) {
    super('motor', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
