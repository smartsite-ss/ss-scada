// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IPage } from './IPage';
import type { IGraphic } from '@scada-editor/plugin-sdk';
import type { EnterAnimationEngine } from '../../../animations/EnterAnimationEngine';

/**
 * Page context interface
 *
 * Through this interface a graphic perceives the page environment, enabling
 * cross-graphic linkage, data queries, and similar capabilities.
 * Injected automatically by BasePage when addGraphic is called; plugin
 * developers access it via this.pageContext.
 */
export interface IPageContext {
  /** Get the current page */
  getPage(): IPage;

  /** Find any graphic by ID */
  getGraphicById(id: string): IGraphic | undefined;

  /** Find all graphics by type */
  getGraphicsByType(type: string): IGraphic[];

  /** Find members of a group */
  getGroupMembers(groupId: string): IGraphic[];

  /** Emit on the event bus */
  emit<T = any>(event: string, payload: T): void;

  /** Listen on the event bus, returns a function to cancel the listener */
  on<T = any>(event: string, handler: (payload: T) => void): () => void;

  /** Enter animation engine */
  animationEngine: EnterAnimationEngine | null;

  /** Set the animation frame callback (drawCanvas injected by editor layer) */
  setAnimationFrameCallback(callback: () => void): void;
}
