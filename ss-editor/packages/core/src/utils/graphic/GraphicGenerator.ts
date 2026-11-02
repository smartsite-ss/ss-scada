// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';
import { GraphicFactory } from '../../graphic-editing/graphic/factory/GraphicFactory';
import {
  GenerateConfig,
  BatchGenerateConfig,
  GenerateResult,
  GridOptions,
  RandomOptions,
} from './GraphicGeneratorTypes';

// Preset color pool
const COLOR_POOL = [
  '#2196F3FF', '#4CAF50FF', '#FF9800FF', '#F44336FF', '#9C27B0FF',
  '#00BCD4FF', '#FFEB3BFF', '#795548FF', '#607D8BFF', '#E91E63FF',
  '#3F51B5FF', '#009688FF', '#FFC107FF', '#8BC34AFF', '#03A9F4FF',
];

/**
 * Dynamic graphic generator
 * Quickly generates a specified number of graphics of a given type,
 * supporting multiple layout modes
 */
export class GraphicGenerator {
  constructor() {}

  /**
   * Generate a specified number of graphics
   * @param config Generation configuration
   * @returns Generation result
   */
  generate(config: GenerateConfig): GenerateResult {
    const startTime = performance.now();

    // Validate configuration
    this.validateConfig(config);

    // Calculate positions
    const positions = this.calculatePositions(config);

    // Create graphics
    const graphics: IGraphic[] = [];
    positions.forEach((pos, index) => {
      const graphic = this.createGraphic(config, pos, index);
      if (graphic) {
        graphics.push(graphic);
      }
    });

    const duration = performance.now() - startTime;

    return {
      graphics,
      duration,
      count: graphics.length,
    };
  }

  /**
   * Batch-generate multiple types of graphics
   * @param config Batch configuration
   * @returns Generation result
   */
  batchGenerate(config: BatchGenerateConfig): GenerateResult {
    const startTime = performance.now();
    const graphics: IGraphic[] = [];

    let currentX = 50;
    let currentY = 50;

    config.graphics.forEach(graphicConfig => {
      const width = graphicConfig.width || 100;
      const height = graphicConfig.height || 80;

      const x = graphicConfig.x ?? currentX;
      const y = graphicConfig.y ?? currentY;

      const graphic = GraphicFactory.createGraphic(
        graphicConfig.type,
        x,
        y,
        width,
        height
      );

      if (graphic && graphicConfig.customProps) {
        Object.entries(graphicConfig.customProps).forEach(([key, value]) => {
          graphic.setProps(key, value);
        });
      }

      if (graphic) {
        graphics.push(graphic);
      }

      currentX += width + 20;
      if (currentX > 1800) {
        currentX = 50;
        currentY += height + 20;
      }
    });

    const duration = performance.now() - startTime;

    return {
      graphics,
      duration,
      count: graphics.length,
    };
  }

  /**
   * Convenience method: generate graphics in a grid layout
   * @param type Graphic type
   * @param count Number
   * @param options Grid options
   * @returns Graphic array
   */
  generateGrid(type: string, count: number, options?: GridOptions): IGraphic[] {
    const result = this.generate({
      type,
      count,
      layoutMode: 'grid',
      startX: options?.startX ?? 50,
      startY: options?.startY ?? 50,
      areaWidth: 1920,
      areaHeight: 1080,
      cols: options?.cols ?? Math.ceil(Math.sqrt(count)),
      gapX: options?.gapX ?? 20,
      gapY: options?.gapY ?? 20,
      fixedWidth: options?.width ?? 100,
      fixedHeight: options?.height ?? 80,
    });
    return result.graphics;
  }

  /**
   * Convenience method: generate graphics in a random layout
   * @param type Graphic type
   * @param count Number
   * @param options Random options
   * @returns Graphic array
   */
  generateRandom(type: string, count: number, options?: RandomOptions): IGraphic[] {
    const result = this.generate({
      type,
      count,
      layoutMode: 'random',
      startX: 0,
      startY: 0,
      areaWidth: options?.areaWidth ?? 1920,
      areaHeight: options?.areaHeight ?? 1080,
      minWidth: options?.minWidth ?? 60,
      maxWidth: options?.maxWidth ?? 120,
      minHeight: options?.minHeight ?? 30,
      maxHeight: options?.maxHeight ?? 60,
      randomColors: options?.randomColors ?? true,
      randomSizes: options?.randomSizes ?? true,
      randomRotation: options?.randomRotation ?? false,
    });
    return result.graphics;
  }

