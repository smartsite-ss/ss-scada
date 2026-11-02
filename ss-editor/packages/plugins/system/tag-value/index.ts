// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { createPlugin } from '@scada-editor/plugin-sdk';
import pkg from './package.json';

// otherwise i18n.global.t() inside the @Graphic decorator will not find the key
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import { TagValuePlugin } from './TagValuePlugin';
import { tagValuePropertySchema } from './tagValuePropertySchema';
import TagValueGraphicComponent from './TagValueGraphic.vue';
import TagValueConfigComponent from './TagValueConfig.vue';

export const TagValueGraphic = TagValueGraphicComponent;
export { TagValuePlugin, tagValuePropertySchema };
export type { TagValueProps } from './TagValuePlugin';
export type { TagValueShape, DecorationImagePosition } from './tagValueUtils';

export default createPlugin({
  type: 'tag-value',
  category: 'system',
  version: pkg.version,
  label: () => i18n.global.t('tagValue.label'),
  plugin: TagValuePlugin,
  schema: tagValuePropertySchema,
  config: TagValueConfigComponent,
  defaultWidth: 160,
  defaultHeight: 48,
  graphicComponent: TagValueGraphicComponent,
  graphicComponentName: 'TagValueGraphic',
});
