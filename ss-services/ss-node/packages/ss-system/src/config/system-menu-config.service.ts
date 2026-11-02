// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Menu, MenuButton } from '../entities/system.entity';

/**
 * System menu config service (v7.1 — DB as the single source of truth)
 *
 * Menu data lives only in the sys_menus table; the code-embedded DEFAULT_SYSTEM_MENU serves
 * solely as seed data for first-time initialization and version sync, not as a runtime fallback.
 * At startup, syncDefaultMenus() inserts missing items and syncs fields of existing ones,
 * ensuring code default changes are automatically reflected in the DB.
 */

/** System menu item interface (aligned with the frontend) */
export interface SystemMenuItem {
  id: string;
  labelKey: string;
  path: string;
  icon: string;
  children?: SystemMenuItem[];
  roles?: string[] | null;
  showInTopbar?: boolean;
  showInSidebar?: boolean;
  isDetail?: boolean;
  order?: number;
  /** Subsystem identifier; NULL/undefined means a global menu */
  subsystem?: string | null;
}

/** Menu button interface */
export interface SystemMenuButton {
  id: string;
  menuId: string;
  labelKey: string;
  permissionCode: string;
  sortOrder: number;
}

/** Code-embedded default menus (used when the DB is unavailable) */
const DEFAULT_SYSTEM_MENU: SystemMenuItem[] = [
  { id: 'overview', labelKey: 'system.nav.overview', path: '', icon: 'overview', order: 0 },
  {
    id: 'projects',
    labelKey: 'system.nav.projects',
    path: '/projects',
    icon: 'projects',
    roles: ['admin'],
    order: 10,
    children: [
      {
        id: 'project-list',
        labelKey: 'system.nav.projectList',
        path: '/projects',
        icon: 'projects',
        roles: ['admin'],
      },
      {
        id: 'page-management',
        labelKey: 'system.nav.pageManagement',
        path: '/page-management',
        icon: 'page-management',
        roles: ['admin'],
      },
    ],
  },
  {
    id: 'devices',
    labelKey: 'system.nav.devices',
    path: '/devices',
    icon: 'devices',
    roles: ['admin', 'user'],
    order: 20,
    children: [
      {
        id: 'device-list',
        labelKey: 'system.nav.devices',
        path: '/devices',
        icon: 'devices',
        roles: ['admin', 'user'],
      },
      {
        id: 'device-monitor',
        labelKey: 'system.nav.deviceMonitor',
        path: '/device-monitor',
        icon: 'device-monitor',
        roles: ['admin', 'user'],
      },
      {
        id: 'real-time-trend',
        labelKey: 'system.nav.realTimeTrend',
        path: '/real-time-trend',
        icon: 'real-time-trend',
        roles: ['admin', 'user'],
      },
    ],
  },
  {
    id: 'plugins',
    labelKey: 'system.nav.plugins',
    path: '/plugins',
    icon: 'plugins',
    roles: ['admin', 'user'],
    order: 30,
  },
  {
    id: 'alarms',
    labelKey: 'system.nav.alarms',
    path: '/alarms',
    icon: 'alarms',
    order: 40,
    children: [
      {
        id: 'realtime-alarms',
        labelKey: 'system.nav.realtimeAlarms',
        path: '/realtime-alarms',
        icon: 'realtime-alarms',
      },
      {
        id: 'history-alarms',
        labelKey: 'system.nav.historyAlarms',
        path: '/alarms',
        icon: 'alarms',
      },
    ],
  },
  {
    id: 'scripts',
    labelKey: 'system.nav.scripts',
    path: '/scripts',
    icon: 'scripts',
    roles: ['admin', 'user'],
    order: 50,
  },
  {
    id: 'report-management',
    labelKey: 'system.nav.reportManagement',
    path: '/reports',
    icon: 'report-management',
    roles: ['admin', 'user'],
    order: 60,
    children: [
      { id: 'reports', labelKey: 'system.nav.reports', path: '/reports', icon: 'reports' },
      {
        id: 'control-logs',
        labelKey: 'system.nav.controlLogs',
        path: '/control-logs',
        icon: 'system-logs',
        roles: ['admin', 'user'],
      },
      {
        id: 'historical-trend',
        labelKey: 'system.nav.historicalTrend',
        path: '/historical-trend',
        icon: 'trend',
        roles: ['admin', 'user', 'viewer'],
      },
    ],
  },
  {
    id: 'templates',
    labelKey: 'system.nav.deviceTemplates',
    path: '/templates',
    icon: 'templates',
    roles: ['admin', 'user'],
    order: 70,
  },
  {
    id: 'canvas-templates',
    labelKey: 'system.nav.canvasTemplates',
    path: '/canvas-templates',
    icon: 'templates',
    roles: ['admin'],
    order: 71,
  },
  {
    id: 'settings',
    labelKey: 'system.nav.settings',
    path: '/settings',
    icon: 'settings',
    roles: ['admin'],
    order: 100,
    children: [
      {
        id: 'settings-general',
        labelKey: 'system.settings.title',
        path: '/settings',
        icon: 'settings-sub',
        roles: ['admin'],
      },
      {
        id: 'users',
        labelKey: 'system.nav.users',
        path: '/users',
        icon: 'users',
        roles: ['admin'],
      },
      {
        id: 'roles',
        labelKey: 'system.nav.roles',
        path: '/roles',
        icon: 'roles',
        roles: ['admin'],
      },
      {
        id: 'positions',
        labelKey: 'system.nav.positions',
        path: '/positions',
        icon: 'positions',
        roles: ['admin'],
      },
      { id: 'dict', labelKey: 'system.nav.dict', path: '/dict', icon: 'dict', roles: ['admin'] },
      { id: 'knowledge', labelKey: 'system.nav.knowledge', path: '/knowledge', icon: 'knowledge' },
      { id: 'gallery', labelKey: 'system.nav.gallery', path: '/gallery', icon: 'gallery', roles: ['admin'] },
    ],
  },
  {
    id: 'ops',
    labelKey: 'system.nav.systemOps',
    path: '/info',
    icon: 'ops',
    roles: ['admin'],
    order: 110,
    children: [
      { id: 'info', labelKey: 'system.settings.systemInfo', path: '/info', icon: 'info' },
      { id: 'health', labelKey: 'system.nav.health', path: '/health', icon: 'health' },
      {
        id: 'database-ops',
        labelKey: 'system.nav.databaseOps',
        path: '/database-ops',
        icon: 'database',
        roles: ['admin'],
      },
      {
        id: 'base-services',
        labelKey: 'system.nav.baseServices',
        path: '/base-services',
        icon: 'base-services',
        roles: ['admin'],
      },
      {
        id: 'ws-monitor',
        labelKey: 'system.nav.wsMonitor',
        path: '/ws-monitor',
        icon: 'ws-monitor',
        roles: ['admin'],
      },
      {
        id: 'ai-config',
        labelKey: 'system.nav.aiConfig',
        path: '/ai-config',
        icon: 'settings',
        roles: ['admin'],
      },
      {
        id: 'terminal',
        labelKey: 'system.nav.terminal',
        path: '/terminal',
        icon: 'terminal',
        roles: ['admin'],
      },
      {
        id: 'menus',
        labelKey: 'system.nav.menus',
        path: '/menus',
        icon: 'menu-config',
        roles: ['admin'],
      },
      {
        id: 'notification-channels',
        labelKey: 'system.nav.notificationChannels',
        path: '/notification-channels',
        icon: 'notification',
        roles: ['admin'],
      },
      {
        id: 'timer-config',
        labelKey: 'system.nav.timerConfig',
        path: '/timer-config',
        icon: 'timer',
        roles: ['admin'],
      },
    ],
  },
  {
    id: 'system-logs',
    labelKey: 'system.nav.systemLogs',
    path: '/operation-logs',
    icon: 'system-logs',
    roles: ['admin'],
    order: 999,
    children: [
      {
        id: 'operation-logs',
        labelKey: 'system.nav.operationLogs',
        path: '/operation-logs',
        icon: 'system-logs',
        roles: ['admin'],
      },
      {
        id: 'security-audit-logs',
        labelKey: 'system.nav.securityAuditLogs',
        path: '/security-audit-logs',
        icon: 'security-audit',
        roles: ['admin'],
      },
      {
        id: 'permission-audit-logs',
        labelKey: 'system.nav.permissionAuditLogs',
        path: '/permission-audit-logs',
        icon: 'permission-audit',
        roles: ['admin'],
      },
      {
        id: 'error-logs',
        labelKey: 'system.nav.errorLogs',
        path: '/error-logs',
        icon: 'error-log',
        roles: ['admin'],
      },
      {
        id: 'event-logs',
        labelKey: 'system.nav.eventLogs',
        path: '/event-logs',
        icon: 'system-logs',
        roles: ['admin'],
      },
      {
        id: 'app-logs',
        labelKey: 'system.nav.appLogs',
        path: '/app-logs',
        icon: 'app-log',
        roles: ['admin'],
      },
    ],
  },
];