  /**
   * Validate configuration
   */
  private validateConfig(config: GenerateConfig): void {
    if (config.count <= 0) {
      throw new Error('Count must be greater than 0');
    }
    if (config.areaWidth <= 0 || config.areaHeight <= 0) {
      throw new Error('Area dimensions must be greater than 0');
    }
  }

  /**
   * Calculate all positions
   */
  private calculatePositions(config: GenerateConfig): { x: number; y: number }[] {
    switch (config.layoutMode) {
      case 'grid':
        return this.layoutGrid(config);
      case 'random':
        return this.layoutRandom(config);
      case 'flow':
        return this.layoutFlow(config);
      case 'spiral':
        return this.layoutSpiral(config);
      default:
        return this.layoutGrid(config);
    }
  }

  /**
   * Grid layout
   */
  private layoutGrid(config: GenerateConfig): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const cols = config.cols ?? Math.ceil(Math.sqrt(config.count));
    const gapX = config.gapX ?? 20;
    const gapY = config.gapY ?? 20;
    const width = config.fixedWidth ?? 100;
    const height = config.fixedHeight ?? 80;

    for (let i = 0; i < config.count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: config.startX + col * (width + gapX),
        y: config.startY + row * (height + gapY),
      });
    }

    return positions;
  }

  /**
   * Random layout
   */
  private layoutRandom(config: GenerateConfig): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const width = config.fixedWidth ?? 100;
    const height = config.fixedHeight ?? 80;

    for (let i = 0; i < config.count; i++) {
      positions.push({
        x: config.startX + Math.random() * (config.areaWidth - width - config.startX),
        y: config.startY + Math.random() * (config.areaHeight - height - config.startY),
      });
    }

    return positions;
  }

  /**
   * Flow layout
   */
  private layoutFlow(config: GenerateConfig): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const gapX = config.gapX ?? 20;
    const gapY = config.gapY ?? 20;
    const width = config.fixedWidth ?? 100;
    const height = config.fixedHeight ?? 80;

    let currentX = config.startX;
    let currentY = config.startY;

    for (let i = 0; i < config.count; i++) {
      positions.push({ x: currentX, y: currentY });

      currentX += width + gapX;

      if (currentX + width > config.startX + config.areaWidth) {
        currentX = config.startX;
        currentY += height + gapY;
      }
    }

    return positions;
  }

  /**
   * Spiral layout
   */
  private layoutSpiral(config: GenerateConfig): { x: number; y: number }[] {
    const positions: { x: number; y: number }[] = [];
    const centerX = config.startX + config.areaWidth / 2;
    const centerY = config.startY + config.areaHeight / 2;
    const width = config.fixedWidth ?? 100;
    const height = config.fixedHeight ?? 80;

    let angle = 0;
    let radius = 50;

    for (let i = 0; i < config.count; i++) {
      const x = centerX + Math.cos(angle) * radius - width / 2;
      const y = centerY + Math.sin(angle) * radius - height / 2;

      positions.push({ x, y });

      angle += 0.8;
      radius += 3;
    }

    return positions;
  }

  /**
   * Create a single graphic
   */
  private createGraphic(config: GenerateConfig, pos: { x: number; y: number }, index: number): IGraphic | null {
    let width: number;
    let height: number;

    if (config.randomSizes) {
      width = this.randomNumber(config.minWidth ?? 60, config.maxWidth ?? 120);
      height = this.randomNumber(config.minHeight ?? 30, config.maxHeight ?? 60);
    } else {
      width = config.fixedWidth ?? 100;
      height = config.fixedHeight ?? 80;
    }

    try {
      const graphic = GraphicFactory.createGraphic(config.type, pos.x, pos.y, width, height);

      // Random color
      if (config.randomColors) {
        const color = this.randomColor();
        graphic.setStyle({ fillColor: color });
      }

      // Random rotation
      if (config.randomRotation) {
        graphic.setRotation(this.randomRotation());
      }

      return graphic;
    } catch (error) {
      console.error(`Failed to create graphic ${index}:`, error);
      return null;
    }
  }

  /**
   * Generate a random color
   */
  private randomColor(): string {
    return COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)];
  }

  /**
   * Generate a random number within a range
   */
  private randomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate a random rotation angle
   */
  private randomRotation(): number {
    return Math.random() * 360;
  }
}
