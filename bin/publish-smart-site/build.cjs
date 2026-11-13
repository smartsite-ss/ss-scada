// bin/publish-smart-site/build.cjs — [1] 构建步骤（后端 pnpm build / 前端 build:web + 插件尽力而为）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, SS_NODE, SS_EDITOR, opt, BUILD_HEAP, BUILD_ENV, TOTAL, C, step, info, fail, run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function runBuildStep() {
// ── [1] 构建 ──────────────────────────────────────────────────
step(1, TOTAL, 'Building (backend / frontend)');
let tempWebEnv = null;
if (opt.build) {
  info(
    `Build heap limit: ${BUILD_HEAP.mb} MB (free physical memory ${BUILD_HEAP.freeMb} MB / total ${BUILD_HEAP.totalMb} MB; source: ${BUILD_HEAP.source})`,
  );
  if (BUILD_HEAP.freeMb < 6144) {
    info(
      C.warn(
        `⚠️ Low free physical memory (${BUILD_HEAP.freeMb} MB): the frontend build may OOM. Close other memory-heavy programs, use --no-build to reuse existing dist, or set --build-heap=<MB> explicitly.`,
      ),
    );
  }
  if (opt.server) {
    info('Backend: pnpm build (ss-services/ss-node -> apps/ss-node-server/dist)');
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
    info(C.warn(`Temporarily writing ${path.relative(ROOT, envLocal)} (VITE_API_BASE_URL cleared -> same origin)`));
    try {
      // ss-scada 适配：目录插件的独立 ESM 产物（dist-plugins）依赖 importmap 单例机制，
      // 而本仓多个插件直接 import @scada-editor/system（v7 插件不这么做，且 system/shared
      // 尚无 importmap 单例产物）⇒ build:plugins 必然失败。应用内打包的插件（build:web
      // 经 vite-plugin-bundled-plugins 编译进主包）才是单包发布的运行主体，故此处降级为
      // 尽力而为：失败仅告警，不阻断发布（独立插件热更新发布流程为已知待办）。
      info('Frontend: pnpm build:plugins (standalone plugin artifacts; best effort, failures do not block)');
      const r = cp.spawnSync('cmd', ['/d', '/s', '/c', 'pnpm build:plugins'], {
        cwd: SS_EDITOR,
        stdio: 'inherit',
        env: { ...process.env, VITE_DEPLOY_BASE: '/', ...BUILD_ENV },
      });
      if (r.status !== 0) {
        info(
          C.warn(
            '! build:plugins failed (skipped): dist-plugins standalone plugin artifacts missing. ' +
              'The package still contains all in-app plugins (build:web); only the standalone hot-update flow is affected.',
          ),
        );
      }
      info(`Frontend: pnpm build:web:${opt.mode} (Vite mode=production|scada|data)`);
      const webCmd = opt.mode === 'full' ? 'build:web' : `build:web:${opt.mode}`;
      run('pnpm', [webCmd], SS_EDITOR, BUILD_ENV);
    } finally {
      if (tempWebEnv && fs.existsSync(tempWebEnv)) {
        fs.rmSync(tempWebEnv, { force: true });
        info(C.dim('Removed temporary .env.production.local'));
      }
    }
  }
} else {
  info(C.dim('Skipping build, using existing dist artifacts'));
}

  }


  return {
    runBuildStep,
  };
};
