#!/usr/bin/env node
// Copyright (c) 2025 Smart Site Team
// SPDX-License-Identifier: Apache-2.0
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * 单包发布打包器（S1 单进程形态，无 Nginx）
 * ---------------------------------------------------------------------------
 * 方案：docs/00-全局/发布/单包发布方案.md
 *
 * 产物：ss-run/ss/smart-site/
 *   ├── dist/           后端编译产物（nest build 输出）
 *   ├── node_modules/   生产依赖（复用 ss-run/ss/services/ss-node/node_modules 作第三方基线，
 *   │                   再用工作区各包的最新 dist 覆盖 @ss-node/*，避免用到过期的已发布包）
 *   ├── i18n/           后端国际化资源（prod 由 SS_NODE_ROOT/i18n 加载）
 *   ├── web/            前端 SPA（后端以 WEB_DIST_DIR 托管）+ web/plugins（图元插件产物）
 *   ├── data/           ★ --with-data 时随包（DATA_DIR=./data）
 *   │                   init/dicts/templates/canvas-templates/faq/images/images-lg/menu/models + db/projects…
 *   ├── base_services/  ★ --with-services 时随包（redis + influxdb2-2.7.8，排除 logs/ 与运行态数据）
 *   ├── rtdb/influxdb2/ ★ 随包创建的空目录（influxd 的 engine/bolt/sqlite 落点：相对 exe 目录 ../../rtdb）
 *   ├── .env            单一生产配置（prod 只读 cwd/.env）—— 路径随形态切换为包内或 ../data
 *   ├── start.bat / stop.bat / status.bat   （start.bat 一键启动：拉起基础服务 → 同端口出 Web+API）
 *   ├── README.md
 *   └── VERSION.json
 *
 * 设计要点：
 *   1) 运行时 cwd = 本包根目录；NODE_ENV=production ⇒ SS_NODE_ROOT = cwd。
 *   2) 两种形态：
 *      - 默认（开发机自测）：DATA_DIR=../data、BASE_SERVICES_DIR=../base_services —— 复用现有数据，不产生分叉；
 *      - 自包含（--standalone = --with-data + --with-services）：DATA_DIR=./data、RUN_DIR=. ——
 *        整个目录可直接拷到目标机（Windows 单机发布，见 docs/00-全局/发布/Windows单机发布方案.md），
 *        双击 start.bat 一键启动（前端由后端托管，无需 Nginx / Docker）。
 *   3) 前端必须用同源相对地址构建（VITE_API_BASE_URL 置空），否则会烤入
 *      http://localhost:4000 导致远端浏览器直连错误地址（DatabaseOpsView 会受影响）。
 *      做法：构建期临时写 apps/web/.env.production.local（Vite 中优先级最高），构建后删除。
 *   4) SPA fallback 由后端 main.ts 提供（WEB_DIST_DIR 开关），排除 /api/ 与 /socket.io。
 *   5) 数据打包规则（--with-data）：排除运行期目录
 *      logs / logs-data / _bak / _tmp / realtime / rtdb / offline_data / ai-workspace / exports
 *      与 *.db-wal / *.db-shm / *.db-journal（WAL 由目标机启动时重建）；
 *      --no-user-data 额外排除 db / projects / plugin-configs / graphic-plugins（适合"首次安装"式交付）。
 *   6) ⚠️ `AUTO_START_BASE_SERVICES` 目前是「元数据里的死配置」（BaseServicesService.autoStartServices()
 *      只认 DB 的 sys_base_services.auto_start 列）。故本包一键启动由 start.bat 自己拉起基础服务，
 *      不依赖该开关。
 *
 * 用法（一般由 bin/publish-smart-site.bat 调用）：
 *   node bin/publish-smart-site.cjs [--port=4200] [--mode=full|scada|data]
 *                                   [--standalone] [--with-data] [--no-user-data]
 *                                   [--with-services] [--tier=lite|standard]
 *                                   [--no-build] [--no-web] [--no-server] [--clean]
 *                                   [--link-deps] [--target=<dir>] [--help]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
// cfg 路径常量（config.cjs）—— 参数解析（--target=path.resolve(ROOT,…)）即需使用，须在 M1 之前解构
const {
  ROOT, SS_NODE, SS_EDITOR, RUN_SS, RUN_WIN, RUN_WIN_MODE_DIRS,
  LAUNCHER_SOURCE, LAUNCHER_BUILD_SCRIPT, SERVER_DIST_SRC, WEB_DIST_SRC, PLUGINS_DIST_SRC,
  PROD_DEPS_SRC, REF_ENV, I18N_SOURCES,
  DATA_EXCLUDE_DIRS, DATA_USER_DIRS, DATA_EXCLUDE_FILES,
  BASE_SERVICE_ITEMS, BASE_SERVICE_EXCLUDE_DIRS, BASE_SERVICE_EXCLUDE_FILES,
} = require('./publish-smart-site/config.cjs');

// 实现已按功能拆分至 bin/publish-smart-site/ 目录（v7 模块布局）：
//   config.cjs（常量）/ util.cjs（通用工具）/ build.cjs（构建）/ artifacts.cjs（产物复制）
//   data.cjs（数据+DB瘦身+reset-admin+基础服务+node）/ deps.cjs（依赖）/ env-config.cjs（.env）
//   scripts.cjs（.bat 生成）/ docs.cjs（README）/ verify.cjs（校验）/ selftest.cjs（自测试）/ zip.cjs（压缩）
// 本文件仅保留：参数解析 → 模块装配 → 主流程编排。
const failEarly = (msg) => {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
};

// ─────────────────────────── 参数解析 ───────────────────────────
const argv = process.argv.slice(2);
const opt = {
  port: '4200',
  mode: 'full',
  launcher: 'node', // node（方式 4：start.bat 直启 node）| exe（方式 5：薄启动器 SmartSite.exe）
  target: null, // 目标目录（未指定时按 launcher 落到 ss-run/ss-win/<方式子目录>）
  build: true,
  web: true,
  server: true,
  deps: true,
  installMissing: true,
  clean: false,
  linkDeps: false,
  withData: false, // 是否把 data/ 打进包
  userData: true, // --with-data 时是否包含用户数据（db/projects/plugin-configs/graphic-plugins）
  withServices: false, // 是否把 base_services/（redis + influxdb2）打进包
  withNode: false, // --with-node：随包带 node.exe（目标机免装 Node）
  service: false, // --service：生成安装/卸载 Windows 服务脚本
  zip: false, // --zip：压缩为 zip 并生成 sha256
  selfTest: false, // --self-test：用暂存副本真实启动一次（探活后清理），结果写入 VERSION.json
  buildHeap: 0, // --build-heap=<MB>：构建期 V8 堆上限（默认按可用物理内存自动推算）
  tier: 'standard', // lite | standard（影响生成 .env 的默认档位）
  dataExclude: [], // --data-exclude=a,b —— data/ 下额外排除的子目录（如 images,images-lg,projects）
  lang: 'zh', // --lang=zh|en —— 英文版发布（en：.env 的 KB_DEFAULT_LANG / I18N_FALLBACK_LANGUAGE=en-US）
  resetAdmin: null, // --reset-admin[=user:password]（默认 admin:admin）—— 发布后重置包内全局库默认账号密码
  dbClean: true, // --no-db-clean：--with-data 时清空事件/日志/报警记录表并 VACUUM 收缩（默认开启）
};
for (const a of argv) {
  if (a === '--help' || a === '-h') {
    printHelp();
    process.exit(0);
  } else if (a === '--no-build') opt.build = false;
  else if (a === '--no-web') opt.web = false;
  else if (a === '--no-server') opt.server = false;
  else if (a === '--no-deps') opt.deps = false;
  else if (a === '--no-install-missing') opt.installMissing = false;
  else if (a === '--clean') opt.clean = true;
  else if (a === '--link-deps') opt.linkDeps = true;
  else if (a === '--standalone') {
    opt.withData = true;
    opt.withServices = true;
  } else if (a === '--exe') opt.launcher = 'exe';
  else if (a.startsWith('--launcher=')) opt.launcher = a.slice('--launcher='.length).trim();
  else if (a === '--with-node') opt.withNode = true;
  else if (a === '--service') opt.service = true;
  else if (a === '--zip') opt.zip = true;
  else if (a === '--self-test') opt.selfTest = true;
  else if (a === '--with-data') opt.withData = true;
  else if (a === '--no-user-data') opt.userData = false;
  else if (a === '--with-services') opt.withServices = true;
  else if (a.startsWith('--data-exclude=')) {
    opt.dataExclude = a
      .slice('--data-exclude='.length)
      .split(',')
      .map((s) => s.trim().replace(/[\\/]+$/, ''))
      .filter(Boolean);
  } else if (a.startsWith('--build-heap=')) opt.buildHeap = Number(a.slice('--build-heap='.length).trim());
  else if (a.startsWith('--tier=')) opt.tier = a.slice('--tier='.length).trim();
  else if (a.startsWith('--port=')) opt.port = a.slice('--port='.length).trim();
  else if (a.startsWith('--mode=')) opt.mode = a.slice('--mode='.length).trim();
  else if (a.startsWith('--target=')) opt.target = path.resolve(ROOT, a.slice('--target='.length));
  else if (a.startsWith('--lang=')) {
    const lang = a.slice('--lang='.length).trim().toLowerCase();
    if (!['zh', 'en'].includes(lang)) failEarly(`--lang 只支持 zh | en，收到: ${lang}`);
    opt.lang = lang;
  } else if (a === '--reset-admin') {
    opt.resetAdmin = 'admin:admin';
  } else if (a.startsWith('--reset-admin=')) {
    const spec = a.slice('--reset-admin='.length).trim();
    if (!spec.includes(':')) failEarly('--reset-admin 格式应为 user:password（或省略值默认 admin:admin）');
    opt.resetAdmin = spec;
  } else if (a === '--no-db-clean') opt.dbClean = false;
  else {
    console.error(`[ERROR] Unknown option: ${a} (use --help for usage)`);
    process.exit(1);
  }
}
if (!['full', 'scada', 'data'].includes(opt.mode)) {
  console.error(`[ERROR] --mode accepts only full | scada | data, got: ${opt.mode}`);
  process.exit(1);
}
if (!['lite', 'standard'].includes(opt.tier)) {
  console.error(`[ERROR] --tier accepts only lite | standard, got: ${opt.tier}`);
  process.exit(1);
}
if (opt.tier === 'lite' && opt.withServices) {
  console.error(
    '[ERROR] --tier=lite conflicts with --with-services: Lite does not use Redis/InfluxDB, remove --with-services',
  );
  process.exit(1);
}
if (!['node', 'exe'].includes(opt.launcher)) {
  console.error(`[ERROR] --launcher accepts only node | exe, got: ${opt.launcher}`);
  process.exit(1);
}
if (opt.launcher === 'exe' && !opt.withNode) {
  console.error(
    '[ERROR] --exe requires --with-node: the thin launcher exe does not embed a Node runtime, node\\node.exe must be bundled',
  );
  process.exit(1);
}
// 未显式指定 --target 时，按发布方式落到 ss-run/ss-win 下的对应子目录
if (!opt.target) {
  opt.target = path.join(RUN_WIN, RUN_WIN_MODE_DIRS[opt.launcher]);
}

/**
 * 构建期 V8 堆上限（MB）——**必须**显式抬高，否则前端构建必挂。
 *
 * 背景（实测）：
 *  - 默认堆 ~4GB 时，`@scada-editor/system` 的 vite build 必然 OOM：
 *    `FATAL ERROR: Ineffective mark-compacts near heap limit` → `Exit status 134`；
 *  - 但堆上限设得比**可用物理内存**还大同样会异常终止（可用 8.2GB 时设 8192 直接 abort）。
 * 故按可用物理内存推算：`heap = clamp(floor((可用MB - 2048)/512)*512, 5120, 12288)`。
 * 优先级：`--build-heap=<MB>` > 已存在的 `NODE_OPTIONS` > 自动推算。
 */
