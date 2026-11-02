// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BaseLayout } from '../base/BaseLayout';
import { IGraphic } from '@scada-editor/plugin-sdk';

// Free layout class
export class FreeLayout extends BaseLayout {
  constructor() {
    super('free', {
      // Free layout has no specific properties
    });
  }

  arrange(_graphics: IGraphic[]): void {
    // Free layout performs no processing; graphics keep their original positions
  }

  // Apply the layout
  applyLayout(_graphics: IGraphic[]): void {
    // Free layout performs no processing; graphics keep their original positions
  }

  // Clone method
  clone(): FreeLayout {
    const newLayout = new FreeLayout();
    newLayout.properties = { ...this.properties };
    return newLayout;
  }
}
