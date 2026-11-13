// bin/publish-smart-site/data.cjs — 数据打包：copyDataDir / 数据库瘦身 / reset-admin / base_services / node 运行时
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, RUN_SS,
    SS_NODE,
    opt,
    C,
    info,
    fail,
    mirror,
    ensureDir,
    rmDirWithRetry,
    DATA_EXCLUDE_DIRS,
    DATA_USER_DIRS,
    DATA_EXCLUDE_FILES,
    wildcardToRegExp,
    A05_EXCLUDE_DIR_PATTERNS,
    A05_EXCLUDE_FILE_PATTERNS,
    BASE_SERVICE_ITEMS,
    BASE_SERVICE_EXCLUDE_DIRS,
    BASE_SERVICE_EXCLUDE_FILES,
    run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

/**
 * A05 剪枝：删除包内 data/ 中命中复刻证据模式的目录/文件（任意层级，按名称匹配）。
 * 与 /XD /XF 互补——robocopy 对中文 glob / 嵌套路径语义不稳定，这里做确定性兜底。
 * 只作用于发布包副本，源数据 ss-run/ss/data 不动。
 */
function pruneRiskPaths(rootDir) {
  const dirMatchers = A05_EXCLUDE_DIR_PATTERNS.map(wildcardToRegExp);
  const fileMatchers = A05_EXCLUDE_FILE_PATTERNS.map(wildcardToRegExp);
  let removedDirs = 0;
  let removedFiles = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (dirMatchers.some((re) => re.test(e.name))) {
          if (rmDirWithRetry(full, 2)) removedDirs++;
          continue;
        }
        walk(full);
      } else if (e.isFile() && fileMatchers.some((re) => re.test(e.name))) {
        try { fs.unlinkSync(full); removedFiles++; } catch { /* 交由合规扫描兜底 */ }
      }
    }
  };
  walk(rootDir);
  info(C.dim(`A05 pruning: removed ${removedDirs} dirs / ${removedFiles} files (replica evidence paths)`));
}

/**
 * 把 ss-run/ss/data 复制进包（--with-data）。
 *
 * 复制规则：整目录镜像，排除运行期目录与 WAL/日志（见文件头 5)）；
 * --no-user-data 时额外排除 db/ projects/ plugin-configs/ graphic-plugins/。
 */
