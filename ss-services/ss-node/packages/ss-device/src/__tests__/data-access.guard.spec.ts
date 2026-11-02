// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataAccessGuard } from '../data/data-access.guard';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

function createMockContext(overrides: {
  user?: any;
  method?: string;
  params?: Record<string, string>;
  body?: any;
  handler?: any;
  classRef?: any;
}): ExecutionContext {
  const request = {
    user: overrides.user,
    method: overrides.method || 'POST',
    params: overrides.params || {},
    body: overrides.body || {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => overrides.handler || jest.fn(),
    getClass: () => overrides.classRef || class {},
  } as any;
}

describe('DataAccessGuard (3.6 device permissions)', () => {
  let guard: DataAccessGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockAuthService: any;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
      get: jest.fn(),
    } as any;

    mockAuthService = {
      checkProjectPermission: jest.fn(),
      checkDevicePermission: jest.fn(),
      checkDeviceGroupPermission: jest.fn(),
    };

    guard = new DataAccessGuard(reflector, mockAuthService);
  });

  // ==================== Basic scenarios ====================
  describe('Basic pass-through scenarios', () => {
    it('TC-PERM-001: a not-logged-in user should throw ForbiddenException', async () => {
      const ctx = createMockContext({ user: null });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('TC-PERM-002: the admin role should be allowed directly', async () => {
      const ctx = createMockContext({ user: { role: 'admin', id: 'u1' } });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('TC-PERM-003: should be allowed without the @DataAccess decorator', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const ctx = createMockContext({ user: { role: 'user', id: 'u1' } });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('TC-PERM-004: GET requests should be allowed', async () => {
      reflector.getAllAndOverride.mockReturnValue(['project']);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1' },
        method: 'GET',
        params: { projectId: 'proj-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('TC-PERM-005: HEAD requests should be allowed', async () => {
      reflector.getAllAndOverride.mockReturnValue(['project']);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1' },
        method: 'HEAD',
        params: { projectId: 'proj-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });
  });

  // ==================== Project-level permissions ====================
  describe('Project-level resource permissions', () => {
    it('TC-PERM-010: with project write permission, should be allowed', async () => {
      reflector.getAllAndOverride.mockReturnValue(['project']);
      mockAuthService.checkProjectPermission.mockResolvedValue(true);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockAuthService.checkProjectPermission).toHaveBeenCalledWith(
        'role-001',
        'proj-001',
        'write',
      );
    });

    it('TC-PERM-011: without project write permission, should throw ForbiddenException', async () => {
      reflector.getAllAndOverride.mockReturnValue(['project']);
      mockAuthService.checkProjectPermission.mockResolvedValue(false);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== Device-level permissions ====================
  describe('Device-level resource permissions', () => {
    it('TC-PERM-020: with device write permission, should be allowed', async () => {
      reflector.getAllAndOverride.mockReturnValue(['device']);
      mockAuthService.checkDevicePermission.mockResolvedValue(true);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001', deviceId: 'dev-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockAuthService.checkDevicePermission).toHaveBeenCalledWith(
        'role-001',
        'proj-001',
        'dev-001',
        'write',
      );
    });

    it('TC-PERM-021: without device write permission, should throw ForbiddenException', async () => {
      reflector.getAllAndOverride.mockReturnValue(['device']);
      mockAuthService.checkDevicePermission.mockResolvedValue(false);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001', deviceId: 'dev-001' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('TC-PERM-022: missing projectId should throw ForbiddenException', async () => {
      reflector.getAllAndOverride.mockReturnValue(['device']);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { deviceId: 'dev-001' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== Group-level permissions ====================
  describe('Device group-level resource permissions', () => {
    it('TC-PERM-030: with group write permission, should be allowed', async () => {
      reflector.getAllAndOverride.mockReturnValue(['deviceGroup']);
      mockAuthService.checkDeviceGroupPermission.mockResolvedValue(true);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001', groupId: 'grp-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockAuthService.checkDeviceGroupPermission).toHaveBeenCalledWith(
        'role-001',
        'proj-001',
        'grp-001',
        'write',
      );
    });

    it('TC-PERM-031: without group write permission, should throw ForbiddenException', async () => {
      reflector.getAllAndOverride.mockReturnValue(['deviceGroup']);
      mockAuthService.checkDeviceGroupPermission.mockResolvedValue(false);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: { projectId: 'proj-001', groupId: 'grp-001' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== Fallback scenarios ====================
  describe('Fallback when authService is unavailable', () => {
    it('TC-PERM-040: should be allowed with no authService and no @Roles decorator', async () => {
      guard = new DataAccessGuard(reflector, undefined as any);
      reflector.getAllAndOverride.mockReturnValue(['project']);
      reflector.get.mockReturnValue([]);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1' },
        params: { projectId: 'proj-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('TC-PERM-041: should be allowed with no authService and @Roles containing the user role', async () => {
      guard = new DataAccessGuard(reflector, undefined as any);
      reflector.getAllAndOverride.mockReturnValue(['project']);
      reflector.get.mockReturnValue(['user']);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1' },
        params: { projectId: 'proj-001' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('TC-PERM-042: should be denied with no authService and @Roles not containing the user role', async () => {
      guard = new DataAccessGuard(reflector, undefined as any);
      reflector.getAllAndOverride.mockReturnValue(['project']);
      reflector.get.mockReturnValue(['admin']);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1' },
        params: { projectId: 'proj-001' },
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== body-param fallback ====================
  describe('Get the resource ID from the body', () => {
    it('TC-PERM-050: should check normally when params lacks projectId but body has it', async () => {
      reflector.getAllAndOverride.mockReturnValue(['project']);
      mockAuthService.checkProjectPermission.mockResolvedValue(true);
      const ctx = createMockContext({
        user: { role: 'user', id: 'u1', roleId: 'role-001' },
        params: {},
        body: { projectId: 'proj-from-body' },
      });

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockAuthService.checkProjectPermission).toHaveBeenCalledWith(
        'role-001',
        'proj-from-body',
        'write',
      );
    });
  });
});
