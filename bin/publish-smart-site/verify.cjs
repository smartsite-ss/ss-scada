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
step(9, TOTAL, '校验产物');
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
info(`${webPluginsOk ? C.ok('✓') : C.warn('!')} ${'web/plugins'.padEnd(34)} 图元插件产物`);
// --data-exclude 断言：指定排除的目录必须**不在**包内
for (const name of opt.dataExclude) {
  const leaked = fs.existsSync(path.join(T, 'data', name));
  if (leaked) bad++;
  info(
    `${leaked ? C.err('✗') : C.ok('✓')} ${('data/' + name + ' (excluded)').padEnd(34)} 应排除`,
  );
}
if (!opt.withData && !fs.existsSync(path.join(T, 'data'))) {
  info(C.dim('· data/ 不存在属预期：本包复用 ../data（ss-run/ss/data）'));
}
if (opt.withData && !opt.userData && !fs.existsSync(path.join(T, 'data', 'db', 'ss-node.db'))) {
  info(C.dim('· 未含全局库 db/ss-node.db（--no-user-data）：目标机首次启动自动建库 + 迁移'));
}

// 模块图门禁：真正加载一次后端模块图，确保依赖完整。
// 比“列目录”更能证明「能启动」——可捕获 MODULE_NOT_FOUND（依赖缺口）类事故。
if (fs.existsSync(path.join(T, 'dist', 'main.js')) && fs.existsSync(path.join(T, 'node_modules'))) {
  info('模块图门禁：加载 dist/app.module.js（子进程，不污染本进程环境）...');
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
    info(C.ok('✓ 模块图可加载（依赖完整）'));
  } else {
    info(C.err('✗ 模块图校验失败：依赖不完整（见上方 MODULE_NOT_FOUND）'));
    info(
      C.warn(
        '  处理：不要用 --no-install-missing 重新打包；或先在工作区执行 pnpm build 生成全部 dist。',
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
