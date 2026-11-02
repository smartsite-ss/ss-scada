// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ILayout } from '../../../types';
import { IGraphic } from '@scada-editor/plugin-sdk';
import type { IThemeColors } from '../../../types';
import type { ITimerConfig, ITimerExecutionResult } from '../../../types/timer';
import type { SelectionManager } from '../../managers/SelectionManager';
import type { LayerManager } from '../../../canvas-page/managers/LayerManager';
import type { HistoryManager } from '../../managers/HistoryManager';
import type { AlignmentManager, AlignmentType, DistributionDirection } from '../../managers/AlignmentManager';
import type { LayoutManager, LayoutType, GridLayoutConfig } from '../../../canvas-page/managers/LayoutManager';
import type { GridSnapManager, GridSnapConfig, SnapResult } from '../../managers/GridSnapManager';
import type { SmartAlignManager, GuideLine } from '../../managers/SmartAlignManager';
import type { BatchOperationManager, BatchStyleOptions, SmartPasteOptions } from '../../managers/BatchOperationManager';
import type { GraphicGroup, GroupManager } from '../../managers/GroupManager';
import type { FitMode } from '../../../canvas-page/managers/ZoomManager';

/**
 * Page interface
 */
export interface IPage {
  // Basic properties
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  fitMode: FitMode;           // Current fit mode
  backgroundColor: string;
  backgroundImage?: string;
  themeColors: IThemeColors;
  icon?: string;
  dirty?: boolean;
  markDirty?: () => void;
  clearDirty?: () => void;

  mode?: 'edit' | 'preview';  // Page mode: edit / runtime

  layout: ILayout;
  graphics: IGraphic[];
  timers: ITimerConfig[];
  groups: GraphicGroup[];
  guideLines: GuideLine[];
  dataSource?: any;
  templateId?: string;     // Template reference ID (reference mode)
  templateMode?: 'reference' | 'copy';  // Template application mode

  // Selection properties (via SelectionManager)
  selectedGraphicId: string | null;
  selectedGraphicIds: string[];

  // ==================== Manager Access Methods ====================
  getSelectionManager(): SelectionManager;
  getLayerManager(): LayerManager;
  getHistoryManager(): HistoryManager;
  getAlignmentManager(): AlignmentManager;
  getLayoutManager(): LayoutManager;
  getGridSnapManager(): GridSnapManager;
  getSmartAlignManager(): SmartAlignManager;
  getBatchOperationManager(): BatchOperationManager;
  getGroupManager(): GroupManager;

  // ==================== Basic Methods ====================
  getSize(): { width: number; height: number };
  getGraphics(): IGraphic[];
  clone(): IPage;
  toJSON(): any;
  toJSONAsync(): Promise<any>;  // Async version, converts Blob URLs to Base64
  fromJSON(data: any): void;

  // Graphic management methods
  findGraphicById(id: string): IGraphic | null;
  getGraphicById(id: string): IGraphic | null;
  addGraphic(graphic: IGraphic, autoZIndex?: boolean, recordHistory?: boolean): void;
  removeGraphic(id: string, recordHistory?: boolean): void;
  deleteSelectedGraphics(): void;
  updateGraphic(id: string, properties: Partial<Record<string, any>>): void;
  updatePageProperties(properties: Partial<Record<string, any>>): void;
  moveGraphic(id: string, x: number, y: number): void;
  resizeGraphic(id: string, width: number, height: number): void;
  duplicateGraphic(id: string): IGraphic | null;
  duplicateGroup(groupId: string): { groupId: string; memberIds: string[] } | null;
  lockGraphic(id: string): void;
  unlockGraphic(id: string): void;
  toggleGraphicLock(id: string): void;
  showGraphic(id: string): void;
  hideGraphic(id: string): void;
  toggleGraphicVisibility(id: string): void;
  importGraphics(data: any[]): void;
  exportGraphics(): any[];

  // Selection management methods
  selectGraphic(id: string | null): void;
  selectMultipleGraphics(ids: string[]): void;
  addToSelection(id: string): void;
  removeFromSelection(id: string): void;
  clearSelection(): void;

  // Layer management methods
  bringToFront(id: string): void;
  sendToBack(id: string): void;
  bringForward(id: string): void;
  sendBackward(id: string): void;
  reorderGraphic(id: string, newIndex: number): void;
  getSortedGraphics(): IGraphic[];

