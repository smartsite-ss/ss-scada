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

// ─────────────────────────── 基础路径 ───────────────────────────
const ROOT = path.resolve(__dirname, '..');
const SS_NODE = path.join(ROOT, 'ss-services', 'ss-node');
const SS_EDITOR = path.join(ROOT, 'ss-editor');
const RUN_SS = path.join(ROOT, 'ss-run', 'ss');
/** Windows 发布方式暂存区：按发布方式分子目录（见 ss-run/ss-win/README.md） */
const RUN_WIN = path.join(ROOT, 'ss-run', 'ss-win');
/** 发布方式 → 暂存子目录：方式 4（node 直启）与方式 5（薄启动器 exe） */
const RUN_WIN_MODE_DIRS = { node: '04-win-node', exe: '05-win-exe' };
/** 薄启动器源码与编译脚本（--exe 时调用） */
const LAUNCHER_SOURCE = path.join(__dirname, 'launcher', 'SmartSiteLauncher.cs');
const LAUNCHER_BUILD_SCRIPT = path.join(__dirname, 'build-launcher-exe.ps1');

const SERVER_DIST_SRC = path.join(SS_NODE, 'apps', 'ss-node-server', 'dist');
const WEB_DIST_SRC = path.join(SS_EDITOR, 'apps', 'web', 'dist');
const PLUGINS_DIST_SRC = path.join(SS_EDITOR, 'packages', 'plugins', 'dist-plugins');

/** 生产依赖基线（已验证可运行，含原生模块 sqlite3 / node-opcua 等） */
const PROD_DEPS_SRC = path.join(RUN_SS, 'services', 'ss-node', 'node_modules');
/** 参考 .env：继承 JWT / Redis / InfluxDB 等环境相关密钥，保证与现有部署同源可用 */
const REF_ENV = path.join(RUN_SS, 'services', 'ss-node', '.env');

/** i18n 源：优先工作区源（ss-sdk），回退到已部署产物 */
const I18N_SOURCES = [
  path.join(SS_NODE, 'packages', 'ss-sdk', 'src', 'i18n'),
  path.join(RUN_SS, 'services', 'ss-node', 'i18n'),
];

// ───────── 数据 / 基础服务 打包规则（详见文件头 5)），供 copyDataDir / copyBaseServices 使用 ─────────
/** 运行期目录：不进包（目标机启动时重建） */
const DATA_EXCLUDE_DIRS = [
  'logs',
  'logs-data',
  '_bak',
  '_tmp',
  'realtime',
  'rtdb',
  'offline_data',
  'ai-workspace',
  'exports',
];
/** 用户数据目录：--no-user-data 时额外排除（适合"首次安装"式交付） */
const DATA_USER_DIRS = ['db', 'projects', 'plugin-configs', 'graphic-plugins'];
/** 运行期文件：WAL / 日志 / RDB 不进包（WAL 帧由目标机重建，避免跨机 SQLite 状态错乱） */
const DATA_EXCLUDE_FILES = ['*.db-wal', '*.db-shm', '*.db-journal', '*.log', 'dump.rdb'];
/** 随包基础服务：influxdb3 / TDengine / nanomq 体积大且可选 ⇒ 默认不带 */
const BASE_SERVICE_ITEMS = ['redis', 'influxdb2-2.7.8'];
const BASE_SERVICE_EXCLUDE_DIRS = ['logs', 'data'];
const BASE_SERVICE_EXCLUDE_FILES = ['*.log', '*.rdb', '*.aof'];

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

// ─────────────────────────── 通用工具 ───────────────────────────
const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
function step(n, total, msg) {
  console.log(`\n${C.bold(`[${n}/${total}]`)} ${msg}`);
}
function info(msg) {
  console.log(`      ${msg}`);
}
function fail(msg) {
  console.error(`\n${C.err('[ERROR]')} ${msg}`);
  process.exit(1);
}

/**
 * robocopy 拷贝（Windows，快）；非 Windows 或失败时回退 fs.cpSync。
 *
 * purge=true（默认）：/MIR —— 目标多余的项会被删除；
 * purge=false：/E —— 只增量复制，**不删除**目标已有文件（用于"叠加"到已存在的目录，
 *   例如把 dist-plugins 叠加进 web/dist 自带的 web/plugins，避免 /MIR 误删 capability.json）。
 */
function mirror(src, dst, { excludeDirs = [], excludeFiles = [], purge = true } = {}) {
  if (!fs.existsSync(src)) fail(`源目录不存在: ${src}`);
  fs.mkdirSync(dst, { recursive: true });

  if (process.platform === 'win32') {
    const args = [
      src,
      dst,
      purge ? '/MIR' : '/E',
      '/MT:16',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
      '/R:1',
      '/W:1',
    ];
    if (excludeDirs.length) {
      args.push('/XD', ...excludeDirs.map((d) => path.join(src, d)));
    }
    if (excludeFiles.length) {
      args.push('/XF', ...excludeFiles);
    }
    const r = cp.spawnSync('robocopy', args, { stdio: 'inherit', windowsHide: true });
    // robocopy 退出码 0-7 均为成功
    if (r.status === null || r.status > 7) {
      info(C.warn(`robocopy 退出码 ${r.status}，回退 fs.cpSync（带排除过滤）`));
      cpSyncFiltered(src, dst, { excludeDirs, excludeFiles });
    }
    return;
  }
  cpSyncFiltered(src, dst, { excludeDirs, excludeFiles });
}

/** 通配符（仅支持 *）转正则，用于 fs.cpSync 的 filter */
function wildcardToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i');
}

/**
 * fs.cpSync 回退拷贝：**必须**沿用 robocopy 的排除规则。
 * ⚠️ 无排除的 cpSync 会把 data/logs、_bak、rtdb、*.db-wal 一起拷进包（违反打包规则）。
 */
function cpSyncFiltered(src, dst, { excludeDirs = [], excludeFiles = [] } = {}) {
  const dirSet = new Set(excludeDirs.map((d) => path.basename(d)));
  const fileMatchers = excludeFiles.map(wildcardToRegExp);
  fs.cpSync(src, dst, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (s) => {
      const base = path.basename(s);
      if (dirSet.has(base)) return false;
      if (fileMatchers.some((re) => re.test(base))) return false;
      return true;
    },
  });
}

/**
 * 运行外部命令（Windows 上 pnpm/npm 是 .cmd，必须经 cmd.exe 启动）。
 *
 * 不使用 `shell: true` + args 数组：Node 会报 DEP0190（参数未转义，有注入风险）。
 * 改为显式 `cmd.exe /d /s /c "<已引号包裹的整条命令>"`。
 */
