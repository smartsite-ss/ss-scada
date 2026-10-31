// bin/publish-smart-site/deps.cjs — 生产依赖：工作区包扫描、基线自举、目标 node_modules 补齐（[5] 步骤）
// 由 bin/publish-smart-site.cjs 拆分而来（v7 模块布局）；共享状态经 ctx 注入。

'use strict';

module.exports = function make(ctx) {
  const { fs, path, cp, os, ROOT, SS_NODE,
    SS_EDITOR,
    RUN_SS,
    PROD_DEPS_SRC,
    opt,
    C,
    step,
    info,
    fail,
    mirror,
    run,
    ensureDir,
    readJson,
    rmDirWithRetry } = ctx;

  // ─────────────────────────── 实现 ───────────────────────────

/**
 * 扫描工作区中可覆盖进 node_modules 的包（@ss-node/* 且已有 dist）。
 *
 * ⚠️ 注意：`packages/ss-storage/` 自身就是一个包，而其子目录
 * （ss-storage-influx / -influx3 / -tdengine）也是包 ⇒ **命中后仍必须继续下钻**，
 * 否则会漏掉嵌套层的工作区包，导致运行期 MODULE_NOT_FOUND。
 */
function scanWorkspacePackages() {
  const out = [];
  const seen = new Set();
  const SKIP = new Set([
    'node_modules',
    'dist',
    'dist_test',
    'src',
    'coverage',
    'scripts',
    'test',
    'tests',
    '__tests__',
  ]);
  const walk = (dir, depth) => {
    if (depth > 2 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const pjPath = path.join(full, 'package.json');
      if (fs.existsSync(pjPath)) {
        const pj = readJson(pjPath);
        if (
          pj &&
          typeof pj.name === 'string' &&
          pj.name.startsWith('@ss-node/') &&
          fs.existsSync(path.join(full, 'dist'))
        ) {
          if (!seen.has(pj.name)) {
            seen.add(pj.name);
            out.push({ name: pj.name, dir: full });
          }
        }
      }
      walk(full, depth + 1); // 继续下钻：嵌套工作区包（如 packages/ss-storage/*）
    }
  };
  walk(path.join(SS_NODE, 'packages'), 0);
  return out;
}

/**
 * 生产依赖基线自举（ss-scada 适配）。
 *
 * v7 打包器复用「已部署产物」ss-run/ss/services/ss-node/node_modules 作平面化生产依赖基线；
 * ss-scada 当前没有该基线 ⇒ 首次运行时用工作区清单 + 锁文件现场构建一个：
 *   1) 暂存目录只放清单（根 package.json / pnpm-workspace.yaml / .npmrc / pnpm-lock.yaml
 *      + 各工作区包的 package.json，不含源码）；
 *   2) pnpm install --frozen-lockfile --prod --ignore-scripts --config.node-linker=hoisted
 *      ⇒ 平面化（hoisted）生产 node_modules；工作区包以清单目录形式就位，dist 由步骤 [6] 覆盖；
 *   3) 原生模块（sqlite3）不出构建产物 ⇒ 从工作区 node_modules/.pnpm 复制已编译绑定；
 *   4) node_modules 移入 RUN_SS/services/ss-node（即 PROD_DEPS_SRC），暂存目录清理。
 * 幂等：基线已存在则直接返回。之后打包器按原逻辑复制基线，无需感知差异。
 */
function ensureProdDepsBaseline() {
  if (fs.existsSync(PROD_DEPS_SRC)) return;
  info(C.warn(`生产依赖基线不存在，开始自举：${path.relative(ROOT, PROD_DEPS_SRC)}`));

  const stage = path.join(RUN_SS, 'services', `.stage-baseline-${Date.now()}`);
  const stageModules = path.join(stage, 'node_modules');
  try {
    ensureDir(stage);
    // 1) 根清单
    for (const f of ['package.json', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml']) {
      const src = path.join(SS_NODE, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, f));
    }
    // 2) 各工作区包的 package.json（保持相对路径；跳过 node_modules/dist 等）
    const SKIP = new Set(['node_modules', 'dist', 'dist_test', 'coverage', 'scripts', '__tests__']);
    const collectManifests = (dir, rel, depth) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const relNext = rel ? path.join(rel, e.name) : e.name;
        const pj = path.join(full, 'package.json');
        if (fs.existsSync(pj)) {
          const dstRel = path.join(stage, relNext);
          ensureDir(dstRel);
          fs.copyFileSync(pj, path.join(dstRel, 'package.json'));
        }
        collectManifests(full, relNext, depth + 1);
      }
    };
    collectManifests(path.join(SS_NODE, 'packages'), 'packages', 0);
    collectManifests(path.join(SS_NODE, 'apps'), 'apps', 0);

    // 3) 平面化生产安装（跳过原生构建，绑定稍后从工作区复制）
    run('pnpm', ['install', '--frozen-lockfile', '--prod', '--ignore-scripts', '--config.node-linker=hoisted'], stage);
    if (!fs.existsSync(stageModules)) fail('基线自举：pnpm install 未产出 node_modules');

    // 4) 复制已编译的 sqlite3 绑定（工作区 .pnpm 中现成可用；hoisted 布局无 .pnpm，需按版本散填）
    const pnpmStore = path.join(SS_NODE, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmStore)) {
      const sqlite3Dirs = [];
      const walkSqlite3 = (dir, depth) => {
        if (depth > 6 || !fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          if (e.name === 'sqlite3') {
            const pj = readJson(path.join(dir, e.name, 'package.json'));
            if (pj) sqlite3Dirs.push({ dir: path.join(dir, e.name), version: pj.version });
            continue;
          }
          walkSqlite3(path.join(dir, e.name), depth + 1);
        }
      };
      walkSqlite3(stageModules, 0);
      for (const { dir, version } of sqlite3Dirs) {
        const variantDir = fs
          .readdirSync(pnpmStore)
          .find((n) => n === `sqlite3@${version}` || n.startsWith(`sqlite3@${version}@`));
        const bindingSrc = variantDir
          ? path.join(
              pnpmStore,
              variantDir,
              'node_modules',
              'sqlite3',
              'build',
              'Release',
              'node_sqlite3.node',
            )
          : null;
        if (!bindingSrc || !fs.existsSync(bindingSrc)) {
          info(C.warn(`  ! 未找到 sqlite3@${version} 的已编译绑定（${path.relative(ROOT, dir)}），运行期将回退 bindings 查找`));
          continue;
        }
        ensureDir(path.join(dir, 'build', 'Release'));
        fs.copyFileSync(bindingSrc, path.join(dir, 'build', 'Release', 'node_sqlite3.node'));
        info(`  sqlite3@${version} 绑定 ← ${path.relative(ROOT, bindingSrc)}`);
      }
    }

    // 5) node_modules 移入正式基线位置
    ensureDir(path.dirname(PROD_DEPS_SRC));
    if (fs.existsSync(PROD_DEPS_SRC)) fs.rmSync(PROD_DEPS_SRC, { recursive: true, force: true });
    fs.renameSync(stageModules, PROD_DEPS_SRC);
    info(C.ok(`生产依赖基线已就绪：${path.relative(ROOT, PROD_DEPS_SRC)}`));
  } finally {
    if (fs.existsSync(stage)) {
      try {
        fs.rmSync(stage, { recursive: true, force: true });
      } catch {
        info(C.warn(`暂存目录清理失败（可手动删除）: ${stage}`));
      }
    }
  }
}

