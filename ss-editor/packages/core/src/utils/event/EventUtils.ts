// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Event handling utility class
 */
export class EventUtils {
  /**
   * Debounce function
   * @param func The function to debounce
   * @param wait Wait time (milliseconds)
   * @returns The debounced function
   */
  public static debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  /**
   * Throttle function
   * @param func The function to throttle
   * @param limit Time limit (milliseconds)
   * @returns The throttled function
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
   * Event delegation
   * @param parent Parent element
   * @param selector Child element selector
   * @param eventType Event type
   * @param handler Event handler
   */
  public static delegateEvent(parent: Element, selector: string, eventType: string, handler: (event: Event, target: Element) => void): void {
    parent.addEventListener(eventType, (event) => {
      const target = event.target as Element;
      const closest = target.closest(selector);
      if (closest && parent.contains(closest)) {
        handler(event, closest);
      }
    });
  }

  /**
   * Stop event propagation
   * @param event Event object
   */
  public static stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  /**
   * Prevent default event
   * @param event Event object
   */
  public static preventDefault(event: Event): void {
    event.preventDefault();
  }

  /**
   * Stop both propagation and default behavior
   * @param event Event object
   */
  public static stopEvent(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
  }

  /**
   * Get the mouse position relative to an element
   * @param event Mouse event
   * @param element Element
   * @returns Mouse position inside the element
   */
  public static getMousePosition(event: MouseEvent, element: Element): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  /**
   * Get the touch position relative to an element
   * @param event Touch event
   * @param element Element
   * @returns Touch position inside the element
   */
  public static getTouchPosition(event: TouchEvent, element: Element): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    const touch = event.touches[0] || event.changedTouches[0];
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  }



  /**
   * Add an event listener in a cross-browser way
   * @param element Element
   * @param eventType Event type
   * @param handler Event handler
   */
  public static addEventListener(element: Element | Window | Document, eventType: string, handler: EventListener): void {
    if (element.addEventListener) {
      element.addEventListener(eventType, handler);
    } else if ((element as any).attachEvent) {
      (element as any).attachEvent(`on${eventType}`, handler);
    }
  }

  /**
   * Remove an event listener in a cross-browser way
   * @param element Element
   * @param eventType Event type
   * @param handler Event handler
   */
  public static removeEventListener(element: Element | Window | Document, eventType: string, handler: EventListener): void {
    if (element.removeEventListener) {
      element.removeEventListener(eventType, handler);
    } else if ((element as any).detachEvent) {
      (element as any).detachEvent(`on${eventType}`, handler);
    }
  }
}
