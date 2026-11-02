'use strict';

// Comment translation pipeline for ss-services/ss-node (AGENTS.md §5.2 rule 12).
//
// Why this exists: translating comments by hand-editing whole files is slow and risky -
// a stale match string can silently touch code. This tool makes the unit of work a small
// JSON patch keyed by *line range*, and proves after every write that the code is
// token-identical (only comment trivia may differ).
//
// Subcommands
//   extract  [paths...] [--out <patch.json>] [--all] [--nospec] [--ext .ts,.js]
//            Emit a patch skeleton: one entry per file with `codeHash` (token signature)
//            and the CJK comment blocks to translate. Feed it to a translator, then fill
//            `patches[]` with { start, end, text } and run `apply`.
//
//   apply    <patch.json> [--dry-run] [--fix-indent] [--allow-cjk] [--backup-dir <dir>]
//            Replace whole-line comment blocks in place. Refuses when:
//              - the file no longer matches `codeHash` (someone edited it since extraction)
//              - a patch range is not exactly one whole-line comment block
//              - the replacement breaks comment syntax / still contains CJK
//              - the token signature changes after the write (impossible by construction,
//                checked anyway; the file is restored on failure)
//
//   verify   <patch.json> [--base <git-ref>]
//            Re-check `codeHash` for every file, optionally against `<git-ref>:<path>`.
//
//   selftest Run an end-to-end fixture test (no repo files touched).
//
// Exit code: 0 on success, 1 on any failure.
//
// Patch format (v1)
// {
//   "version": 1,
//   "root": "F:/.../ss-services/ss-node",
//   "files": [{
//     "path": "packages/ss-core/src/x.ts",       // relative to root, forward slashes
//     "codeHash": "<sha256 of non-comment tokens>",
//     "comments": [{ "start": 6, "end": 12, "kind": "block", "wholeLine": true, "text": "..." }],
//     "patches":  [{ "start": 6, "end": 12, "text": "/** ... */" }]
//   }]
// }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ts = require('typescript');

const CJK = /[\u4e00-\u9fa5]/;
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'coverage', '.git', '.turbo', 'target', 'dist-plugins', '.husky',
]);
const DEFAULT_EXT = ['.ts'];
const PATCH_VERSION = 1;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function findRepoRoot(start) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 10; depth++) {
    if (fs.existsSync(path.join(current, 'ss-services', 'ss-node'))) return current;
    current = path.dirname(current);
  }
  throw new Error('repo root not found (looked for ss-services/ss-node upwards)');
}

// SS_TRANSLATE_ROOT overrides the operating root (the monorepo under translation).
// Without it we fall back to the original ss-v7 behavior (walk up for ss-services/ss-node).
const SS_TRANSLATE_ROOT = process.env.SS_TRANSLATE_ROOT || '';
const REPO_ROOT = SS_TRANSLATE_ROOT ? path.resolve(SS_TRANSLATE_ROOT) : findRepoRoot(__dirname);
const SS_NODE = SS_TRANSLATE_ROOT ? path.resolve(SS_TRANSLATE_ROOT) : path.join(REPO_ROOT, 'ss-services', 'ss-node');

/** Normalize an absolute path to a root-relative, forward-slash path. */
function toRootRelative(absPath) {
  return path.relative(SS_NODE, absPath).split(path.sep).join('/');
}

function toAbsolute(relPath) {
  return path.isAbsolute(relPath) ? relPath : path.join(SS_NODE, relPath);
}

function walk(dir, extSet, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extSet, out);
    else if (extSet.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function expandTargets(targets, extSet) {
  const files = [];
  const list = targets.length ? targets : ['.'];
  for (const target of list) {
    const abs = path.resolve(SS_NODE, target);
    if (!fs.existsSync(abs)) throw new Error(`target not found: ${target}`);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) files.push(...walk(abs, extSet));
    else if (extSet.has(path.extname(abs))) files.push(abs);
  }
  return [...new Set(files)].sort();
}

// ---------------------------------------------------------------------------
// Source I/O (encoding / BOM / EOL preserved)
// ---------------------------------------------------------------------------