function resolveBuildHeapMb() {
  const freeMb = Math.floor(os.freemem() / 1048576);
  const totalMb = Math.floor(os.totalmem() / 1048576);
  const fromEnv = /--max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS || '');
  if (opt.buildHeap > 0) return { mb: opt.buildHeap, freeMb, totalMb, source: '--build-heap' };
  if (fromEnv) return { mb: Number(fromEnv[1]), freeMb, totalMb, source: 'NODE_OPTIONS（已存在）' };
  const computed = Math.floor((freeMb - 2048) / 512) * 512;
  // 上限 8192：构建实测 5.6GB 即可通过，无需把堆上限顶到接近可用内存；下限 5120：低于此值必 OOM
  return {
    mb: Math.min(8192, Math.max(5120, computed)),
    freeMb,
    totalMb,
    source: '自动（按可用物理内存）',
  };
}
const BUILD_HEAP = resolveBuildHeapMb();
/** 传给构建子进程的环境（抬高堆上限；同时覆盖 IDE 注入的 NODE_OPTIONS 钩子） */
const BUILD_ENV = { NODE_OPTIONS: `--max-old-space-size=${BUILD_HEAP.mb}` };

/**
 * 是否把路径内部化到包内：
 * - withData ⇒ DATA_DIR=./data（数据随包）
 * - withServices ⇒ BASE_SERVICES_DIR=./base_services（服务随包，RUN_DIR 必须为包根）
 */
