// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../api/modules/auth.api';
import {
  setToken,
  setRefreshToken,
  getRefreshToken,
  clearTokens,
  persistRefreshToken,
} from '../api/client';
import type { UserInfo, LoginDto, RegisterDto } from '../types/api';
import { DEBUG_USER, getDebugToken } from '../utils/debug';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserInfo | null>(null);
  /**
   * S-C03: token changed to an in-memory flag (no longer read from localStorage)
   *
   * The value 'httpOnly' means authenticated via HttpOnly Cookie (the real token is unreadable from JS).
   * A debug token string means debug mode (not using Cookie).
   * null means unauthenticated.
   */
  const token = ref<string | null>(null);
  const refreshToken = ref<string | null>(null);
  const loading = ref(false);
  /** v6.0: permission code list of the current user (parsed from roles) */
  const permissions = ref<string[]>([]);
  /** v7.1: list of menu IDs visible to the current user (loaded from role menuIds) */
  const menuIds = ref<string[]>([]);
  /**
   * S-C03: session-restored flag, preventing repeated calls to restoreSession
   *
   * - App initialization and route guards may trigger restoreSession concurrently; this flag guarantees a single call
   * - Set to true after successful login/register (already authenticated, no need to restore again)
   * - Reset to false after logout (the next access requires re-restoring)
   */
  const sessionRestored = ref(false);

  const isAuthenticated = computed(() => !!token.value);
  /** v7.1: whether the user is the admin role (bypasses menu filtering, shows all menus) */
  const isAdmin = computed<boolean>(
    () => user.value?.role === 'admin' || (user.value as any)?.roleEntity?.code === 'admin',
  );

  function initDebugSession() {
    const debugToken = getDebugToken();
    token.value = debugToken;
    setToken(debugToken);
    user.value = DEBUG_USER as UserInfo;
    permissions.value = ['*:*'];
    // The debug user is admin with empty menuIds (filterByMenuIds returns everything because isAdmin=true)
    menuIds.value = [];
    // Debug mode is already authenticated; mark the session as restored
    sessionRestored.value = true;
  }

  /**
   * Load user permission codes and menuIds (v8.0: the DB is the single source of truth; no hardcoded fallback)
   *
   * @param profileOverride The profile already fetched by the caller (e.g. restoreSession already called getProfile);
   *                        passing it avoids duplicate requests; login/register omit it and it is fetched internally
   */
  async function loadPermissions(profileOverride?: any) {
    try {
      const { roleApi } = await import('../api/modules/role.api');
      const { userApi } = await import('../api/modules/user.api');
      // Prefer the profile passed in by the caller to avoid duplicate requests
      let profile: any = profileOverride;
      if (!profile) {
        const profileRes = await userApi.getProfile();
        profile = (profileRes as any)?.data || profileRes;
      }
      // Refresh user so that roleEntity and other fields are visible to templates and the isAdmin computed
      if (profile) user.value = profile as UserInfo;

      // Main path: profile.roleEntity is a complete Role object (including menuIds)
      if (profile?.roleEntity) {
        // Even when permissions is null/undefined, set an empty array (safer than keeping the old value)
        permissions.value = profile.roleEntity.permissions || [];
        // Load menuIds (defensive copy)
        menuIds.value = Array.isArray(profile.roleEntity.menuIds)
          ? [...profile.roleEntity.menuIds]
          : [];
        // Admin fallback: when roleEntity exists but permissions is empty/null, supplement *:*
        if (isAdmin.value && (!permissions.value.length || !permissions.value.includes('*:*'))) {
          permissions.value = ['*:*'];
        }
        return;
      }
      // Fallback: try obtaining it from the role snapshot fields
      if (profile?.roleId) {
        const roleRes = await roleApi.getRole(profile.roleId);
        const role: any = (roleRes as any)?.data || roleRes;
        permissions.value = role?.permissions || [];
        menuIds.value = Array.isArray(role?.menuIds) ? [...role.menuIds] : [];
        return;
      }
    } catch {
      /* ignore */
    }
    // v8.0 downgrade: the ROLE_PERMISSIONS hardcoded mapping is no longer used
    // If all DB paths fail, try falling back to the existing roleEntity data in user.value
    const roleEntity = (user.value as any)?.roleEntity;
    if (roleEntity) {
      permissions.value = roleEntity.permissions || [];
      menuIds.value = Array.isArray(roleEntity.menuIds) ? [...roleEntity.menuIds] : [];
      return;
    }
    // Final fallback: the admin role hardcodes *:* to guarantee super-admin navigation is unaffected by DB anomalies
    if (isAdmin.value) {
      permissions.value = ['*:*'];
      menuIds.value = [];
      return;
    }
    // When permissions cannot be obtained at all, clear them to stay safe
    permissions.value = [];
    menuIds.value = [];
  }

  async function login(dto: LoginDto) {
    loading.value = true;
    try {
      const res = await authApi.login(dto);
      const data = res.data || (res as any);
      if (data.accessToken) {
        // Bearer mode (desktop Tauri, cross-site cookies unavailable):
        // the token is delivered in the response body, kept in memory and sent via the Authorization header; refreshToken is persisted for restart recovery
        token.value = data.accessToken;
        refreshToken.value = data.refreshToken || null;
        setToken(data.accessToken);
        if (data.refreshToken) {
          setRefreshToken(data.refreshToken);
          persistRefreshToken(data.refreshToken);
        }
      } else {
        // S-C03: Cookie mode (Web, same-origin); the frontend only marks the auth state
        token.value = 'httpOnly';
        refreshToken.value = 'httpOnly';
        setToken('httpOnly');
      }
      user.value = data.user;
      await loadPermissions();
      // The session is established after successful login; mark as restored to avoid duplicate restore later
      sessionRestored.value = true;
      return true;
    } finally {
      loading.value = false;
    }
  }

  async function register(dto: RegisterDto) {
    loading.value = true;
    try {
      const res = await authApi.register(dto);
      const data = res.data || (res as any);
      if (data.accessToken) {
        // Bearer mode (desktop Tauri), same as login
        token.value = data.accessToken;
        refreshToken.value = data.refreshToken || null;
        setToken(data.accessToken);
        if (data.refreshToken) {
          setRefreshToken(data.refreshToken);
          persistRefreshToken(data.refreshToken);
        }
      } else {
        // S-C03: Cookie mode (Web, same-origin)
        token.value = 'httpOnly';
        refreshToken.value = 'httpOnly';
        setToken('httpOnly');
      }
      user.value = data.user;
      await loadPermissions();
      sessionRestored.value = true;
      return true;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    try {
      // Cookie mode: refreshToken is transported automatically via the Cookie;
      // Bearer mode (desktop): passed explicitly via the body to revoke the server-side refresh token
      const bearerRefreshToken = getRefreshToken();
      await authApi.logout(
        bearerRefreshToken && bearerRefreshToken !== 'httpOnly' ? bearerRefreshToken : undefined,
      );
    } catch {
      /* ignore */
    } finally {
      user.value = null;
      token.value = null;
      refreshToken.value = null;
      permissions.value = [];
      menuIds.value = [];
      // Reset the session flag after logout; the next access requires re-restoring
      sessionRestored.value = false;
      clearTokens();
      persistRefreshToken(null);
    }
  }

  /**
   * WeChat scan login: after scan confirmation the backend has already delivered the token via HttpOnly Cookie;
   * the frontend only needs to load the user profile and permissions to establish the logged-in state.
   *
   * @param wechatUser The user info returned by the backend in confirmed state
   */
  async function loginWithWechat(wechatUser: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    avatar?: string;
  }): Promise<boolean> {
    loading.value = true;
    try {
      // S-C03: the token is set via HttpOnly Cookie; the frontend only marks the auth state
      token.value = 'httpOnly';
      refreshToken.value = 'httpOnly';
      setToken('httpOnly');
      // Fill in the basic user info returned by the scan first; loadPermissions internally fetches the complete profile (including roleEntity)
      user.value = wechatUser as UserInfo;
      await loadPermissions();
      // The session is established after successful login; mark as restored to avoid duplicate restore later
      sessionRestored.value = true;
      return true;
    } finally {
      loading.value = false;
    }
  }

  /**
   * S-C03: restore the session
   *
   * The token is no longer read from localStorage; instead it directly tries fetching the user profile via the Cookie.
   * A valid Cookie means authentication success; an invalid Cookie makes the backend return 401 → clear state.
   *
   * Uses a sessionRestored flag + in-flight Promise lock to ensure concurrent callers (app initialization,
   * multiple route switches) trigger only one backend profile request; other callers share the same Promise result.
   */
  let restoreInFlight: Promise<boolean> | null = null;

  async function restoreSession(): Promise<boolean> {
    // Session already restored: return the current auth state directly
    if (sessionRestored.value) {
      return !!token.value;
    }
    // A restore is already in progress: reuse the same Promise to avoid duplicate requests
    if (restoreInFlight) {
      return restoreInFlight;
    }

    restoreInFlight = (async () => {
      try {
        const { userApi } = await import('../api/modules/user.api');
        const res = await userApi.getProfile();
        const profile = res.data || (res as any);
        user.value = profile;
        // Cookie authentication succeeded, mark the auth state
        token.value = 'httpOnly';
        refreshToken.value = 'httpOnly';
        setToken('httpOnly');
        // Pass in the already-fetched profile to avoid duplicate requests inside loadPermissions
        await loadPermissions(profile);
        return true;
      } catch {
        clearTokens();
        // Session restore failed (including expired desktop persisted refreshToken), clear persisted credentials
        persistRefreshToken(null);
        token.value = null;
        refreshToken.value = null;
        permissions.value = [];
        menuIds.value = [];
        return false;
      } finally {
        // Regardless of success or failure, this restore round is finished
        sessionRestored.value = true;
        restoreInFlight = null;
      }
    })();

    return restoreInFlight;
  }

  return {
    user,
    token,
    refreshToken,
    loading,
    permissions,
    menuIds,
    sessionRestored,
    isAdmin,
    isAuthenticated,
    initDebugSession,
    login,
    register,
    logout,
    loginWithWechat,
    restoreSession,
  };
});
