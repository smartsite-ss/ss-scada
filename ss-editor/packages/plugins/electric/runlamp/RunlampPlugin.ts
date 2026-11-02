// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { BasePlugin, Graphic, InferSchemaProps, buildDefaultsFromSchema, DrawContext } from '@scada-editor/plugin-sdk';
import { runlampPropertySchema } from './runlampPropertySchema';
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export type RunlampProps = InferSchemaProps<typeof runlampPropertySchema> & {
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

const defaults: RunlampProps = {
  ...buildDefaultsFromSchema(runlampPropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as RunlampProps;

@Graphic({
  type: 'runlamp',
  name: i18n.global.t('runlamp.label'),
  category: 'electric',
  primaryCategory: 'electric',
  description: i18n.global.t('runlamp.description'),
  defaultProps: defaults,
  defaultWidth: 36,
  defaultHeight: 36,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: true,
    animatable: true,
  },
})
export class RunlampPlugin extends BasePlugin<RunlampProps> {
  componentName = 'RunlampGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void { }

  constructor(x = 0, y = 0, w = 36, h = 36) {
    super('runlamp', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
