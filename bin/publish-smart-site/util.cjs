// bin/publish-smart-site/util.cjs — 通用工具（颜色/日志/镜像复制/命令执行/HTTP 探测等）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { fs, path, cp, os, ROOT } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

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


  return {
    C,
    step,
    info,
    fail,
    mirror,
    wildcardToRegExp,
    cpSyncFiltered,
    run,
    ensureDir,
    readJson,
    parseEnvFile,
    gitCommit,
    isWeakSecret,
    randomSecret,
    writeBat,
    sha256FileSync,
    sleepSync,
    rmDirWithRetry,
    httpStatusSync,
    portListeningSync,
  };
};
