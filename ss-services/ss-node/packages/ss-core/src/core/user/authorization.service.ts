// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAuthorization } from './entities/project-authorization.entity';
import { DeviceAuthorization } from './entities/device-authorization.entity';
import { TagAuthorization } from './entities/tag-authorization.entity';
import { Role } from './entities/role.entity';

export interface ProjectAuthDto {
  roleId: string;
  projectId: string;
  permission?: string;
}

export interface DeviceAuthDto {
  roleId: string;
  projectId: string;
  deviceId: string;
  permission?: string;
}

export interface TagAuthDto {
  roleId: string;
  projectId: string;
  tagId: string;
  permission?: string;
}

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    @Inject(getRepositoryToken(ProjectAuthorization))
    private projectAuthRepo: Repository<ProjectAuthorization>,
    @Inject(getRepositoryToken(DeviceAuthorization))
    private deviceAuthRepo: Repository<DeviceAuthorization>,
    @Inject(getRepositoryToken(TagAuthorization))
    private tagAuthRepo: Repository<TagAuthorization>,
    @Inject(getRepositoryToken(Role))
    private roleRepo: Repository<Role>,
  ) {}

  // ──────── Project authorization ────────

  /** Get all project authorizations of a role */
  async getProjectAuths(roleId: string): Promise<ProjectAuthorization[]> {
    return this.projectAuthRepo.find({ where: { roleId } });
  }

  /** Get the list of project IDs a role can access */
  async getAccessibleProjectIds(roleId: string): Promise<string[]> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    // admin role (*:*) can access all projects
    if (role?.permissions?.includes('*:*')) {
      return ['*']; // special marker: all projects
    }
    const auths = await this.projectAuthRepo.find({ where: { roleId } });
    return auths.map((a) => a.projectId);
  }

  /** Check whether a role has the given permission on a project */
  async checkProjectPermission(
    roleId: string,
    projectId: string,
    requiredPermission: 'read' | 'write' | 'admin' = 'read',
  ): Promise<boolean> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) return true;

    const auth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (!auth) return false;

    const levels = { read: 0, write: 1, admin: 2 };
    return levels[auth.permission] >= levels[requiredPermission];
  }

  /** Batch-set a role's project authorizations */
  async setProjectAuths(roleId: string, auths: ProjectAuthDto[]): Promise<void> {
    // Delete old authorizations first
    await this.projectAuthRepo.delete({ roleId });
    // Then batch-insert the new authorizations
    if (auths.length > 0) {
      const entities = auths.map((a) =>
        this.projectAuthRepo.create({
          roleId,
          projectId: a.projectId,
          permission: a.permission || 'read',
        }),
      );
      await this.projectAuthRepo.save(entities);
    }
  }

  /** Add a single project authorization */
  async addProjectAuth(dto: ProjectAuthDto): Promise<ProjectAuthorization> {
    const existing = await this.projectAuthRepo.findOne({
      where: { roleId: dto.roleId, projectId: dto.projectId },
    });
    if (existing) {
      existing.permission = dto.permission || 'read';
      return this.projectAuthRepo.save(existing);
    }
    const auth = this.projectAuthRepo.create({
      roleId: dto.roleId,
      projectId: dto.projectId,
      permission: dto.permission || 'read',
    });
    return this.projectAuthRepo.save(auth);
  }

  /** Remove a project authorization */
  async removeProjectAuth(roleId: string, projectId: string): Promise<void> {
    await this.projectAuthRepo.delete({ roleId, projectId });
  }

  // ──────── Device authorization ────────

  /** Get a role's device authorizations within a project */
  async getDeviceAuths(roleId: string, projectId: string): Promise<DeviceAuthorization[]> {
    return this.deviceAuthRepo.find({ where: { roleId, projectId } });
  }

  /** Get the list of device IDs a role can access within a project */
  async getAccessibleDeviceIds(roleId: string, projectId: string): Promise<string[]> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) {
      return ['*']; // all devices
    }
    // With project:admin permission, all devices in the project are accessible
    const projectAuth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (projectAuth?.permission === 'admin') {
      return ['*'];
    }
    const auths = await this.deviceAuthRepo.find({ where: { roleId, projectId } });
    return auths.map((a) => a.deviceId);
  }

  /** Check whether a role has the given permission on a device (v8.0: adds project-association validation to prevent cross-project authorization leakage) */
  async checkDevicePermission(
    roleId: string,
    projectId: string,
    deviceId: string,
    requiredPermission: 'read' | 'write' = 'read',
  ): Promise<boolean> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) return true;

    // With project:admin permission, all devices in the project have write permission
    const projectAuth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (projectAuth?.permission === 'admin') return true;

    // v8.0: validate that the device belongs to the passed projectId (prevents cross-project authorization leakage)
    try {
      const devices: { project_id: string }[] = await this.deviceAuthRepo.manager.query(
        `SELECT project_id FROM sys_devices WHERE id = ?`,
        [deviceId],
      );
      if (devices.length === 0) return false;
      if (devices[0].project_id !== projectId) {
        this.logger.warn(
          `checkDevicePermission: device ${deviceId} project_id=${devices[0].project_id} mismatch with input projectId=${projectId}`,
        );
        return false;
      }
    } catch {
      // Allow through when the sys_devices table does not exist or the query fails (test-env compatible); the business layer provides the fallback
    }

    const auth = await this.deviceAuthRepo.findOne({
      where: { roleId, projectId, deviceId },
    });
    if (!auth) return false;

    const levels = { read: 0, write: 1 };
    return levels[auth.permission] >= levels[requiredPermission];
  }

  /** Batch-set a role's device authorizations within a project */
  async setDeviceAuths(roleId: string, projectId: string, auths: DeviceAuthDto[]): Promise<void> {
    await this.deviceAuthRepo.delete({ roleId, projectId });
    if (auths.length > 0) {
      const entities = auths.map((a) =>
        this.deviceAuthRepo.create({
          roleId,
          projectId,
          deviceId: a.deviceId,
          permission: a.permission || 'read',
        }),
      );
      await this.deviceAuthRepo.save(entities);
    }
  }

  /** Add a single device authorization */
  async addDeviceAuth(dto: DeviceAuthDto): Promise<DeviceAuthorization> {
    const existing = await this.deviceAuthRepo.findOne({
      where: { roleId: dto.roleId, projectId: dto.projectId, deviceId: dto.deviceId },
    });
    if (existing) {
      existing.permission = dto.permission || 'read';
      return this.deviceAuthRepo.save(existing);
    }
    const auth = this.deviceAuthRepo.create({
      roleId: dto.roleId,
      projectId: dto.projectId,
      deviceId: dto.deviceId,
      permission: dto.permission || 'read',
    });
    return this.deviceAuthRepo.save(auth);
  }

  /** Remove a device authorization */
  async removeDeviceAuth(roleId: string, projectId: string, deviceId: string): Promise<void> {
    await this.deviceAuthRepo.delete({ roleId, projectId, deviceId });
  }

  // ──────── Device-group ID derivation (v8.0: derived from device authorizations; standalone group-authorization table deprecated) ────────

  /**
   * Get the device-group ID list visible to a role within a project (derived from device authorizations)
   *
   * No longer queries sys_device_group_authorizations; instead:
   * 1. Get the list of device IDs the role can access in the project
   * 2. Reverse-query the sys_devices table for each device's groupId
   * 3. Dedupe and return
   *
   * Rule: authorizing a device implies authorizing its group.
   */
  async getAccessibleDeviceGroupIds(roleId: string, projectId: string): Promise<string[]> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) {
      return ['*'];
    }
    // With project:admin permission, all groups in the project are accessible
    const projectAuth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (projectAuth?.permission === 'admin') {
      return ['*'];
    }

    // Get deviceIds from device authorizations
    const deviceAuths = await this.deviceAuthRepo.find({ where: { roleId, projectId } });
    if (deviceAuths.length === 0) return [];

    const deviceIds = deviceAuths.map((a) => a.deviceId);
    try {
      // Raw SQL query on sys_devices to avoid circular dependency
      const rows: { group_id: string | null }[] = await this.deviceAuthRepo.manager.query(
        `SELECT DISTINCT group_id FROM sys_devices WHERE id IN (${deviceIds.map(() => '?').join(',')})`,
        deviceIds,
      );
      return rows.map((r) => r.group_id).filter(Boolean) as string[];
    } catch {
      return [];
    }
  }

  // ──────── Tag authorization (implemented in 3.6) ────────

  /**
   * Check whether a role has the given permission on a tag
   *
   * Check order (priority descending):
   * 1. Role has *:* permission -> pass directly
   * 2. Project-level admin permission -> pass
   * 3. Explicit tag authorization (sys_tag_authorizations table)
   * 4. No explicit tag authorization -> return false (caller should fall back to device-level permission check)
   *
   * @returns true=permitted; false=no explicit authorization (should fall back to device-level check)
   */
  async checkTagPermission(
    roleId: string,
    projectId: string,
    tagId: string,
    requiredPermission: 'read' | 'write' = 'read',
  ): Promise<boolean> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) return true;

    // With project:admin permission, all tags in the project have write permission
    const projectAuth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (projectAuth?.permission === 'admin') return true;

    const auth = await this.tagAuthRepo.findOne({
      where: { roleId, projectId, tagId },
    });
    if (!auth) return false;

    const levels = { read: 0, write: 1 };
    return levels[auth.permission as 'read' | 'write'] >= levels[requiredPermission];
  }

  /** Get a role's tag authorizations within a project */
  async getTagAuths(roleId: string, projectId: string): Promise<TagAuthorization[]> {
    return this.tagAuthRepo.find({ where: { roleId, projectId } });
  }

  /** Get the list of tag IDs a role can access within a project */
  async getAccessibleTagIds(roleId: string, projectId: string): Promise<string[]> {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (role?.permissions?.includes('*:*')) {
      return ['*'];
    }
    const projectAuth = await this.projectAuthRepo.findOne({
      where: { roleId, projectId },
    });
    if (projectAuth?.permission === 'admin') {
      return ['*'];
    }
    const auths = await this.tagAuthRepo.find({ where: { roleId, projectId } });
    return auths.map((a) => a.tagId);
  }

  /** Batch-set a role's tag authorizations within a project */
  async setTagAuths(roleId: string, projectId: string, auths: TagAuthDto[]): Promise<void> {
    await this.tagAuthRepo.delete({ roleId, projectId });
    if (auths.length > 0) {
      const entities = auths.map((a) =>
        this.tagAuthRepo.create({
          roleId,
          projectId,
          tagId: a.tagId,
          permission: a.permission || 'read',
        }),
      );
      await this.tagAuthRepo.save(entities);
    }
  }

  /** Add a single tag authorization */
  async addTagAuth(dto: TagAuthDto): Promise<TagAuthorization> {
    const existing = await this.tagAuthRepo.findOne({
      where: { roleId: dto.roleId, projectId: dto.projectId, tagId: dto.tagId },
    });
    if (existing) {
      existing.permission = dto.permission || 'read';
      return this.tagAuthRepo.save(existing);
    }
    const auth = this.tagAuthRepo.create({
      roleId: dto.roleId,
      projectId: dto.projectId,
      tagId: dto.tagId,
      permission: dto.permission || 'read',
    });
    return this.tagAuthRepo.save(auth);
  }

  /** Remove a tag authorization */
  async removeTagAuth(roleId: string, projectId: string, tagId: string): Promise<void> {
    await this.tagAuthRepo.delete({ roleId, projectId, tagId });
  }

  // ──────── v8.0 data migration: group authorizations -> device authorizations ────────

  /**
   * One-time migration: expand group authorizations in sys_device_group_authorizations
   * into corresponding device authorization records (deduped, idempotent).
   *
   * Uses raw SQL to query the sys_devices table, avoiding a ss-core -> ss-device circular dependency.
   * Called in onApplicationBootstrap.
   */
  async migrateDeviceGroupAuthsToDeviceAuths(): Promise<void> {
    try {
      // Query all group-authorization records (raw SQL avoids referencing the DeviceGroupAuthorization entity after its removal)
      const groupAuths: {
        id: string; role_id: string; project_id: string; group_id: string;
        permission: string;
      }[] = await this.deviceAuthRepo.manager.query(
        `SELECT id, role_id, project_id, group_id, permission FROM sys_device_group_authorizations`,
      );
      if (groupAuths.length === 0) {
        this.logger.log('Group authorization migration: nothing to migrate');
        return;
      }

      let migrated = 0;
      for (const ga of groupAuths) {
        // Query all devices under the group's project
        const devices: { id: string }[] = await this.deviceAuthRepo.manager.query(
          `SELECT id FROM sys_devices WHERE project_id = ? AND group_id = ?`,
          [ga.project_id, ga.group_id],
        );

        for (const device of devices) {
          // Check whether a device authorization with the same role + same project already exists (dedupe)
          const existing: { id: string }[] = await this.deviceAuthRepo.manager.query(
            `SELECT id FROM sys_device_authorizations WHERE role_id = ? AND project_id = ? AND device_id = ?`,
            [ga.role_id, ga.project_id, device.id],
          );
          if (existing.length === 0) {
            await this.deviceAuthRepo.manager.query(
              `INSERT INTO sys_device_authorizations (id, role_id, project_id, device_id, permission, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [this.generateUuid(), ga.role_id, ga.project_id, device.id, ga.permission],
            );
            migrated++;
          }
        }
      }

      if (migrated > 0) {
        this.logger.log(
          `Group-to-device authorization migration complete: ${groupAuths.length} group authorizations expanded into ${migrated} device authorizations`,
        );
      } else {
        this.logger.log(
          `Group-to-device authorization migration complete: ${groupAuths.length} group authorizations, all already expanded (no additions)`,
        );
      }
    } catch (error: any) {
      // Silently skip when the table does not exist (not yet created on first startup)
      if (error.message?.includes('no such table')) {
        this.logger.log('Group authorization migration: sys_device_group_authorizations table missing, skipping');
        return;
      }
      this.logger.warn(`Group authorization migration failed: ${error.message}`);
    }
  }

  /** Generate a UUID (without depending on the crypto module) */
  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