function run(cmd, args, cwd, env) {
  info(C.dim(`$ ${cmd} ${args.join(' ')}`));
  const isWin = process.platform === 'win32';
  const quote = (s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const r = isWin
    ? cp.spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', [cmd, ...args].map(quote).join(' ')],
        { cwd, stdio: 'inherit', env: { ...process.env, ...(env || {}) } },
      )
    : cp.spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...(env || {}) } });
  if (r.status !== 0) {
    // 134 / 0xC0000409 类信号 = V8 堆 OOM（前端构建最常见），单独给出可操作提示
    if (r.status === 134 || r.status === 3221225477 || r.status === -1073740791) {
      console.error('');
      console.error(
        C.err(`[ERROR] 命令异常终止（退出码 ${r.status}，通常为 V8 堆内存不足）: ${cmd} ${args.join(' ')}`),
      );
      console.error(
        C.warn(
          `  处理：① 关闭占用内存的程序后重试；② --build-heap=<MB> 指定更大的堆（须小于可用物理内存，当前可用 ${Math.floor(
            os.freemem() / 1048576,
          )} MB）；③ 加 --no-build 复用现有 dist 跳过构建。`,
        ),
      );
      process.exit(1);
    }
    fail(`命令失败（退出码 ${r.status}）: ${cmd} ${args.join(' ')}`);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** 从 .env 文本解析键值（忽略注释与空行） */
function parseEnvFile(p) {
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    map.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return map;
}

function gitCommit() {
  try {
    const r = cp.spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return (r.stdout || '').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 扫描工作区中可覆盖进 node_modules 的包（@ss-node/* 且已有 dist）。
 *
 * ⚠️ 注意：`packages/ss-storage/` 自身就是一个包，而其子目录
 * （ss-storage-influx / -influx3 / -tdengine）也是包 ⇒ **命中后仍必须继续下钻**，
 * 否则会漏掉嵌套层的工作区包，导致运行期 MODULE_NOT_FOUND。
 */
function scanWorkspacePackages() {
  const out = [];
  const seen = new Set();
  const SKIP = new Set([
    'node_modules',
    'dist',
    'dist_test',
    'src',
    'coverage',
    'scripts',
    'test',
    'tests',
    '__tests__',
  ]);
  const walk = (dir, depth) => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const pjPath = path.join(full, 'package.json');
      if (fs.existsSync(pjPath)) {
        const pj = readJson(pjPath);
        if (
          pj &&
          typeof pj.name === 'string' &&
          pj.name.startsWith('@ss-node/') &&
          fs.existsSync(path.join(full, 'dist'))
        ) {
          if (!seen.has(pj.name)) {
            seen.add(pj.name);
            out.push({ name: pj.name, dir: full });
          }
        }
      }
      walk(full, depth + 1); // 继续下钻：嵌套工作区包（如 packages/ss-storage/*）
    }
  };
  walk(path.join(SS_NODE, 'packages'), 0);
  return out;
}

/**
 * 生产依赖基线自举（ss-scada 适配）。
 *
 * v7 打包器复用「已部署产物」ss-run/ss/services/ss-node/node_modules 作平面化生产依赖基线；
 * ss-scada 当前没有该基线 ⇒ 首次运行时用工作区清单 + 锁文件现场构建一个：
 *   1) 暂存目录只放清单（根 package.json / pnpm-workspace.yaml / .npmrc / pnpm-lock.yaml
 *      + 各工作区包的 package.json，不含源码）；
 *   2) pnpm install --frozen-lockfile --prod --ignore-scripts --config.node-linker=hoisted
 *      ⇒ 平面化（hoisted）生产 node_modules；工作区包以清单目录形式就位，dist 由步骤 [6] 覆盖；
 *   3) 原生模块（sqlite3）不出构建产物 ⇒ 从工作区 node_modules/.pnpm 复制已编译绑定；
 *   4) node_modules 移入 RUN_SS/services/ss-node（即 PROD_DEPS_SRC），暂存目录清理。
 * 幂等：基线已存在则直接返回。之后打包器按原逻辑复制基线，无需感知差异。
 */
function ensureProdDepsBaseline() {
  if (fs.existsSync(PROD_DEPS_SRC)) return;
  info(C.warn(`生产依赖基线不存在，开始自举：${path.relative(ROOT, PROD_DEPS_SRC)}`));

  const stage = path.join(RUN_SS, 'services', `.stage-baseline-${Date.now()}`);
  const stageModules = path.join(stage, 'node_modules');
  try {
    ensureDir(stage);
    // 1) 根清单
    for (const f of ['package.json', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml']) {
      const src = path.join(SS_NODE, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, f));
    }
    // 2) 各工作区包的 package.json（保持相对路径；跳过 node_modules/dist 等）
    const SKIP = new Set(['node_modules', 'dist', 'dist_test', 'coverage', 'scripts', '__tests__']);
    const collectManifests = (dir, rel, depth) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const relNext = rel ? path.join(rel, e.name) : e.name;
        const pj = path.join(full, 'package.json');
        if (fs.existsSync(pj)) {
          const dstRel = path.join(stage, relNext);
          ensureDir(dstRel);
          fs.copyFileSync(pj, path.join(dstRel, 'package.json'));
        }
        collectManifests(full, relNext, depth + 1);
      }
    };
    collectManifests(path.join(SS_NODE, 'packages'), 'packages', 0);
    collectManifests(path.join(SS_NODE, 'apps'), 'apps', 0);

    // 3) 平面化生产安装（跳过原生构建，绑定稍后从工作区复制）
    run('pnpm', ['install', '--frozen-lockfile', '--prod', '--ignore-scripts', '--config.node-linker=hoisted'], stage);
    if (!fs.existsSync(stageModules)) fail('基线自举：pnpm install 未产出 node_modules');

    // 4) 复制已编译的 sqlite3 绑定（工作区 .pnpm 中现成可用；hoisted 布局无 .pnpm，需按版本散填）
    const pnpmStore = path.join(SS_NODE, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmStore)) {
      const sqlite3Dirs = [];
      const walkSqlite3 = (dir, depth) => {
        if (depth > 6 || !fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          if (e.name === 'sqlite3') {
            const pj = readJson(path.join(dir, e.name, 'package.json'));
            if (pj) sqlite3Dirs.push({ dir: path.join(dir, e.name), version: pj.version });
            continue;
          }
          walkSqlite3(path.join(dir, e.name), depth + 1);
        }
      };
      walkSqlite3(stageModules, 0);
      for (const { dir, version } of sqlite3Dirs) {
        const variantDir = fs
          .readdirSync(pnpmStore)
          .find((n) => n === `sqlite3@${version}` || n.startsWith(`sqlite3@${version}@`));
        const bindingSrc = variantDir
          ? path.join(
              pnpmStore,
              variantDir,
              'node_modules',
              'sqlite3',
              'build',
              'Release',
              'node_sqlite3.node',
            )
          : null;
        if (!bindingSrc || !fs.existsSync(bindingSrc)) {
          info(C.warn(`  ! 未找到 sqlite3@${version} 的已编译绑定（${path.relative(ROOT, dir)}），运行期将回退 bindings 查找`));
          continue;
        }
        ensureDir(path.join(dir, 'build', 'Release'));
        fs.copyFileSync(bindingSrc, path.join(dir, 'build', 'Release', 'node_sqlite3.node'));
        info(`  sqlite3@${version} 绑定 ← ${path.relative(ROOT, bindingSrc)}`);
      }
    }

    // 5) node_modules 移入正式基线位置
    ensureDir(path.dirname(PROD_DEPS_SRC));
    if (fs.existsSync(PROD_DEPS_SRC)) fs.rmSync(PROD_DEPS_SRC, { recursive: true, force: true });
    fs.renameSync(stageModules, PROD_DEPS_SRC);
    info(C.ok(`生产依赖基线已就绪：${path.relative(ROOT, PROD_DEPS_SRC)}`));
  } finally {
    if (fs.existsSync(stage)) {
      try {
        fs.rmSync(stage, { recursive: true, force: true });
      } catch {
        info(C.warn(`暂存目录清理失败（可手动删除）: ${stage}`));
      }
    }
  }
}

/**
 * 汇总「运行期需要的三方依赖」= 主应用 deps ∪ 各工作区包 deps。
 * 用于检测复用的依赖基线是否缺少新版代码新增的依赖。
 */
function collectRequiredDeps(workspacePkgs) {
  const req = new Map();
  const add = (deps) => {
    for (const [k, v] of Object.entries(deps || {})) if (!req.has(k)) req.set(k, v);
  };
  const appPkg = readJson(path.join(SS_NODE, 'apps', 'ss-node-server', 'package.json'));
  add(appPkg && appPkg.dependencies);
  for (const p of workspacePkgs) {
    const pj = readJson(path.join(p.dir, 'package.json'));
    add(pj && pj.dependencies);
  }
  return req;
}

// ─────────────────────────── 主流程 ───────────────────────────
const T = opt.target;
const TOTAL = 11;

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

// ── [1] 构建 ──────────────────────────────────────────────────
step(1, TOTAL, '构建（后端 / 前端）');
let tempWebEnv = null;
if (opt.build) {
  info(
    `构建堆上限：${BUILD_HEAP.mb} MB（可用物理内存 ${BUILD_HEAP.freeMb} MB / 共 ${BUILD_HEAP.totalMb} MB；来源：${BUILD_HEAP.source}）`,
  );
  if (BUILD_HEAP.freeMb < 6144) {
    info(
      C.warn(
        `⚠️ 可用物理内存偏低（${BUILD_HEAP.freeMb} MB）：前端构建易 OOM。建议关掉其它占用内存的程序，或先用 --no-build 复用现有 dist，或用 --build-heap=<MB> 显式指定。`,
      ),
    );
  }
  if (opt.server) {
    info('后端：pnpm build（ss-services/ss-node → apps/ss-node-server/dist）');
    run('pnpm', ['build'], SS_NODE, BUILD_ENV);
  }
  if (opt.web) {
    // 前端必须同源（相对地址）构建，否则会烤入绝对 API 地址（见文件头说明 3）
    const envLocal = path.join(SS_EDITOR, 'apps', 'web', '.env.production.local');
    tempWebEnv = envLocal;
    fs.writeFileSync(
      envLocal,
      [
        '# 由 bin/publish-smart-site.cjs 临时生成（构建后自动删除）',
        '# 单包 S1 同源部署：API/WS 走相对地址，避免烤入 http://localhost:4000',
        'VITE_API_BASE_URL=',
        'VITE_WS_URL=',
        'VITE_DEPLOY_BASE=/',
        '',
      ].join('\r\n'),
      'utf8',
    );
    info(C.warn(`临时写入 ${path.relative(ROOT, envLocal)}（VITE_API_BASE_URL 置空 → 同源）`));
    try {
      // ss-scada 适配：目录插件的独立 ESM 产物（dist-plugins）依赖 importmap 单例机制，
      // 而本仓多个插件直接 import @scada-editor/system（v7 插件不这么做，且 system/shared
      // 尚无 importmap 单例产物）⇒ build:plugins 必然失败。应用内打包的插件（build:web
      // 经 vite-plugin-bundled-plugins 编译进主包）才是单包发布的运行主体，故此处降级为
      // 尽力而为：失败仅告警，不阻断发布（独立插件热更新发布流程为已知待办）。
      info('前端：pnpm build:plugins（图元插件独立产物；尽力而为，失败不阻断）');
      const r = cp.spawnSync('cmd', ['/d', '/s', '/c', 'pnpm build:plugins'], {
        cwd: SS_EDITOR,
        stdio: 'inherit',
        env: { ...process.env, VITE_DEPLOY_BASE: '/', ...BUILD_ENV },
      });
      if (r.status !== 0) {
        info(
          C.warn(
            '! build:plugins 失败（已跳过）：dist-plugins 独立插件产物缺失。' +
              '发布包仍含应用内打包的全部插件（build:web），仅独立热更新发布流程受影响。',
          ),
        );
      }
      info(`前端：pnpm build:web:${opt.mode}（Vite mode=production|scada|data）`);
      const webCmd = opt.mode === 'full' ? 'build:web' : `build:web:${opt.mode}`;
      run('pnpm', [webCmd], SS_EDITOR, BUILD_ENV);
    } finally {
      if (tempWebEnv && fs.existsSync(tempWebEnv)) {
        fs.rmSync(tempWebEnv, { force: true });
        info(C.dim('已删除临时 .env.production.local'));
      }
    }
  }
} else {
  info(C.dim('跳过构建，使用现有 dist 产物'));
}

// ── [2] 后端产物 ──────────────────────────────────────────────
step(2, TOTAL, '复制后端产物（dist / i18n）');
if (opt.server) {
  mirror(SERVER_DIST_SRC, path.join(T, 'dist'));
  info(`dist ← ${path.relative(ROOT, SERVER_DIST_SRC)}`);
  const i18nSrc = I18N_SOURCES.find((p) => fs.existsSync(p));
  if (!i18nSrc) fail('未找到 i18n 资源（packages/ss-sdk/src/i18n 或已部署的 i18n/）');
  mirror(i18nSrc, path.join(T, 'i18n'));
  info(`i18n ← ${path.relative(ROOT, i18nSrc)}`);
} else {
  info(C.dim('跳过（--no-server）'));
}

// ── [3] 前端产物 ──────────────────────────────────────────────
step(3, TOTAL, '复制前端产物（web / web/plugins）');
if (opt.web) {
  if (!fs.existsSync(path.join(WEB_DIST_SRC, 'index.html'))) {
    fail(`前端产物不存在: ${WEB_DIST_SRC}\\index.html（先构建，或去掉 --no-build）`);
  }
  mirror(WEB_DIST_SRC, path.join(T, 'web'));
  info(`web ← ${path.relative(ROOT, WEB_DIST_SRC)}`);
  if (fs.existsSync(PLUGINS_DIST_SRC)) {
    // ⚠️ purge:false —— 叠加而非镜像：web/dist/plugins 里还带 capability.json / plugin-overrides.json
    // （AI 页面生成与 MCP component_* 的能力快照），/MIR 会把它们删掉。
    mirror(PLUGINS_DIST_SRC, path.join(T, 'web', 'plugins'), { purge: false });
    info(`web/plugins ← ${path.relative(ROOT, PLUGINS_DIST_SRC)}（叠加模式，保留 capability.json）`);
    const capabilityJson = path.join(T, 'web', 'plugins', 'capability.json');
    if (!fs.existsSync(capabilityJson)) {
      info(
        C.warn(
          '! web/plugins/capability.json 缺失：AI 页面生成器的组件能力快照未随包（检查 apps/web/dist/plugins）',
        ),
      );
    }
  } else {
    info(C.warn(`未找到 ${path.relative(ROOT, PLUGINS_DIST_SRC)}，跳过图元插件产物`));
  }
} else {
  info(C.dim('跳过（--no-web）'));
}

