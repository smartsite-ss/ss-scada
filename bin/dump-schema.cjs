// 从 dev 全局库 dump 建表/索引 DDL，生成 InitialSchema 与 EnsureGlobalSchema 迁移
// 输出1：1700000000000-InitialSchema.ts —— 全量权威 schema（表+索引，IF NOT EXISTS）
// 输出2：1701200000000-EnsureGlobalSchema.ts —— 兜底建表（与 InitialSchema 内容一致，双保险）
const path = require('path');
const fs = require('fs');
const sqlite3 = require(
  'f:/work/smartdata/202603_trace/trunk/code/ss-scada/ss-services/ss-node/node_modules/.pnpm/sqlite3@6.0.1/node_modules/sqlite3',
);

const DEV_DB = path.resolve('ss-run', 'ss', 'data', 'db', 'ss-node.db');
const MIG_DIR = path.resolve(
  'ss-services', 'ss-node', 'apps', 'ss-node-server', 'src', 'migrations',
);
const OUT_INITIAL = path.join(MIG_DIR, '1700000000000-InitialSchema.ts');
const OUT = path.join(MIG_DIR, '1701200000000-EnsureGlobalSchema.ts');

const HEADER = [
  '// Copyright (c) 2025 Smart Site Team',
  '// https://smartsite.top/',
  '// Contact: zkxxa@qq.com, zcwebms@gmail.com',
  '',
  "import { MigrationInterface, QueryRunner } from 'typeorm';",
  '',
];

function buildClass({ className, docLines, downLines }) {
  const lines = [...HEADER];
  lines.push('/**');
  for (const d of docLines) lines.push(' * ' + d);
  lines.push(' */');
  lines.push(`export class ${className} implements MigrationInterface {`);
  lines.push(`  name = '${className}';`);
  lines.push('');
  lines.push('  public async up(queryRunner: QueryRunner): Promise<void> {');
  lines.push('    // __UP_BODY__');
  lines.push('  }');
  lines.push('');
  lines.push('  public async down(): Promise<void> {');
  for (const d of downLines) lines.push('    ' + d);
  lines.push('  }');
  lines.push('}');
  return lines;
}

const db = new sqlite3.Database(DEV_DB, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('open fail:', err.message);
    process.exit(1);
  }
  db.all(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'migrations'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
    (err, rows) => {
      if (err) {
        console.error('query fail:', err.message);
        process.exit(1);
      }
      const tables = rows.filter((r) => r.type === 'table');
      const indexes = rows.filter((r) => r.type === 'index' && !r.sql.startsWith('CREATE UNIQUE AUTOINDEX'));

      const body = [];
      for (const t of tables) {
        const sql = t.sql.replace(/CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS').replace(/`/g, '\\`');
        body.push('    await queryRunner.query(`' + sql + '`);');
      }
      for (const idx of indexes) {
        const sql = idx.sql
          .replace(/CREATE UNIQUE INDEX/, 'CREATE UNIQUE INDEX IF NOT EXISTS')
          .replace(/CREATE INDEX/, 'CREATE INDEX IF NOT EXISTS')
          .replace(/`/g, '\\`');
        body.push('    await queryRunner.query(`' + sql + '`);');
      }
      const bodyText = body.join('\r\n');

      const initialLines = buildClass({
        className: 'InitialSchema1700000000000',
        docLines: [
          ' 初始建表：以 dev 全局库（synchronize 长期演进的权威 schema）为基准 dump 全量 DDL。',
          ' *',
          ' * 背景：历史 InitialSchema 手写的表形状落后于当前实体（列名两代命名并存），',
          ' * 生产空库首启时后续迁移/服务查询崩溃（no such column / no such table）。',
          ' * 全部使用 IF NOT EXISTS，天然幂等；对已有库零影响（不写入任何数据）。',
          ' * 生成方式：ss-run/dump-schema.cjs 从 ss-run/ss/data/db/ss-node.db 导出。',
        ],
        downLines: ['// 初始建表不做回滚（保留用户数据）'],
      });
      const initialText = initialLines
        .join('\r\n')
        .replace('    // __UP_BODY__', bodyText);
      fs.writeFileSync(OUT_INITIAL, initialText + '\r\n', 'utf8');
      console.log('written:', OUT_INITIAL);

      const ensureLines = buildClass({
        className: 'EnsureGlobalSchema1701200000000',
        docLines: [
          ' 兜底建表：补齐 migrations 未覆盖的全局库表/索引。',
          ' *',
          ' * 与 InitialSchema 内容一致（同源 dump），作为双保险：即使未来新增迁移',
          ' * 未跑或部分失败，服务启动时也能保证全部表/索引存在。',
          ' * 全部使用 IF NOT EXISTS，天然幂等；对已有库零影响。',
        ],
        downLines: ['// 兜底建表不做回滚（保留用户数据）'],
      });
      const ensureText = ensureLines
        .join('\r\n')
        .replace('    // __UP_BODY__', bodyText);
      fs.writeFileSync(OUT, ensureText + '\r\n', 'utf8');
      console.log('written:', OUT);

      console.log('tables:', tables.length, 'indexes:', indexes.length);
      db.close();
      process.exit(0);
    },
  );
});
