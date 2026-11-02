// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { fan2PropertySchema } from './fan2PropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type Fan2Props = InferSchemaProps<typeof fan2PropertySchema> & {
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

const defaults: Fan2Props = {
  ...buildDefaultsFromSchema(fan2PropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as Fan2Props;


@Graphic({
  type: 'fan2',
  name: i18n.global.t('fan2.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('fan2.description'),
  defaultProps: defaults,
  defaultWidth: 120,
  defaultHeight: 110,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class Fan2Plugin extends BasePlugin<Fan2Props> {
  componentName = 'Fan2Graphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 120, h = 110) {
    super('fan2', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}