// ── [4] 数据目录 / 基础服务 / 随包 Node（自包含，一键启动）──────
step(4, TOTAL, '打包数据目录 / 基础服务 / 随包 Node（--with-data / --with-services / --with-node）');
if (opt.withData) {
  copyDataDir(path.join(T, 'data'));
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

// ── [5] 生产依赖 ──────────────────────────────────────────────
step(5, TOTAL, '准备生产依赖 node_modules');
ensureProdDepsBaseline();
const targetModules = path.join(T, 'node_modules');
if (opt.server && opt.deps) {
  if (opt.linkDeps) {
    if (fs.existsSync(targetModules)) fs.rmSync(targetModules, { recursive: true, force: true });
    if (process.platform !== 'win32') fail('--link-deps 仅支持 Windows（mklink /J）');
    const r = cp.spawnSync('cmd', ['/c', 'mklink', '/J', targetModules, PROD_DEPS_SRC], {
      stdio: 'inherit',
    });
    if (r.status !== 0) fail('创建目录联接失败');
    info(`node_modules 联接 → ${path.relative(ROOT, PROD_DEPS_SRC)}`);
  } else {
    if (!fs.existsSync(PROD_DEPS_SRC)) fail(`生产依赖基线不存在: ${PROD_DEPS_SRC}`);
    info(`复制第三方依赖基线 ← ${path.relative(ROOT, PROD_DEPS_SRC)}（可能耗时 1-3 分钟）`);
    mirror(PROD_DEPS_SRC, targetModules);
  }

  // ── [6] 用工作区最新 dist 覆盖 @ss-node/* ──────────────────
  step(6, TOTAL, '覆盖工作区包 @ss-node/*（避免用到过期的已发布包）');
  const pkgs = scanWorkspacePackages();
  const isJunction = opt.linkDeps;
  let overlaid = 0;
  for (const p of pkgs) {
    const dst = path.join(targetModules, ...p.name.split('/'));
    if (isJunction) {
      // 联接模式下不能直接写进联接目录（会污染源），故跳过覆盖并提示
      continue;
    }
    ensureDir(dst);
    mirror(path.join(p.dir, 'dist'), path.join(dst, 'dist'));
    fs.copyFileSync(path.join(p.dir, 'package.json'), path.join(dst, 'package.json'));
    const pkgI18n = path.join(p.dir, 'i18n');
    if (fs.existsSync(pkgI18n)) mirror(pkgI18n, path.join(dst, 'i18n'));
    overlaid++;
  }
  if (isJunction) {
    info(
      C.warn(
        `--link-deps 模式：跳过 ${pkgs.length} 个 @ss-node/* 的覆盖（避免污染基线目录）。` +
          `若基线中的工作区包较旧，请改用默认复制模式。`,
      ),
    );
  } else {
    info(C.ok(`已覆盖 ${overlaid} 个工作区包（含新增包，如 ss-collector-calc）`));
  }
  // ── [6b] 补齐三方依赖缺口：复用的基线可能缺少「新版代码新增」的依赖 ──
  // 典型：@ss-node/ss-core 新版引入 @modelcontextprotocol/sdk，而旧基线没有 ⇒
  // 运行期 MODULE_NOT_FOUND（与 2026-09-04 部署清单漏项事故同类，见 ci_ss_backand.bat 注释）。
  if (!isJunction) {
    const missing = [];
    for (const [name, range] of collectRequiredDeps(pkgs)) {
      const r = String(range);
      if (r.startsWith('workspace:')) continue; // 工作区包由 overlay 提供
      try {
        require.resolve(name, { paths: [targetModules] });
      } catch {
        missing.push(`${name}@${r}`);
      }
    }
    if (!missing.length) {
      info(C.ok('三方依赖无缺口'));
    } else if (!opt.installMissing) {
      info(
        C.warn(
          `检测到 ${missing.length} 个缺失依赖，但 --no-install-missing 已禁用自动补齐：${missing.join(', ')}`,
        ),
      );
    } else {
      info(`检测到 ${missing.length} 个缺失依赖，开始补齐：${missing.join(', ')}`);
      const staging = path.join(ROOT, 'temp', 'smart-site-deps');
      fs.rmSync(staging, { recursive: true, force: true });
      ensureDir(staging);
      const depsObj = {};
      for (const m of missing) {
        const i = m.lastIndexOf('@');
        depsObj[m.slice(0, i)] = m.slice(i + 1);
      }
      fs.writeFileSync(
        path.join(staging, 'package.json'),
        JSON.stringify(
          { name: 'smart-site-deps', private: true, version: '0.0.0', dependencies: depsObj },
          null,
          2,
        ),
        'utf8',
      );
      run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], staging);
      // 合并进目标 node_modules（已存在的保持不动，避免污染复用基线）
      let copied = 0;
      const merge = (src, dst) => {
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, e.name);
          const d = path.join(dst, e.name);
          if (e.isDirectory()) {
            if (e.name.startsWith('@')) {
              ensureDir(d);
              merge(s, d);
            } else if (!fs.existsSync(d)) {
              fs.cpSync(s, d, { recursive: true, dereference: true });
              copied++;
            }
          } else if (!fs.existsSync(d)) {
            fs.copyFileSync(s, d);
          }
        }
      };
      merge(path.join(staging, 'node_modules'), targetModules);
      fs.rmSync(staging, { recursive: true, force: true });
      info(C.ok(`已补齐 ${copied} 个依赖包目录`));
    }
  }
} else {
  info(C.dim(opt.server ? '跳过依赖（--no-deps）' : '跳过（--no-server）'));
  step(6, TOTAL, '跳过工作区包覆盖');
  info(C.dim('依赖未更新'));
}

// ── [7] 生成 .env ─────────────────────────────────────────────
step(
  7,
  TOTAL,
  INTERNAL_PATHS
    ? '生成运行时配置 .env（★ 自包含：路径指向包内 ./data 与 ./base_services）'
    : '生成运行时配置 .env（复用 ../data 与 ../base_services）',
);
const ref = parseEnvFile(REF_ENV);
const builtAt = new Date().toISOString();

/** 有序配置项：{key, value, comment?}；重复 key 后写覆盖前写 */
const items = [];
const index = new Map();
const set = (key, value, comment) => {
  if (index.has(key)) items[index.get(key)].value = value;
  else {
    index.set(key, items.length);
    items.push({ key, value, comment });
  }
};

set('NODE_ENV', 'production', '应用：运行时环境（production ⇒ SS_NODE_ROOT = cwd）');
set('APP_PRODUCT_MODE', opt.mode, '产品模式 full|scada|data（后端模块注册范围）');
set('PORT', String(opt.port));

set('WEB_DIST_DIR', './web', 'S1 单进程：后端托管前端 SPA（免 Nginx）；注释掉则由 Nginx 托管');
set('SS_DEPLOY_MODE', 'pro', '图元插件：pro 模式开放导入/导出/目录重检/发布复制');
set('PLUGIN_PUBLISH_DIR', './web/plugins', '图元插件发布目录（S1：包内 web/plugins）');

set(
  'DATA_DIR',
  ENV_DATA_DIR,
  opt.withData
    ? '数据根目录（★ 自包含：包内 ./data，随包分发）'
    : '数据根目录（复用 ss-run/ss/data，不复制）',
);
set(
  'RUN_DIR',
  ENV_RUN_DIR,
  INTERNAL_PATHS ? '运行目录（★ 包根 = cwd）' : '运行目录（复用 ss-run/ss）',
);
set('BACKUP_DIR', '${RUN_DIR}/data/_bak');
set(
  'BASE_SERVICES_DIR',
  '${RUN_DIR}/base_services',
  INTERNAL_PATHS ? '基础服务根目录（★ 包内 ./base_services）' : '基础服务根目录（复用现有 redis/influxdb）',
);
set(
  'INFLUXDB_DATA_DIR',
  '${RUN_DIR}/rtdb/influxdb2',
  'InfluxDB 数据根目录（按引擎分层：rtdb/influxdb2；⚠️ 必须与 base_services/influxdb2-2.7.8/config.yaml 的 engine-path/bolt-path/sqlite-path 一致）',
);
set(
  'INFLUXDB3_DATA_DIR',
  '${RUN_DIR}/rtdb/influxdb3',
  'InfluxDB 3 Core 数据根目录（可选引擎；实际落盘由 startArgs 的 --data-dir ../../rtdb/influxdb3 控制）',
);
set('DB_TYPE', 'sqlite');
set('DATABASE_PATH', '${DATA_DIR}/db/ss-node.db');
set('PROJECTS_DIR', '${DATA_DIR}/projects');
set('PROJECT_DB_MODE', 'isolated');
set('PROJECT_DB_INIT_DIR', '${DATA_DIR}/init');
set('LOG_DIR', '${DATA_DIR}/logs');
set('LOG_LEVEL', 'info');
set('LOG_MAX_SIZE', '100m');
set('LOG_MAX_FILES', '10');
set('PLUGIN_CONFIG_DIR', '${DATA_DIR}/plugin-configs', '采集插件运行时配置（activated/isolationMode）');
set(
  'DATA_SCOPE_ENFORCE',
  'true',
  '资源级数据权限（项目/设备）开关；false 会关闭校验并打印 WARN，仅排障时临时使用',
);
set('GRAPHIC_PLUGIN_CONFIG_DIR', '${DATA_DIR}/graphic-plugins');
set('REALTIME_DATA_DIR', '${DATA_DIR}/realtime');
set('OFFLINE_CACHE_DIR', '${DATA_DIR}/offline_data');
set('SS_TMP_DIR', '${DATA_DIR}/_tmp');
set('TEMPLATES_DIR', '${DATA_DIR}/templates');
set('DICTS_DIR', '${DATA_DIR}/dicts');
set('LAYOUT_TEMPLATES_DIR', '${DATA_DIR}/canvas-templates');
set('WIDGET_TEMPLATES_DIR', '${DATA_DIR}/canvas-templates');
set('CANVAS_TEMPLATE_MODE', 'reference');
set('IMAGES_DIR', '${DATA_DIR}/images');
set('KB_ROOT', '${DATA_DIR}/faq');
set('KB_DEFAULT_LANG', 'zh-CN');
set('KB_SUPPORTED_LANGS', 'zh-CN,en-US');
set('KB_AI_BUILD_ENABLED', 'false');