const INTERNAL_PATHS = opt.withData || opt.withServices;

/**
 * 相对路径（正斜杠，"." 表示当前目录）
 */
function toPosixRelative(fromDir, toPath) {
  const rel = path.relative(fromDir, toPath).replace(/\\/g, '/');
  return rel === '' ? '.' : rel;
}

/**
 * 生成 .env 时使用的路径取值。
 *
 * ⚠️ 必须按「目标目录 → ss-run/ss」的真实层级反算，不能写死 '../data'：
 * 默认目标为 ss-run/ss-win/04-win-node（比 ss-run/ss/<pkg> 深一层），写死会让包
 * 静默连到 ss-run/ss-win/data 下的空库（现象：登录恒 401、项目列表为空、
 * setup/status 返回 initialized:false），且 start.bat 仍打印 "Data dir: ..\data"。
 */
const DATA_DIR_ABS = path.join(RUN_SS, 'data');
const ENV_DATA_DIR = opt.withData ? './data' : toPosixRelative(opt.target, DATA_DIR_ABS);
const ENV_RUN_DIR = INTERNAL_PATHS ? '.' : toPosixRelative(opt.target, RUN_SS);
/** 基础服务根目录（复用形态下同样需要反算） */
const ENV_BASE_SERVICES_DIR = INTERNAL_PATHS ? './base_services' : toPosixRelative(opt.target, path.join(RUN_SS, 'base_services'));