  // Group management methods
  createGroup(ids: string[], groupId?: string): any;
  ungroup(groupId: string): IGraphic[];
  isGroup(id: string): boolean;
  getGroupMembers(groupId: string): IGraphic[];
  removeFromGroup(graphicId: string): void;
  addToGroup(graphicId: string, groupId: string): void;
  updateGroupBounds(groupId: string): void;
  selectGroupMembers(groupId: string): void;
  groupGraphics(ids: string[]): any;
  ungroupGraphic(groupId: string): IGraphic[];

  // History methods
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Start batch history recording (merges subsequent saveChange calls into one CompositeChange) */
  startBatch(description: string): void;
  /** End batch history recording */
  endBatch(): void;
  /** Jump to a specific history position (-1 clears all history) */
  jumpToHistory(index: number): void;

  // Layout management methods
  setLayout(layout: LayoutType): void;
  getCurrentLayout(): LayoutType;
  applyGridLayout(config: GridLayoutConfig): void;

  // Other methods
  adjustSpacing(spacing: number, direction: 'horizontal' | 'vertical'): void;
  batchEdit(properties: Partial<IGraphic>): void;
  autoLayout(layoutType: 'grid' | 'flow' | 'circle'): void;
  alignGraphics(alignment: AlignmentType): void;
  distributeGraphics(direction: DistributionDirection): void;
  hasMultipleSelectedGraphics(): boolean;
  hasSelectedGraphics(): boolean;

  // ==================== Grid Snap Methods ====================
  setGridSnapConfig(config: Partial<GridSnapConfig>): void;
  getGridSnapConfig(): GridSnapConfig;
  snapPosition(x: number, y: number, referenceGraphics?: IGraphic[]): SnapResult;
  getGridLines(bounds: { x: number; y: number; width: number; height: number }): any;

  // ==================== Smart Align Methods ====================
  setAlignDistance(distance: number): void;
  detectAlignTargets(draggingGraphic: IGraphic, otherGraphics: IGraphic[]): any;
  addGuideLine(position: number, direction: 'horizontal' | 'vertical'): string;
  removeGuideLine(id: string): void;
  clearAllGuideLines(): void;
  updateGuideLinePosition(id: string, position: number): void;
  getAllGuideLines(): GuideLine[];
  getGuideLine(id: string): GuideLine | null;
  makeSameSize(graphics: IGraphic[]): void;
  makeSameWidth(graphics: IGraphic[]): void;
  makeSameHeight(graphics: IGraphic[]): void;
  alignToPageEdge(graphics: IGraphic[], type: 'left' | 'right' | 'top' | 'bottom', margin?: number): void;
  centerOnPage(graphics: IGraphic[], direction?: 'horizontal' | 'vertical' | 'both'): void;

  // ==================== Batch Operation Methods ====================
  batchMove(deltaX: number, deltaY: number): void;
  batchScale(scaleX: number, scaleY: number, origin?: { x: number; y: number }): void;
  batchRotate(degrees: number, origin?: { x: number; y: number }): void;
  batchApplyStyle(styleProperties: BatchStyleOptions): void;
  batchSetProperty(propertyPath: string, value: any): void;
  smartPaste(options: SmartPasteOptions): IGraphic[];
  spaceEvenlyHorizontal(spacing?: number): void;
  spaceEvenlyVertical(spacing?: number): void;

  // ==================== Timer Management Methods ====================
  addTimer(timer: Omit<ITimerConfig, 'id' | 'lastExecuteTime' | 'executeCount'>): ITimerConfig;
  updateTimer(id: string, config: Partial<ITimerConfig>): void;
  removeTimer(id: string): void;
  getTimer(id: string): ITimerConfig | null;
  getAllTimers(): ITimerConfig[];
  enableTimer(id: string): void;
  disableTimer(id: string): void;

  // ==================== Timer Run Control ====================
  startTimers(): void;
  stopTimers(): void;
  startTimer(id: string): void;
  stopTimer(id: string): void;

  // ==================== Script Execution ====================
  executeTimerScript(timer: ITimerConfig): ITimerExecutionResult;

  // ==================== Window Fit Methods ====================
  setFitMode(mode: FitMode): void;
  getFitMode(): FitMode;
  autoFit(viewportWidth: number, viewportHeight: number): void;
  autoFitToGraphics(viewportWidth: number, viewportHeight: number): void;
  resetFitMode(): void;
}
