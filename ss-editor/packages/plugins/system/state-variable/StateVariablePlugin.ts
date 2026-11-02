// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { i18n, registerLocaleModules } from '@scada-editor/core';
import { stateVariablePropertySchema } from './stateVariablePropertySchema';
import type { StateRule } from './stateVariableUtils';

// Dynamically scan the locales directory; adding a new language only requires adding the corresponding json file, no changes to this file needed
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import pkg from './package.json';

export type StateVariableProps = InferSchemaProps<typeof stateVariablePropertySchema> & {
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
  /** Tag data type (used for comparison matching adaptation) */
  dataType: string;
  /** State rule array; array order is the matching priority */
  states: StateRule[];
  /** Default image shown when no rule matches */
  defaultImage: string;
};

const defaults: StateVariableProps = {
  ...buildDefaultsFromSchema(stateVariablePropertySchema),
  deviceId: '',
  deviceCode: '',
  deviceName: '',
  tagId: '',
  tagName: '',
  dataType: 'float',
  states: [],
  defaultImage: '',
} as StateVariableProps;

@Graphic({
  type: 'state-variable',
  name: i18n.global.t('stateVariable.label'),
  category: 'system',
  version: pkg.version,
  description: i18n.global.t('stateVariable.description'),
  defaultProps: defaults,
  defaultWidth: 100,
  defaultHeight: 100,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: false,
    animatable: false,
  },
})
export class StateVariablePlugin extends BasePlugin<StateVariableProps> {
  componentName = 'StateVariableGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer
  }

  constructor(x = 0, y = 0, w = 100, h = 100) {
    super('state-variable', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