/** Default button permissions (associated by menu) */
const DEFAULT_MENU_BUTTONS: SystemMenuButton[] = [
  // Device management
  {
    id: 'btn-device-create',
    menuId: 'devices',
    labelKey: 'system.btn.create',
    permissionCode: 'device:create',
    sortOrder: 0,
  },
  {
    id: 'btn-device-edit',
    menuId: 'devices',
    labelKey: 'system.btn.edit',
    permissionCode: 'device:edit',
    sortOrder: 10,
  },
  {
    id: 'btn-device-delete',
    menuId: 'devices',
    labelKey: 'system.btn.delete',
    permissionCode: 'device:delete',
    sortOrder: 20,
  },
  {
    id: 'btn-device-import',
    menuId: 'devices',
    labelKey: 'system.btn.import',
    permissionCode: 'device:import',
    sortOrder: 30,
  },
  {
    id: 'btn-device-export',
    menuId: 'devices',
    labelKey: 'system.btn.export',
    permissionCode: 'device:export',
    sortOrder: 40,
  },
  // Collection management
  {
    id: 'btn-plugin-create',
    menuId: 'plugins',
    labelKey: 'system.btn.create',
    permissionCode: 'plugin:create',
    sortOrder: 0,
  },
  {
    id: 'btn-plugin-edit',
    menuId: 'plugins',
    labelKey: 'system.btn.edit',
    permissionCode: 'plugin:edit',
    sortOrder: 10,
  },
  {
    id: 'btn-plugin-delete',
    menuId: 'plugins',
    labelKey: 'system.btn.delete',
    permissionCode: 'plugin:delete',
    sortOrder: 20,
  },
  // Alarm center
  {
    id: 'btn-alarm-ack',
    menuId: 'alarms',
    labelKey: 'system.btn.ack',
    permissionCode: 'alarm:ack',
    sortOrder: 0,
  },
  {
    id: 'btn-alarm-config',
    menuId: 'alarms',
    labelKey: 'system.btn.configure',
    permissionCode: 'alarm:configure',
    sortOrder: 10,
  },
  // Script management
  {
    id: 'btn-script-create',
    menuId: 'scripts',
    labelKey: 'system.btn.create',
    permissionCode: 'script:create',
    sortOrder: 0,
  },
  {
    id: 'btn-script-edit',
    menuId: 'scripts',
    labelKey: 'system.btn.edit',
    permissionCode: 'script:edit',
    sortOrder: 10,
  },
  {
    id: 'btn-script-delete',
    menuId: 'scripts',
    labelKey: 'system.btn.delete',
    permissionCode: 'script:delete',
    sortOrder: 20,
  },
  {
    id: 'btn-script-exec',
    menuId: 'scripts',
    labelKey: 'system.btn.execute',
    permissionCode: 'script:execute',
    sortOrder: 30,
  },
  // Project management
  {
    id: 'btn-project-create',
    menuId: 'projects',
    labelKey: 'system.btn.create',
    permissionCode: 'project:create',
    sortOrder: 0,
  },
  {
    id: 'btn-project-edit',
    menuId: 'projects',
    labelKey: 'system.btn.edit',
    permissionCode: 'project:edit',
    sortOrder: 10,
  },
  {
    id: 'btn-project-delete',
    menuId: 'projects',
    labelKey: 'system.btn.delete',
    permissionCode: 'project:delete',
    sortOrder: 20,
  },
  // Template management
  {
    id: 'btn-tmpl-create',
    menuId: 'templates',
    labelKey: 'system.btn.create',
    permissionCode: 'template:create',
    sortOrder: 0,
  },
  {
    id: 'btn-tmpl-edit',
    menuId: 'templates',
    labelKey: 'system.btn.edit',
    permissionCode: 'template:edit',
    sortOrder: 10,
  },
  {
    id: 'btn-tmpl-delete',
    menuId: 'templates',
    labelKey: 'system.btn.delete',
    permissionCode: 'template:delete',
    sortOrder: 20,
  },
  {
    id: 'btn-tmpl-import',
    menuId: 'templates',
    labelKey: 'system.btn.import',
    permissionCode: 'template:import',
    sortOrder: 30,
  },
  {
    id: 'btn-tmpl-export',
    menuId: 'templates',
    labelKey: 'system.btn.export',
    permissionCode: 'template:export',
    sortOrder: 40,
  },
];

