// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { localventPropertySchema } from './localventPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type LocalventProps = InferSchemaProps<typeof localventPropertySchema> & {
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

const defaults: LocalventProps = {
  ...buildDefaultsFromSchema(localventPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as LocalventProps;


@Graphic({
  type: 'localvent',
  name: i18n.global.t('localvent.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('localvent.description'),
  defaultProps: defaults,
  defaultWidth: 90,
  defaultHeight: 70,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class LocalventPlugin extends BasePlugin<LocalventProps> {
  componentName = 'LocalventGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 90, h = 70) {
    super('localvent', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
