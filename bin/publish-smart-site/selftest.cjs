// bin/publish-smart-site/selftest.cjs — 自测试（--self-test）：暂存副本真实启动 → health/首页/SPA 探活 → 清理，结果回写 VERSION.json
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { fs, path, cp, os, ROOT, opt,
    C,
    info,
    fail,
    sleepSync,
    rmDirWithRetry,
    httpStatusSync,
    portListeningSync,
    readJson,
    mirror } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

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


  return {
    selfTestPackage,
  };
};