set('I18N_FALLBACK_LANGUAGE', 'zh-CN');
set('I18N_SUPPORTED_LANGUAGES', 'zh-CN,en-US,zh-TW');
set('I18N_WATCH', 'false');
set('I18N_RESPONSE_HEADER', 'false');

// 基础服务：由 start.bat 统一拉起（一键启动），故此处保持 false，避免"双起点"抢端口。
// ⚠️ 注意：该键目前仅是 config-metadata 中的元数据（BaseServicesService.autoStartServices()
//    只认 DB 的 sys_base_services.auto_start 列），置 true 并不会自动拉起服务。
set('AUTO_START_BASE_SERVICES', 'false', '元数据项：是否由后端自动拉起基础服务（当前实现不读取）');
const isLite = opt.tier === 'lite';
set('REDIS_HOST', isLite ? '' : 'localhost', isLite ? 'Lite 档：留空 ⇒ Redis 相关能力整体 no-op' : undefined);
set('REDIS_PORT', '6379');
set('INFLUXDB_URL', 'http://localhost:8086');
set('INFLUXDB_ORG', 'ss-org');
set('INFLUXDB_BUCKET', 'ss_node_data');
set('INFLUXDB_TOKEN', '');
set(
  'HISTORICAL_DATA_BACKEND',
  isLite ? 'sqlite' : 'influxdb',
  'influxdb（默认）| sqlite（Lite 档：免 InfluxDB，历史数据落 SQLite）',
);
set('NANOMQ_PORT', '1883');

set('JWT_SECRET', randomSecret(48));
set('JWT_EXPIRES_IN', '7d');
set('COOKIE_SECURE', 'false');
set('RATE_LIMIT_MAX', '6000');
set('RATE_LIMIT_WINDOW_MS', '60000');
set('CORS_ORIGINS', `http://localhost:${opt.port}`);
set('SYSTEM_CONFIG_ENCRYPTION_KEY', 'ss-v7-default-encryption-key-32b');
set('AI_ENABLED', 'true');
set('OPERATION_LOG_ENABLED', 'true');
set(
  'WECHAT_LOGIN_ENABLED',
  'false',
  '微信扫码登录：单包默认关闭（开启需自行配置 WECHAT_* 与回调域名）',
);
set('MEMORY_WARN_PERCENT', '70');
set('MEMORY_CRITICAL_PERCENT', '85');
set('DISK_WARN_PERCENT', '70');
set('DISK_CRITICAL_PERCENT', '85');

// 从现有生产 .env 继承「同源可用必需」的密钥/连接类配置。
//
// ⚠️ 刻意不继承（避免把线上环境带入本地/内网单包）：
//   - SCADA_SHELL_BASE_URL / SYSTEM_BASE_URL / WECHAT_*  → 线上域名，会导致回调与跳转指向错误环境
//   - SWAGGER_USER / SWAGGER_PASSWORD                    → 继承后会在本包暴露 /api/docs
const INHERIT_KEYS = [
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'SYSTEM_CONFIG_ENCRYPTION_KEY',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'INFLUXDB_URL',
  'INFLUXDB_TOKEN',
  'INFLUXDB_ORG',
  'INFLUXDB_BUCKET',
  'HISTORICAL_DATA_BACKEND',
  'NANOMQ_PORT',
  'OPERATION_LOG_ENABLED',
  'OPERATION_LOG_RETENTION_DAYS',
];
/** Lite 档：Redis / InfluxDB 相关键一律不继承（继承会把档位改回 Standard） */
const LITE_SKIP_KEYS = new Set([
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'INFLUXDB_URL',
  'INFLUXDB_TOKEN',
  'INFLUXDB_ORG',
  'INFLUXDB_BUCKET',
  'HISTORICAL_DATA_BACKEND',
  'NANOMQ_PORT',
]);
const inherited = []; // 纯键名（写入 VERSION.json）
const inheritedLabel = []; // 带标注（写入 .env 注释）
const inheritedSkipped = [];
for (const k of INHERIT_KEYS) {
  if (isLite && LITE_SKIP_KEYS.has(k)) continue;
  const v = ref.get(k);
  if (v === undefined || v === '') continue;
  // JWT_SECRET 特殊处理：main.ts 的 validateJwtSecret() 在生产模式下会拒绝
  // 「已知默认值 / 占位特征」密钥并 process.exit(1)。历史生产配置里正是这类弱值，
  // 直接继承会导致打好的包一启动就 FATAL ⇒ 弱值一律改用随机强密钥（需用户重新登录）。
  if (k === 'JWT_SECRET' && isWeakSecret(v)) {
    inheritedSkipped.push(`${k}（值为已知默认/弱密钥，已改用随机强密钥）`);
    continue;
  }
  const existed = index.has(k);
  set(k, v, existed ? undefined : '以下键值继承自现有生产配置（同源可用：JWT / Redis / InfluxDB）');
  inherited.push(k);
  inheritedLabel.push(`${k}${existed ? '' : '（新增）'}`);
}
if (inheritedSkipped.length) {
  for (const s of inheritedSkipped) info(C.warn(`继承跳过：${s}`));
}

// ── 守卫：JWT_SECRET 必须「安全字符集 + ≥32 字符」 ──
// 否则 .env 解析后被截短，生产启动即 FATAL（实测事故见 randomSecret 注释）。
const jwtItem = items.find((it) => it.key === 'JWT_SECRET');
if (jwtItem && !/^[A-Za-z0-9_-]{32,}$/.test(String(jwtItem.value))) {
  info(
    C.warn(
      `JWT_SECRET 不合规（长度 ${String(jwtItem.value).length} 或含 $ / # 等 .env 特殊字符），已重新生成安全密钥`,
    ),
  );
  jwtItem.value = randomSecret(48);
}

const envLines = [
  '# ===========================================================================',
  '#  Smart Site 单包运行时配置（S1 单进程，无 Nginx）',
  `#  生成时间：${builtAt}`,
  `#  生成脚本：bin/publish-smart-site.cjs（方案见 docs/00-全局/发布/单包发布方案.md）`,
  '#',
  '#  ⚠️ 本文件为生产模式唯一配置（NODE_ENV=production 时只读 cwd/.env）。',
  '#  ⚠️ 所有依赖 ${DATA_DIR} / ${RUN_DIR} 的路径变量必须留在本文件内 ——',
  '#     跨文件加载时 dotenv-expand 无法展开，会导致模板/字典/插件配置加载为空。',
  INTERNAL_PATHS
    ? '#  ✅ 自包含形态：DATA_DIR=./data、RUN_DIR=.、BASE_SERVICES_DIR=./base_services —— 整个目录可整体搬移。'
    : '#  ⚠️ 复用形态：DATA_DIR=../data、BASE_SERVICES_DIR=../base_services。',
  INTERNAL_PATHS
    ? '#     双击 start.bat 一键启动（start.bat 会拉起包内 redis/influxd 后再启动后端）。'
    : '#     因此不要与其它实例（如 4000 端口的服务）同时运行并写同一套数据。',
  '# ===========================================================================',
  '',
];
let lastComment = null;
for (const it of items) {
  if (it.comment && it.comment !== lastComment) {
    envLines.push(`# ── ${it.comment} ──`);
    lastComment = it.comment;
  }
  envLines.push(`${it.key}=${it.value}`);
}
if (inherited.length) {
  envLines.push('');
  envLines.push(
    `# 说明：以上继承项来自现有生产配置 ${path.relative(ROOT, REF_ENV)}（同源可用）。`,
  );
  envLines.push(`#      继承键：${inheritedLabel.join(', ')}`);
  envLines.push('#      如需独立配置，直接修改本文件中对应行即可。');
}
envLines.push('');
fs.writeFileSync(path.join(T, '.env'), envLines.join('\r\n'), 'utf8');
info(`.env 已生成（含 ${items.length} 项，继承 ${inherited.length} 项）`);

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
  checks.push(['rtdb/influxdb2', '时序数据落点（空目录）']);
  checks.push(['_start-services.bat', '基础服务引导脚本']);
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

// ─────────────────────────── 生成器实现 ───────────────────────────
/**
 * 与 apps/ss-node-server/src/main.ts 的 validateJwtSecret() 同源的「弱密钥」启发式。
 * 生产模式下弱密钥会导致启动即 process.exit(1)，故继承前必须过滤。
 */
function isWeakSecret(v) {
  const WEAK_SECRET_HINTS = [
    'change-this',
    'change_this',
    'changeme',
    'your-',
    'replace-',
    'placeholder',
    'default-secret',
    'todo-replace',
  ];
  const s = String(v || '').toLowerCase();
  if (s.length < 32) return true;
  return WEAK_SECRET_HINTS.some((h) => s.includes(h));
}

/**
 * 生成随机密钥。
 *
 * ⚠️ 字符集**只能**用 `A-Za-z0-9-_`：`.env` 里 `$` 会被 dotenv-expand 当变量引用（`$F6` → 空），
 * `#` 可能被当行内注释 ⇒ 值被截短。实测事故（2026-10-14）：随机密钥含 `$`/`#`，
 * 48 字符被解析成 25 字符，生产启动直接 `FATAL: JWT_SECRET 长度不足`。
 */
function randomSecret(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let s = '';
  const bytes = require('crypto').randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

/** 生成 .bat：UTF-8 BOM + CRLF（项目规范：.bat 必须 UTF-8 BOM + chcp 65001） */
function writeBat(file, lines) {
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n'), 'utf8');
}

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

/** 流式 sha256（避免 readFileSync 把整个 zip 读进内存） */
function sha256FileSync(file) {
  const hash = require('crypto').createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** 压缩分发（--zip）：tar.exe（Win10+ 自带，快）→ 回退 Compress-Archive；输出 <包名>.zip + .sha256 */
function zipPackage(dir) {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const zipPath = path.join(parent, `${base}.zip`);
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  const t0 = Date.now();
  info(`压缩中：${base}/ → ${path.basename(zipPath)}（大包可能耗时数分钟）`);
  const tar = cp.spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', parent, base], {
    stdio: 'inherit',
    windowsHide: true,
  });
  let ok = tar.status === 0 && fs.existsSync(zipPath);
  if (!ok) {
    info(C.warn('tar.exe 压缩失败，回退 PowerShell Compress-Archive（更慢）'));
    const ps = `Compress-Archive -Path '${dir}' -DestinationPath '${zipPath}' -Force`;
    const r = cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      stdio: 'inherit',
      windowsHide: true,
    });
    ok = r.status === 0 && fs.existsSync(zipPath);
  }
  if (!ok) {
    info(C.err('✗ 压缩失败（未生成 sha256）'));
    return;
  }
  const sizeMb = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  const hash = sha256FileSync(zipPath);
  fs.writeFileSync(`${zipPath}.sha256`, `${hash}  ${path.basename(zipPath)}\r\n`, 'utf8');
  info(C.ok(`✓ ${path.basename(zipPath)}  ${sizeMb} MB  用时 ${((Date.now() - t0) / 60000).toFixed(1)} min`));
  info(`sha256 = ${hash}`);
  info(`校验文件：${path.relative(ROOT, `${zipPath}.sha256`)}`);
  info(C.dim(`目标机校验：certutil -hashfile ${path.basename(zipPath)} SHA256`));
}

