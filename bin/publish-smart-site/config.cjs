// bin/publish-smart-site/config.cjs — 基础路径与打包规则常量（自 publish-smart-site.cjs 拆分）

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

// ─────────────────────────── 基础路径 ───────────────────────────
const ROOT = path.resolve(__dirname, '..', '..'); // 模块位于 bin/publish-smart-site/ 下，仓库根需上溯两级
const SS_NODE = path.join(ROOT, 'ss-services', 'ss-node');
const SS_EDITOR = path.join(ROOT, 'ss-editor');
const RUN_SS = path.join(ROOT, 'ss-run', 'ss');
/** Windows 发布方式暂存区：按发布方式分子目录（见 ss-run/ss-win/README.md） */
const RUN_WIN = path.join(ROOT, 'ss-run', 'ss-win');
/** 发布方式 → 暂存子目录：方式 4（node 直启）与方式 5（薄启动器 exe） */
const RUN_WIN_MODE_DIRS = { node: '04-win-node', exe: '05-win-exe' };
/** 薄启动器源码与编译脚本（--exe 时调用） */
const LAUNCHER_SOURCE = path.join(__dirname, '..', 'launcher', 'SmartSiteLauncher.cs');
const LAUNCHER_BUILD_SCRIPT = path.join(__dirname, '..', 'build-launcher-exe.ps1');

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
const BASE_SERVICE_ITEMS = ['redis', 'influxdb2-2.7.8', 'nanomq'];
const BASE_SERVICE_EXCLUDE_DIRS = ['logs', 'data'];
const BASE_SERVICE_EXCLUDE_FILES = ['*.log', '*.rdb', '*.aof'];


module.exports = {
  ROOT, SS_NODE, SS_EDITOR, RUN_SS, RUN_WIN, RUN_WIN_MODE_DIRS,
  LAUNCHER_SOURCE, LAUNCHER_BUILD_SCRIPT, SERVER_DIST_SRC, WEB_DIST_SRC, PLUGINS_DIST_SRC,
  PROD_DEPS_SRC, REF_ENV, I18N_SOURCES,
  DATA_EXCLUDE_DIRS, DATA_USER_DIRS, DATA_EXCLUDE_FILES,
  BASE_SERVICE_ITEMS, BASE_SERVICE_EXCLUDE_DIRS, BASE_SERVICE_EXCLUDE_FILES,
};