function readSource(filePath) {
  const raw = fs.readFileSync(filePath);
  const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const text = hasBom ? raw.slice(3).toString('utf8') : raw.toString('utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { text, hasBom, eol };
}

function writeSource(filePath, text, meta) {
  fs.writeFileSync(filePath, Buffer.from((meta.hasBom ? '\uFEFF' : '') + text, 'utf8'));
}

// ---------------------------------------------------------------------------
// Comment extraction (AST trivia only - never strings, regexes or templates)
// ---------------------------------------------------------------------------

/**
 * Collect every comment range in a parsed source file.
 *
 * Comments only ever live in the trivia gaps between tokens (the parser already resolved
 * where tokens start), so scanning those gaps cannot hit a slash inside a string, template
 * or regex. The gap itself is pure trivia, hence a tiny `//` / `*​/` scan is sufficient and
 * avoids the quirks of `getLeadingCommentRanges` (it ignores same-line trailing comments).
 */
function collectCommentRanges(sourceFile, text) {
  const seen = new Set();
  const ranges = [];

  const push = (pos, end, kind) => {
    if (seen.has(pos) || end <= pos) return;
    seen.add(pos);
    ranges.push({ pos, end, kind });
  };

  const scanGap = (start, end) => {
    let pos = start;
    while (pos < end) {
      const ch = text[pos];
      if (ch === '/' && text[pos + 1] === '/') {
        const newline = text.indexOf('\n', pos + 2);
        let stop = newline === -1 || newline > end ? end : newline;
        if (text[stop - 1] === '\r') stop--;
        push(pos, stop, 'line');
        pos = Math.max(stop, pos + 2);
        continue;
      }
      if (ch === '/' && text[pos + 1] === '*') {
        const close = text.indexOf('*/', pos + 2);
        const stop = close === -1 ? end : Math.min(close + 2, end);
        push(pos, stop, 'block');
        pos = Math.max(stop, pos + 2);
        continue;
      }
      pos++;
    }
  };

  const visit = (node) => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) return;
    for (const child of children) {
      const gapStart = child.getFullStart();
      const gapEnd = child.getStart(sourceFile);
      if (gapEnd > gapStart) scanGap(gapStart, gapEnd);
      visit(child);
    }
  };

  visit(sourceFile);
  ranges.sort((a, b) => a.pos - b.pos);
  return ranges;
}

/**
 * Token signature of the file with all comment trivia skipped.
 *
 * Built from AST leaf tokens instead of a bare scanner on purpose: a standalone scanner loses
 * template-literal state at `${...}` substitutions, so everything after such a template (comments
 * included) collapses into one giant template token and the signature ends up depending on
 * comment text - which made any comment after a template literal impossible to translate.
 * JSDoc nodes are skipped explicitly for the same reason (they are comment trivia attached to
 * the AST). Whitespace, comment wording and EOL style never affect the hash; any change to the
 * token stream does.
 */
function codeSignature(text, sourceFile) {
  const file = sourceFile || ts.createSourceFile('signature.ts', text, ts.ScriptTarget.Latest, true);
  const parts = [];
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(file);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) parts.push(`${node.kind}:${node.getText(file)}`);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(file);
  return crypto.createHash('sha256').update(parts.join('\u0001')).digest('hex');
}

function posToLine(lineStarts, pos) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= pos) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Lexically inspect a file: comment blocks with 1-based line ranges. */
function inspectFile(filePath, options = {}) {
  const { text, hasBom, eol } = readSource(filePath);
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const lineStarts = sourceFile.getLineStarts();
  const lines = text.split(/\r?\n/);

  const blocks = [];
  for (const range of collectCommentRanges(sourceFile, text)) {
    const startLine = posToLine(lineStarts, range.pos);
    const endLine = posToLine(lineStarts, Math.max(range.pos, range.end - 1));
    const lineStartOffset = lineStarts[startLine];
    const nextLineOffset = lineStarts[endLine + 1] === undefined ? text.length : lineStarts[endLine + 1];

    const before = text.slice(lineStartOffset, range.pos);
    const after = text.slice(range.end, nextLineOffset).replace(/\r?\n$/, '');
    const body = text.slice(range.pos, range.end);

    const blockLines = lines.slice(startLine, endLine + 1);
    blocks.push({
      start: startLine + 1,
      end: endLine + 1,
      kind: range.kind,
      wholeLine: /^[ \t]*$/.test(before) && /^[ \t]*$/.test(after),
      hasCjk: CJK.test(body),
      cjkLines: blockLines.filter((line) => CJK.test(line)).length,
      text: blockLines.join(eol),
    });
  }

  return { text, hasBom, eol, blocks, codeHash: codeSignature(text, sourceFile) };
}

// ---------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------

