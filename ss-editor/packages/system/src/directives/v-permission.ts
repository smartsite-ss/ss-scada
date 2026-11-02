// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { Directive, DirectiveBinding } from 'vue';
import { usePermission } from '../composables/usePermission';
import type { PermissionCode } from '../config/system-menu.config';

/**
 * Permission directive v-permission
 *
 * Usage:
 *   <button v-permission="'project:create'">New</button>
 *        → hides the element when unauthorized
 *
 *   <button v-permission="['project:edit','project:delete']">Operate</button>
 *        → shown when any permission is satisfied
 *
 *   <button v-permission:disable="'device:delete'">Delete</button>
 *        → disabled instead of removed when unauthorized
 */
export const vPermission: Directive<HTMLElement, PermissionCode | PermissionCode[]> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<PermissionCode | PermissionCode[]>) {
    const { hasAnyPermission } = usePermission();
    const codes = Array.isArray(binding.value) ? binding.value : [binding.value];
    const allowed = hasAnyPermission(...codes);

    if (binding.arg === 'disable') {
      // Disable mode: do not remove the element, only add the disabled attribute
      if (!allowed) {
        el.setAttribute('disabled', 'true');
        el.classList.add('permission-disabled');
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
          el.disabled = true;
        }
      }
    } else {
      // Hide mode: remove the DOM element when unauthorized
      if (!allowed) {
        el.parentNode?.removeChild(el);
      }
    }
  },
};