/** 同步睡眠（CJS 顶层流程无法 await，用 Atomics.wait 实现） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 删除目录（带重试）：Windows 上刚被 taskkill 的进程句柄释放有延迟，
 * 直接 rmSync 会 EPERM（实测：自测试通过后清理暂存目录失败）。
 * 兜底：PowerShell [IO.Directory]::Delete（不走回收站；部分环境 node 进程的
 * fs.rmSync 会被外层钩子强制重定向到回收站，在不支持的盘符上必然失败）。
 */
function rmDirWithRetry(dir, attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      return true;
    } catch (e) {
      if (i === attempts) {
        info(C.warn(`rmSync 清理失败（${e.code}），尝试 PowerShell .NET 强制删除：${dir}`));
        break;
      }
      sleepSync(800);
    }
  }
  const escaped = dir.replace(/'/g, "''");
  const r = cp.spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[System.IO.Directory]::Delete('${escaped}', $true); if (Test-Path -LiteralPath '${escaped}') { exit 1 } else { exit 0 }`,
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 120000 },
  );
  if (r.status === 0 && !fs.existsSync(dir)) {
    info(C.ok('PowerShell .NET 删除成功'));
    return true;
  }
  info(C.warn(`清理目录失败（被占用或权限不足）：${dir} —— 可手动删除`));
  return false;
}

/** 同步 HTTP 状态码探测（子进程内用 http 模块请求；失败/超时返回 0） */
function httpStatusSync(url, timeoutSec = 5) {
  const script = [
    'const u = process.argv[1];',
    'const req = require("http").get(u, (r) => { process.stdout.write(String(r.statusCode)); req.destroy(); process.exit(0); });',
    `req.setTimeout(${timeoutSec * 1000}, () => { req.destroy(); process.exit(2); });`,
    'req.on("error", () => process.exit(1));',
  ].join('');
  const r = cp.spawnSync(process.execPath, ['-e', script, url], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: (timeoutSec + 2) * 1000,
  });
  const code = String(r.stdout || '').trim();
  return r.status === 0 && /^\d{3}$/.test(code) ? Number(code) : 0;
}

/** 端口是否已被监听（用于自测试前置预检，避免与在跑的实例冲突） */
function portListeningSync(port) {
  const r = cp.spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  const re = new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING`, 'i');
  return re.test(r.stdout || '');
}

/**
 * 自测试（--self-test）：把产物复制到同级暂存目录真实启动一次。
 *
 * 为什么用暂存副本：不污染交付包（不产生 data/logs、WAL、测试数据），也不触碰
 * 打包机上正在运行的实例；用 Lite 档覆盖（REDIS_HOST 空 + sqlite）避免写入
 * 共享 Redis/InfluxDB。
 *
 * 判定：/api/v1/system/health 200 + 首页 200 + SPA 深路由 200；全程超时 180s。
 */
function selfTestPackage(pkg) {
  const port = Number(pkg.port);
  const startedAt = new Date().toISOString();
  const result = { runAt: startedAt, mode: 'lite-staged', port, pass: false, checks: {} };

  if (portListeningSync(port)) {
    info(C.warn(`端口 ${port} 已被占用 ⇒ 跳过自测试（避免与在跑实例冲突）`));
    result.skipped = `port ${port} already listening`;
    return result;
  }

  const staging = path.join(path.dirname(pkg.dir), `_selftest_${path.basename(pkg.dir)}`);
  try {
    if (fs.existsSync(staging)) rmDirWithRetry(staging);
    info(`暂存副本：${path.relative(ROOT, staging)}（排除 base_services / rtdb）`);
    mirror(pkg.dir, staging, { excludeDirs: ['base_services', 'rtdb'] });

    const nodeExe = pkg.withNode ? path.join(staging, 'node', 'node.exe') : process.execPath;
    if (!fs.existsSync(nodeExe)) fail(`自测试：找不到 node 可执行文件 ${nodeExe}`);
    const logFile = path.join(staging, 'selftest-stdout.log');
    const out = fs.openSync(logFile, 'w');

    info('启动：node dist/main.js（Lite 覆盖：REDIS_HOST= + HISTORICAL_DATA_BACKEND=sqlite）');
    const child = cp.spawn(nodeExe, [path.join(staging, 'dist', 'main.js')], {
      cwd: staging,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        UV_THREADPOOL_SIZE: '8',
        REDIS_HOST: '',
        HISTORICAL_DATA_BACKEND: 'sqlite',
      },
      stdio: ['ignore', out, out],
      windowsHide: true,
    });

    const deadline = Date.now() + 180000;
    let health = 0;
    let waited = 0;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      health = httpStatusSync(`http://127.0.0.1:${port}/api/v1/system/health`, 4);
      if (health === 200) break;
      sleepSync(2000);
      waited += 2;
    }
    result.checks.health = health;
    result.checks.healthWaitSeconds = waited;

    if (health === 200) {
      result.checks.index = httpStatusSync(`http://127.0.0.1:${port}/`, 6);
      result.checks.spaDeepRoute = httpStatusSync(`http://127.0.0.1:${port}/system/device`, 6);
      result.pass = result.checks.index === 200 && result.checks.spaDeepRoute === 200;
    }

    // 停进程（/T 连子进程一起杀：采集隔离进程等）
    if (child.exitCode === null) {
      cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    fs.closeSync(out);
    // 句柄释放有延迟，留出宽限时间，避免随后清理暂存目录 EPERM
    sleepSync(2500);

    if (result.pass) {
      info(
        C.ok(
          `✓ 自测试通过：health=200（${waited}s）· 首页=${result.checks.index} · SPA 深路由=${result.checks.spaDeepRoute}`,
        ),
      );
    } else {
      info(C.err(`✗ 自测试失败：${JSON.stringify(result.checks)}`));
      info(`  启动日志（尾部 30 行，${path.relative(ROOT, logFile)}）：`);
      const tail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-30);
      for (const line of tail) if (line.trim()) info(`    ${line}`);
    }
  } finally {
    if (fs.existsSync(staging)) {
      if (rmDirWithRetry(staging)) info(C.dim('暂存副本已清理'));
    }
  }
  result.finishedAt = new Date().toISOString();
  return result;
}

/**
 * start.bat：一键启动。
 *
 * 顺序：校验产物 → （Standard 档）拉起包内 redis/influxd 并等待端口就绪 → 前台启动后端
 * （后端托管前端 SPA ⇒ Web + API + WS 同端口）。
 *
 * 注：不依赖 `AUTO_START_BASE_SERVICES`（该键目前无消费方，见文件头 6)）；
 *     优先使用包内 node\node.exe（若随包带入），否则用 PATH 中的 node。
 */
function writeStartBat(pkg, fileName = 'start.bat') {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM ============================================================',
    'REM  Smart Site - single-process launcher (S1, no Nginx)',
    `REM  Port: ${port}   Web+API: http://localhost:${port}/`,
    `REM  Mode: ${pkg.mode}   Tier: ${pkg.tier}   Self-contained: ${pkg.internalPaths ? 'yes' : 'no'}`,
    'REM ============================================================',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'cd /d "%~dp0"',
    '',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "node_modules" (',
    '    echo [ERROR] node_modules not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist ".env" (',
    '    echo [ERROR] .env not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "web\\index.html" (',
    '    echo [ERROR] web\\index.html not found - WEB_DIST_DIR hosting needs it. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'REM ---- node binary: prefer the one bundled in node\\ ----',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
  ];

  if (pkg.withServices) {
    writeStartServicesBat(pkg);
    lines.push(
      '',
      'REM ---- bundled base services (redis :6379 / influxdb :8086) ----',
      'if exist "%~dp0_start-services.bat" call "%~dp0_start-services.bat"',
    );
  }

  lines.push(
    '',
    'echo ============================================================',
    'echo   Smart Site (single-process, no Nginx)',
    'echo ============================================================',
    `echo   Web / API : http://localhost:${port}/`,
    `echo   Health    : http://localhost:${port}/api/v1/system/health`,
    pkg.internalPaths
      ? 'echo   Data dir  : .\\data   (bundled with this package)'
      : 'echo   Data dir  : ..\\data   (shared, do NOT run together with :4000)',
    pkg.withServices
      ? 'echo   Services  : bundled (redis :6379 / influxdb :8086)'
      : `echo   Services  : external / tier=${pkg.tier}`,
    'echo ============================================================',
    'echo.',
    '"%SS_NODE%" --version',
    'echo.',
    'REM pass the ABSOLUTE entry path: stop.bat matches processes by command line containing this package root',
    '"%SS_NODE%" "%~dp0dist\\main.js"',
    'echo.',
    'echo [EXIT] service stopped',
    'pause',
    '',
  );
  writeBat(path.join(pkg.dir, fileName), lines);
}

/**
 * start.bat（--exe 形态）：一键启动 = 调用薄启动器 SmartSite.exe。
 *
 * 与 node 形态的差别只有一处：**入口换成 exe**（无控制台窗口，日志落 data/logs/launcher.log）。
 * 基础服务仍由启动器自己调用 _start-services.bat 拉起，后端行为与 node 形态完全一致。
 * 排障时可改用 start-node.bat（保留可见日志的经典 node 启动方式）。
 */