function cmdExtract(args) {
  const opts = parseArgs(args, { values: ['out', 'ext'], flags: ['all', 'nospec'] });
  const extSet = new Set((opts.values.ext || DEFAULT_EXT.join(',')).split(',').map((e) => e.trim()));
  const files = expandTargets(opts.positional, extSet).filter(
    (file) => !opts.flags.nospec || !/\.spec\.ts$/.test(file),
  );

  const manifest = { version: PATCH_VERSION, root: SS_NODE.split(path.sep).join('/'), files: [] };
  let totalBlocks = 0;
  let totalLines = 0;
  let touchedFiles = 0;

  for (const file of files) {
    const info = inspectFile(file);
    const wanted = info.blocks.filter((b) => (opts.flags.all ? true : b.hasCjk));
    if (wanted.length === 0) continue;

    const lines = wanted.reduce((sum, b) => sum + b.cjkLines, 0);
    totalBlocks += wanted.length;
    totalLines += lines;
    touchedFiles++;

    manifest.files.push({
      path: toRootRelative(file),
      codeHash: info.codeHash,
      comments: wanted.map((b) => ({
        start: b.start,
        end: b.end,
        kind: b.kind,
        wholeLine: b.wholeLine,
        cjkLines: b.cjkLines,
        text: b.text,
      })),
      patches: [],
    });

    process.stderr.write(
      `${String(lines).padStart(4)} lines  ${wanted.length} block(s)  ${toRootRelative(file)}\n`,
    );
  }

  process.stderr.write(
    `\nFILES ${touchedFiles}  BLOCKS ${totalBlocks}  LINES ${totalLines}` +
      (opts.flags.all ? '  (all comments)' : '  (CJK comments only)') +
      '\n',
  );

  const json = JSON.stringify(manifest, null, 2);
  if (opts.values.out) {
    const outPath = path.resolve(process.cwd(), opts.values.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stderr.write(`patch skeleton written: ${outPath}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
  return 0;
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}

/**
 * Shift the whole replacement block by a constant amount so its base indentation matches
 * the original comment block (opt-in via --fix-indent). Relative alignment inside a block
 * (e.g. " * item") is preserved.
 */
function reindent(replacementLines, originalLines) {
  const base = (lines) => {
    const indents = lines.filter((l) => l.trim() !== '').map((l) => indentOf(l).length);
    return indents.length ? Math.min(...indents) : 0;
  };
  const shift = base(originalLines) - base(replacementLines);
  if (shift === 0) return replacementLines;
  return replacementLines.map((line) => {
    if (line.trim() === '') return '';
    if (shift > 0) return ' '.repeat(shift) + line;
    const removable = Math.min(-shift, indentOf(line).length);
    return line.slice(removable);
  });
}

/** Validate one patch against the file's comment blocks. Returns the matched block. */
function validatePatch(patch, index, blocks, eol, options) {
  const where = `patch[${index}] ${patch.start}-${patch.end}`;
  if (
    !patch ||
    !Number.isInteger(patch.start) ||
    !Number.isInteger(patch.end) ||
    typeof patch.text !== 'string'
  ) {
    throw new Error(`${where}: needs integer start/end and a string text`);
  }
  if (patch.start < 1 || patch.end < patch.start) {
    throw new Error(`${where}: invalid line range`);
  }

  const block = blocks.find((b) => b.start === patch.start && b.end === patch.end);
  if (!block) {
    const overlapping = blocks.filter((b) => !(b.end < patch.start || b.start > patch.end));
    const hint = overlapping.length
      ? overlapping.map((b) => `  comment block ${b.start}-${b.end} (wholeLine=${b.wholeLine})`).join('\n')
      : '  no comment block at these lines';
    throw new Error(
      `${where}: patch range must equal one comment block exactly\n${hint}\n` +
        '  (re-run extract to get current blocks; do not merge or split blocks)',
    );
  }
  if (!block.wholeLine) {
    throw new Error(
      `${where}: comment block ${block.start}-${block.end} shares its line with code; ` +
        'translate it manually instead of replacing the whole line',
    );
  }

  let lines = patch.text.split(/\r?\n/);
  if (!lines.some((l) => l.trim() !== '')) {
    throw new Error(`${where}: replacement text is empty`);
  }

  if (!options.allowCjk && CJK.test(patch.text)) {
    throw new Error(`${where}: replacement still contains CJK characters`);
  }

  if (block.kind === 'line') {
    const bad = lines.find((l) => l.trim() !== '' && !/^\s*\/\//.test(l));
    if (bad !== undefined) {
      throw new Error(`${where}: line comment block must keep the // prefix on every line: ${bad.trim()}`);
    }
  } else {
    const head = lines.find((l) => l.trim() !== '');
    const tail = [...lines].reverse().find((l) => l.trim() !== '');
    if (!head || !/^\s*\/\*/.test(head) || !tail || !/\*\/\s*$/.test(tail)) {
      throw new Error(`${where}: block comment must start with /* and end with */`);
    }
  }

  const originalLines = block.text.split(/\r?\n/);
  if (options.fixIndent) {
    lines = reindent(lines, originalLines);
  } else if (indentOf(lines[0]) !== indentOf(originalLines[0])) {
    throw new Error(
      `${where}: indentation differs from the original block ` +
        `(expected ${JSON.stringify(indentOf(originalLines[0]))}, got ${JSON.stringify(indentOf(lines[0]))}); ` +
        'rerun with --fix-indent to normalize automatically',
    );
  }

  return lines;
}

function cmdApply(args) {
  const opts = parseArgs(args, { values: ['backup-dir'], flags: ['dry-run', 'fix-indent', 'allow-cjk'] });
  const manifestPath = opts.positional[0];
  if (!manifestPath) throw new Error('usage: apply <patch.json> [--dry-run] [--fix-indent]');

  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), manifestPath), 'utf8'));
  if (manifest.version !== PATCH_VERSION) {
    throw new Error(`unsupported patch version: ${manifest.version} (expected ${PATCH_VERSION})`);
  }
  const root = manifest.root || SS_NODE;
  // CLI flags are hyphenated; validatePatch expects camelCase option names.
  const patchOptions = {
    allowCjk: !!opts.flags['allow-cjk'],
    fixIndent: !!opts.flags['fix-indent'],
  };

  let patchedFiles = 0;
  let patchedBlocks = 0;
  const failures = [];

  for (const entry of manifest.files || []) {
    const absPath = path.isAbsolute(entry.path) ? entry.path : path.join(root, entry.path);
    const rel = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');

    if (!Array.isArray(entry.patches) || entry.patches.length === 0) continue;

    try {
      if (!fs.existsSync(absPath)) throw new Error('file not found');

      const info = inspectFile(absPath);
      if (entry.codeHash && info.codeHash !== entry.codeHash) {
        throw new Error(
          'code signature changed since extract (someone edited the code, or a previous patch was applied); ' +
            're-run extract for this file',
        );
      }

      const blocks = info.blocks;
      const prepared = entry.patches
        .map((patch, i) => ({ patch, lines: validatePatch(patch, i, blocks, info.eol, patchOptions) }))
        .sort((a, b) => b.patch.start - a.patch.start);

      for (let i = 1; i < prepared.length; i++) {
        const prev = prepared[i - 1].patch;
        const curr = prepared[i].patch;
        if (curr.end >= prev.start) {
          throw new Error(`overlapping patches: ${curr.start}-${curr.end} and ${prev.start}-${prev.end}`);
        }
      }

      if (opts.flags['dry-run']) {
        process.stdout.write(`[dry-run] would patch ${entry.patches.length} block(s) in ${rel}\n`);
        continue;
      }

      const allLines = info.text.split(/\r?\n/);
      for (const { patch, lines } of prepared) {
        allLines.splice(patch.start - 1, patch.end - patch.start + 1, ...lines);
      }
      const nextText = allLines.join(info.eol);

      const nextHash = codeSignature(nextText);
      if (nextHash !== info.codeHash) {
        throw new Error('refused: token signature would change (the patch touches code, not comments)');
      }

      if (opts.values['backup-dir']) {
        const backupPath = path.join(
          path.resolve(process.cwd(), opts.values['backup-dir']),
          entry.path.split('/').join(path.sep),
        );
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.writeFileSync(backupPath, Buffer.from(info.text, 'utf8'));
      }

      writeSource(absPath, nextText, info);
      entry.codeHash = nextHash;
      patchedFiles++;
      patchedBlocks += entry.patches.length;
      process.stdout.write(`patched ${entry.patches.length} block(s)  ${rel}\n`);
    } catch (error) {
      failures.push(`${rel}: ${error.message}`);
      process.stderr.write(`FAILED  ${rel}: ${error.message}\n`);
    }
  }

  process.stdout.write(`\nAPPLIED files=${patchedFiles} blocks=${patchedBlocks} failed=${failures.length}\n`);
  if (opts.values['backup-dir'] && patchedFiles > 0) {
    process.stdout.write(`backups written under ${path.resolve(process.cwd(), opts.values['backup-dir'])}\n`);
  }
  return failures.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

