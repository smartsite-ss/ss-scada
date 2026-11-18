#!/usr/bin/env node
// Copyright (c) 2025 Smart Site Team
// SPDX-License-Identifier: Apache-2.0
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Publish the packages produced by bin/publish-smart-site.bat to GitHub and Gitee Releases.
 * ---------------------------------------------------------------------------
 * Design: docs-e/publish/Releases发布方案-GitHub与Gitee.md
 *
 * What it does
 *   1. Resolve the release tag (default: latest git tag) and verify it matches HEAD
 *   2. Discover the package zips (ss-run/ss-win/win-ss-<tag>*.zip) and build .sha256 files
 *   3. Write release-manifest.json (provenance: tag, commit, builtAt, asset hashes)
 *   4. GitHub: one asset per package (2 GiB limit) + sha256 + manifest
 *   5. Gitee : chunked copies (<= 90 MB per attachment) + reassembly scripts + checksums,
 *              because Gitee caps a release attachment at 100 MB
 *   6. Idempotent: existing assets with the same size are skipped, so a failed run can simply
 *      be repeated (--replace overwrites assets whose size changed)
 *
 * Credentials (never committed, never printed):
 *   bin/release.local.env   ->  GITHUB_TOKEN=... / GITEE_TOKEN=...
 *   or the same names in the environment (CI)
 *   GitHub : classic PAT "repo", or fine-grained PAT with Contents: Read and write
 *   Gitee  : 私人令牌 with the "projects" scope
 *
 * Usage (normally through bin/publish-release.bat):
 *   node bin/publish-release.cjs --tag=v7.0.3
 *   node bin/publish-release.cjs --tag=v7.0.3 --dry-run
 *   node bin/publish-release.cjs --tag=v7.0.3 --only-gitee --chunk-mb=90
 *   node bin/publish-release.cjs --tag=v7.0.3 --assets=ss-run/ss-win/win-ss-v7.0.3.zip
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, REPOS, LIMITS, DEFAULTS } = require('./publish-release/config.cjs');
const util = require('./publish-release/util.cjs');
const plan = require('./publish-release/plan.cjs');
const { splitAsset } = require('./publish-release/split.cjs');
const github = require('./publish-release/github.cjs');
const gitee = require('./publish-release/gitee.cjs');

const {
  C, info, ok, warn, err, step, humanSize, ensureDir, git, gitOrNull, loadSecretFile,
  resolveProxy, maskSecret,
} = util;

// ─────────────────────────── CLI parsing ───────────────────────────

const TOTAL_STEPS = 6;

const opt = {
  ...DEFAULTS,
  assets: null,
  name: null,
  title: null,
  notesFile: null,
  notesEn: null,
  notesZh: null,
  updateNotes: false,
  dryRun: false,
  selfCheck: false,
  verbose: false,
  targetCommitish: null,
};

