// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { faultlampPropertySchema } from './faultlampPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type FaultlampProps = InferSchemaProps<typeof faultlampPropertySchema> & {
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

const defaults: FaultlampProps = {
  ...buildDefaultsFromSchema(faultlampPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as FaultlampProps;

@Graphic({
  type: 'faultlamp',
  name: i18n.global.t('faultlamp.label'),
  category: 'electric',
  primaryCategory: 'electric',
  description: i18n.global.t('faultlamp.description'),
  defaultProps: defaults,
  defaultWidth: 40,
  defaultHeight: 44,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class FaultlampPlugin extends BasePlugin<FaultlampProps> {
  componentName = 'FaultlampGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 40, h = 44) {
    super('faultlamp', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
