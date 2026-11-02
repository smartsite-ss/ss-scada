// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Page carousel type definitions
 */

/** Carousel transition effect */
export type CarouselTransition = 'none' | 'fade' | 'slide-left' | 'slide-right';

/** Carousel config (project-level persistence) */
export interface CarouselConfig {
  /** Whether the carousel is enabled */
  enabled: boolean;
  /** Carousel interval (ms), default 30000 (30 seconds) */
  interval: number;
  /** List of page IDs participating in the carousel; empty means all pages */
  pageIds: string[];
  /** Whether to loop */
  loop: boolean;
  /** Transition effect */
  transition: CarouselTransition;
  /** Whether to start automatically when preview starts */
  autoStart: boolean;
  /** Whether to show carousel controls even with a single page */
  showSinglePage: boolean;
}

/** Carousel page info */
export interface CarouselPageInfo {
  id: string;
  name: string;
  /** Index in the original pages array */
  index: number;
}

/** Carousel runtime state */
export interface CarouselState {
  /** Whether running */
  isRunning: boolean;
  /** Whether paused */
  isPaused: boolean;
  /** Index of the current page within carouselPages */
  currentIndex: number;
  /** Elapsed play time of the current page (ms) */
  elapsedTime: number;
  /** List of carousel pages (filtered and sorted) */
  carouselPages: CarouselPageInfo[];
}

/** Default carousel config */
export const DEFAULT_CAROUSEL_CONFIG: CarouselConfig = {
  enabled: false,
  interval: 10000,
  pageIds: [],
  loop: true,
  transition: 'fade',
  autoStart: false,
  showSinglePage: false,
};
