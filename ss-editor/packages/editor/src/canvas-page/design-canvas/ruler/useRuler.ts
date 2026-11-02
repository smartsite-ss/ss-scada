// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * useRuler - core ruler logic Composable
 *
 * Extracts the shared logic of VerticalRuler / HorizontalRuler:
 * - RAF-throttled mouse tracking
 * - Mouse-leave handling
 * - Guide-line drag creation (with error handling)
 * - Lifecycle event binding/cleanup
 * - mousePosition prop watch
 */
import { ref, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue';

export interface UseRulerOptions {
  /** Ruler direction */
  orientation: 'vertical' | 'horizontal';
  /** Canvas size (vertical=height, horizontal=width) */
  canvasSize: number;
  /** Scroll offset */
  scrollOffset: number;
  /** Zoom ratio */
  scale: number;
  /** External mouse position (may be null) */
  mousePosition: { x: number; y: number } | null;
  /** Guide-line creation callback */
  onCreateGuideLine: (position: number) => void;
  /** Mouse position update callback */
  onUpdateMousePosition: (position: { x: number; y: number } | null) => void;
  /** Delete-last-guide-line callback */
  onDeleteLastGuideLine: () => void;
}

export interface UseRulerReturn {
  rulerRef: Ref<HTMLElement | null>;
  rulerTrack: Ref<HTMLElement | null>;
  /** Current axis value (vertical=Y, horizontal=X) */
  axisValue: Ref<number>;
  showMouseIndicator: Ref<boolean>;
  isDraggingNewGuide: Ref<boolean>;
  dragPosition: Ref<number>;
  guideLinePreviewStyle: ComputedRef<Record<string, string>>;
}

/**
 * Core ruler logic Composable
 * @param options config options
 * @returns ruler state and computed properties
 */
export function useRuler(options: UseRulerOptions): UseRulerReturn {
  const {
    orientation,
    scrollOffset,
    mousePosition,
    onCreateGuideLine,
    onUpdateMousePosition,
  } = options;

  const isVertical = orientation === 'vertical';

  const rulerRef = ref<HTMLElement | null>(null);
  const rulerTrack = ref<HTMLElement | null>(null);
  const axisValue = ref(0);
  const showMouseIndicator = ref(false);
  const isDraggingNewGuide = ref(false);
  const dragPosition = ref(0);

  // ===== RAF-throttled mouse tracking =====
  let rafId: number | null = null;
  let pendingPosition = { x: 0, y: 0 };

  const handleMouseMove = (event: MouseEvent) => {
    if (!rulerTrack.value) return;

    const rect = rulerTrack.value.getBoundingClientRect();
    pendingPosition = {
      x: event.clientX - rect.left + scrollOffset,
      y: event.clientY - rect.top + scrollOffset,
    };

    // RAF throttle: coalesces multiple calls into one frame
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        onUpdateMousePosition(pendingPosition);
        rafId = null;
      });
    }
  };

  // ===== Mouse-leave handling =====
  const handleMouseLeave = () => {
    if (!isDraggingNewGuide.value) {
      onUpdateMousePosition(null);
    }
  };

  // ===== Guide-line drag creation (with enhanced error handling) =====
  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault();

    try {
      if (!rulerRef.value) {
        console.warn(`[${orientation}Ruler] mousedown but rulerRef is null`);
        return;
      }

      const rect = rulerRef.value.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn(`[${orientation}Ruler] ruler element has zero dimensions`);
        return;
      }

      // Extract the coordinate of the corresponding axis
      const coord = isVertical
        ? event.clientY - rect.top + scrollOffset
        : event.clientX - rect.left + scrollOffset;

      if (!Number.isFinite(coord)) {
        console.warn(`[${orientation}Ruler] Invalid coordinate: ${coord}`);
        return;
      }

      dragPosition.value = coord;
      isDraggingNewGuide.value = true;

      const handleDragMove = (moveEvent: MouseEvent) => {
        try {
          const newRect = rulerRef.value!.getBoundingClientRect();
          const newCoord = isVertical
            ? moveEvent.clientY - newRect.top + scrollOffset
            : moveEvent.clientX - newRect.left + scrollOffset;

          if (Number.isFinite(newCoord)) {
            dragPosition.value = newCoord;
          }
        } catch (error) {
          console.error(`[${orientation}Ruler] Error in drag move:`, error);
        }
      };

      const handleDragUp = (upEvent: MouseEvent) => {
        try {
          const newRect = rulerRef.value!.getBoundingClientRect();
          const finalCoord = isVertical
            ? upEvent.clientY - newRect.top + scrollOffset
            : upEvent.clientX - newRect.left + scrollOffset;

          if (Number.isFinite(finalCoord)) {
            onCreateGuideLine(finalCoord);
          }

          isDraggingNewGuide.value = false;
        } catch (error) {
          console.error(`[${orientation}Ruler] Error in drag up:`, error);
          isDraggingNewGuide.value = false;
        } finally {
          document.removeEventListener('mousemove', handleDragMove);
          document.removeEventListener('mouseup', handleDragUp);
        }
      };

      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragUp, { once: true });

    } catch (error) {
      console.error(`[${orientation}Ruler] Error in handleMouseDown:`, error);
      isDraggingNewGuide.value = false;
    }
  };

  // ===== Watch external mousePosition changes =====
  watch(
    () => mousePosition,
    (newPosition) => {
      if (newPosition) {
        axisValue.value = isVertical ? newPosition.y : newPosition.x;
        showMouseIndicator.value = true;
      } else {
        showMouseIndicator.value = false;
      }
    },
    // P1 optimization: add a debounce check to avoid redundant assignment when unchanged
    { flush: 'sync' },
  );

  // ===== Guide-line preview style =====
  const guideLinePreviewStyle = computed<Record<string, string>>(() => ({
    [isVertical ? 'top' : 'left']: `${dragPosition.value - scrollOffset}px`,
  }));

  // ===== Lifecycle: event binding/cleanup =====
  onMounted(() => {
    if (rulerRef.value) {
      rulerRef.value.addEventListener('mousemove', handleMouseMove);
      rulerRef.value.addEventListener('mouseleave', handleMouseLeave);
      rulerRef.value.addEventListener('mousedown', handleMouseDown);
    }
  });

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId);

    if (rulerRef.value) {
      rulerRef.value.removeEventListener('mousemove', handleMouseMove);
      rulerRef.value.removeEventListener('mouseleave', handleMouseLeave);
      rulerRef.value.removeEventListener('mousedown', handleMouseDown);
    }
  });

  return {
    rulerRef,
    rulerTrack,
    axisValue,
    showMouseIndicator,
    isDraggingNewGuide,
    dragPosition,
    guideLinePreviewStyle,
  };
}
