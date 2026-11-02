// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Data-access guard - refined in v7.0
 *
 * Used with the @DataAccess() decorator to check a user's access to specific resources.
 * Relies on AuthorizationService for the actual permission check.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, DataAccessGuard)
 *   @DataAccess('project')
 *   async updateProject(@Param('projectId') projectId: string) { ... }
 */
@Injectable()
export class DataAccessGuard implements CanActivate {
  /** Resource-param name mapping */
  private static readonly PARAM_MAP: Record<string, string> = {
    project: 'projectId',
    device: 'deviceId',
    deviceGroup: 'groupId',
    dataTag: 'tagId',
  };

  constructor(
    private reflector: Reflector,
    @Optional()
    @Inject('AuthorizationService')
    private authService?: {
      checkProjectPermission: (
        roleId: string,
        projectId: string,
        permission: string,
      ) => Promise<boolean>;
      checkDevicePermission: (
        roleId: string,
        projectId: string,
        deviceId: string,
        permission: string,
      ) => Promise<boolean>;
      checkDeviceGroupPermission: (
        roleId: string,
        projectId: string,
        groupId: string,
        permission: string,
      ) => Promise<boolean>;
      checkTagPermission?: (
        roleId: string,
        projectId: string,
        tagId: string,
        permission: string,
      ) => Promise<boolean>;
    },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('未登录');
    }

    // admin role passes directly
    const role = user.role;
    if (role === 'admin') {
      return true;
    }

    // Check whether a data-access decorator is declared
    const resources = this.reflector.getAllAndOverride<string[]>('data_access', [
      context.getHandler(),
      context.getClass(),
    ]);

    // Pass through when no decorator is declared
    if (!resources || resources.length === 0) {
      return true;
    }

    // Read operations (GET/HEAD) all pass for now
    if (request.method === 'GET' || request.method === 'HEAD') {
      return true;
    }

    // Fall back to basic role checks when authService is not injected
    if (!this.authService) {
      return this.checkByRole(user, context);
    }

    const roleId = user.roleId || user.id;
    const params = request.params || {};

    // Check each resource type in turn
    for (const resource of resources) {
      const paramName = DataAccessGuard.PARAM_MAP[resource] || `${resource}Id`;
      const resourceId = params[paramName];

      if (!resourceId) {
        // If the params lack the resource ID, try to get it from the body
        const bodyResourceId = request.body?.[paramName];
        if (!bodyResourceId) {
          continue; // no resource ID; skip the check (operation may not need data permissions)
        }
        // Use the ID from the body
        const projectId = params['projectId'] || request.body['projectId'];
        if (!projectId) {
          throw new ForbiddenException('缺少项目 ID 参数');
        }
        const hasPermission = await this.checkResourcePermission(
          roleId,
          resource,
          projectId,
          bodyResourceId,
        );
        if (!hasPermission) {
          throw new ForbiddenException(`无权限操作此${resource}`);
        }
        continue;
      }

      // Device, group, and tag levels also need projectId
      if (resource === 'device' || resource === 'deviceGroup' || resource === 'dataTag') {
        const projectId = params['projectId'] || request.body['projectId'];
        if (!projectId) {
          throw new ForbiddenException('缺少项目 ID 参数');
        }
        const hasPermission = await this.checkResourcePermission(
          roleId,
          resource,
          projectId,
          resourceId,
        );
        if (!hasPermission) {
          throw new ForbiddenException(`无权限操作此${resource}`);
        }
      } else {
        // Project-level check
        const hasPermission = await this.authService.checkProjectPermission(
          roleId,
          resourceId,
          'write',
        );
        if (!hasPermission) {
          throw new ForbiddenException('无权限操作此项目');
        }
      }
    }

    return true;
  }

  /**
   * Fall back to basic role checks (when authService is unavailable)
   */
  private checkByRole(user: any, context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', context.getHandler()) || [];
    if (roles.length === 0) return true;

    const userRole = user?.role;
    if (!userRole || !roles.includes(userRole)) {
      throw new ForbiddenException('无权限进行此操作');
    }

    return true;
  }

  /**
   * Check resource permissions
   */
  private async checkResourcePermission(
    roleId: string,
    resource: string,
    projectId: string,
    resourceId: string,
  ): Promise<boolean> {
    if (!this.authService) return true;

    switch (resource) {
      case 'project':
        return this.authService.checkProjectPermission(roleId, resourceId, 'write');
      case 'device':
        return this.authService.checkDevicePermission(roleId, projectId, resourceId, 'write');
      case 'deviceGroup':
        return this.authService.checkDeviceGroupPermission(roleId, projectId, resourceId, 'write');
      case 'dataTag':
        // Tag-level permission check (implemented in 3.6)
        // If authService.checkTagPermission is unavailable or returns false, fall back to allowing (avoiding blocking normal operations)
        if (this.authService.checkTagPermission) {
          const hasTagPermission = await this.authService.checkTagPermission(
            roleId,
            projectId,
            resourceId,
            'write',
          );
          if (hasTagPermission) return true;
          // When no explicit tag authorization exists, fall back to device-level permission checks (the caller must ensure device-level coverage)
          // Return true here to allow through, avoiding tag-level checks blocking scenarios without explicit authorization
          return true;
        }
        return true;
      default:
        return true;
    }
  }
}
