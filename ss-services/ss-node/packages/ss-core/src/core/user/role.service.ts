// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { DEFAULT_ROLE_PERMISSIONS } from '../auth/permission-codes';

export interface CreateRoleDto {
  name: string;
  code: string;
  description?: string;
  permissions?: string[];
  /** List of menu IDs visible to the role (full replacement) */
  menuIds?: string[];
  sortOrder?: number;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  permissions?: string[];
  /** List of menu IDs visible to the role (full replacement) */
  menuIds?: string[];
  sortOrder?: number;
}

/** Default permission codes of system built-in roles (from permission-codes.ts, consistent with design doc section 3.3) */
const SYSTEM_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: DEFAULT_ROLE_PERMISSIONS.admin as string[],
  user: DEFAULT_ROLE_PERMISSIONS.user as string[],
  viewer: DEFAULT_ROLE_PERMISSIONS.viewer as string[],
};

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.roleRepository.find({ order: { sortOrder: 'ASC' } });
  }

  async findById(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async findByCode(code: string): Promise<Role | null> {
    return this.roleRepository.findOne({ where: { code } });
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const existing = await this.findByCode(dto.code);
    if (existing) throw new ForbiddenException('角色编码已存在');
    const role = this.roleRepository.create({
      name: dto.name,
      code: dto.code,
      description: dto.description || '',
      permissions: dto.permissions || [],
      menuIds: dto.menuIds || [],
      isSystem: false,
      sortOrder: dto.sortOrder || 0,
    });
    return this.roleRepository.save(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findById(id);
    if (dto.name !== undefined) role.name = dto.name;
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;
    // Menu ID list uses full replacement: the frontend submits all currently checked items, overwriting directly
    if (dto.menuIds !== undefined) role.menuIds = dto.menuIds;
    if (dto.sortOrder !== undefined) role.sortOrder = dto.sortOrder;
    return this.roleRepository.save(role);
  }

  async delete(id: string): Promise<void> {
    const role = await this.findById(id);
    if (role.isSystem) throw new ForbiddenException('系统内置角色不可删除');
    await this.roleRepository.remove(role);
  }

  /**
   * One-time migration: fill default menuIds for existing user/viewer system roles
   *
   * Fills only when menuIds is empty, to avoid overwriting data manually configured by the admin; idempotent.
   * Called in onApplicationBootstrap, ensuring ss-system's syncDefaultMenus has run and the sys_menus table is populated.
   * - admin is not processed (filterByMenuIds shows everything via the isAdmin bypass)
   * - user-created roles like test are not processed (configured manually by the admin in the role editor)
   */
  async migrateSystemRoleMenuIds(): Promise<void> {
    const allMenuIds = await this.queryAllMenuIds();
    if (allMenuIds.length === 0) {
      this.logger.warn('sys_menus table is empty, skipping role menuIds migration (will retry on next start)');
      return;
    }

    const targets = await this.roleRepository.find({
      where: [
        { code: 'user', isSystem: true },
        { code: 'viewer', isSystem: true },
      ],
    });

    for (const role of targets) {
      if (!role.menuIds || role.menuIds.length === 0) {
        role.menuIds = [...allMenuIds];
        await this.roleRepository.save(role);
        this.logger.log(`Filled default menuIds for role ${role.code} (${allMenuIds.length} items)`);
      }
    }
  }

  /**
   * Sync system roles' default permissions on every startup (add missing ones, never delete existing)
   *
   * Scenario: after DEFAULT_ROLE_PERMISSIONS adds new permission codes, deployed system roles are auto-completed.
   * Append-only, no deletion, to avoid overwriting permissions the admin manually added in the role editor.
   */
  async migrateSystemRolePermissions(): Promise<void> {
    const targets = await this.roleRepository.find({
      where: { isSystem: true },
    });

    let synced = 0;
    for (const role of targets) {
      const defaults = (SYSTEM_ROLE_PERMISSIONS as any)[role.code] as string[] | undefined;
      if (!defaults || defaults.length === 0) continue;

      const existing = new Set(role.permissions || []);
      const missing = defaults.filter((code) => !existing.has(code));
      if (missing.length > 0) {
        role.permissions = [...existing, ...missing];
        await this.roleRepository.save(role);
        synced++;
        this.logger.log(
          `Added ${missing.length} default permissions to role ${role.code}: ${missing.join(', ')}`,
        );
      }
    }
    if (synced > 0) {
      this.logger.log(`System role permission migration complete, ${synced} roles updated`);
    }
  }

  /**
   * Query all menu IDs from the sys_menus table
   * Uses bare SQL to avoid importing ss-system's Menu entity, which would create a ss-core -> ss-system circular dependency
   */
  private async queryAllMenuIds(): Promise<string[]> {
    try {
      const rows: { id: string }[] = await this.roleRepository.manager.query(
        'SELECT id FROM sys_menus',
      );
      return rows.map((r) => r.id);
    } catch (err) {
      this.logger.warn(`Failed to query sys_menus: ${(err as Error).message}`);
      return [];
    }
  }

  /** Get a role's permission-code list */
  async getPermissions(roleId: string): Promise<string[]> {
    const role = await this.findById(roleId);
    return role.permissions || [];
  }

  /**
   * Initialize system built-in roles on first startup
   * If the roles table is empty, insert the three system roles admin/user/viewer
   */
  async initSystemRoles(): Promise<void> {
    const count = await this.roleRepository.count();
    if (count > 0) return;

    // Query all current menu IDs (sys_menus may not be synced yet on first startup; fill [] when empty, migrateSystemRoleMenuIds is the fallback)
    const allMenuIds = await this.queryAllMenuIds();

    const systemRoles = [
      {
        name: '超级管理员',
        code: 'admin',
        description: '系统内置超级管理员角色，拥有所有权限',
        permissions: SYSTEM_ROLE_PERMISSIONS.admin,
        // admin shows all menus via filterByMenuIds' isAdmin bypass; no menuIds config needed
        menuIds: [],
        isSystem: true,
        sortOrder: 0,
      },
      {
        name: '普通用户',
        code: 'user',
        description: '系统内置普通用户角色，拥有基本操作权限',
        permissions: SYSTEM_ROLE_PERMISSIONS.user,
        // Default visible to all menus (aligned with v7.0 item.roles=['admin','user'] behavior, avoiding empty menus after switching)
        menuIds: [...allMenuIds],
        isSystem: true,
        sortOrder: 1,
      },
      {
        name: '观察员',
        code: 'viewer',
        description: '系统内置观察员角色，仅拥有只读权限',
        permissions: SYSTEM_ROLE_PERMISSIONS.viewer,
        menuIds: [...allMenuIds],
        isSystem: true,
        sortOrder: 2,
      },
    ];
    await this.roleRepository.save(systemRoles);
  }
}
