// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BaseLayout } from '../base/BaseLayout';
import { IGraphic } from '@scada-editor/plugin-sdk';

// Grid layout class
export class GridLayout extends BaseLayout {
  constructor() {
    super('grid', {
      rows: 2,
      columns: 2,
      spacing: 10,
      padding: 10,
    });
  }

  clone(): GridLayout {
    const cloned = new GridLayout();
    cloned.properties = { ...this.properties };
    return cloned;
  }

  // Apply the layout
  applyLayout(graphics: IGraphic[]): void {
    this.arrange(graphics);
  }

  // Arrange the graphics
  arrange(graphics: IGraphic[]): void {
    const { rows, columns, spacing, padding } = this.properties;
    const totalItems = graphics.length;
    const itemsPerPage = rows * columns;
    const pageCount = Math.ceil(totalItems / itemsPerPage);

    for (let page = 0; page < pageCount; page++) {
      const startIndex = page * itemsPerPage;
      const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
      const pageGraphics = graphics.slice(startIndex, endIndex);

      for (let i = 0; i < pageGraphics.length; i++) {
        const graphic = pageGraphics[i];
        const row = Math.floor(i / columns);
        const col = i % columns;

        // Compute graphic position
        const x =
          padding + col * (graphic.config.geometry.width + spacing);
        const y =
          padding + row * (graphic.config.geometry.height + spacing);

        // Update graphic position
        graphic.config.geometry.x = x;
        graphic.config.geometry.y = y;
      }
    }
  }
}