function writeStartBatExeLauncher(pkg) {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM ============================================================',
    'REM  Smart Site - mode 5 thin exe launcher (plan A, zero backend changes)',
    `REM  Port: ${port}   Web+API: http://localhost:${port}/`,
    `REM  Mode: ${pkg.mode}   Tier: ${pkg.tier}   Launcher: exe`,
    'REM  SmartSite.exe only hides the console and starts node\\node.exe with',
    'REM  dist\\main.js. Troubleshooting with visible logs: start-node.bat',
    'REM ============================================================',
    'cd /d "%~dp0"',
    '',
    'if not exist "SmartSite.exe" (',
    '    echo [ERROR] SmartSite.exe not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found. Re-run publish-smart-site.bat',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "node\\node.exe" (',
    '    echo [ERROR] node\\node.exe not found - the thin launcher does not embed a Node runtime.',
    '    echo         Re-run publish-smart-site.bat with --with-node --exe',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'echo ============================================================',
    'echo   Smart Site (single-process, no Nginx, thin exe launcher)',
    'echo ============================================================',
    `echo   Web / API : http://localhost:${port}/`,
    `echo   Health    : http://localhost:${port}/api/v1/system/health`,
    'echo   Logs      : .\\data\\logs\\launcher.log',
    'echo ============================================================',
    'echo.',
    '',
    'REM detach so this cmd window closes immediately; the launcher keeps running',
    'start "" "%~dp0SmartSite.exe"',
    'exit /b 0',
    '',
  ];
  writeBat(path.join(pkg.dir, 'start.bat'), lines);
}

/**
 * 编译薄启动器（--exe）：调用 bin\build-launcher-exe.ps1，把 SmartSite.exe 放进包根。
 *
 * 不自行内联 csc 命令，保证「命令行编译」与「打包编译」走**同一份参数**（避免两处漂移）。
 */
function writeLauncherExe(pkg) {
  if (!fs.existsSync(LAUNCHER_BUILD_SCRIPT)) {
    console.error(`[ERROR] 薄启动器编译脚本缺失：${LAUNCHER_BUILD_SCRIPT}`);
    process.exit(1);
  }
  if (!fs.existsSync(LAUNCHER_SOURCE)) {
    console.error(`[ERROR] 薄启动器源码缺失：${LAUNCHER_SOURCE}`);
    process.exit(1);
  }

  const outputPath = path.join(pkg.dir, 'SmartSite.exe');
  const r = cp.spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', LAUNCHER_BUILD_SCRIPT, '-OutputPath', outputPath],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (r.status !== 0 || !fs.existsSync(outputPath)) {
    console.error('[ERROR] 薄启动器编译失败（见上方 csc 输出）');
    process.exit(1);
  }
  info(`SmartSite.exe 已生成（薄启动器，${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB）`);
}

/**
 * _start-services.bat：按 `.env` 档位拉起**包内**基础服务（start.bat 与 service-run.bat 共用）。
 *
 * - `REDIS_HOST=localhost` → 起 base_services\redis\redis-server.exe（cwd 必须是 redis 目录：redis.conf 用 `dir ./`）
 * - `HISTORICAL_DATA_BACKEND=influxdb` → 起 base_services\influxdb2-2.7.8\influxd.exe（其 config.yaml 用相对 exe 的 ../../rtdb）
 * - 端口已在监听则跳过（避免与外部/已有实例冲突）
 * - 注：不依赖 `AUTO_START_BASE_SERVICES`（该键无消费方，见文件头 6)）
 */
function writeStartServicesBat(pkg) {
  const lines = [
    '@echo off',
    'REM  Started by start.bat / service-run.bat - do not run directly',
    'setlocal',
    'cd /d "%~dp0"',
    '',
    'if not exist "base_services\\redis\\redis-server.exe" goto :ss_skip_redis',
    'findstr /r /c:"^REDIS_HOST=localhost" ".env" >nul 2>&1',
    'if errorlevel 1 goto :ss_skip_redis',
    'netstat -ano | findstr ":6379 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 goto :ss_skip_redis',
    'echo [INFO] starting Redis (:6379) from base_services\\redis ...',
    'pushd "base_services\\redis"',
    'start "ss-redis" /min redis-server.exe redis.conf',
    'popd',
    'call :ss_wait_port 6379 30',
    ':ss_skip_redis',
    '',
    'if not exist "base_services\\influxdb2-2.7.8\\influxd.exe" goto :ss_skip_influx',
    'findstr /r /c:"^HISTORICAL_DATA_BACKEND=influxdb" ".env" >nul 2>&1',
    'if errorlevel 1 goto :ss_skip_influx',
    'netstat -ano | findstr ":8086 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 goto :ss_skip_influx',
    'echo [INFO] starting InfluxDB (:8086) from base_services\\influxdb2-2.7.8 ...',
    'pushd "base_services\\influxdb2-2.7.8"',
    'start "ss-influxd" /min influxd.exe',
    'popd',
    'call :ss_wait_port 8086 60',
    ':ss_skip_influx',
    'exit /b 0',
    '',
    'REM ---- helper: wait for a listening port (%%1=port, %%2=max seconds) ----',
    ':ss_wait_port',
    'set /a "SS_WAIT=0"',
    ':ss_wait_port_loop',
    'netstat -ano | findstr ":%~1 " | findstr LISTENING >nul 2>&1',
    'if not errorlevel 1 exit /b 0',
    'set /a "SS_WAIT+=1"',
    'if %SS_WAIT% GEQ %~2 exit /b 0',
    'REM use ping instead of timeout: timeout.exe needs a console (fails under a service/task)',
    'ping -n 2 127.0.0.1 >nul',
    'goto :ss_wait_port_loop',
    '',
  ];
  writeBat(path.join(pkg.dir, '_start-services.bat'), lines);
}

/**
 * self-test.bat / _selftest-run.bat：**目标机**可执行的自检。
 *
 * 就地运行（不是暂存副本）：用 Lite 档覆盖起一次后端 → 探活 health / 首页 / SPA 深路由 →
 * 调 stop.bat 收尾。会写 `data\logs\selftest-stdout.log` 与少量运行期数据，属预期。
 */
function writeSelfTestBat(pkg) {
  const port = pkg.port;
  writeBat(path.join(pkg.dir, '_selftest-run.bat'), [
    '@echo off',
    'chcp 65001 >nul',
    'REM  Launched by self-test.bat - do not run directly',
    'cd /d "%~dp0"',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'set "REDIS_HOST="',
    'set "HISTORICAL_DATA_BACKEND=sqlite"',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
    'if not exist "data\\logs" mkdir "data\\logs"',
    '"%SS_NODE%" "%~dp0dist\\main.js" >> "%~dp0data\\logs\\selftest-stdout.log" 2>&1',
    'exit /b %ERRORLEVEL%',
    '',
  ]);

  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal enabledelayedexpansion',
    'REM ============================================================',
    `REM  Self test for the deployed package (port ${port})`,
    'REM  Starts the backend with Lite overrides (no Redis/InfluxDB),',
    'REM  probes health / index / SPA deep route, then stops it again.',
    'REM ============================================================',
    'cd /d "%~dp0"',
    'if not exist "dist\\main.js" (echo [ERROR] dist\\main.js missing & pause & exit /b 1)',
    '',
    `netstat -ano | findstr ":${port} " | findstr LISTENING >nul 2>&1`,
    'if not errorlevel 1 (',
    `    echo [WARN] port ${port} is already listening - run stop.bat first, then retry.`,
    '    pause',
    '    exit /b 2',
    ')',
    '',
    'echo [INFO] starting backend for self test ...',
    'start "ss-selftest" /min cmd /c "%~dp0_selftest-run.bat"',
    '',
    'set "SS_OK=0"',
    'set /a "SS_I=0"',
    ':ss_wait',
    'set /a "SS_I+=1"',
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 \'http://127.0.0.1:${port}/api/v1/system/health\').StatusCode } catch { 0 }"') do set "SS_HEALTH=%%c"`,
    'if "!SS_HEALTH!"=="200" goto :ss_ready',
    'if !SS_I! GEQ 90 goto :ss_timeout',
    'REM use ping instead of timeout: timeout.exe needs a console (fails with redirected stdin)',
    'ping -n 3 127.0.0.1 >nul',
    'goto :ss_wait',
    '',
    ':ss_timeout',
    'echo [FAIL] backend did not become healthy in 180s (health=!SS_HEALTH!)',
    'echo        see data\\logs\\selftest-stdout.log',
    'goto :ss_stop',
    '',
    ':ss_ready',
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 \'http://127.0.0.1:${port}/\').StatusCode } catch { 0 }"') do set "SS_INDEX=%%c"`,
    `for /f "delims=" %%c in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 \'http://127.0.0.1:${port}/system/device\').StatusCode } catch { 0 }"') do set "SS_SPA=%%c"`,
    'echo [OK]   health     = !SS_HEALTH!  (waited !SS_I! s)',
    'echo [OK]   index      = !SS_INDEX!',
    'echo [OK]   SPA route  = !SS_SPA!',
    'if "!SS_INDEX!"=="200" if "!SS_SPA!"=="200" set "SS_OK=1"',
    '',
    ':ss_stop',
    'echo [INFO] stopping test instance ...',
    'call "%~dp0stop.bat"',
    'echo.',
    'if "!SS_OK!"=="1" (',
    '    echo ============================================================',
    '    echo   SELF TEST PASSED',
    '    echo ============================================================',
    ') else (',
    '    echo ============================================================',
    '    echo   SELF TEST FAILED - see data\\logs\\selftest-stdout.log',
    '    echo ============================================================',
    ')',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'self-test.bat'), lines);
}

/** service-run.bat：后台运行器（Windows 服务 / 计划任务调用；先拉基础服务再前台跑后端） */
function writeServiceRunBat(pkg) {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM  Background runner for the Windows service / scheduled task (see install-service.bat)',
    'cd /d "%~dp0"',
    'set "NODE_ENV=production"',
    'set "UV_THREADPOOL_SIZE=8"',
    'if not exist "data\\logs" mkdir "data\\logs"',
    'set "SS_NODE=node"',
    'if exist "%~dp0node\\node.exe" set "SS_NODE=%~dp0node\\node.exe"',
  ];
  if (pkg.withServices) {
    lines.push('if exist "%~dp0_start-services.bat" call "%~dp0_start-services.bat"');
  }
  lines.push(
    'REM console output -> data\\logs\\service-stdout.log (winston keeps writing data\\logs too)',
    '"%SS_NODE%" "%~dp0dist\\main.js" >> "%~dp0data\\logs\\service-stdout.log" 2>&1',
    'exit /b %ERRORLEVEL%',
    '',
  );
  writeBat(path.join(pkg.dir, 'service-run.bat'), lines);
}