@Injectable()
export class SystemMenuConfigService implements OnModuleInit {
  private readonly logger = new Logger(SystemMenuConfigService.name);

  constructor(
    @InjectRepository(Menu)
    private readonly menuRepo: Repository<Menu>,
    @InjectRepository(MenuButton)
    private readonly buttonRepo: Repository<MenuButton>,
  ) {}

  async onModuleInit() {
    await this.syncDefaultMenus();
    await this.syncDefaultButtons();
  }

  /**
   * Get the system menu (tree structure) — DB as the single source of truth
   * @param subsystem optional subsystem filter; priority: parameter > env.SUBSYSTEM > no filter
   * @returns the menu tree from the DB; an empty array when the DB is empty (syncDefaultMenus guarantees it is seeded at startup)
   */
  async getMenu(subsystem?: string): Promise<SystemMenuItem[]> {
    const currentSubsystem = subsystem || process.env.SUBSYSTEM || undefined;
    try {
      const qb = this.menuRepo
        .createQueryBuilder('menu')
        .where('menu.isDetail = :isDetail', { isDetail: 0 });
      if (currentSubsystem) {
        qb.andWhere('(menu.subsystem IS NULL OR menu.subsystem = :subsystem)', {
          subsystem: currentSubsystem,
        });
      }
      const rows = await qb.orderBy('menu.sortOrder', 'ASC').getMany();
      return this.buildTree(rows);
    } catch (e: any) {
      this.logger.warn(`Failed to load menu from DB: ${e.message}`);
      return [];
    }
  }

