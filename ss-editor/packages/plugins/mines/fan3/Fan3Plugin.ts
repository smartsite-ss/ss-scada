// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { fan3PropertySchema } from './fan3PropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type Fan3Props = InferSchemaProps<typeof fan3PropertySchema> & {
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

const defaults: Fan3Props = {
  ...buildDefaultsFromSchema(fan3PropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as Fan3Props;


@Graphic({
  type: 'fan3',
  name: i18n.global.t('fan3.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('fan3.description'),
  defaultProps: defaults,
  defaultWidth: 175,
  defaultHeight: 210,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class Fan3Plugin extends BasePlugin<Fan3Props> {
  componentName = 'Fan3Graphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void {
  }

  constructor(x = 0, y = 0, w = 175, h = 210) {
    super('fan3', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}