// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { shakingtablePropertySchema } from './shakingtablePropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type ShakingtableProps = InferSchemaProps<typeof shakingtablePropertySchema> & {
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

const defaults: ShakingtableProps = {
  ...buildDefaultsFromSchema(shakingtablePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as ShakingtableProps;


@Graphic({
  type: 'shakingtable',
  name: i18n.global.t('shakingtable.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('shakingtable.description'),
  defaultProps: defaults,
  defaultWidth: 180,
  defaultHeight: 85,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class ShakingtablePlugin extends BasePlugin<ShakingtableProps> {
  componentName = 'ShakingtableGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 180, h = 85) {
    super('shakingtable', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
