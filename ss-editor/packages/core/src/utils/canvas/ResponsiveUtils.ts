// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Breakpoint type
 */
export interface Breakpoint {
  name: string;
  minWidth: number;
  maxWidth?: number;
}

/**
 * Responsive utility class
 */
export class ResponsiveUtils {
  private static breakpoints: Breakpoint[] = [
    { name: 'xs', minWidth: 0, maxWidth: 575 },
    { name: 'sm', minWidth: 576, maxWidth: 767 },
    { name: 'md', minWidth: 768, maxWidth: 991 },
    { name: 'lg', minWidth: 992, maxWidth: 1199 },
    { name: 'xl', minWidth: 1200, maxWidth: 1399 },
    { name: 'xxl', minWidth: 1400 }
  ];

  /**
   * Get the current breakpoint
   * @returns Current breakpoint name
   */
  public static getCurrentBreakpoint(): string {
    const width = window.innerWidth;
    for (const breakpoint of this.breakpoints) {
      if (width >= breakpoint.minWidth && (!breakpoint.maxWidth || width <= breakpoint.maxWidth)) {
        return breakpoint.name;
      }
    }
    return 'xxl';
  }

  /**
   * Check whether inside a given breakpoint range
   * @param breakpoint Breakpoint name
   * @returns Whether inside the given breakpoint range
   */
  public static isBreakpoint(breakpoint: string): boolean {
    return this.getCurrentBreakpoint() === breakpoint;
  }

  /**
   * Check whether greater than or equal to a given breakpoint
   * @param breakpoint Breakpoint name
   * @returns Whether greater than or equal to the given breakpoint
   */
  public static isBreakpointUp(breakpoint: string): boolean {
    const currentBreakpoint = this.getCurrentBreakpoint();
    const currentIndex = this.breakpoints.findIndex(bp => bp.name === currentBreakpoint);
    const targetIndex = this.breakpoints.findIndex(bp => bp.name === breakpoint);
    return currentIndex >= targetIndex;
  }

  /**
   * Check whether less than or equal to a given breakpoint
   * @param breakpoint Breakpoint name
   * @returns Whether less than or equal to the given breakpoint
   */
  public static isBreakpointDown(breakpoint: string): boolean {
    const currentBreakpoint = this.getCurrentBreakpoint();
    const currentIndex = this.breakpoints.findIndex(bp => bp.name === currentBreakpoint);
    const targetIndex = this.breakpoints.findIndex(bp => bp.name === breakpoint);
    return currentIndex <= targetIndex;
  }

  /**
   * Check whether inside a given breakpoint range
   * @param minBreakpoint Minimum breakpoint
   * @param maxBreakpoint Maximum breakpoint
   * @returns Whether inside the given breakpoint range
   */
  public static isBreakpointBetween(minBreakpoint: string, maxBreakpoint: string): boolean {
    const currentBreakpoint = this.getCurrentBreakpoint();
    const currentIndex = this.breakpoints.findIndex(bp => bp.name === currentBreakpoint);
    const minIndex = this.breakpoints.findIndex(bp => bp.name === minBreakpoint);
    const maxIndex = this.breakpoints.findIndex(bp => bp.name === maxBreakpoint);
    return currentIndex >= minIndex && currentIndex <= maxIndex;
  }

  /**
   * Get the minimum width of a breakpoint
   * @param breakpoint Breakpoint name
   * @returns Minimum width
   */
  public static getBreakpointMinWidth(breakpoint: string): number | undefined {
    const bp = this.breakpoints.find(bp => bp.name === breakpoint);
    return bp?.minWidth;
  }

  /**
   * Get the maximum width of a breakpoint
   * @param breakpoint Breakpoint name
   * @returns Maximum width
   */
  public static getBreakpointMaxWidth(breakpoint: string): number | undefined {
    const bp = this.breakpoints.find(bp => bp.name === breakpoint);
    return bp?.maxWidth;
  }

  /**
   * Listen for window resize
   * @param callback Callback function
   * @param debounceDelay Debounce delay (milliseconds)
   * @returns Function to cancel the listener
   */
  public static onResize(callback: () => void, debounceDelay: number = 250): () => void {
    const debouncedCallback = this.debounce(callback, debounceDelay);
    window.addEventListener('resize', debouncedCallback);
    return () => window.removeEventListener('resize', debouncedCallback);
  }

  /**
   * Debounce function
   * @param func Function to debounce
   * @param wait Wait time (milliseconds)
   * @returns Debounced function
   */
  private static debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  /**
   * Throttle function
   * @param func Function to throttle
   * @param limit Time limit (milliseconds)
   * @returns Throttled function
   */
  public static throttle<T extends (...args: any[]) => any>(func: T, limit: number): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Register custom breakpoints
   * @param breakpoints Breakpoint array
   */
  public static registerBreakpoints(breakpoints: Breakpoint[]): void {
    this.breakpoints = breakpoints;
  }

  /**
   * Get all breakpoints
   * @returns All breakpoints
   */
  public static getAllBreakpoints(): Breakpoint[] {
    return [...this.breakpoints];
  }
}
