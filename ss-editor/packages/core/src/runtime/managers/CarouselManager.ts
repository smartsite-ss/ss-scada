// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  type CarouselConfig,
  type CarouselState,
  type CarouselPageInfo,
  DEFAULT_CAROUSEL_CONFIG,
} from '../types/CarouselConfig';

/**
 * Carousel manager
 * Manages automatic carousel page switching for a project in the preview/runtime mode
 */
export class CarouselManager {
  private config: CarouselConfig;
  private state: CarouselState;
  private onPageSwitch: (pageId: string) => void;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private animationFrameId: number | null = null;
  private lastSwitchTime: number = 0;

  constructor(
    config: Partial<CarouselConfig>,
    onPageSwitch: (pageId: string) => void,
  ) {
    this.config = { ...DEFAULT_CAROUSEL_CONFIG, ...config };
    this.onPageSwitch = onPageSwitch;
    this.state = {
      isRunning: false,
      isPaused: false,
      currentIndex: 0,
      elapsedTime: 0,
      carouselPages: [],
    };
  }

  /** Build carousel pages from a page list */
  buildCarouselPages(pages: CarouselPageInfo[]): void {
    const pageIds = this.config.pageIds.length > 0
      ? this.config.pageIds
      : pages.map(p => p.id);

    this.state.carouselPages = pages.filter(p => pageIds.includes(p.id));
  }

  /** Start the carousel */
  start(): void {
    console.log('[CarouselManager] start() 调用:', {
      carouselPagesCount: this.state.carouselPages.length,
      isRunning: this.state.isRunning,
      interval: this.config.interval,
    });

    if (this.state.carouselPages.length === 0) {
      console.warn('[CarouselManager] start: 没有可轮播的页面，跳过');
      return;
    }
    if (this.state.isRunning) {
      console.log('[CarouselManager] start: 已在运行中，跳过');
      return;
    }

    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.elapsedTime = 0;
    this.lastSwitchTime = Date.now();
    this.scheduleNext();
    this.startProgressTracker();
    console.log('[CarouselManager] 轮播已启动:', { interval: this.config.interval, nextSwitch: `${this.config.interval / 1000}s 后` });
  }

  /** Stop the carousel */
  stop(): void {
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.elapsedTime = 0;
    this.clearTimer();
    this.clearProgressTracker();
  }

  /** Pause switching (keep the timer but do not trigger switches) */
  pause(): void {
    if (!this.state.isRunning) return;
    this.state.isPaused = true;
  }

  /** Resume switching */
  resume(): void {
    if (!this.state.isRunning) return;
    this.state.isPaused = false;
  }

  /** Play (start or resume) */
  play(): void {
    if (!this.state.isRunning) {
      this.start();
    } else {
      this.resume();
    }
  }

  /** Switch to the previous page */
  previous(): void {
    if (this.state.carouselPages.length === 0) return;

    const totalPages = this.state.carouselPages.length;
    if (this.config.loop) {
      this.state.currentIndex = (this.state.currentIndex - 1 + totalPages) % totalPages;
    } else {
      this.state.currentIndex = Math.max(0, this.state.currentIndex - 1);
    }

    this.performSwitch();
  }

  /** Switch to the next page */
  next(): void {
    if (this.state.carouselPages.length === 0) return;

    const totalPages = this.state.carouselPages.length;
    if (this.config.loop) {
      this.state.currentIndex = (this.state.currentIndex + 1) % totalPages;
    } else {
      const next = this.state.currentIndex + 1;
      if (next >= totalPages) {
        this.stop();
        return;
      }
      this.state.currentIndex = next;
    }

    console.log('[CarouselManager] next: 切换到页面索引', this.state.currentIndex,
      '页面:', this.state.carouselPages[this.state.currentIndex]?.name);
    this.performSwitch();
  }

  /** Jump to a page by index */
  goTo(index: number): void {
    if (index < 0 || index >= this.state.carouselPages.length) return;
    this.state.currentIndex = index;
    this.performSwitch();
  }

  /** Update configuration */
  updateConfig(partial: Partial<CarouselConfig>): void {
    const wasRunning = this.state.isRunning;
    const wasEnabled = this.config.enabled;
    const wasInterval = this.config.interval;

    this.config = { ...this.config, ...partial };

    // Carousel disabled → stop
    if (wasRunning && wasEnabled && !this.config.enabled) {
      this.stop();
      return;
    }

    // Carousel enabled → start
    if (!wasRunning && this.config.enabled) {
      if (this.state.carouselPages.length > 1 || this.config.showSinglePage) {
        this.start();
      }
      return;
    }

    // Interval changed → restart the timer
    if (wasRunning && this.config.interval !== wasInterval) {
      this.state.elapsedTime = 0;
      this.lastSwitchTime = Date.now();
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /** Get the current state snapshot */
  getState(): Readonly<CarouselState> {
    return this.state;
  }

  /** Get the current config snapshot */
  getConfig(): Readonly<CarouselConfig> {
    return this.config;
  }

  /** Destroy */
  destroy(): void {
    this.stop();
  }

  /** Perform a page switch */
  private performSwitch(): void {
    const page = this.state.carouselPages[this.state.currentIndex];
    if (page) {
      this.lastSwitchTime = Date.now();
      this.state.elapsedTime = 0;
      this.onPageSwitch(page.id);
    }
  }

  /** Start timed switching */
  private scheduleNext(): void {
    this.clearTimer();
    this.intervalId = setInterval(() => {
      if (!this.state.isPaused) {
        this.next();
      }
    }, this.config.interval);
  }

  /** Start progress tracking */
  private startProgressTracker(): void {
    this.clearProgressTracker();
    const tick = () => {
      if (!this.state.isRunning) return;
      this.state.elapsedTime = Date.now() - this.lastSwitchTime;
      if (this.state.elapsedTime >= this.config.interval) {
        this.state.elapsedTime = this.config.interval;
      }
      this.animationFrameId = requestAnimationFrame(tick);
    };
    this.animationFrameId = requestAnimationFrame(tick);
  }

  /** Clear the timer */
  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Clear progress tracking */
  private clearProgressTracker(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
