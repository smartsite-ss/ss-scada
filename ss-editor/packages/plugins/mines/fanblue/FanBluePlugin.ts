// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { fanbluePropertySchema } from './fanbluePropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type FanBlueProps = InferSchemaProps<typeof fanbluePropertySchema> & {
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

const defaults: FanBlueProps = {
  ...buildDefaultsFromSchema(fanbluePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as FanBlueProps;


@Graphic({
  type: 'fanblue',
  name: i18n.global.t('fanblue.label'),
  category: 'mines',
  primaryCategory: 'mining',
  description: i18n.global.t('fanblue.description'),
  defaultProps: defaults,
  defaultWidth: 200,
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
export class FanBluePlugin extends BasePlugin<FanBlueProps> {
  componentName = 'FanBlueGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    const props = {
      w: width,
      h: height,
      dur: this.pluginProps.dur,
      roate: this.pluginProps.roate,
      cls: this.pluginProps.cls,
      backgroundColor: this.pluginProps.backgroundColor,
      colors: this.pluginProps.colors,
      dataset: this.pluginProps.dataset,
    };
    return props;
  };

  protected render(_dc: DrawContext): void {
  }

  constructor(x = 0, y = 0, w = 200, h = 200) {
    super('fanblue', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}