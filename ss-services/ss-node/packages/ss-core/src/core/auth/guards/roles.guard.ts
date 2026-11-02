// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../user/entities/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    // Standard roles (admin/user/viewer): checked by role code
    if (requiredRoles.some((role) => user?.role === role)) {
      return true;
    }
    // v7.2: self-built roles (role code not in the standard UserRole enum, e.g. test) fall back to actual permissions.
    // JwtStrategy.validate already loaded roleEntity via findById, so permissions can be read directly.
    if (user?.role && !Object.values(UserRole).includes(user.role as UserRole)) {
      const permissions: string[] = user?.roleEntity?.permissions || [];
      // admin level (*:*) : allow all
      if (permissions.includes('*:*')) {
        return true;
      }
      // ReadRoles (includes VIEWER): self-built roles with non-empty permissions are allowed for read ops.
      // Write ops (WriteRoles/AdminRoles exclude VIEWER) still require *:* or fine-grained @Permissions checks.
      if (requiredRoles.includes(UserRole.VIEWER) && permissions.length > 0) {
        return true;
      }
    }
    return false;
  }
}
