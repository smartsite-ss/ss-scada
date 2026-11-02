// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, CanActivate, ExecutionContext, Inject, Optional, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Role } from '../../user/entities/role.entity';

/**
 * Permission-code guard
 * Used together with the @Permissions() decorator
 *
 * Permission-code read priority (v8.0: DB is the single source of truth, no hard-coded fallback):
 *  1. Read from the DB roles table (user.roleId -> role.permissions)
 *  2. When DB unavailable, return an empty array (reject all requests, avoid silent authorization)
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @Permissions('project:create')
 *   async create() { ... }
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    @Optional()
    @Inject(getRepositoryToken(Role))
    private roleRepository?: Repository<Role>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const userPermissions = await this.getUserPermissions(user);
    // admin has all permissions
    if (userPermissions.includes('*:*')) return true;

    return required.some((code) => userPermissions.includes(code));
  }

  /**
   * Get the user's permission-code list (v8.0: DB is the single source of truth)
   * When DB is unavailable, return an empty array and reject all requests, avoiding silent authorization from a hard-coded fallback.
   */
  private async getUserPermissions(user: any): Promise<string[]> {
    if (user.roleId && this.roleRepository) {
      try {
        const role = await this.roleRepository.findOne({ where: { id: user.roleId } });
        if (role && role.permissions && role.permissions.length > 0) {
          return role.permissions;
        }
      } catch (error: any) {
        this.logger.warn(`Failed to load permissions for user ${user.username || user.id}: ${error.message}`);
      }
    }
    // v8.0: no longer fall back to hard-coded; when DB is unavailable, reject all requests
    if (!user.roleId) {
      this.logger.warn(`User ${user.username || user.id} has no roleId, denying all permissions`);
    }
    return [];
  }
}
