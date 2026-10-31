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
    console.error(`[ERROR] 未知参数: ${a}（用 --help 查看用法）`);
    process.exit(1);
  }
}
if (!['full', 'scada', 'data'].includes(opt.mode)) {
  console.error(`[ERROR] --mode 只支持 full | scada | data，收到: ${opt.mode}`);
  process.exit(1);
}
if (!['lite', 'standard'].includes(opt.tier)) {
  console.error(`[ERROR] --tier 只支持 lite | standard，收到: ${opt.tier}`);
  process.exit(1);
}
if (opt.tier === 'lite' && opt.withServices) {
  console.error(
    '[ERROR] --tier=lite 与 --with-services 冲突：Lite 档不使用 Redis/InfluxDB，请去掉 --with-services',
  );
  process.exit(1);
}
if (!['node', 'exe'].includes(opt.launcher)) {
  console.error(`[ERROR] --launcher 只支持 node | exe，收到: ${opt.launcher}`);
  process.exit(1);
}
if (opt.launcher === 'exe' && !opt.withNode) {
  console.error(
    '[ERROR] --exe 需要 --with-node：薄启动器 exe 自己不内嵌 Node 运行时，必须随包带 node\\node.exe',
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
/** 生成 .env 时使用的路径取值 */
const ENV_DATA_DIR = opt.withData ? './data' : '../data';
const ENV_RUN_DIR = INTERNAL_PATHS ? '.' : '..';

function printHelp() {
  console.log(`
单包发布打包器（S1 单进程，无 Nginx）

用法：
  node bin/publish-smart-site.cjs [选项]

选项：
  --port=<n>        运行时端口（默认 4200，避免与现有 4000 实例冲突）
  --mode=<m>        产品模式 full|scada|data（默认 full）
  --standalone      ★ 自包含交付包 = --with-data + --with-services（可直接拷到目标机一键启动）
  --with-data       把 data/ 打进包（DATA_DIR=./data；含资产与用户数据，排除运行期目录与 WAL）
  --no-user-data    --with-data 时排除用户数据（db/ projects/ plugin-configs/ graphic-plugins/），
                    适合"首次安装"式交付（目标机启动时自动建库 + 迁移）
  --with-services   把 base_services/{redis,influxdb2-2.7.8} 打进包并创建 rtdb/influxdb2
  --data-exclude=<a,b>
                    --with-data 时额外排除 data/ 下的子目录（瘦身交付）。
                    典型：--data-exclude=images,images-lg,projects
  --with-node       随包带 node.exe（node\\node.exe）⇒ 目标机免装 Node，且规避原生模块 ABI 不一致
  --exe             ★ 方式 5：生成薄启动器 SmartSite.exe（winexe，无控制台窗口，双击即启）。
                    与 --with-node 必须同用（启动器不内嵌 Node 运行时）；start.bat 改为调用它。
                    方案见 docs/00-全局/发布/后台发布成exe方案.md（方案 A：后台零改造）
  --launcher=<x>    启动器形态 node|exe（默认 node；--exe 等价于 --launcher=exe）
  --service         生成 install-service.bat / uninstall-service.bat（NSSM 优先，schtasks 兜底）
  --zip             打包完成后压缩为 <包名>.zip 并生成 <包名>.zip.sha256
  --self-test       自测试：把产物复制到同级暂存目录真实启动一次（Lite 覆盖，不触碰外部
                    Redis/InfluxDB），探测 /api/v1/health、/、SPA 深路由后清理，
                    结果写入 VERSION.json 的 selfTest 字段（失败则整包判失败、不压缩）
  --tier=<t>        基础服务档位 lite|standard（默认 standard）；lite ⇒ REDIS_HOST 置空 +
                    HISTORICAL_DATA_BACKEND=sqlite（免 Redis/InfluxDB）
  --build-heap=<MB> 构建期 V8 堆上限（默认按可用物理内存自动推算，范围 5120~12288）。
                    前端生产构建（尤其 @scada-editor/system）在默认 ~4GB 堆下必 OOM
                    （exit 134）；但堆上限超过可用物理内存同样会异常终止，故需恰到好处
  --no-build        跳过前后端构建，直接使用现有 dist 产物
  --no-web          不更新前端（仅后端）
  --no-server       不更新后端（仅前端）
  --no-deps         不更新 node_modules（重跑改配置时用，秒级）
  --no-install-missing
                    不自动补齐「基线缺少的三方依赖」（默认自动补齐；需网络）
  --clean           打包前清空目标目录
  --link-deps       生产依赖用目录联接（mklink /J）而非复制（秒级，但不自包含）
  --target=<dir>    目标目录（默认 ss-run/ss-win/04-win-node；--exe 时默认 05-win-exe）
  -h, --help        显示本帮助

示例（Windows 单机交付包）：
  node bin/publish-smart-site.cjs --standalone --port=8080 --tier=standard
  node bin/publish-smart-site.cjs --standalone --port=8080 --with-node --exe   # 方式 5：exe 启动
  node bin/publish-smart-site.cjs --with-data --no-user-data --tier=lite   # 不带用户数据的 Lite 档
`);
}


// ─────────────────────────── 模块装配 ───────────────────────────
const cfg = require('./publish-smart-site/config.cjs');
const ctx = { fs, path, cp, os, ...cfg, opt, BUILD_HEAP, BUILD_ENV, INTERNAL_PATHS, ENV_DATA_DIR, ENV_RUN_DIR };
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
const T = opt.target;
const TOTAL = 11;
ctx.T = T; // 供 runArtifactsStep / runDepsStep 等运行期取用
ctx.TOTAL = TOTAL;

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
console.log(C.bold('  Smart Site 单包发布（S1 单进程，无 Nginx）'));
console.log('='.repeat(78));
console.log(`  目标目录   : ${T}`);
console.log(`  产品模式   : ${opt.mode}`);
console.log(`  运行端口   : ${opt.port}`);
console.log(`  形态       : ${INTERNAL_PATHS ? C.bold('自包含（路径指向包内）') : '复用本机 ss-run'}`);
console.log(`  数据/服务  : ${dataSummary} + ${svcSummary}（档位 ${opt.tier}）`);
console.log(
  `  附加产物   : ${
    [
      opt.withNode ? `随包 node（${process.version}）` : null,
      opt.service ? 'Windows 服务脚本' : null,
      opt.selfTest ? '自测试' : null,
      opt.zip ? 'zip + sha256' : null,
    ]
      .filter(Boolean)
      .join(' / ') || '无'
  }`,
);
console.log(
  `  构建       : ${opt.build ? `是（堆上限 ${BUILD_HEAP.mb} MB；可用物理内存 ${BUILD_HEAP.freeMb} MB，${BUILD_HEAP.source}）` : '否（--no-build）'}`,
);
console.log(`  前端/后端  : ${opt.web ? '更新' : '跳过'} / ${opt.server ? '更新' : '跳过'}`);
console.log(
  `  依赖       : ${
    !opt.deps ? '跳过（--no-deps）' : opt.linkDeps ? '目录联接（--link-deps）' : '复制基线'
  }${opt.deps && !opt.linkDeps && opt.installMissing ? ' + 自动补齐缺口' : ''}`,
);
console.log('='.repeat(78));

if (opt.withData && !opt.withServices && opt.tier === 'standard') {
  console.log(
    C.warn(
      '  提示：--with-data 但未带 base_services（--with-services）⇒ 目标机需自备 Redis/InfluxDB，' +
        '或改用 --tier=lite（零外部服务）。',
    ),
  );
}
if (opt.withServices && !opt.withData) {
  console.log(
    C.warn('  提示：--with-services 但未带 data ⇒ 数据目录仍指向 ../data（需与包同级放置）。'),
  );
}
if (opt.withData && opt.userData) {
  console.log(
    C.warn('  提示：本次打包包含用户数据（db/、projects/、plugin-configs/、graphic-plugins/），注意保密与体积。'),
  );
}
if (opt.dataExclude.length && !opt.withData) {
  console.log(C.warn('  提示：--data-exclude 仅在 --with-data 时生效（本次未随包 data/）。'));
}

if (opt.clean && fs.existsSync(T)) {
  step(1, TOTAL, `清空目标目录（--clean）`);
  fs.rmSync(T, { recursive: true, force: true });
  info(C.ok('已清空'));
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
    info(C.dim('已清理运行期产物 .ss-collector-isolation/'));
  }
}
const strayDataDir = path.join(T, 'data');
if (!opt.withData && fs.existsSync(strayDataDir) && !/^\.\.[\\/]/.test(String(process.env.DATA_DIR || ''))) {
  info(
    C.warn(
      '检测到包内 data/ 目录：这是运行期按 cwd 相对路径产生的残留，' +
        '本包 .env 的 DATA_DIR 指向 ../data（复用现有数据），请确认其未被误用后手动删除。',
    ),
  );
}


// ── [1] 构建（build.cjs）──
buildMod.runBuildStep();

// ── [2][3] 后端 / 前端产物（artifacts.cjs）──
artifactsMod.runArtifactsStep();

// ── [4] 数据目录 / 基础服务 / 随包 Node（自包含，一键启动）──────
step(4, TOTAL, '打包数据目录 / 基础服务 / 随包 Node（--with-data / --with-services / --with-node）');
if (opt.withData) {
  copyDataDir(path.join(T, 'data'));
  // 数据库瘦身：清空事件/日志/报警记录表并 VACUUM 收缩（对包内副本操作，不影响 ss-run 源库）
  if (opt.dbClean) purgeDataDatabases(path.join(T, 'data'));
  else info(C.dim('跳过数据库瘦身（--no-db-clean）'));
  // 重置包内全局库默认账号密码（--reset-admin，默认 admin:admin；每次打包都生效）
  if (opt.resetAdmin) resetAdminPassword(path.join(T, 'data'), opt.resetAdmin);
} else {
  info(C.dim('跳过 data/（未指定 --with-data：本包 .env 的 DATA_DIR 指向 ../data）'));
}
if (opt.withServices) {
  copyBaseServices(path.join(T, 'base_services'));
  // influxd 的 engine/sqlite/bolt 落点为「相对 influxd.exe 目录的 ../../rtdb/influxdb2」
  // ⇒ 包内即 <pkg>/rtdb/influxdb2（与 .env 的 INFLUXDB_DATA_DIR=${RUN_DIR}/rtdb/influxdb2 一致）
  ensureDir(path.join(T, 'rtdb', 'influxdb2'));
  ensureDir(path.join(T, 'rtdb', 'influxdb3'));
  info('已创建 rtdb/influxdb2 与 rtdb/influxdb3（时序数据落点，升级不覆盖）');
} else {
  info(C.dim('跳过 base_services/（未指定 --with-services：需目标机自备或走 --tier=lite）'));
}
if (opt.withNode) {
  copyNodeRuntime(path.join(T, 'node'));
} else {
  info(C.dim('跳过 node/（未指定 --with-node：目标机需自备 Node，且大版本须与打包机一致）'));
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
step(8, TOTAL, '生成启停脚本 / README / VERSION.json');
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
        baseServicesDir: INTERNAL_PATHS ? './base_services' : '../base_services',
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

// ── [10] 自测试（--self-test）─────────────────────────────────
let selfTestResult = null;
if (opt.selfTest) {
  step(10, TOTAL, '自测试（--self-test：暂存副本真实启动 → 探活 → 清理）');
  if (bad) {
    info(C.warn('存在校验未通过项，跳过自测试'));
  } else {
    selfTestResult = selfTestPackage(pkg);
    if (!selfTestResult.pass) bad++;
    // 把结果并入 VERSION.json，便于交付物自证
    try {
      const versionFile = path.join(T, 'VERSION.json');
      const vj = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      vj.selfTest = selfTestResult;
      fs.writeFileSync(versionFile, JSON.stringify(vj, null, 2) + '\n', 'utf8');
      info('自测试结果已写入 VERSION.json#selfTest');
    } catch (e) {
      info(C.warn(`写入 VERSION.json 失败（忽略）: ${e.message}`));
    }
  }
} else {
  step(10, TOTAL, '自测试（未指定 --self-test，跳过）');
  info(C.dim('建议：加 --self-test 让打包器真实起一次服务并探活（约 1-2 分钟）'));
}

// ── [11] 压缩分发（--zip）─────────────────────────────────────
if (opt.zip) {
  step(11, TOTAL, '压缩打包（--zip：zip + sha256）');
  if (bad) {
    info(C.warn('存在校验未通过项，跳过压缩（请先修复上面的 ✗ 项）'));
  } else {
    zipPackage(T);
  }
} else {
  step(11, TOTAL, '压缩分发（未指定 --zip，跳过）');
  info(C.dim(`如需分发压缩包：加 --zip 参数重新打包（或自行压缩 ${T}）`));
}

console.log('');
console.log('='.repeat(78));
if (bad) {
  console.log(C.err(`  完成，但有 ${bad} 项校验未通过，请检查上面的 ✗ 项。`));
} else {
  console.log(C.ok('  打包完成。'));
}
console.log('='.repeat(78));
console.log(`  产物目录 : ${T}`);
console.log(`  启动     : ${path.join(T, 'start.bat')}`);
console.log(`  自检     : ${path.join(T, 'self-test.bat')}`);
console.log(`  访问地址 : http://localhost:${opt.port}/`);
console.log(`  健康检查 : http://localhost:${opt.port}/api/v1/system/health`);
if (selfTestResult) {
  console.log(
    `  打包期自测: ${
      selfTestResult.pass
        ? C.ok(`通过（health=200, ${selfTestResult.checks.healthWaitSeconds}s）`)
        : selfTestResult.skipped
          ? C.warn(`跳过（${selfTestResult.skipped}）`)
          : C.err('失败（见 VERSION.json#selfTest）')
    }`,
  );
}
console.log('');
console.log(C.warn('  提示：'));
if (INTERNAL_PATHS) {
  console.log('   1) 自包含形态：整目录可直接拷到目标机，双击 start.bat 一键启动');
  console.log(`      （${pkg.withData ? 'data/ 随包' : 'data/ 指向 ../data'}；${pkg.withServices ? 'base_services/ 随包，start.bat 会先拉起 redis/influxd' : 'base_services/ 未随包'}）。`);
  console.log(`   2) 档位 ${pkg.tier}：${pkg.tier === 'lite' ? 'REDIS_HOST 留空 + HISTORICAL_DATA_BACKEND=sqlite（零外部服务）' : '需 Redis :6379 / InfluxDB :8086（已在包内）'}。`);
  if (pkg.withData && pkg.userData) {
    const excluded = pkg.dataExclude && pkg.dataExclude.length ? `（已排除 ${pkg.dataExclude.join('/')}）` : '';
    console.log(`   3) ⚠️ 本包包含现网用户数据（db/、plugin-configs/、graphic-plugins/ 等）${excluded}，分发前注意保密；`);
    if (pkg.dataExclude.includes('projects')) {
      console.log('      注意：已排除 data/projects ⇒ 全局库中仍留有项目记录，打开项目会因缺 system.db 报错；');
      console.log('      如需"空数据交付"，请改用 --with-data --no-user-data（连 db/ 一起排除）。');
    } else {
      console.log('      如只需"首次安装"式交付，请加 --no-user-data 重新打包。');
    }
  } else {
    console.log('   3) 目标机首次启动会自动建库并执行 TypeORM 迁移（管理员账号需按引导初始化）。');
  }
} else {
  console.log('   1) 运行前请确保基础服务已就绪（复用 ss-run/ss/base_services）：');
  console.log('      Redis :6379 / InfluxDB :8086；未启动时可改 .env 为 Lite 档：');
  console.log('        REDIS_HOST=            （留空 → Redis 相关全 no-op）');
  console.log('        HISTORICAL_DATA_BACKEND=sqlite   （历史数据落 SQLite）');
  console.log('   2) 本包与 4000 端口的实例共用同一 data 目录，请勿同时运行。');
  console.log('   3) 修改端口/档位只需编辑 .env 后重启，无需重新打包。');
  console.log('   4) 需要"一键启动"的自包含交付包：加 --standalone（= --with-data --with-services）。');
}
console.log('');

