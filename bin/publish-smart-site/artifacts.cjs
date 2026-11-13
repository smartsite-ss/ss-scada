// bin/publish-smart-site/artifacts.cjs — [2][3] 步骤：后端 dist / i18n 与前端 web / web/plugins 产物复制
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, mirror, cpSyncFiltered, ensureDir, SERVER_DIST_SRC, I18N_SOURCES, WEB_DIST_SRC, PLUGINS_DIST_SRC, opt, TOTAL, C, step, info, fail } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function runArtifactsStep() {
    const { T } = ctx;
// ── [2] 后端产物 ──────────────────────────────────────────────
step(2, TOTAL, 'Copying backend artifacts (dist / i18n)');
if (opt.server) {
  mirror(SERVER_DIST_SRC, path.join(T, 'dist'));
  info(`dist ← ${path.relative(ROOT, SERVER_DIST_SRC)}`);
  const i18nSrc = I18N_SOURCES.find((p) => fs.existsSync(p));
  if (!i18nSrc) fail('i18n assets not found (packages/ss-sdk/src/i18n or deployed i18n/)');
  mirror(i18nSrc, path.join(T, 'i18n'));
  info(`i18n ← ${path.relative(ROOT, i18nSrc)}`);
} else {
  info(C.dim('Skipped (--no-server)'));
}

// ── [3] 前端产物 ──────────────────────────────────────────────
step(3, TOTAL, 'Copying frontend artifacts (web / web/plugins)');
if (opt.web) {
  if (!fs.existsSync(path.join(WEB_DIST_SRC, 'index.html'))) {
    fail(`Frontend artifact missing: ${WEB_DIST_SRC}\\index.html (build first, or drop --no-build)`);
  }
  mirror(WEB_DIST_SRC, path.join(T, 'web'));
  info(`web ← ${path.relative(ROOT, WEB_DIST_SRC)}`);
  // 剔除开发态 importmap：apps/web/public/import-map.json 是 Vite dev server 的 @fs
  // 映射（含打包机绝对路径），生产 importmap 已由 shared-deps 插件内联进 index.html。
  const devImportMap = path.join(T, 'web', 'import-map.json');
  if (fs.existsSync(devImportMap)) {
    fs.rmSync(devImportMap, { force: true });
    info('Removed web/import-map.json (dev @fs mapping; production uses an inline importmap)');
  }
  if (fs.existsSync(PLUGINS_DIST_SRC)) {
    // ⚠️ purge:false —— 叠加而非镜像：web/dist/plugins 里还带 capability.json / plugin-overrides.json
    // （AI 页面生成与 MCP component_* 的能力快照），/MIR 会把它们删掉。
    mirror(PLUGINS_DIST_SRC, path.join(T, 'web', 'plugins'), { purge: false });
    info(`web/plugins ← ${path.relative(ROOT, PLUGINS_DIST_SRC)} (overlay mode, capability.json preserved)`);
    const capabilityJson = path.join(T, 'web', 'plugins', 'capability.json');
    if (!fs.existsSync(capabilityJson)) {
      info(
        C.dim(
          '- web/plugins/capability.json missing: this product line does not generate the snapshot (AI page generator component capability table); add a generation step if AI page generation is needed',
        ),
      );
    }
  } else {
    info(C.warn(`${path.relative(ROOT, PLUGINS_DIST_SRC)} not found, skipping plugin artifacts`));
  }
} else {
  info(C.dim('Skipped (--no-web)'));
}

  }


  return {
    runArtifactsStep,
  };
};