  /**
   * Update the system menu (accepts a tree structure, flattened and upserted into the menus table)
   * Also deletes records in the menus table absent from the new data
   */
  async updateMenu(items: SystemMenuItem[]): Promise<void> {
    const flatRows = this.flattenTree(items);
    const ids = new Set(flatRows.map((r) => r.id));

    // manager.transaction() is not used: the sqlite3 driver under TypeORM transaction wrapping has a
    // known TransactionNotStartedError issue (commit/rollback on a not-yet-started transaction).
    // The delete + upsert pattern is idempotent by itself and SQLite writes are naturally serial; no explicit transaction is needed.

    // Delete old records absent from the new data
    await this.menuRepo
      .createQueryBuilder()
      .delete()
      .from(Menu)
      .where('id NOT IN (:...ids)', { ids: ids.size > 0 ? [...ids] : ['__none__'] })
      .execute();

    // Upsert each record
    for (const row of flatRows) {
      await this.menuRepo
        .createQueryBuilder()
        .insert()
        .into(Menu)
        .values(row)
        .orUpdate([
          'parent_id',
          'label_key',
          'path',
          'icon',
          'roles',
          'sort_order',
          'is_detail',
          'subsystem',
          'updated_at',
        ])
        .execute();
    }

    this.logger.log(`Menu updated: ${flatRows.length} items`);
  }