function printHelp() {
  console.log(`
Smart Site single-package publisher (S1 single process, no Nginx)

Usage:
  node bin/publish-smart-site.cjs [options]

Options:
  --port=<n>        Runtime port (default 4200, avoids conflict with the existing :4000 instance)
  --mode=<m>        Product mode full|scada|data (default full)
  --standalone      Self-contained package = --with-data + --with-services (copy the folder to the target machine and start with one click)
  --with-data       Bundle data/ (DATA_DIR=./data; includes assets and user data, excludes runtime dirs and WAL)
  --no-user-data    With --with-data, exclude user data (db/ projects/ plugin-configs/ graphic-plugins/),
                    suitable for "first install" delivery (target creates the DB and runs migrations on first start)
  --with-services   Bundle base_services/{redis,influxdb2-2.7.8} and create rtdb/influxdb2
  --data-exclude=<a,b>
                    With --with-data, additionally exclude subdirectories under data/ (slim delivery).
                    Typical: --data-exclude=images,images-lg,projects
  --with-node       Bundle node.exe (node\\node.exe) => no Node install needed on target, avoids native module ABI mismatch
  --exe             Mode 5: build thin launcher SmartSite.exe (winexe, no console window, double-click to start).
                    Must be used with --with-node (launcher does not embed Node); start.bat will call it.
                    See the Windows exe release design doc under docs/ (option A: zero backend changes)
  --launcher=<x>    Launcher form node|exe (default node; --exe equals --launcher=exe)
  --service         Generate install-service.bat / uninstall-service.bat (NSSM preferred, schtasks fallback)
  --zip             Compress to <package>.zip and generate <package>.zip.sha256 after packaging
  --self-test       Self test: copy artifacts to a sibling staging dir and start once (Lite overrides,
                    external Redis/InfluxDB untouched), probe /api/v1/health, /, SPA deep route, then clean up,
                    write the result to VERSION.json#selfTest (failure fails the whole package, no zip)
  --tier=<t>        Base service tier lite|standard (default standard); lite => REDIS_HOST empty +
                    HISTORICAL_DATA_BACKEND=sqlite (no Redis/InfluxDB)
  --build-heap=<MB> V8 heap limit for builds (default derived from free physical memory, 5120~12288).
                    The frontend production build (esp. @scada-editor/system) OOMs under the default ~4GB heap
                    (exit 134); but a limit above free physical memory also aborts, so tune it carefully
  --no-build        Skip frontend/backend builds, reuse existing dist artifacts
  --no-web          Do not update frontend (backend only)
  --no-server       Do not update backend (frontend only)
  --no-deps         Do not update node_modules (fast re-run when changing config only)
  --no-install-missing
                    Do not auto-install third-party deps missing from the baseline (default: auto; needs network)
  --clean           Clear the target directory before packaging
  --link-deps       Use directory junctions (mklink /J) for production deps instead of copying (fast, not self-contained)
  --target=<dir>    Target directory (default ss-run/ss-win/04-win-node; 05-win-exe for --exe)
  -h, --help        Show this help

Examples (Windows single-machine delivery):
  node bin/publish-smart-site.cjs --standalone --port=8080 --tier=standard
  node bin/publish-smart-site.cjs --standalone --port=8080 --with-node --exe   # Mode 5: exe launcher
  node bin/publish-smart-site.cjs --with-data --no-user-data --tier=lite   # Lite tier without user data
`);
}


