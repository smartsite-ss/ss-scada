// bin/publish-smart-site/artifacts.cjs — [2][3] 步骤：后端 dist / i18n 与前端 web / web/plugins 产物复制
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, mirror, cpSyncFiltered, ensureDir, SERVER_DIST_SRC, I18N_SOURCES, WEB_DIST_SRC, PLUGINS_DIST_SRC, opt, TOTAL, C, step, info, fail } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function runArtifactsStep() {
    const { T } = ctx;
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

  }


  return {
    runArtifactsStep,
  };
};
