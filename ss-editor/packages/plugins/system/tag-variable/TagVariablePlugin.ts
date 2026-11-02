// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { tagVariablePropertySchema } from './tagVariablePropertySchema';
import { i18n, registerLocaleModules } from '@scada-editor/core';

// Dynamically scan the locales directory; adding a new language only requires adding the corresponding json file, no changes to this file needed
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import pkg from './package.json';

export type TagVariableProps = InferSchemaProps<typeof tagVariablePropertySchema> & {
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

const defaults: TagVariableProps = {
  ...buildDefaultsFromSchema(tagVariablePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
} as TagVariableProps;

@Graphic({
  type: 'tag-variable',
  name: i18n.global.t('tagVariable.label'),
  category: 'system',
  version: pkg.version,
  description: i18n.global.t('tagVariable.description'),
  defaultProps: defaults,
  defaultWidth: 120,
  defaultHeight: 40,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: false,
    animatable: false,
  },
})
export class TagVariablePlugin extends BasePlugin<TagVariableProps> {
  componentName = 'TagVariableGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer
  }

  constructor(x = 0, y = 0, w = 120, h = 40) {
    super('tag-variable', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
