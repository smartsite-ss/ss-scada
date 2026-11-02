// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BasePlugin, Graphic, DrawContext, InferSchemaProps, buildDefaultsFromSchema } from '@scada-editor/plugin-sdk';
import { i18n, registerLocaleModules } from '@scada-editor/core';
import { hikvisionVideoPropertySchema } from './hikvisionVideoPropertySchema';
import type { VideoChannel } from './videoPlayer';

// Dynamically scan the locales directory; adding a new language only requires adding the corresponding json file, no changes to this file needed
registerLocaleModules(import.meta.glob('./locales/*.json', { eager: true }));

import pkg from './package.json';

export type HikvisionVideoProps = InferSchemaProps<typeof hikvisionVideoPropertySchema> & {
  /** Video channel list; array order is the grid slot order (top-left → bottom-right) */
  channels: VideoChannel[];
};

const defaults: HikvisionVideoProps = {
  ...buildDefaultsFromSchema(hikvisionVideoPropertySchema),
  channels: [],
} as HikvisionVideoProps;

@Graphic({
  type: 'hikvision-video',
  name: i18n.global.t('hikvisionVideo.label'),
  category: 'system',
  version: pkg.version,
  description: i18n.global.t('hikvisionVideo.description'),
  defaultProps: defaults,
  defaultWidth: 640,
  defaultHeight: 360,
  features: {
    resizable: true,
    rotatable: false,
    cloneable: true,
    groupable: true,
    dataBindable: false,
    animatable: false,
  },
})
export class HikvisionVideoPlugin extends BasePlugin<HikvisionVideoProps> {
  componentName = 'HikvisionVideoGraphic';

  getComponentProps = () => {
    const { width, height } = this.getSize();
    return { w: width, h: height, ...this.pluginProps };
  };

  protected render(_dc: DrawContext): void {
    // Vue SFC mode: main rendering is done by the Vue DOM layer
  }

  constructor(x = 0, y = 0, w = 640, h = 360) {
    super('hikvision-video', x, y, w, h);
    this.setDefaultProps({ ...defaults });
  }
}
