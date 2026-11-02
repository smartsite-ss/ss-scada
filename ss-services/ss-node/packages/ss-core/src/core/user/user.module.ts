// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, OnModuleInit, OnApplicationBootstrap, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Position } from './entities/position.entity';
import { ProjectAuthorization } from './entities/project-authorization.entity';
import { DeviceAuthorization } from './entities/device-authorization.entity';
import { TagAuthorization } from './entities/tag-authorization.entity';
import { PermissionAuditLog } from './entities/permission-audit-log.entity';
import { UserService } from './user.service';
import { RoleService } from './role.service';
import { PositionService } from './position.service';
import { AuthorizationService } from './authorization.service';
import { PermissionAuditService } from './permission-audit.service';
import { UserController } from './user.controller';
import { RoleController } from './role.controller';
import { PositionController } from './position.controller';

/**
 * @Global() - user/authorization module declared as a global module (implemented in 3.6)
 *
 * Lets AuthorizationService be injected by any module's Guard/Interceptor;
 * in particular ss-device's DataAccessGuard injects the 'AuthorizationService' string Token
 * to perform tag-level permission checks (checkTagPermission).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      Position,
      ProjectAuthorization,
      DeviceAuthorization,
      TagAuthorization,
      PermissionAuditLog,
    ]),
  ],
  controllers: [UserController, RoleController, PositionController],
  providers: [
    UserService,
    RoleService,
    PositionService,
    AuthorizationService,
    PermissionAuditService,
    // String Token alias -- for DataAccessGuard's @Inject('AuthorizationService')
    { provide: 'AuthorizationService', useExisting: AuthorizationService },
  ],
  exports: [
    UserService,
    RoleService,
    PositionService,
    AuthorizationService,
    PermissionAuditService,
    'AuthorizationService',
  ],
})
export class UserModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    private readonly roleService: RoleService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async onModuleInit() {
    // Auto-initialize system roles on first startup
    await this.roleService.initSystemRoles();
  }

  async onApplicationBootstrap() {
    // Run migrations after all modules' onModuleInit, ensuring ss-system's syncDefaultMenus has run and sys_menus is synced
    await this.roleService.migrateSystemRoleMenuIds();
    // Add system roles' missing default permissions (e.g. newly added trend-view permission)
    await this.roleService.migrateSystemRolePermissions();
    // v8.0: device-group authorization -> device authorization migration (sys_device_group_authorizations deprecated)
    await this.authorizationService.migrateDeviceGroupAuthsToDeviceAuths();
  }
}