function printHelp() {
  console.log(`
Smart Site release uploader (GitHub + Gitee)

Usage:
  node bin/publish-release.cjs [options]

Options:
  --tag=<tag>          Release tag (default: latest git tag, e.g. v7.0.2)
  --package=<dir>      Package dir made by publish-smart-site (default ss-run/ss-win/04-win-node)
  --assets=<a,b>       Explicit asset files (overrides auto discovery in ss-run/ss-win)
  --name=<base>        Asset base name (default win-ss-<tag>[-standalone][-exe])
  --title=<text>       Release title (GitHub: "Smart Site <tag> (Windows package)", Gitee: Chinese)
  --notes=<file>       Same notes file for both platforms
  --notes-en=<file>    GitHub notes (English; default: staged RELEASE-NOTES-en.md or generated)
  --notes-zh=<file>    Gitee notes (Chinese; default: staged RELEASE-NOTES-zh-CN.md or generated)
  --update-notes       Rewrite the notes of an existing release (default: keep the existing ones)
  --platforms=<list>   github,gitee (default both)
  --only-github | --only-gitee
  --chunk-mb=<n>       Gitee chunk size in MB (default 90; 0 = no split)
  --no-chunk           Same as --chunk-mb=0 (Gitee rejects attachments > 100 MB)
  --quota-warn-mb=<n>  Warn when the Gitee plan exceeds this size (default 900)
  --replace            Delete and re-upload assets whose size differs (default: report and skip)
  --no-verify          Skip the final asset re-listing check
  --no-tag-push        Never create/push the git tag (only inspect it)
  --target=<branch>    target_commitish for platforms that create the tag (default: current branch)
  --proxy=<url>        HTTPS proxy for GitHub (default: HTTPS_PROXY). Gitee should stay direct
  --token-file=<path>  Secret file (default bin/release.local.env)
  --work-root=<dir>    Release staging root (default ss-run/ss-win/release)
  --dry-run            Print the plan and the assets, do not touch the platforms
  --self-check         Validate tag/assets/tokens/sizes only, then exit
  --verbose            More logging
  -h, --help           Show this help

Examples:
  node bin/publish-release.cjs --tag=v7.0.3 --dry-run
  node bin/publish-release.cjs --tag=v7.0.3
  node bin/publish-release.cjs --tag=v7.0.3 --only-gitee --replace
`);
}