// ─────────────────────────── 模块装配 ───────────────────────────
const cfg = require('./publish-smart-site/config.cjs');
// ⚠️ T / TOTAL 必须在装配前放进 ctx：各模块在工厂调用时就解构了它们的值，
// 装配后再赋值只会改到 ctx，模块内捕获的仍是 undefined（曾导致步骤标题
// 全部显示为 [1/undefined]）。
const T = opt.target;
const TOTAL = 11;
const ctx = {
  fs, path, cp, os, ...cfg, opt, T, TOTAL, BUILD_HEAP, BUILD_ENV, INTERNAL_PATHS,
  ENV_DATA_DIR, ENV_RUN_DIR, ENV_BASE_SERVICES_DIR,
};
Object.assign(ctx, require('./publish-smart-site/util.cjs')(ctx));
const deps = require('./publish-smart-site/deps.cjs')(ctx);
Object.assign(ctx, deps);
const buildMod = require('./publish-smart-site/build.cjs')(ctx);
const artifactsMod = require('./publish-smart-site/artifacts.cjs')(ctx);
Object.assign(ctx, require('./publish-smart-site/data.cjs')(ctx));
const envMod = require('./publish-smart-site/env-config.cjs')(ctx);
Object.assign(ctx, require('./publish-smart-site/scripts.cjs')(ctx));
Object.assign(ctx, require('./publish-smart-site/docs.cjs')(ctx));
const verifyMod = require('./publish-smart-site/verify.cjs')(ctx);
const complianceMod = require('./publish-smart-site/compliance.cjs')(ctx);
Object.assign(ctx, require('./publish-smart-site/selftest.cjs')(ctx));
Object.assign(ctx, require('./publish-smart-site/zip.cjs')(ctx));
const {
  // util
  C, step, info, fail, mirror, wildcardToRegExp, cpSyncFiltered, run, ensureDir, readJson,
  parseEnvFile, gitCommit, isWeakSecret, randomSecret, writeBat, sha256FileSync, sleepSync,
  rmDirWithRetry, httpStatusSync, portListeningSync,
  // deps
  scanWorkspacePackages, ensureProdDepsBaseline, collectRequiredDeps,
  // data
  copyDataDir, purgeDataDatabases, resetAdminPassword, copyBaseServices, copyNodeRuntime,
  // selftest / zip
  selfTestPackage, zipPackage,
  // scripts / docs
  writeStartBat, writeStartBatExeLauncher, writeLauncherExe, writeStartServicesBat,
  writeSelfTestBat, writeServiceRunBat, writeServiceScripts, writeStopBat, writeStatusBat,
  writeReadme,
} = ctx;

// ─────────────────────────── 主流程 ───────────────────────────

const dataSummary = opt.withData
  ? `随包 data/（${opt.userData ? '含用户数据' : '仅代码资产'}${
      opt.dataExclude.length ? `；排除 ${opt.dataExclude.join('/')}` : ''
    }）`
  : `复用 ${path.join(RUN_SS, 'data')}`;
const svcSummary = opt.withServices
  ? '随包 base_services/（redis + influxdb2）'
  : `复用 ${path.join(RUN_SS, 'base_services')}`;

console.log('');
console.log('='.repeat(78));
console.log(C.bold('  Smart Site single-package publisher (S1 single process, no Nginx)'));
console.log('='.repeat(78));
console.log(`  Target dir : ${T}`);
console.log(`  Mode       : ${opt.mode}`);
console.log(`  Port       : ${opt.port}`);
console.log(`  Form       : ${INTERNAL_PATHS ? C.bold('Self-contained (paths point inside the package)') : 'Reuse local ss-run'}`);
console.log(`  Data/Svc   : ${dataSummary} + ${svcSummary} (tier ${opt.tier})`);
console.log(
  `  Extra      : ${
    [
      opt.withNode ? `Bundled node (${process.version})` : null,
      opt.service ? 'Windows service scripts' : null,
      opt.selfTest ? 'Self test' : null,
      opt.zip ? 'zip + sha256' : null,
    ]
      .filter(Boolean)
      .join(' / ') || 'none'
  }`,
);
console.log(
  `  Build      : ${opt.build ? `yes (heap limit ${BUILD_HEAP.mb} MB; free physical memory ${BUILD_HEAP.freeMb} MB, ${BUILD_HEAP.source})` : 'no (--no-build)'}`,
);
console.log(`  Web/API    : ${opt.web ? 'update' : 'skip'} / ${opt.server ? 'update' : 'skip'}`);
console.log(
  `  Deps       : ${
    !opt.deps ? 'skip (--no-deps)' : opt.linkDeps ? 'junction (--link-deps)' : 'copy baseline'
  }${opt.deps && !opt.linkDeps && opt.installMissing ? ' + auto-install missing' : ''}`,
);
console.log('='.repeat(78));

