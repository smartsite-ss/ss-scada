// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, onMounted, onUnmounted, nextTick, watch, type Ref } from 'vue';
import { usePageStore, debounce } from '@scada-editor/core';
import { useViewportStore } from '../../../stores/useViewportStore';
import { calculateFitScale } from '../constants';

const _debug = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[AutoFit]', ...args);
};

export function useAutoFit(
  canvasWidth: Ref<number>,
  canvasHeight: Ref<number>,
  _panX: Ref<number>,
  _panY: Ref<number>,
) {
  const pageStore = usePageStore();
  const viewportStore = useViewportStore();
  const containerRef = ref<HTMLElement | null>(null);
  // Continuously observe the container size during the lifecycle (optimization plan P2-3)
  let resizeObserver: ResizeObserver | null = null;

  const calculateAutoFitScale = () => {
    if (!pageStore.enableAutoFit || !containerRef.value) return 1;

    const containerRect = containerRef.value.getBoundingClientRect();

    return calculateFitScale(
      containerRect.width,
      containerRect.height,
      canvasWidth.value,
      canvasHeight.value,
      viewportStore.scaleMin,
    );
  };

  const applyEditModeAutoFit = () => {
    _debug('apply', { enableAutoFit: pageStore.enableAutoFit });
    const scale = calculateAutoFitScale();
    viewportStore.scale = scale * 100;

    nextTick(() => {
      const container = containerRef.value;
      if (container) {
        const editor = container.querySelector('.plugin-layer-manager') as HTMLElement | null;
        if (editor) {
          editor.scrollLeft = 0;
          editor.scrollTop = 0;
        }
      }
    });
  };

  watch(() => pageStore.enableAutoFit, (newVal) => {
    if (newVal) {
      applyEditModeAutoFit();
    } else {
      viewportStore.scale = 100;
    }
  });

  const handleWindowResize = debounce(() => {
    if (pageStore.enableAutoFit) {
      applyEditModeAutoFit();
    }
  }, 100);

  watch(
    () => [canvasWidth.value, canvasHeight.value],
    () => {
      if (pageStore.enableAutoFit) {
        applyEditModeAutoFit();
      }
    },
  );

  // ===== Reliable initialization mechanism (ResizeObserver) =====
  onMounted(() => {
    window.addEventListener('resize', handleWindowResize);

    if (pageStore.enableAutoFit) {
      let applied = false;
      const tryApply = () => {
        if (applied) return;
        const el = containerRef.value;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          applied = true;
          applyEditModeAutoFit();
        }
      };

      nextTick(() => tryApply());

      // Continuously observe container size changes: collapsing/expanding panels, dragging splitters etc. do not trigger window resize,
      // the callback reuses a 100ms debounce (optimization plan P2-3, replacing the old disconnect-after-2s approach)
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            if (!applied) {
              tryApply();
            } else if (pageStore.enableAutoFit) {
              handleWindowResize();
            }
          }
        }
      });
      if (containerRef.value) resizeObserver.observe(containerRef.value);

      // The 2s only serves as a "force one attempt if the first fit failed" fallback timer; the observer keeps working afterwards (optimization plan P2-3)
      setTimeout(() => {
        if (!applied) tryApply();
      }, 2000);
    }
  });

  onUnmounted(() => {
    window.removeEventListener('resize', handleWindowResize);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  return {
    containerRef,
    calculateAutoFitScale,
    applyEditModeAutoFit,
  };
}