  /** Assemble flat rows into a tree structure */
  private buildTree(rows: Menu[]): SystemMenuItem[] {
    const map = new Map<string, SystemMenuItem>();
    const roots: SystemMenuItem[] = [];

    // First pass: create all nodes
    for (const row of rows) {
      const item: SystemMenuItem = {
        id: row.id,
        labelKey: row.labelKey,
        path: row.path,
        icon: row.icon,
        roles: row.roles,
        order: row.sortOrder,
        subsystem: row.subsystem,
      };
      map.set(row.id, item);
    }

    // Second pass: establish parent-child relations
    for (const row of rows) {
      const item = map.get(row.id)!;
      if (row.parentId && map.has(row.parentId)) {
        const parent = map.get(row.parentId)!;
        if (!parent.children) parent.children = [];
        parent.children.push(item);
      } else {
        roots.push(item);
      }
    }

    // Sort by order / sortOrder to guarantee display order
    roots.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const item of map.values()) {
      if (item.children && item.children.length > 1) {
        item.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      }
    }

    return roots;
  }

  /** Flatten the menu tree into DB rows */
  private flattenTree(items: SystemMenuItem[], parentId: string | null = null): Partial<Menu>[] {
    const result: Partial<Menu>[] = [];
    for (const item of items) {
      result.push({
        id: item.id,
        parentId,
        labelKey: item.labelKey,
        path: item.path,
        icon: item.icon,
        roles: item.roles || null,
        sortOrder: item.order ?? 0,
        isDetail: item.isDetail ? 1 : 0,
        subsystem: item.subsystem || null,
        updatedAt: new Date(),
      });
      if (item.children && item.children.length > 0) {
        result.push(...this.flattenTree(item.children, item.id));
      }
    }
    return result;
  }

  // ──────── Button permissions ────────

  /**
   * Get all menu buttons — DB as the single source of truth
   * @returns the button list from the DB; an empty array when the DB is empty
   */
  async getMenuButtons(): Promise<SystemMenuButton[]> {
    try {
      const rows = await this.buttonRepo.find({ order: { sortOrder: 'ASC' } });
      return rows.map((r) => ({
        id: r.id,
        menuId: r.menuId,
        labelKey: r.labelKey,
        permissionCode: r.permissionCode,
        sortOrder: r.sortOrder,
      }));
    } catch (e: any) {
      this.logger.warn(`Failed to load menu buttons from DB: ${e.message}`);
      return [];
    }
  }

  /** Get the buttons of a given menu */
  async getMenuButtonsByMenu(menuId: string): Promise<SystemMenuButton[]> {
    const all = await this.getMenuButtons();
    return all.filter((b) => b.menuId === menuId);
  }

  /** Update menu buttons */
  async updateMenuButtons(buttons: SystemMenuButton[]): Promise<void> {
    const ids = new Set(buttons.map((b) => b.id));

    // manager.transaction() is not used: the sqlite3 driver under TypeORM transaction wrapping has a
    // known TransactionNotStartedError issue (commit/rollback on a not-yet-started transaction).
    // The delete + upsert pattern is idempotent by itself and SQLite writes are naturally serial; no explicit transaction is needed.

    await this.buttonRepo
      .createQueryBuilder()
      .delete()
      .from(MenuButton)
      .where('id NOT IN (:...ids)', { ids: ids.size > 0 ? [...ids] : ['__none__'] })
      .execute();

    for (const btn of buttons) {
      await this.buttonRepo
        .createQueryBuilder()
        .insert()
        .into(MenuButton)
        .values({
          id: btn.id,
          menuId: btn.menuId,
          labelKey: btn.labelKey,
          permissionCode: btn.permissionCode,
          sortOrder: btn.sortOrder,
        })
        .orUpdate(['menu_id', 'label_key', 'permission_code', 'sort_order', 'updated_at'])
        .execute();
    }

    this.logger.log(`Menu buttons updated: ${buttons.length} items`);
  }

  /**
   * Sync default menus into the DB (called at startup)
   * - Empty table: write all of DEFAULT_SYSTEM_MENU
   * - Non-empty table: insert missing items + update fields of existing ones (parent_id, label_key, path, icon, roles, is_detail, subsystem)
   *   ensuring the DB always matches code defaults and old data never drifts.
   *   Note: sort_order is user-defined runtime data (adjustable on the menu management page) and is not synced;
   *   only newly inserted items use the code default order as the initial value, avoiding overwriting the user's ordering after a restart.
   */
  async syncDefaultMenus(): Promise<void> {
    try {
      const count = await this.menuRepo.count();
      if (count === 0) {
        // Empty table: full write
        await this.updateMenu(DEFAULT_SYSTEM_MENU);
        this.logger.log('Default menus initialized (empty DB)');
      } else {
        // Non-empty table: clean up renamed/deprecated legacy menu items
        await this.cleanupStaleMenuIds();
        // Insert missing + sync fields
        const synced = await this.upsertDefaultMenus(DEFAULT_SYSTEM_MENU);
        if (synced > 0) {
          this.logger.log(`Menus synced: ${synced} items inserted/updated`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to sync default menus: ${e.message}`);
    }
  }

  /**
   * Clean up known renamed/deprecated legacy menu item IDs (called during startup sync)
   * Avoids i18n key mismatches from stale IDs (e.g. audit-logs → operation-logs)
   */
  private async cleanupStaleMenuIds(): Promise<void> {
    const staleIds = [
      'audit-logs', // renamed to operation-logs
      'system-config', // deprecated: duplicates System Management > System Settings, replaced by settings-general
    ];
    for (const id of staleIds) {
      const existing = await this.menuRepo.findOne({ where: { id } });
      if (existing) {
        // Cascade-delete child nodes
        await this.menuRepo.delete({ parentId: id } as any);
        // Delete associated buttons
        await this.buttonRepo.delete({ menuId: id } as any);
        await this.menuRepo.delete(id);
        this.logger.log(`Cleaned up stale menu item: ${id}`);
      }
    }
  }

  /**
   * Recursively sync menu items: insert when absent, update fields when present
   * @returns the number of records inserted or updated
   */
  private async upsertDefaultMenus(
    items: SystemMenuItem[],
    parentId: string | null = null,
  ): Promise<number> {
    let synced = 0;
    for (const item of items) {
      const existing = await this.menuRepo.findOne({ where: { id: item.id } });
      const roles = item.roles || null;
      if (!existing) {
        // Insert new item
        await this.menuRepo
          .createQueryBuilder()
          .insert()
          .into(Menu)
          .values({
            id: item.id,
            parentId: parentId,
            labelKey: item.labelKey,
            path: item.path,
            icon: item.icon,
            roles,
            sortOrder: item.order ?? 0,
            isDetail: item.isDetail ? 1 : 0,
            subsystem: item.subsystem || null,
          })
          .orIgnore()
          .execute();
        synced++;
        this.logger.log(`Inserted missing menu item: ${item.id}`);
      } else {
        // Update fields of existing items (detecting whether anything changed)
        // Note: sortOrder is user-defined runtime data (draggable on the menu management page),
        // so startup sync must not overwrite the user's ordering; it is excluded from needsUpdate and the update set.
        // Only newly inserted items use item.order as the initial ordering (see the insert branch above).
        const needsUpdate =
          existing.parentId !== parentId ||
          existing.labelKey !== item.labelKey ||
          existing.path !== item.path ||
          existing.icon !== item.icon ||
          JSON.stringify(existing.roles) !== JSON.stringify(roles) ||
          existing.isDetail !== (item.isDetail ? 1 : 0) ||
          existing.subsystem !== (item.subsystem || null);
        if (needsUpdate) {
          await this.menuRepo
            .createQueryBuilder()
            .update(Menu)
            .set({
              parentId,
              labelKey: item.labelKey,
              path: item.path,
              icon: item.icon,
              roles,
              isDetail: item.isDetail ? 1 : 0,
              subsystem: item.subsystem || null,
              updatedAt: new Date(),
            })
            .where('id = :id', { id: item.id })
            .execute();
          synced++;
          this.logger.log(`Updated menu item: ${item.id}`);
        }
      }
      if (item.children && item.children.length > 0) {
        synced += await this.upsertDefaultMenus(item.children, item.id);
      }
    }
    return synced;
  }

  /**
   * Sync default buttons into the DB (called at startup)
   * - Empty table: full write
   * - Non-empty table: insert missing items + update fields of existing ones
   */
  async syncDefaultButtons(): Promise<void> {
    try {
      const count = await this.buttonRepo.count();
      if (count === 0) {
        await this.updateMenuButtons(DEFAULT_MENU_BUTTONS);
        this.logger.log('Default menu buttons initialized (empty DB)');
      } else {
        // Insert missing + sync
        let synced = 0;
        for (const btn of DEFAULT_MENU_BUTTONS) {
          const existing = await this.buttonRepo.findOne({ where: { id: btn.id } });
          if (!existing) {
            await this.buttonRepo
              .createQueryBuilder()
              .insert()
              .into(MenuButton)
              .values({
                id: btn.id,
                menuId: btn.menuId,
                labelKey: btn.labelKey,
                permissionCode: btn.permissionCode,
                sortOrder: btn.sortOrder,
              })
              .orIgnore()
              .execute();
            synced++;
          } else {
            const needsUpdate =
              existing.menuId !== btn.menuId ||
              existing.labelKey !== btn.labelKey ||
              existing.permissionCode !== btn.permissionCode ||
              existing.sortOrder !== btn.sortOrder;
            if (needsUpdate) {
              await this.buttonRepo
                .createQueryBuilder()
                .update(MenuButton)
                .set({
                  menuId: btn.menuId,
                  labelKey: btn.labelKey,
                  permissionCode: btn.permissionCode,
                  sortOrder: btn.sortOrder,
                  updatedAt: new Date(),
                })
                .where('id = :id', { id: btn.id })
                .execute();
              synced++;
            }
          }
        }
        if (synced > 0) {
          this.logger.log(`Menu buttons synced: ${synced} items inserted/updated`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to sync default buttons: ${e.message}`);
    }
  }

  // ──────── Single-item CRUD ────────

  /** Create a single menu item */
  async createMenuItem(item: SystemMenuItem, parentId?: string | null): Promise<Menu> {
    const entity = this.menuRepo.create({
      id: item.id,
      parentId: parentId || null,
      labelKey: item.labelKey,
      path: item.path,
      icon: item.icon,
      roles: item.roles || null,
      sortOrder: item.order ?? 0,
      isDetail: item.isDetail ? 1 : 0,
      subsystem: item.subsystem || null,
    });
    return this.menuRepo.save(entity);
  }

  /** Update a single menu item */
  async updateMenuItem(id: string, item: SystemMenuItem, parentId?: string | null): Promise<Menu> {
    const existing = await this.menuRepo.findOne({ where: { id } });
    if (!existing) {
      throw new Error(`菜单项不存在: ${id}`);
    }
    // Update fields
    if (parentId !== undefined) existing.parentId = parentId;
    existing.labelKey = item.labelKey;
    existing.path = item.path;
    existing.icon = item.icon;
    existing.roles = item.roles || null;
    existing.sortOrder = item.order ?? 0;
    existing.isDetail = item.isDetail ? 1 : 0;
    existing.subsystem = item.subsystem || null;
    existing.updatedAt = new Date();
    return this.menuRepo.save(existing);
  }

  /** Delete a single menu item (with cascading child deletion) */
  async deleteMenuItem(id: string): Promise<void> {
    // Cascade-delete all child nodes
    const children = await this.menuRepo.find({ where: { parentId: id } });
    for (const child of children) {
      await this.deleteMenuItem(child.id);
    }
    // Delete associated buttons
    await this.buttonRepo.delete({ menuId: id } as any);
    await this.menuRepo.delete(id);
    this.logger.log(`Menu item deleted: ${id}`);
  }

  /** Create a single menu button */
  async createMenuButton(btn: SystemMenuButton): Promise<MenuButton> {
    const entity = this.buttonRepo.create({
      id: btn.id,
      menuId: btn.menuId,
      labelKey: btn.labelKey,
      permissionCode: btn.permissionCode,
      sortOrder: btn.sortOrder,
    });
    return this.buttonRepo.save(entity);
  }

  /** Delete a single menu button */
  async deleteMenuButton(id: string): Promise<void> {
    await this.buttonRepo.delete(id);
    this.logger.log(`Menu button deleted: ${id}`);
  }

  // ──────── Permission code registry (v8.0) ────────

  /**
   * Get the permission code registry
   *
   * Data sources:
   * 1. Permission code list → sys_menu_buttons.permission_code (real runtime data)
   * 2. Categories and labels → PERMISSION_CATEGORIES (imported from @ss-node/ss-core, UI metadata only)
   * 3. Permission codes not matching a category are grouped under "uncategorized"
   *
   * Replaces the frontend's hard-coded ROLE_PERMISSIONS and PERMISSION_CATEGORIES.
   */
  async getPermissionsRegistry(): Promise<{
    categories: { module: string; label: string; codes: { code: string; label: string }[] }[];
  }> {
    // Dynamic import avoids a module-level circular dependency ss-system → ss-core (the @Injectable level is safe)
    const { PERMISSION_CATEGORIES } = await import('@ss-node/ss-core');

    // Aggregate and deduplicate permission codes from sys_menu_buttons
    let allCodes: { code: string; label: string }[] = [];
    try {
      const rows: { permission_code: string }[] = await this.menuRepo.manager.query(
        `SELECT DISTINCT permission_code FROM sys_menu_buttons WHERE permission_code IS NOT NULL AND permission_code != ''`,
      );
      allCodes = rows.map((r) => ({ code: r.permission_code, label: r.permission_code }));
    } catch {
      this.logger.warn('Failed to query sys_menu_buttons for permission codes');
    }

    // Match a category for each permission code
    const codeToCategory = new Map<string, string>();
    for (const cat of PERMISSION_CATEGORIES) {
      for (const code of cat.codes) {
        codeToCategory.set(code, cat.module);
      }
    }

    // Group by category
    const categoryMap = new Map<string, { module: string; label: string; codes: { code: string; label: string }[] }>();
    const unmatched: { code: string; label: string }[] = [];

    for (const item of allCodes) {
      const module = codeToCategory.get(item.code);
      if (module) {
        const cat = categoryMap.get(module);
        if (cat) {
          cat.codes.push(item);
        } else {
          const catDef = PERMISSION_CATEGORIES.find((c) => c.module === module)!;
          categoryMap.set(module, {
            module,
            label: catDef.label,
            codes: [item],
          });
        }
      } else {
        unmatched.push(item);
      }
    }

    const categories = [...categoryMap.values()];
    // Add categories defined in PERMISSION_CATEGORIES but absent from sys_menu_buttons (empty codes)
    for (const catDef of PERMISSION_CATEGORIES) {
      if (!categoryMap.has(catDef.module)) {
        categories.push({
          module: catDef.module,
          label: catDef.label,
          codes: [],
        });
      }
    }
    if (unmatched.length > 0) {
      categories.push({ module: 'other', label: '未分类', codes: unmatched });
    }

    return { categories };
  }
}