/**
 * install-service.bat / uninstall-service.bat：注册为开机自启。
 *
 * NSSM 优先（崩溃自动重启 + 日志重定向 + 轮转）；找不到 nssm.exe 时回退到
 * 「计划任务 ONSTART + SYSTEM」——两种方式都**不需要**目标机预装第三方程序。
 */
function writeServiceScripts(pkg) {
  const ssh = `SmartSite-${pkg.port}`;
  const nodeLine = pkg.withNode
    ? 'set "SS_NODE=%~dp0node\\node.exe"'
    : 'set "SS_NODE=node"';
  const install = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal enabledelayedexpansion',
    'REM ============================================================',
    'REM  Register Smart Site as an auto-start Windows service',
    `REM  Service name: ${ssh}   (NSSM preferred, Scheduled Task fallback)`,
    'REM ============================================================',
    'cd /d "%~dp0"',
    `set "SERVICE_NAME=${ssh}"`,
    'set "PKG_DIR=%~dp0"',
    nodeLine,
    'if not exist "%SS_NODE%" (',
    '    echo [ERROR] node not found: %SS_NODE%',
    '    pause',
    '    exit /b 1',
    ')',
    'if not exist "dist\\main.js" (',
    '    echo [ERROR] dist\\main.js not found - run this inside the released package',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'set "NSSM="',
    'if exist "%~dp0nssm.exe" set "NSSM=%~dp0nssm.exe"',
    'if not defined NSSM for %%I in (nssm.exe) do if not "%%~$PATH:I"=="" set "NSSM=%%~$PATH:I"',
    'if defined NSSM goto :use_nssm',
    '',
    'REM ---- fallback: Scheduled Task (no third-party tool needed) ----',
    'echo [INFO] nssm.exe not found - using a Scheduled Task instead (onstart, SYSTEM).',
    'schtasks /Create /TN "%SERVICE_NAME%" /TR "\\"%PKG_DIR%service-run.bat\\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F',
    'if errorlevel 1 ( echo [ERROR] schtasks failed & pause & exit /b 1 )',
    'echo [OK] Scheduled task "%SERVICE_NAME%" created (auto-start at boot).',
    'echo      start now : schtasks /Run /TN "%SERVICE_NAME%"',
    'echo      remove    : uninstall-service.bat',
    'echo      logs      : data\\logs\\service-stdout.log',
    'goto :done',
    '',
    ':use_nssm',
    'echo [INFO] using NSSM: %NSSM%',
    '"%NSSM%" install "%SERVICE_NAME%" "%SS_NODE%" "%PKG_DIR%dist\\main.js"',
    '"%NSSM%" set "%SERVICE_NAME%" AppDirectory "%PKG_DIR%"',
    '"%NSSM%" set "%SERVICE_NAME%" AppEnvironmentExtra NODE_ENV=production UV_THREADPOOL_SIZE=8',
    '"%NSSM%" set "%SERVICE_NAME%" AppStdout "%PKG_DIR%data\\logs\\service-stdout.log"',
    '"%NSSM%" set "%SERVICE_NAME%" AppStderr "%PKG_DIR%data\\logs\\service-stderr.log"',
    '"%NSSM%" set "%SERVICE_NAME%" AppRotateFiles 1',
    '"%NSSM%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START',
    '"%NSSM%" start "%SERVICE_NAME%"',
    'echo [OK] Windows service "%SERVICE_NAME%" installed and started.',
    '',
    ':done',
    'REM NOTE: bundled redis/influxd are started by service-run.bat (and by start.bat).',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'install-service.bat'), install);

  const uninstall = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `REM  Remove the "${ssh}" service / scheduled task`,
    'cd /d "%~dp0"',
    `set "SERVICE_NAME=${ssh}"`,
    'set "NSSM="',
    'if exist "%~dp0nssm.exe" set "NSSM=%~dp0nssm.exe"',
    'if not defined NSSM for %%I in (nssm.exe) do if not "%%~$PATH:I"=="" set "NSSM=%%~$PATH:I"',
    'if defined NSSM goto :use_nssm',
    'schtasks /End /TN "%SERVICE_NAME%" 2>nul',
    'schtasks /Delete /TN "%SERVICE_NAME%" /F',
    'echo [INFO] scheduled task removed (if it existed).',
    'goto :done',
    '',
    ':use_nssm',
    '"%NSSM%" stop "%SERVICE_NAME%"',
    '"%NSSM%" remove "%SERVICE_NAME%" confirm',
    'echo [INFO] Windows service removed.',
    '',
    ':done',
    'echo [INFO] leftover processes (if any) can be stopped with stop.bat',
    'pause',
    '',
  ];
  writeBat(path.join(pkg.dir, 'uninstall-service.bat'), uninstall);
}

/** stop.bat：只停「本包」的 node/redis/influxd（按可执行文件所在目录匹配，避免误杀其它实例） */
function writeStopBat(pkg) {
  const names = pkg.withServices
    ? "@('node.exe','redis-server.exe','influxd.exe')"
    : "@('node.exe')";
  const psCmd = [
    "$root='%~dp0';",
    `$names=${names};`,
    '$p=Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and (($_.Name -eq \'node.exe\' -and $_.CommandLine -like (\'*\'+$root+\'*\')) -or ($_.Name -ne \'node.exe\' -and $_.ExecutablePath -like ($root+\'*\'))) };',
    "if ($p) { $p | ForEach-Object { Write-Host ('[OK] kill ' + $_.Name + ' PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force } } else { Write-Host '[INFO] no smart-site process found' }",
  ].join(' ');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'REM  Stop processes owned by THIS package only (matched by executable/image path)',
    'cd /d "%~dp0"',
    'echo [INFO] Stopping smart-site processes ...',
    `powershell -NoProfile -Command "${psCmd}"`,
    'echo [INFO] done.',
    'echo [INFO] NOTE: SQLite WAL is crash-safe; next start will replay/checkpoint it.',
    'endlocal',
    '',
  ];
  writeBat(path.join(pkg.dir, 'stop.bat'), lines);
}

function writeStatusBat(pkg) {
  const port = pkg.port;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `REM  Status of smart-site (port ${port})`,
    'cd /d "%~dp0"',
    'echo ============================================================',
    'echo   Smart Site status',
    'echo ============================================================',
    'echo [1] processes owned by this package:',
    `powershell -NoProfile -Command "$root='%~dp0'; $names=@('node.exe'${pkg.withServices ? ",'redis-server.exe','influxd.exe'" : ''}); Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and (($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*'+$root+'*')) -or ($_.Name -ne 'node.exe' -and $_.ExecutablePath -like ($root+'*'))) } | ForEach-Object { Write-Host ('    PID ' + $_.ProcessId + '  ' + $_.Name) }"`,
    `echo [2] port ${port}:`,
    `netstat -ano | findstr ":${port} " | findstr LISTENING`,
  ];
  if (pkg.withServices) {
    lines.push(
      'echo [2b] base service ports 6379 / 8086:',
      'netstat -ano | findstr ":6379 " | findstr LISTENING',
      'netstat -ano | findstr ":8086 " | findstr LISTENING',
    );
  }
  lines.push(
    `echo [3] health http://localhost:${port}/api/v1/system/health :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/api/v1/system/health\'; Write-Host (\'    HTTP \' + $r.StatusCode + \' \' + $r.Content) } catch { Write-Host \'    unreachable\' }"`,
    `echo [3b] page http://localhost:${port}/ (SPA hosting) :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/\'; Write-Host (\'    HTTP \' + $r.StatusCode + \'  bytes=\' + $r.RawContentLength) } catch { Write-Host \'    unreachable\' }"`,
    `echo [3c] SPA fallback (deep route) :`,
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 \'http://localhost:${port}/system/device\'; Write-Host (\'    HTTP \' + $r.StatusCode) } catch { Write-Host \'    unreachable\' }"`,
    'echo [4] version:',
    'if exist "VERSION.json" (type VERSION.json) else (echo     VERSION.json missing)',
    'echo.',
    'endlocal',
    '',
  );
  writeBat(path.join(pkg.dir, 'status.bat'), lines);
}

