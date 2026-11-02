// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { filterpressPropertySchema } from './filterpressPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type FilterpressProps = InferSchemaProps<typeof filterpressPropertySchema> & {
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

const defaults: FilterpressProps = {
  ...buildDefaultsFromSchema(filterpressPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as FilterpressProps;


@Graphic({
  type: 'filterpress',
  name: i18n.global.t('filterpress.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('filterpress.description'),
  defaultProps: defaults,
  defaultWidth: 200,
  defaultHeight: 100,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class FilterpressPlugin extends BasePlugin<FilterpressProps> {
  componentName = 'FilterpressGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 200, h = 100) {
    super('filterpress', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
