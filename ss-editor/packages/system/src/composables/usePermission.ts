// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import {
  PermissionCodes,
  type PermissionCode,
  type SystemRole,
} from '../config/system-menu.config';

/**
 * Button/action-level permission composable
 *
 * Role-level usage:
 *   const { canEdit, canDelete, isAtLeast, role } = usePermission();
 *   <button v-if="canDelete" @click="handleDelete">Delete</button>
 *
 * Permission-code-level usage:
 *   const { hasPermission, hasAnyPermission } = usePermission();
 *   <button v-if="hasPermission(PermissionCodes.PROJECT_CREATE)">New</button>
 */
export function usePermission() {
  const authStore = useAuthStore();

  /** Current user role */
  const role = computed<SystemRole | null>(() => {
    return (authStore.user?.role as SystemRole) || null;
  });

  /** Role weight mapping */
  const ROLE_WEIGHT: Record<SystemRole, number> = {
    viewer: 0,
    user: 1,
    admin: 2,
  };

  /** Determine whether the current user has reached at least the specified role level */
  function isAtLeast(requiredRole: SystemRole): boolean {
    if (!role.value) return false;
    return ROLE_WEIGHT[role.value] >= ROLE_WEIGHT[requiredRole];
  }

  /** Whether the user is an admin */
  const isAdmin = computed(() => role.value === 'admin');

  /** Whether editable (at least user) */
  const canEdit = computed(() => isAtLeast('user'));

  /** Whether deletable (admin only) */
  const canDelete = computed(() => isAtLeast('admin'));

  /** Whether manageable (admin only) */
  const canManage = computed(() => isAtLeast('admin'));

  /** Whether read-only (viewer) */
  const isReadonly = computed(() => role.value === 'viewer');

  // ──────── Permission-code level (v8.0: read dynamically from authStore.permissions; DB is the single source of truth) ────────

  /** Get all permission codes of the current user (loaded from DB roles) */
  function getUserPermissions(): PermissionCode[] {
    return (authStore.permissions as PermissionCode[]) || [];
  }

  /** Check whether a specific permission code is held */
  function hasPermission(code: PermissionCode): boolean {
    const perms = getUserPermissions();
    return perms.includes(PermissionCodes.ALL as PermissionCode) || perms.includes(code);
  }

  /** Check whether all specified permission codes are held */
  function hasAllPermissions(...codes: PermissionCode[]): boolean {
    return codes.every((code) => hasPermission(code));
  }

  /** Check whether any of the specified permission codes is held */
  function hasAnyPermission(...codes: PermissionCode[]): boolean {
    return codes.some((code) => hasPermission(code));
  }

  // ──────── Data permission helpers (added in v7.0) ────────

  /**
   * Check whether the current user can access a device group
   * Note: actual data permissions are enforced by the backend DataAccessGuard + AuthorizationService;
   * this method provides frontend-assisted filtering (double protection)
   */
  function canAccessDeviceGroup(): boolean {
    return hasAnyPermission(
      PermissionCodes.DEVICE_GROUP_VIEW as PermissionCode,
      PermissionCodes.DEVICE_GROUP_CREATE as PermissionCode,
      PermissionCodes.DEVICE_GROUP_EDIT as PermissionCode,
      PermissionCodes.DEVICE_GROUP_DELETE as PermissionCode,
    );
  }

  /**
   * Check whether the current user can access a device
   * Note: actual data permissions are enforced by the backend DataAccessGuard + AuthorizationService;
   * this method provides frontend-assisted filtering (double protection)
   */
  function canAccessDevice(): boolean {
    return hasAnyPermission(
      PermissionCodes.DEVICE_VIEW as PermissionCode,
      PermissionCodes.DEVICE_CREATE as PermissionCode,
    );
  }

  return {
    role,
    isAdmin,
    canEdit,
    canDelete,
    canManage,
    isReadonly,
    isAtLeast,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
    getUserPermissions,
    canAccessDeviceGroup,
    canAccessDevice,
  };
}