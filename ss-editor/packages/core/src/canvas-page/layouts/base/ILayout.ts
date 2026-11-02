// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';

// Layout interface
export interface ILayout {
  id: string;
  type: string;
  properties: Record<string, any>;

  // Apply the layout
  applyLayout(graphics: IGraphic[]): void;

  // Update properties
  update(properties: Partial<Record<string, any>>): void;

  // Serialize
  toJSON(): any;

  // Deserialize
  fromJSON(data: any): void;

  // Clone method
  clone(): ILayout;
}
