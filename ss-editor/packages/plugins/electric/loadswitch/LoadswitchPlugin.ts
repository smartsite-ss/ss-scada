// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { loadswitchPropertySchema } from './loadswitchPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type LoadswitchProps = InferSchemaProps<typeof loadswitchPropertySchema> & {
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

const defaults: LoadswitchProps = {
  ...buildDefaultsFromSchema(loadswitchPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as LoadswitchProps;

@Graphic({
  type: 'loadswitch',
  name: i18n.global.t('loadswitch.label'),
  category: 'electric',
  primaryCategory: 'electric',
  description: i18n.global.t('loadswitch.description'),
  defaultProps: defaults,
  defaultWidth: 40,
  defaultHeight: 90,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: false,
  },
})
export class LoadswitchPlugin extends BasePlugin<LoadswitchProps> {
  componentName = 'LoadswitchGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 40, h = 90) {
    super('loadswitch', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
