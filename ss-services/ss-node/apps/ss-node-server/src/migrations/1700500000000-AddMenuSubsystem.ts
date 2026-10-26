// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddMenuSubsystem1700500000000 implements MigrationInterface {
  name = 'AddMenuSubsystem1700500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 幂等防御（与 v7 对齐）：sys_menus 可能尚未创建（fresh DB 时由 EnsureGlobalSchema 兜底建表），
    // 表缺失时跳过列/索引变更，避免 "Table sys_menus does not exist" 中断启动迁移链
    const menusTable = await queryRunner.getTable('sys_menus');

    if (menusTable && !menusTable.findColumnByName('subsystem')) {
      await queryRunner.addColumn(
        'sys_menus',
        new TableColumn({
          name: 'subsystem',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      );
    }

    if (menusTable && !menusTable.indices.some((index) => index.name === 'idx_sys_menus_subsystem')) {
      await queryRunner.createIndex(
        'sys_menus',
        new TableIndex({
          name: 'idx_sys_menus_subsystem',
          columnNames: ['subsystem'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('sys_menus', 'idx_sys_menus_subsystem');
    await queryRunner.dropColumn('sys_menus', 'subsystem');
  }
}
