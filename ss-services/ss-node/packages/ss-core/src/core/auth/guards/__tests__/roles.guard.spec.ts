// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { UserRole } from '../../../user/entities/user.entity';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let mockReflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    guard = new RolesGuard(mockReflector);
  });

  /** Build a mock ExecutionContext, injecting the user object */
  function createMockContext(user: any): ExecutionContext {
    const mockRequest: any = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  /** ReadRoles equivalent: [ADMIN, USER, VIEWER] */
  const READ_ROLES = [UserRole.ADMIN, UserRole.USER, UserRole.VIEWER];
  /** WriteRoles equivalent: [ADMIN, USER] */
  const WRITE_ROLES = [UserRole.ADMIN, UserRole.USER];

  describe('canActivate - no role requirement', () => {
    it('Allowed when requiredRoles is undefined', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      const ctx = createMockContext({ id: 'u1', role: 'user' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('Allowed when requiredRoles is an empty array', () => {
      mockReflector.getAllAndOverride.mockReturnValue([]);
      const ctx = createMockContext({ id: 'u1', role: 'user' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('canActivate - standard roles (checked by role code)', () => {
    it('admin + ReadRoles → allowed', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({ id: 'u1', role: UserRole.ADMIN });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('user + ReadRoles → allowed', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({ id: 'u1', role: UserRole.USER });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('viewer + ReadRoles → allowed', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({ id: 'u1', role: UserRole.VIEWER });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('viewer + WriteRoles (not including viewer) → denied', () => {
      mockReflector.getAllAndOverride.mockReturnValue(WRITE_ROLES);
      const ctx = createMockContext({ id: 'u1', role: UserRole.VIEWER });
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });

  describe('canActivate - custom role fallback (added in v7.2)', () => {
    it('Custom role + ReadRoles + non-empty permissions → allowed (read operation)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['project:view', 'device:view'] },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('Custom role + ReadRoles + permissions with *:* → allowed (admin level)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['*:*'] },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('Custom role + ReadRoles + empty permissions → denied (unauthorized)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: [] },
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('Custom role + ReadRoles + missing roleEntity → denied (falls back to empty permissions)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext({ id: 'u1', role: 'test' });
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('Custom role + WriteRoles + no *:* → denied (write operations require admin level)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(WRITE_ROLES);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['project:view', 'device:view'] },
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('Custom role + WriteRoles + *:* → allowed (admin level)', () => {
      mockReflector.getAllAndOverride.mockReturnValue(WRITE_ROLES);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['*:*'] },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('Custom role + AdminRoles (admin only) + *:* → allowed', () => {
      mockReflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['*:*'] },
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('Custom role + AdminRoles (admin only) + no *:* → denied', () => {
      mockReflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const ctx = createMockContext({
        id: 'u1',
        role: 'test',
        roleEntity: { permissions: ['project:view'] },
      });
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });

  describe('canActivate - edge cases', () => {
    it('Denied when the user object is missing', () => {
      mockReflector.getAllAndOverride.mockReturnValue(READ_ROLES);
      const ctx = createMockContext(null);
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });
});