function copyDataDir(dst) {
  const src = path.join(RUN_SS, 'data');
  if (!fs.existsSync(src)) fail(`Data directory does not exist: ${src}`);
  const excludeDirs = [...DATA_EXCLUDE_DIRS];
  if (!opt.userData) excludeDirs.push(...DATA_USER_DIRS);
  // --data-exclude=<a,b>：额外排除（典型用法：images,images-lg,projects 瘦身交付）
  for (const name of opt.dataExclude) {
    if (!excludeDirs.includes(name)) excludeDirs.push(name);
    const probe = path.join(src, name);
    if (!fs.existsSync(probe)) {
      info(C.warn(`--data-exclude ${name}/ not found in source data directory (check spelling)`));
    }
  }
  if (fs.existsSync(dst)) {
    // 先清空再镜像：避免上次打包的残留（尤其是 --no-user-data / --data-exclude 时的旧目录；
    // ⚠️ robocopy /MIR 不会删除被 /XD 排除掉的旧目录，所以这一步不能省）
    info(C.dim('Clearing target data/ before copying (avoid leftovers from previous packaging)'));
    if (!rmDirWithRetry(dst)) {
      fail(
        `Cannot clear target data directory (in use or insufficient permissions): ${dst}\n  Action: stop the process using it (stop.bat / Task Manager), or repackage with --clean.`,
      );
    }
  }
  const t0 = Date.now();
  mirror(src, dst, { excludeDirs, excludeFiles: DATA_EXCLUDE_FILES });
  pruneRiskPaths(dst); // A05：确定性剪枝（任意层级按名称匹配，不依赖 robocopy glob）
  info(
    `data ← ${path.relative(ROOT, src)} (${opt.userData ? 'including user data db/ projects/ etc.' : 'code assets only'}, ` +
      `elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
  );
  info(C.dim(`Excluded dirs: ${excludeDirs.join(' / ')}; excluded files: ${DATA_EXCLUDE_FILES.join(' / ')}`));
  const seedDb = path.join(dst, 'db', 'ss-node.db');
  if (fs.existsSync(seedDb)) {
    info(C.ok('✓ Global DB data/db/ss-node.db included (live data)'));
  } else {
    info(C.warn('! data/db/ss-node.db not included => target will create the DB and run migrations on first start'));
  }
  if (!fs.existsSync(path.join(dst, 'init'))) {
    info(C.warn('! data/init (SQL init scripts) missing => project DB init may fail, check the data source'));
  }
}

/**
 * 解析原生/依赖模块的可 require 完整路径（按模块独立解析）。
 * 本机 pnpm 隔离布局：node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>，
 * bcryptjs 与 sqlite3 分属不同 .pnpm 目录 ⇒ 不能返回单一目录，须返回 { 模块名: 完整路径 }。
 * 全部模块解析成功才返回对象；任一失败返回 null。
 */
function resolveModulePaths(needs) {
  const candidates = [
    path.join(SS_NODE, 'apps', 'ss-node-server', 'node_modules'),
    path.join(SS_NODE, 'node_modules'),
  ];
  const pnpmDir = path.join(SS_NODE, 'node_modules', '.pnpm');
  const out = {};
  for (const m of needs) {
    let found = null;
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, m))) { found = path.join(c, m); break; }
    }
    if (!found && fs.existsSync(pnpmDir)) {
      const dir = fs
        .readdirSync(pnpmDir)
        .filter((d) => d.startsWith(m + '@'))
        .sort()
        .pop();
      const p = dir && path.join(pnpmDir, dir, 'node_modules', m);
      if (p && fs.existsSync(p)) found = p;
    }
    if (!found) return null;
    out[m] = found;
  }
  return out;
}

/** 递归收集 data 目录下的 .db/.sqlite 文件（限深 4 层，跳过 -wal/-shm） */
function collectDbFiles(rootDir, maxDepth = 4) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(db|sqlite|sqlite3)$/i.test(e.name)) files.push(p);
    }
  };
  walk(rootDir, 0);
  return files;
}

/**
 * 数据库瘦身（--with-data 默认执行，--no-db-clean 关闭）：对**包内 data 副本**操作，
 * 清空 DB_PURGE_TABLES 中的表（存在才清）、复位 sqlite_sequence 高水位、
 * WAL checkpoint + VACUUM 收缩文件并删除残留 WAL/SHM。ss-run 源库不动。
 * 单库失败仅告警不中断发布。
 */
function purgeDataDatabases(pkgDataDir) {
  // 数据库瘦身目标表（参照 v7：运行期累积的事件/日志/审计/AI 会话/报警记录）
  const DB_PURGE_TABLES = [
    // ── 事件 / 操作 / 审计日志（全局库）──
    'evt_event_log',
    'sys_operation_logs',
    'sys_error_logs',
    'sys_audit_logs',
    'sys_permission_audit_logs',
    'sys_backup_logs',
    'sys_ai_messages',
    'sys_ai_conversations',
    'sys_ai_usage_logs',
    'prj_script_audit',
    'prj_script_executions',
    // ── 运行记录（全局库同位表）──
    'dev_device_status_log',
    // ── 报警记录（体积最大）──
    'alm_alarm_records',
  ];
  if (!fs.existsSync(pkgDataDir)) {
    info(C.warn('! Skipping database purge: in-package data/ missing'));
    return;
  }
  const modPaths = resolveModulePaths(['sqlite3']);
  if (!modPaths) {
    info(C.warn('! Skipping database purge: sqlite3 module not found (check ss-services/ss-node dependency install)'));
    return;
  }
  const dbFiles = collectDbFiles(pkgDataDir);
  if (!dbFiles.length) {
    info(C.dim('Database purge: no .db files found, skipping'));
    return;
  }
  const childScript = [
    'const path=require("path"), fs=require("fs");',
    'const [sqlite3Path,tablesJson,filesJson]=process.argv.slice(1);',
    'const sqlite3=require(sqlite3Path);',
    'const tables=JSON.parse(tablesJson), files=JSON.parse(filesJson);',
    'const openDb=(f)=>new Promise((res,rej)=>{const db=new sqlite3.Database(f,(e)=>e?rej(e):res(db));});',
    'const all=(db,sql)=>new Promise((res,rej)=>db.all(sql,[],(e,r)=>e?rej(e):res(r)));',
    'const run=(db,sql)=>new Promise((res,rej)=>db.run(sql,function(e){e?rej(e):res(this);}));',
    'const exec=(db,sql)=>new Promise((res,rej)=>db.exec(sql,(e)=>e?rej(e):res()));',
    'const close=(db)=>new Promise((res)=>{try{db.close(()=>res());}catch(e){res();}});',
    '(async()=>{',
    '  const out=[];',
    '  for(const f of files){',
    '    const before=(()=>{try{return fs.statSync(f).size;}catch(e){return 0;}})();',
    '    let db=null;',
    '    try{',
    '      db=await openDb(f);',
    '      await exec(db,"PRAGMA busy_timeout=10000");',
    '      const master=await all(db,"SELECT name FROM sqlite_master WHERE type=\'table\'");',
    '      const exists=new Set(master.map((r)=>r.name));',
    '      const targets=tables.filter((t)=>exists.has(t));',
    '      let deleted=0;',
    '      for(const t of targets){',
    '        const r=await run(db,"DELETE FROM "+t);',
    '        deleted+=r.changes||0;',
    '      }',
    '      if(exists.has("sqlite_sequence")){',
    '        const list=targets.map((t)=>"\'"+t.replace(/\'/g,"\'\'")+"\'").join(",");',
    '        if(list) await exec(db,"DELETE FROM sqlite_sequence WHERE name IN ("+list+")");',
    '      }',
    '      await exec(db,"PRAGMA wal_checkpoint(TRUNCATE)").catch(()=>{});',
    '      await exec(db,"VACUUM");',
    '      await close(db); db=null;',
    '      for(const suf of ["-wal","-shm","-journal"]){try{fs.rmSync(f+suf,{force:true});}catch(e){}}',
    '      const after=(()=>{try{return fs.statSync(f).size;}catch(e){return 0;}})();',
    '      out.push({file:f,purged:targets.length,deleted,before,after});',
    '    }catch(e){',
    '      if(db) await close(db);',
    '      out.push({file:f,error:e.message});',
    '    }',
    '  }',
    '  process.stdout.write(JSON.stringify(out));',
    '  process.exit(0);',
    '})();',
  ].join('\n');
  const r = cp.spawnSync(
    process.execPath,
    ['-e', childScript, modPaths.sqlite3, JSON.stringify(DB_PURGE_TABLES), JSON.stringify(dbFiles)],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    info(C.warn(`! Database purge failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 500)}`));
    return;
  }
  let results;
  try {
    results = JSON.parse(r.stdout);
  } catch {
    info(C.warn(`! Cannot parse database purge output: ${(r.stdout || '').slice(0, 300)}`));
    return;
  }
  const mb = (n) => (n / 1048576).toFixed(2);
  let totalBefore = 0;
  let totalAfter = 0;
  let totalDeleted = 0;
  for (const item of results) {
    const rel = path.relative(path.dirname(pkgDataDir), item.file);
    if (item.error) {
      info(C.warn(`  ✗ ${rel}：${item.error}`));
      continue;
    }
    totalBefore += item.before;
    totalAfter += item.after;
    totalDeleted += item.deleted;
    info(
      `  ✓ ${rel}: purged ${item.purged} tables / deleted ${item.deleted} rows / ` +
        `${mb(item.before)} MB → ${mb(item.after)} MB`,
    );
  }
  if (totalBefore > 0) {
    info(
      C.ok(`Database purge complete: ${totalDeleted} rows deleted, ${mb(totalBefore)} MB -> ${mb(totalAfter)} MB`),
    );
  }
}

/**
 * 重置包内全局库默认账号密码（--reset-admin[=user:password]，默认 admin:admin）。
 *
 * 背景：--with-data 的包内 data/db/ss-node.db 是现网副本，admin 密码与打包机一致；
 * 交付包要求默认账号固定为已知密码（admin/admin），且每次打包都生效。
 * bcryptjs 10 轮（与 ss-system setup.service 同算法）+ sqlite3 直改 sys_users；
 * 以子进程执行（主流程同步，sqlite3 为异步 API）。用户不存在时报错终止（拼写检查）。
 */
function resetAdminPassword(pkgDataDir, resetAdminSpec) {
  const [username, password] = String(resetAdminSpec).split(':');
  const dbFile = path.join(pkgDataDir, 'db', 'ss-node.db');
  if (!fs.existsSync(dbFile)) {
    info(C.warn('! Skipping --reset-admin: in-package data/db/ss-node.db missing (a --no-user-data package creates the admin via the setup wizard on first start)'));
    return;
  }
  const modPaths = resolveModulePaths(['bcryptjs', 'sqlite3']);
  if (!modPaths) fail('--reset-admin failed: bcryptjs/sqlite3 modules not found (check ss-services/ss-node dependency install)');
  const childScript = [
    'const [dbFile,username,password,bcryptPath,sqlite3Path]=process.argv.slice(1);',
    'const bcrypt=require(bcryptPath);',
    'const sqlite3=require(sqlite3Path);',
    'const hash=bcrypt.hashSync(password,10);',
    'const db=new sqlite3.Database(dbFile);',
    'db.serialize(()=>{',
    '  db.run("PRAGMA busy_timeout=5000");',
    '  db.run("UPDATE sys_users SET password=?, isActive=1, updatedAt=datetime(\'now\') WHERE username=?",[hash,username],function(err){',
    '    if(err){console.error("[reset-admin] UPDATE failed: "+err.message);process.exit(1);}',
    '    if(this.changes===0){console.error(\'[reset-admin] user "\'+username+\'" not found in sys_users\');process.exit(2);}',
    '    console.log("[reset-admin] ok: "+username+" / password reset ("+this.changes+" row)");',
    '    db.close(()=>process.exit(0));',
    '  });',
    '});',
  ].join('\n');
  const r = cp.spawnSync(
    process.execPath,
    ['-e', childScript, dbFile, username, password, modPaths.bcryptjs, modPaths.sqlite3],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    fail(`--reset-admin failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
  }
  info(r.stdout.trim());
}

