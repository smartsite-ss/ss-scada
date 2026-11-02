// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { magselectorPropertySchema } from './magselectorPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type MagselectorProps = InferSchemaProps<typeof magselectorPropertySchema> & {
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

const defaults: MagselectorProps = {
  ...buildDefaultsFromSchema(magselectorPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as MagselectorProps;


@Graphic({
  type: 'magselector',
  name: i18n.global.t('magselector.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('magselector.description'),
  defaultProps: defaults,
  defaultWidth: 160,
  defaultHeight: 90,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class MagselectorPlugin extends BasePlugin<MagselectorProps> {
  componentName = 'MagselectorGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 160, h = 90) {
    super('magselector', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
