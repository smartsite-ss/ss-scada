// bin/publish-smart-site/env-config.cjs — [7] 步骤：生成运行时 .env（含 --lang=en 英文版语言键、继承生产配置、JWT 守卫）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, opt, TOTAL, C, step, info, parseEnvFile, REF_ENV, ENV_DATA_DIR, ENV_RUN_DIR, INTERNAL_PATHS, randomSecret, isWeakSecret,
    run 
  } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function generateEnv() {
    const { T } = ctx;
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
// --lang=en（英文版发布）：默认语言与回退语言切换为 en-US（zh 走后端默认 zh-CN，不写键）
if (opt.lang === 'en') {
  set('KB_DEFAULT_LANG', 'en-US', '英文版发布（--lang=en）');
  set('I18N_FALLBACK_LANGUAGE', 'en-US', '英文版发布（--lang=en）');
  set('I18N_SUPPORTED_LANGUAGES', 'en-US,zh-CN,zh-TW');
} else {
  set('KB_DEFAULT_LANG', 'zh-CN');
  set('KB_SUPPORTED_LANGS', 'zh-CN,en-US');
  set('I18N_FALLBACK_LANGUAGE', 'zh-CN');
  set('I18N_SUPPORTED_LANGUAGES', 'zh-CN,en-US,zh-TW');
}
set('KB_AI_BUILD_ENABLED', 'false');
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

    return { builtAt, inherited, inheritedLabel, inheritedSkipped };
  }


  return {
    generateEnv,
  };
};
