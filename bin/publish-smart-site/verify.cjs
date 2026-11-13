// bin/publish-smart-site/verify.cjs — [9] 步骤：产物完整性校验（关键文件 / 模块图门禁），返回未通过数
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, opt, TOTAL, C, step, info, fail,
    run 
  } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function runVerifyStep() {
    const { T, pkg, builtAt, inherited } = ctx;
// ── [9] 校验与摘要 ────────────────────────────────────────────
step(9, TOTAL, 'Verifying artifacts');
const checks = [
  ['dist/main.js', '后端入口'],
  ['node_modules', '生产依赖'],
  ['i18n', '国际化资源'],
  ['web/index.html', '前端入口'],
  ['.env', '运行时配置'],
  opt.launcher === 'exe'
    ? ['start.bat', '启动脚本（薄启动器 exe）']
    : ['start.bat', '启动脚本'],
  ['self-test.bat', '目标机自检脚本'],
];
if (opt.launcher === 'exe') {
  checks.push(['SmartSite.exe', '薄启动器可执行文件']);
  checks.push(['start-node.bat', 'node 形态启动脚本（排障用）']);
}
if (opt.withData) {
  checks.push(['data/init', '数据资产（init SQL）']);
  checks.push(['data/dicts', '数据资产（字典）']);
  if (opt.userData) checks.push(['data/db/ss-node.db', '全局库（含现网数据）']);
}
if (opt.withServices) {
  checks.push(['base_services/redis/redis-server.exe', 'Redis 二进制']);
  checks.push(['base_services/influxdb2-2.7.8/influxd.exe', 'InfluxDB 二进制']);
  checks.push(['base_services/influxdb2-2.7.8/config.yaml', 'InfluxDB 配置（engine-path → ../../rtdb）']);
  checks.push(['base_services/nanomq/bin/nanomq.exe', 'NanoMQ 二进制']);
  checks.push(['base_services/nanomq/config/nanomq.conf', 'NanoMQ 配置']);
  checks.push(['rtdb/influxdb2', '时序数据落点（空目录）']);
  checks.push(['_start-services.bat', '基础服务引导脚本']);
  checks.push(['init-influxdb.bat', 'InfluxDB 一次性初始化脚本']);
}
if (opt.withNode) checks.push(['node/node.exe', `随包 Node（${process.version}）`]);
if (opt.service) {
  checks.push(['install-service.bat', '服务安装脚本']);
  checks.push(['uninstall-service.bat', '服务卸载脚本']);
  checks.push(['service-run.bat', '服务后台运行器']);
}
let bad = 0;
for (const [rel, desc] of checks) {
  const ok = fs.existsSync(path.join(T, rel));
  if (!ok) bad++;
  info(`${ok ? C.ok('✓') : C.err('✗')} ${rel.padEnd(34)} ${desc}`);
}
const webPluginsOk = fs.existsSync(path.join(T, 'web', 'plugins'));
info(`${webPluginsOk ? C.ok('✓') : C.warn('!')} ${'web/plugins'.padEnd(34)} plugin artifacts`);
// --data-exclude 断言：指定排除的目录必须**不在**包内
for (const name of opt.dataExclude) {
  const leaked = fs.existsSync(path.join(T, 'data', name));
  if (leaked) bad++;
  info(
    `${leaked ? C.err('✗') : C.ok('✓')} ${('data/' + name + ' (excluded)').padEnd(34)} should be excluded`,
  );
}
if (!opt.withData && !fs.existsSync(path.join(T, 'data'))) {
  info(C.dim('- data/ absence is expected: this package reuses ss-run/ss/data'));
}
if (opt.withData && !opt.userData && !fs.existsSync(path.join(T, 'data', 'db', 'ss-node.db'))) {
  info(C.dim('- Global DB db/ss-node.db not included (--no-user-data): target creates it and runs migrations on first start'));
}

// ── 复用形态：.env 的 DATA_DIR 必须真的落在现有数据目录上 ──
// 历史事故：DATA_DIR 写死 '../data'，而默认目标 ss-run/ss-win/04-win-node 比
// ss-run/ss/<pkg> 深一层 ⇒ 包用 ss-run/ss-win/data 下的空库启动（登录恒 401）。
if (!opt.withData) {
  const dataDirResolved = path.resolve(T, ctx.ENV_DATA_DIR);
  const dbResolved = path.join(dataDirResolved, 'db', 'ss-node.db');
  const dirOk = fs.existsSync(dataDirResolved);
  const dbOk = fs.existsSync(dbResolved);
  if (!dirOk) bad++;
  info(
    `${dirOk ? C.ok('✓') : C.err('✗')} ${'DATA_DIR'.padEnd(34)} ${ctx.ENV_DATA_DIR} → ${dataDirResolved}`,
  );
  info(
    `${dbOk ? C.ok('✓') : C.warn('!')} ${'DATA_DIR/db/ss-node.db'.padEnd(34)} ${
      dbOk ? 'Global DB present' : 'Global DB missing (target creates an empty DB on first start: no accounts, no projects)'
    }`,
  );
}

// ── 目录插件清单与产物必须一致 ──
// 历史事故：build:plugins 部分失败后旧清单仍留在 public/plugins 下，运行时按清单
// 动态 import 一批不存在的 .mjs（SPA fallback 还会把 index.html 当模块返回）。
const pluginsRoot = path.join(T, 'web', 'plugins');
if (fs.existsSync(pluginsRoot)) {
  const missing = [];
  const categories = fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const category of categories) {
    const manifestPath = path.join(pluginsRoot, category, 'plugin-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_e) {
      continue;
    }
    for (const entry of manifest.entries || []) {
      if (!entry || !entry.url) continue;
      const rel = String(entry.url).replace(/^\/plugins\//, '').replace(/^\//, '');
      const filePath = path.join(pluginsRoot, rel.replace(/\//g, path.sep));
      if (!fs.existsSync(filePath)) missing.push(`${category}/${entry.type}`);
    }
  }
  if (missing.length) {
    bad++;
    info(
      C.err(
        `✗ ${'web/plugins manifest'.padEnd(34)} ${missing.length} entries missing artifacts (first 5: ${missing.slice(0, 5).join(', ')})`,
      ),
    );
    info(C.warn('  Action: re-run pnpm build:plugins before packaging (or fix the plugin dependencies for that category).'));
  } else {
    info(C.ok(`✓ ${'web/plugins manifest'.padEnd(34)} manifest matches artifacts`));
  }

  // 源目录插件数 vs 清单条目数：防止 build:plugins 部分失败后被"静默瘦身"
  //（结果数组错位、某分类整体失败等情况，清单看起来自洽但组件凭空消失）。
  const categoriesJson = path.join(ROOT, 'ss-editor', 'packages', 'plugins', 'categories.json');
  if (fs.existsSync(categoriesJson)) {
    let directoryCategories = [];
    try {
      directoryCategories = JSON.parse(fs.readFileSync(categoriesJson, 'utf8'))
        .filter((c) => c.deployMode === 'directory')
        .map((c) => c.id);
    } catch (_e) {
      directoryCategories = [];
    }
    for (const category of directoryCategories) {
      const sourceCategoryDir = path.join(ROOT, 'ss-editor', 'packages', 'plugins', category);
      if (!fs.existsSync(sourceCategoryDir)) continue;
      const sourceCount = fs
        .readdirSync(sourceCategoryDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(sourceCategoryDir, d.name, 'index.ts')))
        .length;
      const manifestPath = path.join(pluginsRoot, category, 'plugin-manifest.json');
      let shippedCount = null;
      if (fs.existsSync(manifestPath)) {
        try {
          shippedCount = (JSON.parse(fs.readFileSync(manifestPath, 'utf8')).entries || []).length;
        } catch (_e) {
          shippedCount = null;
        }
      }
      const countOk = shippedCount === sourceCount;
      if (!countOk) bad++;
      info(
        `${countOk ? C.ok('✓') : C.err('✗')} ${('plugins/' + category).padEnd(34)} source ${sourceCount} / manifest ${
          shippedCount === null ? 'missing' : shippedCount
        } entries`,
      );
    }
  }
}

// ── 开发态 importmap 不得随包 ──
// apps/web/public/import-map.json 是 Vite dev server 的 @fs 映射（含打包机绝对路径），
// 生产用 index.html 内联的 importmap，此文件随包既泄漏路径又可能误导排障。
if (fs.existsSync(path.join(T, 'web', 'import-map.json'))) {
  bad++;
  info(C.err(`✗ ${'web/import-map.json'.padEnd(34)} dev @fs mapping must not be bundled`));
}

// 模块图门禁：真正加载一次后端模块图，确保依赖完整。
// 比“列目录”更能证明「能启动」——可捕获 MODULE_NOT_FOUND（依赖缺口）类事故。
if (fs.existsSync(path.join(T, 'dist', 'main.js')) && fs.existsSync(path.join(T, 'node_modules'))) {
  info('Module graph gate: loading dist/app.module.js (child process, does not pollute this process environment)...');
  const gate = cp.spawnSync(
    process.execPath,
    ['-e', "require('./dist/app.module.js'); console.log('[gate] module graph OK');"],
    {
      cwd: T,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit',
    },
  );
  if (gate.status === 0) {
    info(C.ok('✓ Module graph loadable (dependencies complete)'));
  } else {
    info(C.err('✗ Module graph check failed: incomplete dependencies (see MODULE_NOT_FOUND above)'));
    info(
      C.warn(
        '  Action: do not repackage with --no-install-missing; or run pnpm build in the workspace first to generate all dist artifacts.',
      ),
    );
    bad++;
  }
}

    return bad;
  }


  return {
    runVerifyStep,
  };
};