if (opt.withData && !opt.withServices && opt.tier === 'standard') {
  console.log(
    C.warn(
      '  Note: --with-data without base_services (--with-services) => target must provide Redis/InfluxDB, ' +
        'or use --tier=lite (no external services).',
    ),
  );
}
if (opt.withServices && !opt.withData) {
  console.log(
    C.warn('  Note: --with-services without data => DATA_DIR still points to ../data (must sit next to the package).'),
  );
}
if (opt.withData && opt.userData) {
  console.log(
    C.warn('  Note: this package contains user data (db/, projects/, plugin-configs/, graphic-plugins/); mind confidentiality and size.'),
  );
}
if (opt.dataExclude.length && !opt.withData) {
  console.log(C.warn('  Note: --data-exclude only applies with --with-data (data/ not bundled this time).'));
}

if (opt.clean && fs.existsSync(T)) {
  step(1, TOTAL, `Clearing target directory (--clean)`);
  fs.rmSync(T, { recursive: true, force: true });
  info(C.ok('Cleared'));
}
ensureDir(T);

// 清理「运行期产物」：这些目录由上一次运行生成，不属于发布内容。
// - .ss-collector-isolation/：隔离模式把 node 拷贝成 ss-collector-*.exe（约 90MB/个），运行期重建
// - data/：若存在，说明有组件按 cwd 相对路径落了数据（已知：offline-cache.service 的 dumpDir
//   在模块加载期取 env，早于 dotenv ⇒ 回落 ./data/offline_data）。**不自动删除**以免误删
//   DATA_DIR 被配置为 ./data 时的用户数据，仅提示。
const isolationDir = path.join(T, '.ss-collector-isolation');
if (fs.existsSync(isolationDir)) {
  const s = fs.statSync(isolationDir);
  if (s.isDirectory()) {
    fs.rmSync(isolationDir, { recursive: true, force: true });
    info(C.dim('Removed runtime artifact .ss-collector-isolation/'));
  }
}
const strayDataDir = path.join(T, 'data');
if (!opt.withData && fs.existsSync(strayDataDir) && !/^\.\.[\\/]/.test(String(process.env.DATA_DIR || ''))) {
  info(
    C.warn(
      'Detected an in-package data/ directory: this is a runtime leftover created by cwd-relative paths. ' +
        'This package .env points DATA_DIR to ../data (reusing existing data); verify it is unused and delete it manually.',
    ),
  );
}


// ── [1] 构建（build.cjs）──
buildMod.runBuildStep();

// ── [2][3] 后端 / 前端产物（artifacts.cjs）──
artifactsMod.runArtifactsStep();

// ── [4] 数据目录 / 基础服务 / 随包 Node（自包含，一键启动）──────
step(4, TOTAL, 'Bundling data dir / base services / bundled Node (--with-data / --with-services / --with-node)');
if (opt.withData) {
  copyDataDir(path.join(T, 'data'));
  // 数据库瘦身：清空事件/日志/报警记录表并 VACUUM 收缩（对包内副本操作，不影响 ss-run 源库）
  if (opt.dbClean) purgeDataDatabases(path.join(T, 'data'));
  else info(C.dim('Skipping database purge (--no-db-clean)'));
  // 重置包内全局库默认账号密码（--reset-admin，默认 admin:admin；每次打包都生效）
  if (opt.resetAdmin) resetAdminPassword(path.join(T, 'data'), opt.resetAdmin);
} else {
  info(C.dim('Skipping data/ (--with-data not set: .env points DATA_DIR to ../data)'));
}
if (opt.withServices) {
  copyBaseServices(path.join(T, 'base_services'));
  // influxd 的 engine/sqlite/bolt 落点为「相对 influxd.exe 目录的 ../../rtdb/influxdb2」
  // ⇒ 包内即 <pkg>/rtdb/influxdb2（与 .env 的 INFLUXDB_DATA_DIR=${RUN_DIR}/rtdb/influxdb2 一致）
  ensureDir(path.join(T, 'rtdb', 'influxdb2'));
  ensureDir(path.join(T, 'rtdb', 'influxdb3'));
  info('Created rtdb/influxdb2 and rtdb/influxdb3 (time-series data locations, not overwritten on upgrade)');
} else {
  info(C.dim('Skipping base_services/ (--with-services not set: target must provide them or use --tier=lite)'));
}
if (opt.withNode) {
  copyNodeRuntime(path.join(T, 'node'));
} else {
  info(C.dim('Skipping node/ (--with-node not set: target needs its own Node with a matching major version)'));
}


