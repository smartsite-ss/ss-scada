#!/usr/bin/env node
// Copyright (c) 2025 Smart Site Team
// SPDX-License-Identifier: Apache-2.0
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Pack a Smart Site release into ss-run/ss-win/release/<tag>/ together with its notes.
 * ---------------------------------------------------------------------------
 * Design: docs-e/publish/Releases发布方案-GitHub与Gitee.md
 *
 * Result layout (one self-describing directory per version):
 *   ss-run/ss-win/release/<tag>/
 *   ├── win-ss-<tag>[-standalone][-exe]/       unpacked package (double-click start.bat)
 *   ├── win-ss-<tag>[-standalone][-exe].zip    the distributable archive
 *   ├── <zip>.sha256                           checksum of the archive
 *   ├── RELEASE-NOTES-en.md                    English notes (GitHub)
 *   ├── RELEASE-NOTES-zh-CN.md                 Chinese notes (Gitee)
 *   └── release-manifest.json                  provenance (tag/commit/assets/notes)
 *
 * The actual packaging is done by bin/publish-smart-site.cjs; every option that is not
 * understood here is forwarded to it, so the two tools cannot drift apart:
 *   bin\pack-release.bat v7.0.3 --standalone --port=4200 --no-build --zip
 *
 * Publish afterwards with bin/publish-release.bat --tag=v7.0.3 (separate script).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const { ROOT, DEFAULTS } = require('./publish-release/config.cjs');
const util = require('./publish-release/util.cjs');
const plan = require('./publish-release/plan.cjs');

const { C, info, ok, warn, err, step, humanSize, ensureDir, gitOrNull, sha256File } = util;

const TOTAL_STEPS = 5;
const PACKAGER = path.join(ROOT, 'bin', 'publish-smart-site.cjs');

const opt = {
  tag: null,
  notesEn: null,
  notesZh: null,
  clean: false,
  createTag: false,
  skipPack: false,
  workRoot: DEFAULTS.workRoot,
  forwarded: [],
};

function printHelp() {
  console.log(`
Smart Site release packer (stage + bilingual notes)

Usage:
  node bin/pack-release.cjs <tag> [packager options]
  node bin/pack-release.cjs --tag=<tag> [packager options]

Examples:
  node bin/pack-release.cjs v7.0.3 --standalone --port=4200
  node bin/pack-release.cjs v7.0.3 --standalone --no-build      (reuse dist, repackage only)
  node bin/pack-release.cjs v7.0.3 --notes-zh=temp/notes.md     (custom Chinese notes)

Options handled here:
  <tag> / --tag=<tag>   Release tag (required), e.g. v7.0.3
  --notes-en=<file>     English notes markdown (default: bin/release-notes/<tag>.en.md or generated)
  --notes-zh=<file>     Chinese notes markdown (default: bin/release-notes/<tag>.zh-CN.md or generated)
  --clean               Delete the whole release/<tag> directory before packaging
  --skip-pack           Do not run the packager, only regroup/rename + regenerate notes
  --create-tag          Create the git tag at HEAD when it does not exist yet
  -h, --help            Show this help

Everything else is forwarded to bin/publish-smart-site.cjs, e.g.
  --standalone  --with-node  --exe  --port=4200  --tier=lite  --mode=full
  --lang=en     --no-build   --no-web  --no-server  --no-deps  --no-user-data
  --data-exclude=images,projects  --service  --link-deps  --build-heap=8192

Output:
  ss-run/ss-win/release/<tag>/  (package + zip + sha256 + RELEASE-NOTES-*.md + manifest)
`);
}

