// bin/publish-smart-site/zip.cjs — 压缩分发（--zip）：tar.exe → 回退 Compress-Archive；输出 zip + sha256
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { ROOT, fs, path, cp, C, info,
    fail,
    sha256FileSync } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

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


  return {
    zipPackage,
  };
};
