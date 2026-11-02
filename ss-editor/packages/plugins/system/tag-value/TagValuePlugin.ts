// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { i18n, registerLocaleModules } from '@scada-editor/core';
import { tagValuePropertySchema } from './tagValuePropertySchema';

// Dynamically scan the locales directory; adding a new language only requires adding the corresponding json file, no changes to this file needed
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import pkg from './package.json';

export type TagValueProps = InferSchemaProps<typeof tagValuePropertySchema> & {
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
  /** Decoration image URL / dataURL (managed by TagValueConfig via StateImagePicker) */
  decorationImage: string;
  /** Background image URL / dataURL (managed by TagValueConfig via StateImagePicker) */
  backgroundImage: string;
};

const defaults: TagValueProps = {
  ...buildDefaultsFromSchema(tagValuePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
  decorationImage: '',
  backgroundImage: '',
} as TagValueProps;

@Graphic({
  type: 'tag-value',
  name: i18n.global.t('tagValue.label'),
  category: 'system',
  version: pkg.version,
  description: i18n.global.t('tagValue.description'),
  defaultProps: defaults,
  defaultWidth: 160,
  defaultHeight: 48,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: false,
    animatable: false,
  },
})
export class TagValuePlugin extends BasePlugin<TagValueProps> {
  componentName = 'TagValueGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer
  }

  constructor(x = 0, y = 0, w = 160, h = 48) {
    super('tag-value', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