function cmdVerify(args) {
  const opts = parseArgs(args, { values: ['base'], flags: ['json'] });
  const manifestPath = opts.positional[0];
  if (!manifestPath) throw new Error('usage: verify <patch.json> [--base <git-ref>]');

  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), manifestPath), 'utf8'));
  const root = manifest.root || SS_NODE;
  const problems = [];
  let checked = 0;

  for (const entry of manifest.files || []) {
    const absPath = path.isAbsolute(entry.path) ? entry.path : path.join(root, entry.path);
    const repoRelative = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');

    if (!fs.existsSync(absPath)) {
      problems.push(`${entry.path}: file not found`);
      continue;
    }

    const info = inspectFile(absPath);
    checked++;

    if (entry.codeHash && info.codeHash !== entry.codeHash) {
      problems.push(`${entry.path}: working-tree code signature differs from manifest`);
      continue;
    }

    if (opts.values.base) {
      const refPath = `ss-services/ss-node/${entry.path}`;
      let baseText = null;
      try {
        baseText = execFileSync('git', ['show', `${opts.values.base}:${refPath}`], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
      } catch {
        problems.push(`${entry.path}: not found at ${opts.values.base}:${refPath}`);
        continue;
      }
      if (codeSignature(baseText) !== info.codeHash) {
        problems.push(`${entry.path}: code differs from ${opts.values.base}`);
      } else if (!opts.flags.json) {
        process.stdout.write(`ok(code=${opts.values.base})  ${entry.path}\n`);
      }
      continue;
    }

    if (!opts.flags.json) process.stdout.write(`ok  ${entry.path}\n`);
  }

  if (problems.length) {
    process.stderr.write(`\nVERIFY FAILED (${problems.length}/${checked})\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }
  process.stdout.write(`\nVERIFY OK  files=${checked}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// selftest
// ---------------------------------------------------------------------------

function cmdSelftest() {
  const dir = path.join(
    REPO_ROOT,
    'temp',
    'codebuddy',
    '2026-11-01-ssnode-comments-en',
    'data',
    'selftest',
  );
  fs.mkdirSync(dir, { recursive: true });
  const fixture = path.join(dir, 'fixture.ts');

  const source = [
    '// 顶部中文行注释',
    "const url = 'http://host//path'; // 行内中文注释（不可整行替换）",
    'const count = 1;',
    'const tpl = `a${count}b`;',
    '/**',
    ' * 中文块注释第一行',
    ' * 中文块注释第二行',
    ' */',
    'export function run(): number {',
    '  // 函数内中文注释',
    '  const label = "中文字符串必须保留";',
    '  return count + url.length + label.length;',
    '}',
    '',
  ].join('\n');

  fs.writeFileSync(fixture, source, 'utf8');

  const info = inspectFile(fixture);
  const cjkBlocks = info.blocks.filter((b) => b.hasCjk);
  const wholeLine = cjkBlocks.filter((b) => b.wholeLine);
  const inline = cjkBlocks.filter((b) => !b.wholeLine);

  const checks = [];
  const check = (name, condition, detail) => {
    checks.push({ name, ok: !!condition, detail });
    process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : ` -> ${detail || ''}`}\n`);
  };

  check(
    'signature ignores comment text (template literals must not swallow comments)',
    codeSignature(source) === codeSignature(source.replace('顶部中文行注释', 'top-level comment')),
    'comment wording changed the code signature',
  );
  check('extract finds 4 CJK comment blocks', cjkBlocks.length === 4, `got ${cjkBlocks.length}`);
  check('inline comment is not whole-line', inline.length === 1, `got ${inline.length}`);

  const replacements = new Map([
    [`${wholeLine[0].start}-${wholeLine[0].end}`, '// Top-level line comment'],
    [
      `${wholeLine.find((b) => b.kind === 'block').start}-${wholeLine.find((b) => b.kind === 'block').end}`,
      '/**\n * Chinese block comment, first line\n * Chinese block comment, second line\n */',
    ],
    [
      `${wholeLine[wholeLine.length - 1].start}-${wholeLine[wholeLine.length - 1].end}`,
      '  // Comment inside the function',
    ],
  ]);

  const entry = {
    path: toRootRelative(fixture),
    codeHash: info.codeHash,
    patches: wholeLine.map((b) => ({
      start: b.start,
      end: b.end,
      text: replacements.get(`${b.start}-${b.end}`) || `// block ${b.start}`,
    })),
  };

  const manifestPath = path.join(dir, 'patch.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ version: PATCH_VERSION, root: SS_NODE, files: [entry] }, null, 2),
    'utf8',
  );

  const applyCode = cmdApply([manifestPath]);
  check('apply exits 0', applyCode === 0, `exit=${applyCode}`);

  const after = inspectFile(fixture);
  check('code signature unchanged after apply', after.codeHash === info.codeHash, 'signature drifted');
  check('CJK comment blocks removed', after.blocks.filter((b) => b.hasCjk).length === 1, 'expected 1 inline CJK left');
  check(
    'Chinese string literal preserved',
    after.text.includes('中文字符串必须保留'),
    'string literal was modified',
  );
  check('inline comment untouched', after.text.includes('行内中文注释（不可整行替换）'), 'inline comment changed');

  const verifyCode = cmdVerify([manifestPath]);
  check('verify exits 0', verifyCode === 0, `exit=${verifyCode}`);

  // A patch that changes code must be refused.
  fs.writeFileSync(fixture, source, 'utf8');
  const badManifest = path.join(dir, 'patch-bad.json');
  fs.writeFileSync(
    badManifest,
    JSON.stringify(
      {
        version: PATCH_VERSION,
        root: SS_NODE,
        files: [
          {
            path: toRootRelative(fixture),
            codeHash: info.codeHash,
            patches: [{ start: 2, end: 2, text: 'const url = 1; // tampered' }],
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  const beforeBad = fs.readFileSync(fixture, 'utf8');
  const badCode = cmdApply([badManifest]);
  check(
    'patch touching code is refused',
    badCode === 1 && fs.readFileSync(fixture, 'utf8') === beforeBad,
    'file was modified or exit code wrong',
  );

  // CLI flags must reach the validator: --allow-cjk and --fix-indent.
  const writeManifest = (name, patch) => {
    const target = path.join(dir, name);
    fs.writeFileSync(
      target,
      JSON.stringify(
        {
          version: PATCH_VERSION,
          root: SS_NODE,
          files: [{ path: toRootRelative(fixture), codeHash: info.codeHash, patches: [patch] }],
        },
        null,
        2,
      ),
      'utf8',
    );
    return target;
  };

  fs.writeFileSync(fixture, source, 'utf8');
  const cjkManifest = writeManifest('patch-cjk.json', { start: 1, end: 1, text: '// 保留中文的注释' });
  check('CJK replacement is refused by default', cmdApply([cjkManifest]) === 1, 'exit code wrong');
  check('--allow-cjk takes effect', cmdApply([cjkManifest, '--allow-cjk']) === 0, 'exit code wrong');

  fs.writeFileSync(fixture, source, 'utf8');
  const indentManifest = writeManifest('patch-indent.json', { start: 10, end: 10, text: '// no indentation' });
  check('indentation mismatch is refused', cmdApply([indentManifest]) === 1, 'exit code wrong');
  check('--fix-indent takes effect', cmdApply([indentManifest, '--fix-indent']) === 0, 'exit code wrong');
  check(
    '--fix-indent restores the original indentation',
    fs.readFileSync(fixture, 'utf8').includes('  // no indentation'),
    'indentation was not restored',
  );

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(`\nSELFTEST ${failed.length === 0 ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length})\n`);
  return failed.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv, spec) {
  const flags = {};
  const values = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (spec.values.includes(key)) {
        values[key] = argv[++i];
      } else if (spec.flags.includes(key)) {
        flags[key] = true;
      } else {
        throw new Error(`unknown option: ${arg}`);
      }
      continue;
    }
    positional.push(arg);
  }

  return { flags, values, positional };
}

const USAGE = `Usage: node ss-services/ss-node/scripts/translate-comments.cjs <command> [options]

  extract  [paths...] [--out <patch.json>] [--all] [--nospec] [--ext .ts,.js]
  apply    <patch.json> [--dry-run] [--fix-indent] [--allow-cjk] [--backup-dir <dir>]
  verify   <patch.json> [--base <git-ref>]
  selftest

Extract writes a patch skeleton (comment blocks + code signature). A translator fills
files[].patches[] with { start, end, text }; apply replaces whole-line comment blocks only
and refuses any patch that would alter the token stream.
`;

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'extract':
      return cmdExtract(rest);
    case 'apply':
      return cmdApply(rest);
    case 'verify':
      return cmdVerify(rest);
    case 'selftest':
      return cmdSelftest();
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
