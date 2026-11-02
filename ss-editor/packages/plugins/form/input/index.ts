// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n, registerLocaleModules } from '@scada-editor/core';
import { createPlugin } from '@scada-editor/plugin-sdk';
import pkg from './package.json';

// ★ Locale must be merged before importing InputPlugin,
// otherwise i18n.global.t() inside the @Graphic decorator will not find the key
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

export { default as InputIcon } from './InputIcon.vue';
export { default as InputConfig } from './InputConfig.vue';
import { InputPlugin } from './InputPlugin';
import { inputPropertySchema } from './inputPropertySchema';
import InputGraphicComponent from './InputGraphic.vue';

export const InputGraphic = InputGraphicComponent;
export { InputPlugin, inputPropertySchema };
export type { InputProps } from './InputPlugin';

export default createPlugin({
  type: 'input',
  category: 'form',
  version: pkg.version,
  label: () => i18n.global.t('input.label'),
  plugin: InputPlugin,
  schema: inputPropertySchema,
  defaultWidth: 160,
  defaultHeight: 36,
  graphicComponent: InputGraphicComponent,
  graphicComponentName: 'InputGraphic',
});
