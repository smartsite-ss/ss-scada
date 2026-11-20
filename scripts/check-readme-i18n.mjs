#!/usr/bin/env node
/**
 * README i18n consistency checker.
 *
 * Guards the five public README files against silent drift:
 *   1. every locale file exists
 *   2. each file starts with the same 5-item language navigation, exactly one bolded
 *   3. <h1> count is 1 and <h2> section count matches the English baseline
 *   4. fenced code blocks are balanced
 *   5. every relative link and image target exists (case-sensitive)
 *   6. demo URL, Quick Start command and license identifier are present
 *
 * No dependencies, no build step: `node scripts/check-readme-i18n.mjs`.
 * Used by .github/workflows/readme-i18n-ci.yml.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOCALES = [
  { file: 'README.md', name: 'English' },
  { file: 'README.zh-CN.md', name: '简体中文' },
  { file: 'README.ja.md', name: '日本語' },
  { file: 'README.de.md', name: 'Deutsch' },
  { file: 'README.es.md', name: 'Español' },
];

/** Tokens that must survive in every language version. */
const REQUIRED_TOKENS = [
  { token: 'smartsite.top', label: 'online demo URL' },
  { token: 'start.bat', label: 'Quick Start command' },
  { token: 'Apache-2.0', label: 'license identifier' },
];

const errors = [];

function report(file, line, message) {
  errors.push(line ? `${file}:${line}  ${message}` : `${file}  ${message}`);
}

function isFence(line) {
  return /^\s*(?:```|~~~)/.test(line);
}

/**
 * Blanks out fenced code blocks so shell comments (`# Start from source`)
 * are not counted as headings or links. Line indexes are preserved.
 */
function maskFencedBlocks(lines, file) {
  const masked = [];
  let inside = false;
  lines.forEach((line) => {
    if (isFence(line)) {
      inside = !inside;
      masked.push('');
      return;
    }
    masked.push(inside ? '' : line);
  });
  if (inside) {
    report(file, null, 'unterminated fenced code block');
  }
  return masked;
}

/**
 * Case-sensitive existence check. Windows resolves `Docs/` and `docs/`
 * identically, Linux (CI) does not; walk each segment to match the exact name.
 */
function existsWithExactCase(targetPath) {
  const root = path.parse(targetPath).root;
  const segments = targetPath.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (!fs.existsSync(current)) return false;
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

function isExternalTarget(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith('//') ||
    target.startsWith('#')
  );
}

function checkRelativeTarget(file, lineNumber, rawTarget, context) {
  let target = rawTarget.trim().replace(/^<|>$/g, '');
  const titleSuffix = target.search(/\s+["']/);
  if (titleSuffix !== -1) target = target.slice(0, titleSuffix);
  if (!target || isExternalTarget(target)) return;

  target = target.split('#')[0];
  if (!target) return;
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep the raw value; the existence check below will fail loudly
  }

  const baseDir = path.dirname(path.join(repoRoot, file));
  const absoluteTarget = target.startsWith('/')
    ? path.join(repoRoot, target)
    : path.resolve(baseDir, target);

  if (!existsWithExactCase(absoluteTarget)) {
    report(file, lineNumber, `${context} target not found (case-sensitive): ${rawTarget}`);
  }
}

function analyzeLocale(locale) {
  const absolutePath = path.join(repoRoot, locale.file);
  if (!fs.existsSync(absolutePath)) {
    report(locale.file, null, 'file is missing');
    return null;
  }

  const text = fs.readFileSync(absolutePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const masked = maskFencedBlocks(lines, locale.file);

  // 1. Heading structure.
  const h1Count = masked.filter((line) => /^# [^#]/.test(line)).length;
  const h2Count = masked.filter((line) => /^## [^#]/.test(line)).length;
  if (h1Count !== 1) {
    report(locale.file, null, `expected exactly 1 <h1>, found ${h1Count}`);
  }

  // 2. Language navigation on the first line.
  const navLine = lines[0] ?? '';
  const boldNames = [...navLine.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1].trim());
  for (const other of LOCALES) {
    if (!navLine.includes(other.name)) {
      report(locale.file, 1, `language navigation is missing "${other.name}"`);
    }
  }
  if (boldNames.length !== 1) {
    report(locale.file, 1, `expected exactly 1 bolded language, found ${boldNames.length}`);
  } else if (boldNames[0] !== locale.name) {
    report(locale.file, 1, `bolded language is "${boldNames[0]}", expected "${locale.name}"`);
  }

  const navLinks = [...navLine.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1].trim(),
    target: match[2].trim(),
  }));
  if (navLinks.length !== LOCALES.length - 1) {
    report(locale.file, 1, `expected ${LOCALES.length - 1} language links, found ${navLinks.length}`);
  }
  const localeFiles = new Set(LOCALES.map((item) => item.file));
  for (const link of navLinks) {
    const normalizedTarget = link.target.replace(/^\.\//, '');
    if (!localeFiles.has(normalizedTarget)) {
      report(locale.file, 1, `language link points to unknown file: ${link.target}`);
    }
  }

  // 3. Relative links and images.
  let linkCount = 0;
  let imageCount = 0;
  masked.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*([^)]+?)\s*\)/g)) {
      const isImage = match[0].startsWith('!');
      if (isImage) imageCount += 1;
      else linkCount += 1;
      checkRelativeTarget(locale.file, lineNumber, match[1], isImage ? 'image' : 'link');
    }
    for (const match of line.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      imageCount += 1;
      checkRelativeTarget(locale.file, lineNumber, match[1], 'image');
    }
  });

  // 4. Fence balance.
  const fenceCount = lines.filter(isFence).length;
  if (fenceCount % 2 !== 0) {
    report(locale.file, null, `unbalanced code fences (${fenceCount} markers)`);
  }

  // 5. Content that must survive translation.
  for (const required of REQUIRED_TOKENS) {
    if (!text.includes(required.token)) {
      report(locale.file, null, `missing ${required.label} ("${required.token}")`);
    }
  }

  return { file: locale.file, h1Count, h2Count, linkCount, imageCount, size: text.length };
}

const summaries = LOCALES.map(analyzeLocale).filter(Boolean);
const baseline = summaries.find((item) => item.file === 'README.md');
if (baseline) {
  for (const summary of summaries) {
    if (summary.h2Count !== baseline.h2Count) {
      report(
        summary.file,
        null,
        `section count drift: ${summary.h2Count} <h2> sections, English baseline has ${baseline.h2Count}`,
      );
    }
  }
}

if (summaries.length > 0) {
  console.log('file                 h1  h2  links  images  bytes');
  for (const summary of summaries) {
    console.log(
      `${summary.file.padEnd(20)} ${String(summary.h1Count).padEnd(3)} ${String(summary.h2Count).padEnd(3)} ` +
        `${String(summary.linkCount).padEnd(6)} ${String(summary.imageCount).padEnd(7)} ${summary.size}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`\nREADME i18n check failed with ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('\nREADME i18n check passed.');