/**
 * 把 base_services/{redis,influxdb2-2.7.8} 复制进包（--with-services）。
 *
 * 说明：influxd 的落盘路径由 config.yaml 的 `engine-path: ../../rtdb/influxdb2/...`（基准 =
 * influxd.exe 所在目录）决定 ⇒ 在包内自动落到 <pkg>/rtdb/influxdb2，与 .env 的
 * INFLUXDB_DATA_DIR 一致，故无需改配置（见 docs/00-全局/发布/单包发布方案.md §6.4）。
 */
function copyBaseServices(dstRoot) {
  const srcRoot = path.join(RUN_SS, 'base_services');
  if (!fs.existsSync(srcRoot)) fail(`Base services directory does not exist: ${srcRoot}`);
  for (const name of BASE_SERVICE_ITEMS) {
    const src = path.join(srcRoot, name);
    if (!fs.existsSync(src)) {
      info(C.warn(`${path.relative(ROOT, src)} not found, skipping`));
      continue;
    }
    const dst = path.join(dstRoot, name);
    if (fs.existsSync(dst) && !rmDirWithRetry(dst)) {
      fail(`Cannot clear ${dst} (in use or insufficient permissions): stop the base service first (end redis-server.exe / influxd.exe in Task Manager)`);
    }
    mirror(src, dst, {
      excludeDirs: BASE_SERVICE_EXCLUDE_DIRS,
      excludeFiles: BASE_SERVICE_EXCLUDE_FILES,
    });
    info(`base_services/${name} ← ${path.relative(ROOT, src)}`);
  }
  const redisExe = path.join(dstRoot, 'redis', 'redis-server.exe');
  const influxdExe = path.join(dstRoot, 'influxdb2-2.7.8', 'influxd.exe');
  if (fs.existsSync(redisExe)) info(C.ok('✓ base_services/redis/redis-server.exe'));
  if (fs.existsSync(influxdExe)) info(C.ok('✓ base_services/influxdb2-2.7.8/influxd.exe'));
}

/**
 * 随包 Node（--with-node）：把**打包器自身正在使用的** node.exe 复制到 <pkg>/node。
 * 之所以用 process.execPath：这样包内 node 与产出 node_modules 原生模块
 * （sqlite3 / isolated-vm）的运行时完全一致，规避 ABI 不匹配（见 §11 坑 1）。
 */
function copyNodeRuntime(dst) {
  const src = process.execPath;
  if (!fs.existsSync(src)) fail(`node executable not found: ${src}`);
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  ensureDir(dst);
  fs.copyFileSync(src, path.join(dst, 'node.exe'));
  const sizeMb = (fs.statSync(src).size / 1048576).toFixed(1);
  info(`node ← ${src}（${process.version}, ${sizeMb} MB）`);
  info(C.dim('start.bat / service-run.bat prefer node\\node.exe automatically (no Node install needed on target)'));
}


  return {
    copyDataDir,
    pruneRiskPaths,
    purgeDataDatabases,
    resetAdminPassword,
    copyBaseServices,
    copyNodeRuntime,
  };
};