for (const arg of process.argv.slice(2)) {
  if (arg === '-h' || arg === '--help') {
    printHelp();
    process.exit(0);
  } else if (arg === '--clean') opt.clean = true;
  else if (arg === '--skip-pack') opt.skipPack = true;
  else if (arg === '--create-tag') opt.createTag = true;
  else if (arg.startsWith('--tag=')) opt.tag = arg.slice('--tag='.length).trim();
  else if (arg.startsWith('--notes-en=')) opt.notesEn = path.resolve(ROOT, arg.slice('--notes-en='.length));
  else if (arg.startsWith('--notes-zh=')) opt.notesZh = path.resolve(ROOT, arg.slice('--notes-zh='.length));
  else if (arg.startsWith('--work-root=')) opt.workRoot = path.resolve(ROOT, arg.slice('--work-root='.length));
  else if (arg.startsWith('-')) opt.forwarded.push(arg);
  else if (!opt.tag) opt.tag = arg.trim();
  else {
    err(`[ERROR] Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

if (!opt.tag) {
  printHelp();
  process.exit(1);
}
if (!/^v?\d+\.\d+\.\d+/.test(opt.tag)) {
  warn(`  ! Tag "${opt.tag}" does not look like a semantic version (vX.Y.Z); continuing anyway`);
}

/** Release staging directory for the tag */
const stageDir = path.join(opt.workRoot, opt.tag);

/** Remove a file or directory tree if it exists */
function removeIfExists(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function runPackager(targetDir) {
  const args = [...opt.forwarded, '--zip', `--target=${targetDir}`];
  // The packer only understands its own options; keep --zip/--target last so they win
  info(`  node bin/publish-smart-site.cjs ${args.join(' ')}`);
  const r = cp.spawnSync(process.execPath, [PACKAGER, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw util.fail(`Packaging failed (exit code ${r.status}) — see the packager output above`);
  }
}

function renameSidecar(sidecar, hash, zipName) {
  fs.writeFileSync(sidecar, `${hash}  ${zipName}\r\n`, 'utf8');
}

async function main() {
  console.log('');
  console.log('='.repeat(78));
  console.log(C.bold(`  Smart Site release packer — ${opt.tag}`));
  console.log('='.repeat(78));
  console.log(`  Stage dir : ${path.relative(ROOT, stageDir)}`);
  console.log(`  Pack dir  : ${path.relative(ROOT, path.join(stageDir, 'app'))}`);
  if (opt.forwarded.length) console.log(`  Packager  : ${opt.forwarded.join(' ')}`);
  if (opt.skipPack) console.log(C.warn('  Mode      : --skip-pack (packaging skipped)'));
  console.log('='.repeat(78));

  // ── [1] Tag sanity ───────────────────────────────────────────
  step(1, TOTAL_STEPS, 'Checking release tag');
  const tagInfo = plan.resolveTag(ROOT, opt.tag);
  info(`  Tag exists : ${tagInfo.tagExists ? 'yes' : 'no'}${tagInfo.tagExists ? ` (${String(tagInfo.tagCommit).slice(0, 8)})` : ''}`);
  info(`  HEAD       : ${tagInfo.headShort}`);

  if (!tagInfo.tagExists) {
    if (opt.createTag) {
      const created = gitOrNull(['tag', '-a', tagInfo.tag, '-m', `Smart Site ${tagInfo.tag}`], ROOT);
      if (created === null) throw util.fail(`git tag ${tagInfo.tag} failed`);
      info(`  Created tag ${tagInfo.tag} at ${tagInfo.headShort} (push it before/with publishing)`);
    } else {
      warn(
        `  ! Tag ${tagInfo.tag} does not exist. The package will be built from HEAD (${tagInfo.headShort}); ` +
          'create the tag first or pass --create-tag.',
      );
    }
  } else if (tagInfo.tagCommit !== tagInfo.headCommit) {
    warn(
      `  ! ${tagInfo.tag} points to ${String(tagInfo.tagCommit).slice(0, 8)}, HEAD is ${tagInfo.headShort}. ` +
        'The package will be built from HEAD, so the tag will not match the artifacts.',
    );
  }

  // ── [2] Package ──────────────────────────────────────────────
  step(2, TOTAL_STEPS, 'Packaging (bin/publish-smart-site.cjs)');
  const appDir = path.join(stageDir, 'app');

  if (opt.skipPack && !fs.existsSync(appDir)) {
    // A previous successful run renamed app/ to the published name; restore the working name
    const previous = fs.existsSync(stageDir)
      ? fs.readdirSync(stageDir).find((entry) => {
          const full = path.join(stageDir, entry);
          return (
            entry.startsWith('win-ss-') &&
            fs.statSync(full).isDirectory() &&
            fs.existsSync(path.join(full, 'VERSION.json'))
          );
        })
      : null;
    if (!previous) {
      throw util.fail('--skip-pack was given but there is no packaged directory in the stage dir');
    }
    info(`  --skip-pack: reusing ${previous}/`);
    fs.renameSync(path.join(stageDir, previous), appDir);
  }

  if (opt.clean) {
    info(`  --clean: removing ${path.relative(ROOT, stageDir)}`);
    removeIfExists(stageDir);
  }
  ensureDir(stageDir);

  if (!opt.skipPack) {
    // Always start from a fresh package dir so no stale file ends up inside the archive
    removeIfExists(appDir);
    removeIfExists(`${appDir}.zip`);
    removeIfExists(`${appDir}.zip.sha256`);
    runPackager(appDir);
  } else {
    info('  packaging skipped, reusing the existing app/ directory');
  }

  const versionFile = path.join(appDir, 'VERSION.json');
  const versionInfo = util.readJsonSafe(versionFile);
  if (!versionInfo) {
    throw util.fail(`VERSION.json missing in ${path.relative(ROOT, appDir)} — packaging did not complete`);
  }
  info(
    `  Built ${versionInfo.builtAt || '-'} from commit ${versionInfo.gitCommit || '-'} ` +
      `(form: ${versionInfo.form || '-'}, standalone: ${versionInfo.standalone ? 'yes' : 'no'})`,
  );

  // ── [3] Rename to the published asset name ───────────────────
  step(3, TOTAL_STEPS, 'Renaming to the published asset name');
  const assetBase = plan.buildAssetBaseName(tagInfo.tag, versionInfo);
  const finalDir = path.join(stageDir, assetBase);
  const zipSrc = `${appDir}.zip`;
  const finalZip = path.join(stageDir, `${assetBase}.zip`);
  const finalSidecar = `${finalZip}.sha256`;

  // --skip-pack reuses the archive of the previous run (same package dir, same content)
  const reuseArchive = opt.skipPack && !fs.existsSync(zipSrc) && fs.existsSync(finalZip);
  if (reuseArchive) info('  --skip-pack: reusing the existing archive (no re-zip)');

  // Clear leftovers from a previous run with the same tag but a different form
  for (const entry of fs.readdirSync(stageDir)) {
    const isPackageDir =
      fs.statSync(path.join(stageDir, entry)).isDirectory() &&
      !['app', 'gitee-parts'].includes(entry);
    if (isPackageDir && path.join(stageDir, entry) !== finalDir) {
      info(`  removing stale package dir: ${entry}`);
      removeIfExists(path.join(stageDir, entry));
    }
    if (/^win-ss-.*\.zip(\.sha256)?$/i.test(entry)) {
      const full = path.join(stageDir, entry);
      if (full !== finalZip && full !== finalSidecar) {
        info(`  removing stale archive: ${entry}`);
        removeIfExists(full);
      }
    }
  }

  if (path.resolve(finalDir) !== path.resolve(appDir)) {
    removeIfExists(finalDir);
    fs.renameSync(appDir, finalDir);
  }

  if (!reuseArchive) {
    if (!fs.existsSync(zipSrc)) {
      throw util.fail(`Zip not found: ${path.relative(ROOT, zipSrc)} (was --zip skipped?)`);
    }
    removeIfExists(finalZip);
    fs.renameSync(zipSrc, finalZip);
    removeIfExists(`${zipSrc}.sha256`);
  }

  const zipSize = fs.statSync(finalZip).size;
  const zipHash = await sha256File(finalZip);
  renameSidecar(finalSidecar, zipHash, `${assetBase}.zip`);
  ok(`  ${assetBase}/ — ${humanSize(zipSize)} -> ${assetBase}.zip`);
  info(`  sha256 = ${zipHash}`);

  // ── [4] Bilingual release notes ──────────────────────────────
  step(4, TOTAL_STEPS, 'Generating release notes (English for GitHub, Chinese for Gitee)');
  const assets = [{ file: finalZip, name: `${assetBase}.zip`, size: zipSize, sha256: zipHash }];
  const ctx = { root: ROOT, hashes: new Map([[finalZip, zipHash]]), workDir: stageDir };

  const notesEn = resolveNotes({
    lang: 'en',
    explicitFile: opt.notesEn,
    stageFile: path.join(stageDir, 'RELEASE-NOTES-en.md'),
    repoFile: path.join(ROOT, 'bin', 'release-notes', `${tagInfo.tag}.en.md`),
    generate: () => plan.generateNotes(ctx, tagInfo, assets, versionInfo),
  });
  const notesZh = resolveNotes({
    lang: 'zh-CN',
    explicitFile: opt.notesZh,
    stageFile: path.join(stageDir, 'RELEASE-NOTES-zh-CN.md'),
    repoFile: path.join(ROOT, 'bin', 'release-notes', `${tagInfo.tag}.zh-CN.md`),
    generate: () => plan.generateNotesZh(ctx, tagInfo, assets, versionInfo),
  });

  const notesEnFile = path.join(stageDir, 'RELEASE-NOTES-en.md');
  const notesZhFile = path.join(stageDir, 'RELEASE-NOTES-zh-CN.md');
  fs.writeFileSync(notesEnFile, notesEn.text, 'utf8');
  fs.writeFileSync(notesZhFile, notesZh.text, 'utf8');
  info(`  RELEASE-NOTES-en.md    ${Buffer.byteLength(notesEn.text)} bytes  (source: ${notesEn.source})`);
  info(`  RELEASE-NOTES-zh-CN.md ${Buffer.byteLength(notesZh.text)} bytes  (source: ${notesZh.source})`);

  // ── [5] Manifest ─────────────────────────────────────────────
  step(5, TOTAL_STEPS, 'Writing release manifest');
  const manifest = {
    product: 'smart-site',
    tag: tagInfo.tag,
    stagedAt: new Date().toISOString(),
    tagExists: tagInfo.tagExists,
    tagCommit: tagInfo.tagCommit || null,
    headCommit: tagInfo.headCommit,
    headShort: tagInfo.headShort,
    assetBase,
    assets: [
      {
        name: `${assetBase}.zip`,
        size: zipSize,
        sha256: zipHash,
        source: path.relative(ROOT, finalZip).replace(/\\/g, '/'),
      },
    ],
    notes: {
      en: { file: 'RELEASE-NOTES-en.md', source: notesEn.source },
      'zh-CN': { file: 'RELEASE-NOTES-zh-CN.md', source: notesZh.source },
    },
    package: versionInfo,
  };
  const manifestFile = path.join(stageDir, 'release-manifest.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  info(`  ${path.relative(ROOT, manifestFile)}`);

  // ── Summary ──────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(78));
  ok('  Release staged successfully.');
  console.log('='.repeat(78));
  console.log(`  Directory : ${path.relative(ROOT, stageDir)}`);
  console.log(`  Package   : ${assetBase}/  (${humanSize(zipSize)} zip)`);
  console.log('  Notes     : RELEASE-NOTES-en.md (GitHub) / RELEASE-NOTES-zh-CN.md (Gitee)');
  console.log('');
  console.log('  Next step (publish to both platforms):');
  console.log(C.bold(`    bin\\publish-release.bat --tag=${tagInfo.tag} --dry-run`));
  console.log(C.bold(`    bin\\publish-release.bat --tag=${tagInfo.tag}`));
  console.log('='.repeat(78));

  return 0;
}

/**
 * Resolve the notes text for one language.
 *
 * Priority: explicit CLI file > notes already staged for this tag > per-tag file committed
 * under bin/release-notes/ > auto-generated text.
 */
function resolveNotes({ lang, explicitFile, stageFile, repoFile, generate }) {
  const read = (file, source) => ({ text: fs.readFileSync(file, 'utf8'), source });
  if (explicitFile) {
    if (!fs.existsSync(explicitFile)) throw util.fail(`Notes file not found: ${explicitFile}`);
    return read(explicitFile, `--notes=${path.relative(ROOT, explicitFile)}`);
  }
  if (fs.existsSync(stageFile)) return read(stageFile, 'existing staged file');
  if (fs.existsSync(repoFile)) return read(repoFile, path.relative(ROOT, repoFile));
  return { text: generate(), source: lang === 'en' ? 'generated (VERSION.json + git log)' : 'generated (Chinese scaffold)' };
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    if (e && e.isFatal) err(`\n[ERROR] ${e.message}`);
    else {
      err(`\n[ERROR] ${e && e.message ? e.message : e}`);
    }
    process.exit(1);
  });
