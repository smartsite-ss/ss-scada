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
    BASE_SERVICE_ITEMS,
    BASE_SERVICE_EXCLUDE_DIRS,
    BASE_SERVICE_EXCLUDE_FILES,
    run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

/**
 * 把 ss-run/ss/data 复制进包（--with-data）。
 *
 * 复制规则：整目录镜像，排除运行期目录与 WAL/日志（见文件头 5)）；
 * --no-user-data 时额外排除 db/ projects/ plugin-configs/ graphic-plugins/。
 */
function copyDataDir(dst) {
  const src = path.join(RUN_SS, 'data');
  if (!fs.existsSync(src)) fail(`数据目录不存在: ${src}`);
  const excludeDirs = [...DATA_EXCLUDE_DIRS];
  if (!opt.userData) excludeDirs.push(...DATA_USER_DIRS);
  // --data-exclude=<a,b>：额外排除（典型用法：images,images-lg,projects 瘦身交付）
  for (const name of opt.dataExclude) {
    if (!excludeDirs.includes(name)) excludeDirs.push(name);
    const probe = path.join(src, name);
    if (!fs.existsSync(probe)) {
      info(C.warn(`--data-exclude 指定的 ${name}/ 在源数据目录中不存在（拼写检查）`));
    }
  }
  if (fs.existsSync(dst)) {
    // 先清空再镜像：避免上次打包的残留（尤其是 --no-user-data / --data-exclude 时的旧目录；
    // ⚠️ robocopy /MIR 不会删除被 /XD 排除掉的旧目录，所以这一步不能省）
    info(C.dim('清空目标 data/ 后重新复制（避免上次打包残留）'));
    if (!rmDirWithRetry(dst)) {
      fail(
        `无法清空目标数据目录（被占用或权限不足）：${dst}\n  处理：先停掉正在使用该目录的进程（stop.bat / 任务管理器），或改用 --clean 重新打包。`,
      );
    }
  }
  const t0 = Date.now();
  mirror(src, dst, { excludeDirs, excludeFiles: DATA_EXCLUDE_FILES });
  info(
    `data ← ${path.relative(ROOT, src)}（${opt.userData ? '含用户数据 db/ projects/ 等' : '仅代码资产'}，` +
      `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`,
  );
  info(C.dim(`排除目录：${excludeDirs.join(' / ')}；排除文件：${DATA_EXCLUDE_FILES.join(' / ')}`));
  const seedDb = path.join(dst, 'db', 'ss-node.db');
  if (fs.existsSync(seedDb)) {
    info(C.ok('✓ 含全局库 data/db/ss-node.db（现网数据）'));
  } else {
    info(C.warn('! 未含 data/db/ss-node.db ⇒ 目标机首次启动将自动建库并执行迁移'));
  }
  if (!fs.existsSync(path.join(dst, 'init'))) {
    info(C.warn('! 未找到 data/init（SQL 初始化脚本）⇒ 项目库初始化可能失败，请检查数据源'));
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
    info(C.warn('! 跳过数据库瘦身：包内 data/ 不存在'));
    return;
  }
  const modPaths = resolveModulePaths(['sqlite3']);
  if (!modPaths) {
    info(C.warn('! 跳过数据库瘦身：找不到 sqlite3 模块（检查 ss-services/ss-node 依赖安装）'));
    return;
  }
  const dbFiles = collectDbFiles(pkgDataDir);
  if (!dbFiles.length) {
    info(C.dim('数据库瘦身：未发现 .db 文件，跳过'));
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
    info(C.warn(`! 数据库瘦身失败（exit ${r.status}）：${(r.stderr || r.stdout || '').trim().slice(0, 500)}`));
    return;
  }
  let results;
  try {
    results = JSON.parse(r.stdout);
  } catch {
    info(C.warn(`! 数据库瘦身输出无法解析：${(r.stdout || '').slice(0, 300)}`));
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
      `  ✓ ${rel}：清空 ${item.purged} 表 / 删 ${item.deleted} 行 / ` +
        `${mb(item.before)} MB → ${mb(item.after)} MB`,
    );
  }
  if (totalBefore > 0) {
    info(
      C.ok(`数据库瘦身完成：共删 ${totalDeleted} 行，${mb(totalBefore)} MB → ${mb(totalAfter)} MB`),
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
    info(C.warn('! 跳过 --reset-admin：包内不存在 data/db/ss-node.db（--no-user-data 包首启走 setup 向导建管理员）'));
    return;
  }
  const modPaths = resolveModulePaths(['bcryptjs', 'sqlite3']);
  if (!modPaths) fail('--reset-admin 失败：找不到 bcryptjs/sqlite3 模块（检查 ss-services/ss-node 依赖安装）');
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
    fail(`--reset-admin 失败（exit ${r.status}）：${(r.stderr || r.stdout || '').trim()}`);
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
  if (!fs.existsSync(srcRoot)) fail(`基础服务目录不存在: ${srcRoot}`);
  for (const name of BASE_SERVICE_ITEMS) {
    const src = path.join(srcRoot, name);
    if (!fs.existsSync(src)) {
      info(C.warn(`未找到 ${path.relative(ROOT, src)}，跳过`));
      continue;
    }
    const dst = path.join(dstRoot, name);
    if (fs.existsSync(dst) && !rmDirWithRetry(dst)) {
      fail(`无法清空 ${dst}（被占用或权限不足）：请先停止该基础服务（任务管理器里结束 redis-server.exe / influxd.exe）`);
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
  if (!fs.existsSync(src)) fail(`未找到 node 可执行文件: ${src}`);
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  ensureDir(dst);
  fs.copyFileSync(src, path.join(dst, 'node.exe'));
  const sizeMb = (fs.statSync(src).size / 1048576).toFixed(1);
  info(`node ← ${src}（${process.version}, ${sizeMb} MB）`);
  info(C.dim('start.bat / service-run.bat 会自动优先使用 node\\node.exe（目标机免装 Node）'));
}


  return {
    copyDataDir,
    purgeDataDatabases,
    resetAdminPassword,
    copyBaseServices,
    copyNodeRuntime,
  };
};