// ── [5] 生产依赖（deps.cjs）──
deps.runDepsStep();

// ── [7] 生成 .env（env-config.cjs）──
const envOut = envMod.generateEnv();
const builtAt = envOut.builtAt;
const inherited = envOut.inherited;
const inheritedLabel = envOut.inheritedLabel;
const inheritedSkipped = envOut.inheritedSkipped;
ctx.builtAt = builtAt;
ctx.inherited = inherited;

// ── [8] 生成启停脚本与版本信息 ────────────────────────────────
step(8, TOTAL, 'Generating start/stop scripts / README / VERSION.json');
/** 生成器共享上下文：把"形态"一次性算好，避免各生成器重复判断 */
const pkg = {
  dir: T,
  port: opt.port,
  mode: opt.mode,
  withData: opt.withData,
  userData: opt.userData,
  withServices: opt.withServices,
  withNode: opt.withNode,
  service: opt.service,
  tier: opt.tier,
  launcher: opt.launcher,
  dataExclude: opt.dataExclude,
  internalPaths: INTERNAL_PATHS,
  dataDir: ENV_DATA_DIR,
  runDir: ENV_RUN_DIR,
  baseServicesDir: ENV_BASE_SERVICES_DIR,
};
if (opt.launcher === 'exe') {
  // 方式 5：入口为薄启动器 exe；同时保留 node 形态脚本（start-node.bat）便于排障
  writeStartBat(pkg, 'start-node.bat');
  writeStartBatExeLauncher(pkg);
  writeLauncherExe(pkg);
} else {
  writeStartBat(pkg);
}
writeStopBat(pkg);
writeStatusBat(pkg);
writeSelfTestBat(pkg);
if (opt.service) {
  writeServiceRunBat(pkg);
  writeServiceScripts(pkg);
  info('install-service.bat / uninstall-service.bat / service-run.bat');
}
writeReadme(pkg, builtAt, inherited);
fs.writeFileSync(
  path.join(T, 'VERSION.json'),
  JSON.stringify(
    {
      product: 'smart-site',
      form: opt.launcher === 'exe' ? 'thin-exe-launcher (S1-S5, no nginx)' : 'single-process (S1, no nginx)',
      launcher: opt.launcher,
      productMode: opt.mode,
      port: Number(opt.port),
      builtAt,
      gitCommit: gitCommit(),
      standalone: INTERNAL_PATHS,
      packaging: {
        tier: opt.tier,
        dataIncluded: opt.withData,
        userDataIncluded: opt.withData && opt.userData,
        dataExcluded: opt.dataExclude,
        baseServicesIncluded: opt.withServices,
        nodeIncluded: opt.withNode,
        serviceScripts: opt.service,
        zipped: opt.zip,
      },
      runtime: {
        nodeVersion: opt.withNode ? process.version : null,
        nodeExe: opt.withNode ? 'node/node.exe' : null,
        packedByNode: process.version,
      },
      build: opt.build
        ? {
            heapMb: BUILD_HEAP.mb,
            heapSource: BUILD_HEAP.source,
            freePhysicalMbAtPackTime: BUILD_HEAP.freeMb,
            totalPhysicalMb: BUILD_HEAP.totalMb,
          }
        : null,
      sources: {
        serverDist: path.relative(ROOT, SERVER_DIST_SRC),
        webDist: path.relative(ROOT, WEB_DIST_SRC),
        pluginsDist: path.relative(ROOT, PLUGINS_DIST_SRC),
        depsBaseline: path.relative(ROOT, PROD_DEPS_SRC),
      },
      paths: {
        dataDir: ENV_DATA_DIR,
        runDir: ENV_RUN_DIR,
        baseServicesDir: ENV_BASE_SERVICES_DIR,
      },
      inheritedEnvKeys: inherited,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
info(
  opt.launcher === 'exe'
    ? 'SmartSite.exe / start.bat / start-node.bat / stop.bat / status.bat / README.md / VERSION.json'
    : 'start.bat / stop.bat / status.bat / README.md / VERSION.json',
);


// ── [9] 校验与摘要（verify.cjs）──
let bad = verifyMod.runVerifyStep();

// ── A14 发布前合规卡点：复刻证据 / 第三方权利标识命中即阻断 zip ──
// （A05 剪枝是预防，本扫描是验收；只读，失败时 fail() 退出进程）
complianceMod.enforceCompliance(path.join(T, 'data'));

// ── [10] 自测试（--self-test）─────────────────────────────────
let selfTestResult = null;
if (opt.selfTest) {
  step(10, TOTAL, 'Self test (--self-test: start staged copy -> probe health -> clean up)');
  if (bad) {
    info(C.warn('Verification failures present, skipping self test'));
  } else {
    selfTestResult = selfTestPackage(pkg);
    if (!selfTestResult.pass) bad++;
    // 把结果并入 VERSION.json，便于交付物自证
    try {
      const versionFile = path.join(T, 'VERSION.json');
      const vj = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      vj.selfTest = selfTestResult;
      fs.writeFileSync(versionFile, JSON.stringify(vj, null, 2) + '\n', 'utf8');
      info('Self test result written to VERSION.json#selfTest');
    } catch (e) {
      info(C.warn(`Failed to write VERSION.json (ignored): ${e.message}`));
    }
  }
} else {
  step(10, TOTAL, 'Self test (--self-test not set, skipping)');
  info(C.dim('Hint: add --self-test to actually start the service once and probe health (about 1-2 minutes)'));
}

// ── [11] 压缩分发（--zip）─────────────────────────────────────
if (opt.zip) {
  step(11, TOTAL, 'Compressing (--zip: zip + sha256)');
  if (bad) {
    info(C.warn('Verification failures present, skipping compression (fix the ✗ items above first)'));
  } else {
    zipPackage(T);
  }
} else {
  step(11, TOTAL, 'Compression (--zip not set, skipping)');
  info(C.dim(`To distribute a zip: repackage with --zip (or compress ${T} yourself)`));
}

console.log('');
console.log('='.repeat(78));
if (bad) {
  console.log(C.err(`  Done, but ${bad} check(s) failed; see the ✗ items above.`));
} else {
  console.log(C.ok('  Packaging complete.'));
}
console.log('='.repeat(78));
console.log(`  Output dir : ${T}`);
console.log(`  Start      : ${path.join(T, 'start.bat')}`);
console.log(`  Self test  : ${path.join(T, 'self-test.bat')}`);
console.log(`  URL        : http://localhost:${opt.port}/`);
console.log(`  Health     : http://localhost:${opt.port}/api/v1/system/health`);
if (selfTestResult) {
  console.log(
    `  Build self-test: ${
      selfTestResult.pass
        ? C.ok(`passed (health=200, ${selfTestResult.checks.healthWaitSeconds}s)`)
        : selfTestResult.skipped
          ? C.warn(`skipped (${selfTestResult.skipped})`)
          : C.err('failed (see VERSION.json#selfTest)')
    }`,
  );
}
console.log('');
console.log(C.warn('  Notes:'));
if (INTERNAL_PATHS) {
  console.log('   1) Self-contained: copy the whole folder to the target machine and double-click start.bat');
  console.log(`      (${pkg.withData ? 'data/ bundled' : 'data/ points to ../data'}; ${pkg.withServices ? 'base_services/ bundled, start.bat starts redis/influxd first' : 'base_services/ not bundled'}).`);
  console.log(`   2) Tier ${pkg.tier}: ${pkg.tier === 'lite' ? 'REDIS_HOST empty + HISTORICAL_DATA_BACKEND=sqlite (no external services)' : 'needs Redis :6379 / InfluxDB :8086 (bundled)'}.`);
  if (pkg.withData && pkg.userData) {
    const excluded = pkg.dataExclude && pkg.dataExclude.length ? `（已排除 ${pkg.dataExclude.join('/')}）` : '';
    console.log(`   3) ⚠️ This package contains live user data (db/, plugin-configs/, graphic-plugins/, etc.) ${excluded}; mind confidentiality before distribution;`);
    if (pkg.dataExclude.includes('projects')) {
      console.log('      Note: data/projects excluded => project records remain in the global DB; opening one fails due to missing system.db;');
      console.log('      For an "empty data" delivery use --with-data --no-user-data (excludes db/ as well).');
    } else {
      console.log('      For a "first install" delivery, repackage with --no-user-data.');
    }
  } else {
    console.log('   3) First start on the target creates the DB and runs TypeORM migrations (initialize the admin account via the setup guide).');
  }
} else {
  console.log('   1) Ensure base services are ready before running (reusing ss-run/ss/base_services):');
  console.log('      Redis :6379 / InfluxDB :8086; if not running, switch .env to the Lite tier:');
  console.log('        REDIS_HOST=            (empty => all Redis features no-op)');
  console.log('        HISTORICAL_DATA_BACKEND=sqlite   (historical data in SQLite)');
  console.log('   2) This package shares the same data dir as the :4000 instance; do not run both at once.');
  console.log('   3) To change port/tier, edit .env and restart; no repackaging needed.');
  console.log('   4) For a self-contained "one-click start" package, add --standalone (= --with-data --with-services).');
}
console.log('');

