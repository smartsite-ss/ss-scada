// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { mixingpoolPropertySchema } from './mixingpoolPropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));
export type MixingpoolProps = InferSchemaProps<typeof mixingpoolPropertySchema> & {
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

const defaults: MixingpoolProps = {
  ...buildDefaultsFromSchema(mixingpoolPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as MixingpoolProps;


@Graphic({
  type: 'mixingpool',
  name: i18n.global.t('mixingpool.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('mixingpool.description'),
  defaultProps: defaults,
  defaultWidth: 140,
  defaultHeight: 200,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class MixingpoolPlugin extends BasePlugin<MixingpoolProps> {
  componentName = 'MixingpoolGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return {
      w: width,
      h: height,
      ...this.pluginProps,
    };
  };

  constructor(x = 0, y = 0, w = 140, h = 200) {
    super('mixingpool', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}