for (const arg of process.argv.slice(2)) {
  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  } else if (arg === '--dry-run') opt.dryRun = true;
  else if (arg === '--self-check') opt.selfCheck = true;
  else if (arg === '--verbose') opt.verbose = true;
  else if (arg === '--replace') opt.replace = true;
  else if (arg === '--no-verify') opt.verify = false;
  else if (arg === '--no-tag-push') opt.createTag = false;
  else if (arg === '--update-notes') opt.updateNotes = true;
  else if (arg === '--prerelease') opt.prerelease = true;
  else if (arg === '--no-chunk') opt.chunkMb = 0;
  else if (arg === '--only-github') opt.platforms = ['github'];
  else if (arg === '--only-gitee') opt.platforms = ['gitee'];
  else if (arg.startsWith('--tag=')) opt.tag = arg.slice('--tag='.length).trim();
  else if (arg.startsWith('--package=')) {
    opt.packageDir = path.resolve(ROOT, arg.slice('--package='.length));
  } else if (arg.startsWith('--assets=')) {
    opt.assets = arg
      .slice('--assets='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (arg.startsWith('--name=')) opt.name = arg.slice('--name='.length).trim();
  else if (arg.startsWith('--title=')) opt.title = arg.slice('--title='.length);
  else if (arg.startsWith('--notes=')) opt.notesFile = path.resolve(ROOT, arg.slice('--notes='.length));
  else if (arg.startsWith('--notes-en=')) {
    opt.notesEn = path.resolve(ROOT, arg.slice('--notes-en='.length));
  } else if (arg.startsWith('--notes-zh=')) {
    opt.notesZh = path.resolve(ROOT, arg.slice('--notes-zh='.length));
  } else if (arg.startsWith('--platforms=')) {
    opt.platforms = arg
      .slice('--platforms='.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } else if (arg.startsWith('--chunk-mb=')) opt.chunkMb = Number(arg.slice('--chunk-mb='.length));
  else if (arg.startsWith('--quota-warn-mb=')) {
    opt.giteeQuotaWarnMb = Number(arg.slice('--quota-warn-mb='.length));
  } else if (arg.startsWith('--target=')) {
    opt.targetCommitish = arg.slice('--target='.length).trim();
  } else if (arg.startsWith('--proxy=')) opt.proxy = arg.slice('--proxy='.length).trim();
  else if (arg.startsWith('--token-file=')) {
    opt.tokenFile = path.resolve(ROOT, arg.slice('--token-file='.length));
  } else if (arg.startsWith('--work-root=')) {
    opt.workRoot = path.resolve(ROOT, arg.slice('--work-root='.length));
  } else {
    console.error(`[ERROR] Unknown option: ${arg} (use --help)`);
    process.exit(1);
  }
}

if (
  opt.platforms.length === 0 ||
  opt.platforms.some((p) => !['github', 'gitee'].includes(p))
) {
  console.error(`[ERROR] --platforms accepts only github,gitee (got: ${opt.platforms.join(',')})`);
  process.exit(1);
}
if (!Number.isFinite(opt.chunkMb) || opt.chunkMb < 0) {
  console.error('[ERROR] --chunk-mb must be a non-negative number');
  process.exit(1);
}
if (opt.chunkMb > 0 && opt.chunkMb > LIMITS.giteeAssetMb) {
  console.error(
    `[ERROR] --chunk-mb=${opt.chunkMb} exceeds the Gitee limit of ${LIMITS.giteeAssetMb} MB per attachment`,
  );
  process.exit(1);
}

// ─────────────────────────── Shared context ───────────────────────────

const secrets = loadSecretFile(opt.tokenFile);
const pick = (name) => secrets[name] || process.env[name] || '';

/** Tag → work dir (chunk parts, checksums, manifest) */
function workDirFor(tag) {
  return path.join(opt.workRoot, tag);
}

/** Free disk space of the drive that holds `dir` (null when unsupported) */
function freeSpaceBytes(dir) {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

/**
 * Create and push the annotated tag when it does not exist yet.
 * Push order follows the repository policy: GitHub first, then Gitee.
 */
function ensureTag(ctx, tagInfo) {
  if (tagInfo.tagExists) {
    if (tagInfo.tagCommit && tagInfo.headCommit && tagInfo.tagCommit !== tagInfo.headCommit) {
      warn(
        `  ! Tagging mismatch: ${tagInfo.tag} points to ${tagInfo.tagCommit.slice(0, 8)}, ` +
          `HEAD is ${tagInfo.headCommit.slice(0, 8)}. The assets were built from HEAD.`,
      );
      warn('    Create a fresh tag for the new build (--tag=v<next>) if that is not intended.');
    }
    return { created: false };
  }

  if (!ctx.createTag) {
    warn(`  ! Tag ${tagInfo.tag} does not exist and --no-tag-push was given`);
    return { created: false };
  }

  info(`  Creating annotated tag ${tagInfo.tag} at ${tagInfo.headShort} ...`);
  const created = git(['tag', '-a', tagInfo.tag, '-m', `Smart Site ${tagInfo.tag}`, tagInfo.headCommit], ROOT);
  if (created.status !== 0) {
    throw util.fail(`git tag failed: ${created.stderr || created.stdout}`);
  }

  for (const remote of ['origin', 'gitee']) {
    const has = git(['remote'], ROOT).stdout.split(/\r?\n/).includes(remote);
    if (!has) {
      warn(`  ! remote "${remote}" not configured, skipping tag push`);
      continue;
    }
    const pushed = git(['push', remote, `refs/tags/${tagInfo.tag}`], ROOT);
    if (pushed.status === 0) ok(`  Tag pushed to ${remote}`);
    else warn(`  ! Tag push to ${remote} failed: ${pushed.stderr.split('\n')[0]}`);
  }
  return { created: true };
}

// ─────────────────────────── Main ───────────────────────────

async function main() {
  console.log('');
  console.log('='.repeat(78));
  console.log(C.bold('  Smart Site release uploader (GitHub + Gitee)'));
  console.log('='.repeat(78));
  console.log(`  Repository root : ${ROOT}`);
  console.log(`  Platforms       : ${opt.platforms.join(', ')}`);
  console.log(`  Package dir     : ${path.relative(ROOT, opt.packageDir)}`);
  console.log(`  Secret file     : ${path.relative(ROOT, opt.tokenFile)}${fs.existsSync(opt.tokenFile) ? '' : ' (missing)'}`);
  console.log(`  Gitee chunk     : ${opt.chunkMb > 0 ? `${opt.chunkMb} MB` : 'disabled'}`);
  if (opt.dryRun) console.log(C.warn('  Mode            : DRY RUN (no uploads)'));
  if (opt.selfCheck) console.log(C.warn('  Mode            : SELF CHECK (no uploads)'));
  console.log('='.repeat(78));

  // ── [1] Tag / commit ─────────────────────────────────────────
  step(1, TOTAL_STEPS, 'Resolving release tag and commit');
  const tagInfo = plan.resolveTag(ROOT, opt.tag);
  const branch = opt.targetCommitish || gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT) || 'master';
  info(`  Tag        : ${tagInfo.tag}${tagInfo.tagExists ? '' : C.warn(' (not created yet)')}`);
  info(`  Previous   : ${tagInfo.previousTag || '(none)'}`);
  info(`  HEAD       : ${tagInfo.headShort} (${branch})`);

  const proxy = resolveProxy(opt.proxy);
  const ctx = {
    root: ROOT,
    repos: REPOS,
    proxy,
    token: '',
    timeoutMs: DEFAULTS.timeoutMs,
    replace: opt.replace,
    prerelease: opt.prerelease,
    createTag: opt.createTag,
    updateNotes: opt.updateNotes,
    targetCommitish: branch,
    hashes: new Map(),
    workDir: workDirFor(tagInfo.tag),
  };
  if (proxy) info(`  Proxy      : ${proxy.url} (GitHub only)`);

  // Dry run / self check never mutate the repository: report a missing tag instead of creating it
  const previewOnly = opt.dryRun || opt.selfCheck;
  const tagResult = previewOnly ? { created: false } : ensureTag(ctx, tagInfo);
  if (tagResult.created) tagInfo.tagExists = true;
  if (previewOnly && !tagInfo.tagExists) {
    warn(
      `  ! Tag ${tagInfo.tag} does not exist yet; a real run would create it at ${tagInfo.headShort} ` +
        'and push it to origin + gitee',
    );
  }

  // ── [2] Assets ───────────────────────────────────────────────
  step(2, TOTAL_STEPS, 'Discovering package assets');
  const discovered = plan.discoverAssets(opt, tagInfo, ROOT);
  ensureDir(ctx.workDir);
  info(
    `  Source     : ${discovered.staged ? 'release staging dir' : 'legacy package output'} ` +
      `(${discovered.staged ? path.relative(ROOT, ctx.workDir) : path.relative(ROOT, opt.artifactDir)})`,
  );
  for (const asset of discovered.assets) {
    info(`  * ${asset.name} — ${humanSize(asset.size)}  (${path.relative(ROOT, asset.file)})`);
  }
  if (discovered.versionInfo) {
    info(
      `  VERSION.json: ${discovered.versionInfo.form || '-'}, built ${discovered.versionInfo.builtAt || '-'}, ` +
        `commit ${discovered.versionInfo.gitCommit || '-'}`,
    );

    // The package must come from the tagged commit, otherwise the release claims provenance it
    // does not have (common when the package was built before the last commits were added)
    const pkgCommit = String(discovered.versionInfo.gitCommit || '').trim().split('-')[0];
    const refCommit = tagInfo.tagCommit || tagInfo.headCommit || '';
    if (pkgCommit && refCommit && !refCommit.startsWith(pkgCommit)) {
      warn(
        `  ! VERSION.json was built from commit ${pkgCommit}, but ${tagInfo.tag} points to ` +
          `${refCommit.slice(0, 8)}. Rebuild the package after tagging if this is unintended.`,
      );
    }
  } else {
    warn(`  ! VERSION.json not found (looked in ${path.relative(ROOT, opt.packageDir)} and the stage dir) — provenance will be incomplete`);
  }

  // ── [3] Notes / checksums / manifest ─────────────────────────
  step(3, TOTAL_STEPS, 'Preparing bilingual notes, checksums and manifest');
  const titleEn = opt.title || `${opt.titlePrefix} ${tagInfo.tag} (Windows package)`;
  const titleZh = opt.title || `${opt.titlePrefix} ${tagInfo.tag}（Windows 单机包）`;

  /**
   * Notes for one language.
   *
   * Priority: --notes-en/--notes-zh (or --notes for both) > notes staged for this tag by
   * bin/pack-release.bat > bin/release-notes/<tag>.<lang>.md > generated text.
   * Generated text is written into the stage dir so the release folder stays self-describing.
   */
  const resolveNotes = (lang, explicitFile) => {
    const fileName = lang === 'en' ? 'RELEASE-NOTES-en.md' : 'RELEASE-NOTES-zh-CN.md';
    const stagedFile = path.join(ctx.workDir, fileName);
    const repoFile = path.join(ROOT, 'bin', 'release-notes', `${tagInfo.tag}.${lang}.md`);

    const read = (file, source) => ({ text: fs.readFileSync(file, 'utf8'), source });

    if (explicitFile) {
      if (!fs.existsSync(explicitFile)) throw util.fail(`Notes file not found: ${explicitFile}`);
      const resolved = read(explicitFile, path.relative(ROOT, explicitFile));
      fs.writeFileSync(stagedFile, resolved.text, 'utf8');
      return resolved;
    }
    if (fs.existsSync(stagedFile)) return read(stagedFile, path.relative(ROOT, stagedFile));
    if (fs.existsSync(repoFile)) {
      const resolved = read(repoFile, path.relative(ROOT, repoFile));
      fs.writeFileSync(stagedFile, resolved.text, 'utf8');
      return resolved;
    }

    const text =
      lang === 'en'
        ? plan.generateNotes(ctx, tagInfo, discovered.assets, discovered.versionInfo)
        : plan.generateNotesZh(ctx, tagInfo, discovered.assets, discovered.versionInfo);
    fs.writeFileSync(stagedFile, text, 'utf8');
    return { text, source: `generated → ${path.relative(ROOT, stagedFile)}` };
  };

  const notesEn = resolveNotes('en', opt.notesEn || opt.notesFile);
  const notesZh = resolveNotes('zh-CN', opt.notesZh || opt.notesFile);
  info(
    `  notes (GitHub, English) : ${notesEn.source} (${Buffer.byteLength(notesEn.text)} bytes)`,
  );
  info(
    `  notes (Gitee, Chinese)  : ${notesZh.source} (${Buffer.byteLength(notesZh.text)} bytes)`,
  );

  const checksumAssets = await plan.buildChecksums(ctx, discovered.assets);
  const manifestAsset = await plan.writeManifest(
    ctx,
    tagInfo,
    discovered.assets,
    discovered.versionInfo,
    {
      notes: {
        en: { file: 'RELEASE-NOTES-en.md', source: notesEn.source },
        'zh-CN': { file: 'RELEASE-NOTES-zh-CN.md', source: notesZh.source },
      },
    },
  );
  info(`  manifest: ${path.relative(ROOT, manifestAsset.file)}`);

  // ── [4] Platform plans (Gitee chunking) ──────────────────────
  step(4, TOTAL_STEPS, 'Planning uploads (GitHub single files, Gitee chunked)');

  const githubAssets = [...discovered.assets, ...checksumAssets, manifestAsset];
  const giteeAssets = [];
  let giteeBytes = 0;
  let splitFailed = false;

  if (opt.platforms.includes('gitee')) {
    const chunkLimit = opt.chunkMb > 0 ? opt.chunkMb * 1024 * 1024 : 0;
    for (const asset of discovered.assets) {
      const needsSplit = chunkLimit > 0 && asset.size > chunkLimit;
      if (!needsSplit) {
        if (asset.size > LIMITS.giteeAssetMb * 1024 * 1024) {
          err(
            `  ✗ ${asset.name} is ${humanSize(asset.size)} — over the Gitee per-attachment limit ` +
              `(${LIMITS.giteeAssetMb} MB) and chunking is disabled`,
          );
          splitFailed = true;
          continue;
        }
        giteeAssets.push(asset);
        giteeBytes += asset.size;
        info(`  Gitee: ${asset.name} (${humanSize(asset.size)}) — single file`);
        continue;
      }

      const split = await splitAsset(asset, { chunkMb: opt.chunkMb, outRoot: ctx.workDir });
      if (!split.verified) splitFailed = true;
      giteeAssets.push(...split.parts, ...split.extras);
      giteeBytes += split.parts.reduce((sum, p) => sum + p.size, 0);
      giteeBytes += split.extras.reduce((sum, p) => sum + p.size, 0);
      info(
        `  Gitee: ${asset.name} -> ${split.parts.length} part(s) + ` +
          `${split.extras.length} helper file(s), ${humanSize(giteeBytes)} total`,
      );
    }
    giteeAssets.push(...checksumAssets, manifestAsset);
  }

  // Size / quota guards
  let planBad = false;
  for (const asset of githubAssets) {
    if (asset.size > LIMITS.githubAssetMb * 1024 * 1024) {
      err(`  ✗ ${asset.name} is ${humanSize(asset.size)} — over the GitHub per-asset limit (2 GiB)`);
      planBad = true;
    }
  }
  const giteeQuota = opt.giteeQuotaWarnMb * 1024 * 1024;
  if (giteeBytes > giteeQuota) {
    warn(
      `  ! Gitee plan is ${humanSize(giteeBytes)}, above the warning threshold ` +
        `(${opt.giteeQuotaWarnMb} MB). Gitee limits a repository to ${LIMITS.giteeRepoQuotaMb} MB of attachments.`,
    );
    warn('    Consider --data-exclude / --no-user-data to ship a smaller package, or publish Gitee only in parts of a lite build.');
  }
  if (splitFailed) planBad = true;

  info('');
  info(`  GitHub assets : ${githubAssets.length} file(s), ${humanSize(githubAssets.reduce((s, a) => s + a.size, 0))}`);
  info(`  Gitee assets  : ${giteeAssets.length} file(s), ${humanSize(giteeBytes)}`);

  // Disk space for the chunked copies
  if (opt.platforms.includes('gitee') && opt.chunkMb > 0) {
    const free = freeSpaceBytes(opt.workRoot);
    if (free !== null && free < giteeBytes + 200 * 1024 * 1024) {
      err(
        `  ✗ Not enough free disk space for chunk copies: need ${humanSize(giteeBytes)}, ` +
          `free ${humanSize(free)} at ${opt.workRoot}`,
      );
      planBad = true;
    }
  }

  if (planBad) throw util.fail('Upload plan has blocking problems (see ✗ above)');

  // ── Dry run / self check ─────────────────────────────────────
  if (opt.dryRun || opt.selfCheck) {
    info('');
    info(C.bold('  Plan (no uploads performed)'));
    for (const platform of opt.platforms) {
      const list = platform === 'github' ? githubAssets : giteeAssets;
      info(`  ${platform} -> https://${platform === 'github' ? 'github.com' : 'gitee.com'}/${
        platform === 'github' ? REPOS.github : REPOS.gitee
      }/releases/tag/${encodeURIComponent(tagInfo.tag)}`);
      const notes = platform === 'github' ? notesEn : notesZh;
      info(
        `      title: ${platform === 'github' ? titleEn : titleZh}\n` +
          `      notes: ${notes.source} (${Buffer.byteLength(notes.text)} bytes)`,
      );
      for (const asset of list) info(`      ${asset.name}  ${humanSize(asset.size)}`);
    }

    if (opt.selfCheck) {
      let checkBad = false;
      if (opt.platforms.includes('github')) {
        const token = pick('GITHUB_TOKEN') || pick('GH_TOKEN');
        if (!token) {
          err('  ✗ GITHUB_TOKEN missing (bin/release.local.env or environment)');
          checkBad = true;
        } else {
          ok(`  ✓ GitHub token present: ${maskSecret(token)}`);
        }
      }
      if (opt.platforms.includes('gitee')) {
        const token = pick('GITEE_TOKEN');
        if (!token) {
          err('  ✗ GITEE_TOKEN missing (bin/release.local.env or environment)');
          checkBad = true;
        } else {
          ok(`  ✓ Gitee token present: ${maskSecret(token)}`);
        }
      }
      if (checkBad) throw util.fail('Self check failed');
      ok('\n  Self check passed: tag, assets, sizes and tokens are ready.');
    } else {
      info('\n  Dry run finished. Remove --dry-run to upload.');
    }
    return 0;
  }

  // ── [5] Upload ───────────────────────────────────────────────
  step(5, TOTAL_STEPS, 'Uploading release assets');
  const results = {};
  let failures = 0;

  for (const platform of opt.platforms) {
    const client = platform === 'github' ? github : gitee;
    const assets = platform === 'github' ? githubAssets : giteeAssets;
    console.log('');
    console.log(C.bold(`  ── ${platform} (${client.repo}) ──`));
    try {
      ctx.token = platform === 'github' ? pick('GITHUB_TOKEN') || pick('GH_TOKEN') : pick('GITEE_TOKEN');
      client.checkToken(ctx);
      const platformTitle = platform === 'github' ? titleEn : titleZh;
      const platformNotes = platform === 'github' ? notesEn.text : notesZh.text;
      info(`  title: ${platformTitle}`);
      info(`  notes: ${platform === 'github' ? notesEn.source : notesZh.source}`);
      results[platform] = await client.publish(ctx, tagInfo, platformTitle, platformNotes, assets);
      if (results[platform].failed.length) {
        failures += results[platform].failed.length;
        err(`  ✗ ${results[platform].failed.length} asset(s) require attention on ${platform}`);
      }
    } catch (e) {
      failures += 1;
      results[platform] = { error: e.message };
      err(`  ✗ ${platform} failed: ${e.message}`);
    }
  }

  // ── [6] Verify ───────────────────────────────────────────────
  step(6, TOTAL_STEPS, 'Verifying uploaded assets');
  if (!opt.verify) {
    info('  skipped (--no-verify)');
  } else {
    for (const platform of opt.platforms) {
      const result = results[platform];
      if (!result || result.error) {
        warn(`  ${platform}: skipped verification (upload failed)`);
        continue;
      }
      const expected = (platform === 'github' ? githubAssets : giteeAssets).map((a) => a.name);
      const listed = [...result.uploaded, ...result.skipped];
      const missing = expected.filter((name) => !listed.includes(name));
      if (missing.length) {
        failures += missing.length;
        err(`  ✗ ${platform}: missing assets: ${missing.join(', ')}`);
      } else {
        ok(`  ✓ ${platform}: ${expected.length}/${expected.length} asset(s) present`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(78));
  if (failures) console.log(C.err(`  Published with ${failures} problem(s).`));
  else console.log(C.ok('  Release published successfully.'));
  console.log('='.repeat(78));
  console.log(`  Tag        : ${tagInfo.tag} (${tagInfo.headShort})`);
  if (results.github) {
    console.log(
      `  GitHub     : ${results.github.releaseUrl || `https://github.com/${REPOS.github}/releases/tag/${tagInfo.tag}`}`,
    );
    console.log(`               uploaded ${results.github.uploaded?.length || 0}, skipped ${results.github.skipped?.length || 0}`);
  }
  if (results.gitee) {
    console.log(
      `  Gitee      : ${results.gitee.releaseUrl || `https://gitee.com/${REPOS.gitee}/releases/tag/${tagInfo.tag}`}`,
    );
    console.log(`               uploaded ${results.gitee.uploaded?.length || 0}, skipped ${results.gitee.skipped?.length || 0}`);
  }
  console.log(`  Work dir   : ${path.relative(ROOT, ctx.workDir)}`);
  console.log('='.repeat(78));
  console.log(C.dim('  Re-run the same command to resume: assets already uploaded are skipped.'));

  return failures ? 1 : 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    if (e && e.isFatal) {
      err(`\n[ERROR] ${e.message}`);
    } else {
      err(`\n[ERROR] ${e && e.message ? e.message : e}`);
      if (e && e.stack && opt.verbose) console.error(e.stack);
    }
    process.exit(1);
  });