/**
 * 汇总「运行期需要的三方依赖」= 主应用 deps ∪ 各工作区包 deps。
 * 用于检测复用的依赖基线是否缺少新版代码新增的依赖。
 */
function collectRequiredDeps(workspacePkgs) {
  const req = new Map();
  const add = (deps) => {
    for (const [k, v] of Object.entries(deps || {})) if (!req.has(k)) req.set(k, v);
  };
  const appPkg = readJson(path.join(SS_NODE, 'apps', 'ss-node-server', 'package.json'));
  add(appPkg && appPkg.dependencies);
  for (const p of workspacePkgs) {
    const pj = readJson(path.join(p.dir, 'package.json'));
    add(pj && pj.dependencies);
  }
  return req;
}


  function runDepsStep() {
    const { T, TOTAL } = ctx;

// ── [5] 生产依赖 ──────────────────────────────────────────────
step(5, TOTAL, '准备生产依赖 node_modules');
ensureProdDepsBaseline();
const targetModules = path.join(T, 'node_modules');
if (opt.server && opt.deps) {
  if (opt.linkDeps) {
    if (fs.existsSync(targetModules)) fs.rmSync(targetModules, { recursive: true, force: true });
    if (process.platform !== 'win32') fail('--link-deps 仅支持 Windows（mklink /J）');
    const r = cp.spawnSync('cmd', ['/c', 'mklink', '/J', targetModules, PROD_DEPS_SRC], {
      stdio: 'inherit',
    });
    if (r.status !== 0) fail('创建目录联接失败');
    info(`node_modules 联接 → ${path.relative(ROOT, PROD_DEPS_SRC)}`);
  } else {
    if (!fs.existsSync(PROD_DEPS_SRC)) fail(`生产依赖基线不存在: ${PROD_DEPS_SRC}`);
    info(`复制第三方依赖基线 ← ${path.relative(ROOT, PROD_DEPS_SRC)}（可能耗时 1-3 分钟）`);
    mirror(PROD_DEPS_SRC, targetModules);
  }

  // ── [6] 用工作区最新 dist 覆盖 @ss-node/* ──────────────────
  step(6, TOTAL, '覆盖工作区包 @ss-node/*（避免用到过期的已发布包）');
  const pkgs = scanWorkspacePackages();
  const isJunction = opt.linkDeps;
  let overlaid = 0;
  for (const p of pkgs) {
    const dst = path.join(targetModules, ...p.name.split('/'));
    if (isJunction) {
      // 联接模式下不能直接写进联接目录（会污染源），故跳过覆盖并提示
      continue;
    }
    ensureDir(dst);
    mirror(path.join(p.dir, 'dist'), path.join(dst, 'dist'));
    fs.copyFileSync(path.join(p.dir, 'package.json'), path.join(dst, 'package.json'));
    const pkgI18n = path.join(p.dir, 'i18n');
    if (fs.existsSync(pkgI18n)) mirror(pkgI18n, path.join(dst, 'i18n'));
    overlaid++;
  }
  if (isJunction) {
    info(
      C.warn(
        `--link-deps 模式：跳过 ${pkgs.length} 个 @ss-node/* 的覆盖（避免污染基线目录）。` +
          `若基线中的工作区包较旧，请改用默认复制模式。`,
      ),
    );
  } else {
    info(C.ok(`已覆盖 ${overlaid} 个工作区包（含新增包，如 ss-collector-calc）`));
  }
  // ── [6b] 补齐三方依赖缺口：复用的基线可能缺少「新版代码新增」的依赖 ──
  // 典型：@ss-node/ss-core 新版引入 @modelcontextprotocol/sdk，而旧基线没有 ⇒
  // 运行期 MODULE_NOT_FOUND（与 2026-09-04 部署清单漏项事故同类，见 ci_ss_backand.bat 注释）。
  if (!isJunction) {
    const missing = [];
    for (const [name, range] of collectRequiredDeps(pkgs)) {
      const r = String(range);
      if (r.startsWith('workspace:')) continue; // 工作区包由 overlay 提供
      try {
        require.resolve(name, { paths: [targetModules] });
      } catch {
        missing.push(`${name}@${r}`);
      }
    }
    if (!missing.length) {
      info(C.ok('三方依赖无缺口'));
    } else if (!opt.installMissing) {
      info(
        C.warn(
          `检测到 ${missing.length} 个缺失依赖，但 --no-install-missing 已禁用自动补齐：${missing.join(', ')}`,
        ),
      );
    } else {
      info(`检测到 ${missing.length} 个缺失依赖，开始补齐：${missing.join(', ')}`);
      const staging = path.join(ROOT, 'temp', 'smart-site-deps');
      fs.rmSync(staging, { recursive: true, force: true });
      ensureDir(staging);
      const depsObj = {};
      for (const m of missing) {
        const i = m.lastIndexOf('@');
        depsObj[m.slice(0, i)] = m.slice(i + 1);
      }
      fs.writeFileSync(
        path.join(staging, 'package.json'),
        JSON.stringify(
          { name: 'smart-site-deps', private: true, version: '0.0.0', dependencies: depsObj },
          null,
          2,
        ),
        'utf8',
      );
      run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], staging);
      // 合并进目标 node_modules（已存在的保持不动，避免污染复用基线）
      let copied = 0;
      const merge = (src, dst) => {
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, e.name);
          const d = path.join(dst, e.name);
          if (e.isDirectory()) {
            if (e.name.startsWith('@')) {
              ensureDir(d);
              merge(s, d);
            } else if (!fs.existsSync(d)) {
              fs.cpSync(s, d, { recursive: true, dereference: true });
              copied++;
            }
          } else if (!fs.existsSync(d)) {
            fs.copyFileSync(s, d);
          }
        }
      };
      merge(path.join(staging, 'node_modules'), targetModules);
      fs.rmSync(staging, { recursive: true, force: true });
      info(C.ok(`已补齐 ${copied} 个依赖包目录`));
    }
  }
} else {
  info(C.dim(opt.server ? '跳过依赖（--no-deps）' : '跳过（--no-server）'));
  step(6, TOTAL, '跳过工作区包覆盖');
  info(C.dim('依赖未更新'));
}


  }


  return {
    scanWorkspacePackages,
    ensureProdDepsBaseline,
    collectRequiredDeps,
    runDepsStep,
  };
};
