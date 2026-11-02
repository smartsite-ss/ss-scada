// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Component-level request cancellation composable
 *
 * Automatically cancels all unfinished requests on component unmount, preventing memory leaks and invalid state updates.
 *
 * Usage:
 *   const { signal, cancelAll } = useRequestCancel();
 *   onMounted(() => {
 *     fetchProjects(signal).then(data => projects.value = data);
 *   });
 *   // cancelAll() is called automatically when the component unmounts
 */

import { onUnmounted } from 'vue';

export function useRequestCancel() {
  const controller = new AbortController();
  const { signal } = controller;

  onUnmounted(() => {
    controller.abort();
  });

  return { signal, controller };
}