function writeReadme(pkg, builtAt, inherited) {
  const dataDirNames = [
    'db',
    'projects',
    'init',
    'dicts',
    'templates',
    'canvas-templates',
    'faq',
    'models',
    'menu',
    'plugin-configs',
    'graphic-plugins',
    'images',
    'images-lg',
  ].filter((n) => !(pkg.dataExclude || []).includes(n));
  const dirTable = [
    '| `dist/` | 后端编译产物（nest build） |',
    '| `node_modules/` | 生产依赖（第三方基线 + 工作区 `@ss-node/*` 最新 dist 覆盖） |',
    '| `i18n/` | 后端国际化资源 |',
    '| `web/` | 前端 SPA（由后端 `WEB_DIST_DIR` 托管，**无 Nginx**） |',
    '| `web/plugins/` | 图元插件产物（`PLUGIN_PUBLISH_DIR` 指向此处） |',
    pkg.withData
      ? `| \`data/\` | **随包**数据目录（\`DATA_DIR=./data\`）：${dataDirNames.join(' / ')}${
          pkg.dataExclude && pkg.dataExclude.length ? `　（**不含** ${pkg.dataExclude.join(' / ')}）` : ''
        } |`
      : '| `data/` | 不含（`DATA_DIR=../data`，复用包外数据目录） |',
    pkg.withServices
      ? '| `base_services/` | **随包**基础服务：`redis/`（redis-server.exe）与 `influxdb2-2.7.8/`（influxd.exe） |'
      : '| `base_services/` | 不含（需外部 Redis/InfluxDB，或使用 Lite 档） |',
    pkg.withServices ? '| `rtdb/influxdb2/` | InfluxDB 时序数据落点（升级**不覆盖**） |' : null,
    pkg.withServices ? '| `_start-services.bat` | 基础服务引导（由 start.bat / service-run.bat 调用，勿直接运行） |' : null,
    pkg.withNode ? `| \`node/\` | **随包 Node**（${process.version}）——\`start.bat\` 优先使用，目标机免装 Node |` : null,
    pkg.service ? '| `install-service.bat` / `uninstall-service.bat` / `service-run.bat` | 注册/卸载开机自启（NSSM 优先，计划任务兜底） |' : null,
    '| `.env` | **唯一**运行时配置（生产模式只读 cwd/.env） |',
    pkg.launcher === 'exe'
      ? '| `SmartSite.exe` | **薄启动器**（发布方式 5）：无控制台窗口，自动解析包根并拉起 `node\\node.exe` + `dist\\main.js`，日志落 `data\\logs\\launcher.log` |'
      : null,
    pkg.launcher === 'exe'
      ? '| `start.bat` / `start-node.bat` | 双击启动入口（`start.bat`→`SmartSite.exe`；`start-node.bat` 为 node 形态，保留可见日志便于排障） |'
      : '| `start.bat` / `stop.bat` / `status.bat` | 一键启停与状态 |',
    pkg.launcher === 'exe' ? '| `stop.bat` / `status.bat` | 停止与状态查询（对 exe / node 两种入口均适用） |' : null,
    '| `self-test.bat` | **目标机自检**：Lite 档起一次后端 → 探 health/首页/SPA 深路由 → 自动停（日志 `data\\logs\\selftest-stdout.log`） |',
    '| `VERSION.json` | 版本、构建时间、打包形态与继承项 |',
  ]
    .filter(Boolean)
    .join('\n');

  const pathTable = pkg.internalPaths
    ? [
        '| 变量 | 值 | 实际位置 |',
        '|------|-----|---------|',
        '| `DATA_DIR` | `./data` | **包内** `<包根>/data` |',
        '| `RUN_DIR` | `.` | 包根（= 进程 cwd） |',
        `| \`BASE_SERVICES_DIR\` | \`./base_services\` | ${pkg.withServices ? '**包内**' : '包内（本次未随包，需自备或改 Lite 档）'} |`,
        '| `INFLUXDB_DATA_DIR` | `${RUN_DIR}/rtdb/influxdb2` | 包内 `<包根>/rtdb/influxdb2` |',
      ].join('\n')
    : [
        '| 变量 | 值 | 实际位置 |',
        '|------|-----|---------|',
        '| `DATA_DIR` | `../data` | `ss-run/ss/data`（复用） |',
        '| `RUN_DIR` | `..` | `ss-run/ss` |',
        '| `BASE_SERVICES_DIR` | `../base_services` | `ss-run/ss/base_services`（Redis / InfluxDB，复用） |',
      ].join('\n');

  const startSteps = pkg.withServices
    ? [
        '```bat',
        ':: 1) 一键启动（会自动拉起包内 Redis :6379 与 InfluxDB :8086，等端口就绪后启动后端）',
        'start.bat',
        ':: 2) 访问（Web + API + WebSocket 同端口）',
        `::    http://localhost:${pkg.port}/`,
        '```',
      ].join('\n')
    : [
        '```bat',
        ':: 1) 确保外部基础服务已就绪（Redis :6379 / InfluxDB :8086），或使用 Lite 档（见下）',
        ':: 2) 启动',
        'start.bat',
        ':: 3) 访问',
        `::    http://localhost:${pkg.port}/`,
        '```',
      ].join('\n');

  const upgradeSteps = pkg.internalPaths
    ? [
        '1. `stop.bat`',
        '2. 备份 `data/db`、`data/projects`、`data/plugin-configs`、`data/graphic-plugins`、`rtdb/influxdb2`',
        '3. 对每个 SQLite 执行 `PRAGMA wal_checkpoint(TRUNCATE)`',
        '4. 覆盖 `dist/` `node_modules/` `i18n/` `web/`（Standard 档另有 `base_services/`，为纯程序目录）；**不覆盖** `data/`、`rtdb/`、`base_services/redis/data`',
        '5. `start.bat` → `status.bat` 验证（登录 / 项目 / 设备 / 点表实时值 / 图元插件页）',
      ].join('\n')
    : [
        '1. `stop.bat`',
        '2. 备份 `../data/db`、`../data/projects`、`../data/plugin-configs`、`../data/graphic-plugins`',
        '3. 重新执行 `bin\\publish-smart-site.bat`（**不覆盖** data/base_services）',
        '4. `start.bat`，用 `status.bat` 验证',
      ].join('\n');

  const serviceSection = pkg.service
    ? [
        '',
        '## 5.1 开机自启（Windows 服务 / 计划任务）',
        '',
        '```bat',
        'install-service.bat     :: 注册为开机自启（有 nssm.exe 用 NSSM，否则用计划任务 ONSTART+SYSTEM）',
        'uninstall-service.bat   :: 卸载',
        '```',
        '',
        `- 服务名：\`SmartSite-${pkg.port}\`；后台运行器为 \`service-run.bat\`（会先拉起包内基础服务，再前台跑后端）。`,
        '- NSSM 模式会重定向日志到 `data\\logs\\service-stdout.log` 并自动重启；计划任务模式同样落该日志。',
        '- 需要管理员权限运行 `install-service.bat`（注册服务/计划任务）。',
        '',
      ].join('\n')
    : '';
  const md = `# Smart Site 单包（${pkg.launcher === 'exe' ? 'S5 薄启动器 exe' : 'S1 单进程'}，无 Nginx）

**形态**：后端直接托管前端 SPA，**无需 Nginx / Docker**；一个端口对外（Web + REST API + WebSocket + MCP）。${pkg.launcher === 'exe' ? '\n**启动入口**：`SmartSite.exe`（薄启动器，发布方式 5）或 `start.bat` / `start-node.bat`。' : ''}
**打包形态**：${pkg.internalPaths ? `**自包含**（数据随包：${pkg.withData ? '是' : '否'}；基础服务随包：${pkg.withServices ? '是' : '否'}；随包 Node：${pkg.withNode ? '是' : '否'}）` : '复用本机 `ss-run`（便于开发机自测）'}
**基础服务档位**：\`${pkg.tier}\`${pkg.dataExclude && pkg.dataExclude.length ? `\n**数据排除**：\`${pkg.dataExclude.join('`, `')}\`（本次交付**不含**这些目录）` : ''}
**生成时间**：${builtAt}
**产品模式**：\`${pkg.mode}\`　**端口**：\`${pkg.port}\`

> 方案依据：单包发布方案（S1 单进程，无 Nginx）· Windows 单机发布方案（docs/00-全局/发布）

---

## 1. 目录说明

| 路径 | 说明 |
|------|------|
${dirTable}

## 2. 数据与基础服务：${pkg.internalPaths ? '**随包（自包含）**' : '**复用，不复制**'}

${pathTable}

${pkg.internalPaths ? '> ✅ 自包含形态：整个目录可整体搬移/拷贝到目标机，路径全部相对包根解析。' : '> ⚠️ **不要与其它实例同时运行**：共用一个 `ss-run/ss/data`（同一 SQLite 库）。若必须并行，请复制一份 data 并改 `.env` 的 `DATA_DIR`，同时更换 `PORT`。'}

## 3. 启动

${startSteps}

其他命令：

\`\`\`bat
status.bat     :: 进程 + 端口 + 基础服务端口 + 健康检查 + 首页/SPA 探测 + 版本
self-test.bat  :: 自检：临时起一次后端探活后自动停（Lite 覆盖，不写外部 Redis/Influx）
stop.bat       :: 仅停止本包进程（node / redis / influxd，按可执行文件路径匹配）
\`\`\`

> 💡 随包放入 \`node\\node.exe\` 时，\`start.bat\` 会自动优先使用它（目标机无需安装 Node）。${pkg.withNode ? '**本包已随包 Node。**' : ''}
${pkg.launcher === 'exe' ? '\n> 🖥 **发布方式 5（薄启动器 exe）**：也可直接双击 `SmartSite.exe`，行为与 `start.bat` 等价（无控制台窗口）。需排障看实时日志时改用 `start-node.bat`；启动器日志见 `data\\logs\\launcher.log`。\n' : ''}

## 4. 基础服务档位

| 档位 | 配置 | 说明 |
|------|------|------|
| **Standard**${pkg.tier === 'standard' ? '（本包当前）' : ''} | \`REDIS_HOST=localhost\` + \`HISTORICAL_DATA_BACKEND=influxdb\` | 需 Redis 与 InfluxDB（本包${pkg.withServices ? '已内置，start.bat 自动拉起' : '需外部提供'}） |
| **Lite**${pkg.tier === 'lite' ? '（本包当前）' : ''} | \`REDIS_HOST=\`（留空）+ \`HISTORICAL_DATA_BACKEND=sqlite\` | 零外部服务；Redis 相关能力降级为 no-op，历史数据落 SQLite。**注意：重启后"最新值"可能为空** |
| **External** | 指向客户自有机房实例 | 改 \`REDIS_HOST\` / \`INFLUXDB_URL\` |

切换档位只需编辑 \`.env\` 后重启，**无需重新打包**。

## 5. 图元插件

\`SS_DEPLOY_MODE=pro\` + \`PLUGIN_PUBLISH_DIR=./web/plugins\`
⇒ 导入 / 目录重检 / 发布复制会把产物写入本包 \`web/plugins\`（无 Nginx 时的正确落点）。${serviceSection}

## 6. 升级与回滚

${upgradeSteps}

回滚 = 保留上一份完整目录（或解压上一包 + 恢复备份），直接切回。

## 7. 从现有生产配置继承的键

${inherited.length ? inherited.map((k) => `- \`${k}\``).join('\n') : '（无：未找到参考 .env、无匹配键，或当前为 Lite 档已跳过 Redis/InfluxDB 相关键）'}

> 继承自 \`ss-run/ss/services/ss-node/.env\`，用于保持 JWT / Redis / InfluxDB 等同源可用。
> 如不希望继承，删除本包 \`.env\` 中对应行即可。

## 8. 常见问题

| 现象 | 原因 / 处理 |
|------|------------|
| 页面空白 / 静态资源 404 | 确认 \`.env\` 中 \`WEB_DIST_DIR=./web\` 且 \`web/index.html\` 存在 |
| 接口 404 | 确认请求路径以 \`/api/v1\` 开头（SPA fallback 不接管 \`/api/\`） |
| WebSocket 连不上 | 同源访问（勿直连 IP:其它端口）；\`CORS_ORIGINS\` 已按端口配置 |
| 登录后不停跳登录 | \`COOKIE_SECURE\` 与访问协议不一致（HTTP 部署必须为 \`false\`） |
| 无历史数据 | \`HISTORICAL_DATA_BACKEND=influxdb\` 但 InfluxDB 未启动；改 \`sqlite\` 或启动服务 |
| 最新值为空 | Lite 档（无 Redis）预期行为；生产建议启用 Redis |
| 备份下载跳到 localhost | 前端构建时烤入了 \`VITE_API_BASE_URL\`；用打包器重新构建（会自动置空） |
| 采集插件不采集 | 见 \`data/plugin-configs/*.json\` 的 \`activated\`；并检查调度是否饱和（\`/pipeline/metrics/diagnostic\`） |
`;
  fs.writeFileSync(path.join(pkg.dir, 'README.md'), md, 'utf8');
}
