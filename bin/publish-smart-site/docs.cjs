// bin/publish-smart-site/docs.cjs — 生成器：包内 README.md（形态/启动/档位/升级/FAQ）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, opt, C, info,
    run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

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


  return {
    writeReadme,
  };
};
