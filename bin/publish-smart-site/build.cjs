// bin/publish-smart-site/build.cjs — [1] 构建步骤（后端 pnpm build / 前端 build:web + 插件尽力而为）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, os, SS_NODE, SS_EDITOR, opt, BUILD_HEAP, BUILD_ENV, TOTAL, C, step, info, fail, run } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────


  function runBuildStep() {
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

  }


  return {
    runBuildStep,
  };
};
