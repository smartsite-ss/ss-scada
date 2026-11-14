// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Locale batch tool: split the Chinese source packs into flat key→text chunks,
 * then merge translated chunks back into nested locale JSON files.
 *
 * Usage:
 *   node scripts/i18n-locale-tool.mjs split <locale> [chunkSize]
 *   node scripts/i18n-locale-tool.mjs build <locale>
 *   node scripts/i18n-locale-tool.mjs check <locale>
 *
 * Chunks live in .i18n-work/<locale>/<source>/NNN.json as flat maps:
 *   { "dotted.key.path": "translated text" }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK_ROOT = path.join(EDITOR_ROOT, '.i18n-work');

const SOURCES = [
  {
    id: 'core',
    dir: 'packages/core/src/locales',
    target: (locale) => `packages/core/src/locales/${locale}.json`,
  },
  {
    id: 'system',
    dir: 'packages/system/src/locales',
    target: (locale) => `packages/system/src/locales/${locale}.json`,
  },
  {
    id: 'pluginSdk',
    dir: 'packages/plugin-sdk/src/locales',
    target: (locale) => `packages/plugin-sdk/src/locales/${locale}.json`,
  },
  {
    id: 'node',
    dir: '../ss-services/ss-node/packages/ss-sdk/src/i18n/zh',
    target: (locale) => `../ss-services/ss-node/packages/ss-sdk/src/i18n/${locale}`,
    perFile: true,
  },
];

function flatten(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function setNested(target, dottedKey, value) {
  const parts = dottedKey.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sourceFiles(source) {
  const base = path.resolve(EDITOR_ROOT, source.dir);
  if (!source.perFile) {
    return [{ name: source.id, file: path.join(base, 'zh-CN.json') }];
  }
  return fs
    .readdirSync(base)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name: name.replace(/\.json$/, ''), file: path.join(base, name) }));
}

function split(locale, chunkSize = 400) {
  const localeDir = path.join(WORK_ROOT, locale);
  fs.rmSync(localeDir, { recursive: true, force: true });

  for (const source of SOURCES) {
    for (const entry of sourceFiles(source)) {
      const flat = flatten(readJson(entry.file));
      const keys = Object.keys(flat);
      const outDir = path.join(localeDir, source.id, entry.name === source.id ? '' : entry.name);
      fs.mkdirSync(outDir, { recursive: true });

      let chunkIndex = 0;
      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = {};
        for (const key of keys.slice(i, i + chunkSize)) {
          chunk[key] = flat[key];
        }
        chunkIndex += 1;
        const fileName = `${String(chunkIndex).padStart(3, '0')}.json`;
        writeJson(path.join(outDir, fileName), chunk);
      }
      console.log(`${locale} ${source.id}/${entry.name}: ${keys.length} keys → ${chunkIndex} chunks`);
    }
  }
}

function readChunks(dir) {
  if (!fs.existsSync(dir)) return {};
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort();
  const merged = {};
  for (const file of files) {
    Object.assign(merged, readJson(path.join(dir, file)));
  }
  return merged;
}

function build(locale) {
  const localeDir = path.join(WORK_ROOT, locale);
  if (!fs.existsSync(localeDir)) {
    throw new Error(`No translated chunks found for ${locale}: ${localeDir}`);
  }

  let failures = 0;

  for (const source of SOURCES) {
    for (const entry of sourceFiles(source)) {
      const template = readJson(entry.file);
      const flat = flatten(template);
      const chunkDir = path.join(localeDir, source.id, entry.name === source.id ? '' : entry.name);
      const translated = readChunks(chunkDir);

      const result = {};
      const missing = [];
      const untranslated = [];

      for (const [key, sourceValue] of Object.entries(flat)) {
        const value = translated[key];

        // Array leaves (e.g. cron month names) are copied as-is unless translated explicitly.
        if (Array.isArray(sourceValue)) {
          setNested(result, key, Array.isArray(value) && value.length > 0 ? value : sourceValue);
          continue;
        }

        if (typeof value !== 'string' || value.length === 0) {
          missing.push(key);
          setNested(result, key, sourceValue);
        } else {
          if (value === sourceValue && /[\u4e00-\u9fff]/.test(sourceValue)) {
            untranslated.push(key);
          }
          setNested(result, key, value);
        }
      }

      const extra = Object.keys(translated).filter((key) => !(key in flat));
      const targetPath = path.resolve(EDITOR_ROOT, source.target(locale));
      const finalPath = source.perFile ? path.join(targetPath, `${entry.name}.json`) : targetPath;
      writeJson(finalPath, result);

      if (untranslated.length) {
        console.warn(
          `[${locale}] ${source.id}/${entry.name}: ${untranslated.length} value(s) identical to zh-CN (may be shared CJK characters)`,
        );
      }

      if (missing.length || extra.length) {
        failures += 1;
        console.error(
          `[${locale}] ${source.id}/${entry.name}: missing=${missing.length} extra=${extra.length}`,
        );
        if (missing.length) console.error(`  missing sample: ${missing.slice(0, 5).join(', ')}`);
        if (extra.length) console.error(`  extra sample: ${extra.slice(0, 5).join(', ')}`);
      } else {
        console.log(`[${locale}] ${source.id}/${entry.name}: OK (${Object.keys(flat).length} keys)`);
      }
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function check(locale) {
  let failures = 0;
  for (const source of SOURCES) {
    for (const entry of sourceFiles(source)) {
      const sourceFlat = flatten(readJson(entry.file));
      const targetPath = path.resolve(EDITOR_ROOT, source.target(locale));
      const finalPath = source.perFile ? path.join(targetPath, `${entry.name}.json`) : targetPath;
      if (!fs.existsSync(finalPath)) {
        console.error(`[${locale}] missing file: ${finalPath}`);
        failures += 1;
        continue;
      }
      const targetFlat = flatten(readJson(finalPath));
      const missing = Object.keys(sourceFlat).filter((key) => !(key in targetFlat));
      const extra = Object.keys(targetFlat).filter((key) => !(key in sourceFlat));
      if (missing.length || extra.length) {
        failures += 1;
        console.error(`[${locale}] ${source.id}/${entry.name}: missing=${missing.length} extra=${extra.length}`);
      }
    }
  }
  console.log(failures === 0 ? `[${locale}] key structure OK` : `[${locale}] ${failures} file(s) with issues`);
  if (failures > 0) process.exitCode = 1;
}

const [command, locale, size] = process.argv.slice(2);
if (!command || !locale) {
  console.error('Usage: node scripts/i18n-locale-tool.mjs <split|build|check> <locale> [chunkSize]');
  process.exit(1);
}

if (command === 'split') split(locale, size ? Number(size) : 400);
else if (command === 'build') build(locale);
else if (command === 'check') check(locale);
else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
