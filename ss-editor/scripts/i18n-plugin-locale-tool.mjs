// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Plugin locale batch tool: split all plugin zh-CN locale packs into flat
 * key→text chunks, then merge translated chunks back into per-plugin JSON files.
 *
 * Usage:
 *   node scripts/i18n-plugin-locale-tool.mjs split <locale> [chunkSize]
 *   node scripts/i18n-plugin-locale-tool.mjs build <locale>
 *   node scripts/i18n-plugin-locale-tool.mjs check <locale>
 *
 * Chunk format: { "<pluginRelativePath>/<dottedKey>": "translated text" }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_ROOT = path.join(EDITOR_ROOT, 'packages', 'plugins');
const WORK_ROOT = path.join(EDITOR_ROOT, '.i18n-plugin-work');

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

/** Find every plugin locale directory that contains zh-CN.json, sorted by relative path. */
function discoverPlugins() {
  const plugins = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === 'locales') {
        const source = path.join(fullPath, 'zh-CN.json');
        if (fs.existsSync(source)) {
          const relative = path.relative(PLUGINS_ROOT, path.dirname(fullPath)).split(path.sep).join('/');
          plugins.push({ id: relative, localesDir: fullPath, source });
        }
        continue;
      }
      walk(fullPath);
    }
  };
  walk(PLUGINS_ROOT);
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return plugins;
}

function split(locale, chunkSize = 400) {
  const localeDir = path.join(WORK_ROOT, locale);
  fs.rmSync(localeDir, { recursive: true, force: true });
  fs.mkdirSync(localeDir, { recursive: true });

  const plugins = discoverPlugins();
  let chunk = {};
  let chunkKeyCount = 0;
  let chunkIndex = 0;
  let totalKeys = 0;

  const flush = () => {
    if (chunkKeyCount === 0) return;
    chunkIndex += 1;
    writeJson(path.join(localeDir, `${String(chunkIndex).padStart(3, '0')}.json`), chunk);
    chunk = {};
    chunkKeyCount = 0;
  };

  for (const plugin of plugins) {
    const flat = flatten(readJson(plugin.source));
    // Keep a single plugin inside one chunk so keys of the same file stay together.
    const pluginSize = Object.keys(flat).length;
    if (chunkKeyCount > 0 && chunkKeyCount + pluginSize > chunkSize) flush();
    for (const [key, value] of Object.entries(flat)) {
      chunk[`${plugin.id}/${key}`] = value;
    }
    chunkKeyCount += pluginSize;
    totalKeys += pluginSize;
  }
  flush();

  fs.writeFileSync(
    path.join(localeDir, '_plugins.json'),
    `${JSON.stringify(plugins.map((plugin) => plugin.id), null, 2)}\n`,
    'utf8',
  );
  console.log(`${locale}: ${plugins.length} plugins, ${totalKeys} keys → ${chunkIndex} chunks`);
}

function readChunks(dir) {
  const merged = {};
  for (const name of fs.readdirSync(dir).filter((file) => /^\d+\.json$/.test(file)).sort()) {
    Object.assign(merged, readJson(path.join(dir, name)));
  }
  return merged;
}

function build(locale) {
  const localeDir = path.join(WORK_ROOT, locale);
  if (!fs.existsSync(localeDir)) {
    throw new Error(`No translated chunks found for ${locale}: ${localeDir}`);
  }

  const plugins = discoverPlugins();
  const translated = readChunks(localeDir);
  let failures = 0;
  let written = 0;

  for (const plugin of plugins) {
    const template = readJson(plugin.source);
    const flat = flatten(template);
    const result = {};
    const missing = [];

    for (const [key, sourceValue] of Object.entries(flat)) {
      const lookupKey = `${plugin.id}/${key}`;
      const value = translated[lookupKey];
      if (Array.isArray(sourceValue)) {
        setNested(result, key, Array.isArray(value) && value.length > 0 ? value : sourceValue);
      } else if (typeof value === 'string' && value.length > 0) {
        setNested(result, key, value);
      } else {
        missing.push(key);
        setNested(result, key, sourceValue);
      }
    }

    writeJson(path.join(plugin.localesDir, `${locale}.json`), result);
    written += 1;
    if (missing.length) {
      failures += 1;
      console.error(`[${locale}] ${plugin.id}: missing=${missing.length} (${missing.slice(0, 3).join(', ')})`);
    }
  }

  console.log(`[${locale}] wrote ${written} plugin locale files, plugins with issues: ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

function check(locale) {
  const plugins = discoverPlugins();
  let failures = 0;
  for (const plugin of plugins) {
    const sourceFlat = flatten(readJson(plugin.source));
    const targetPath = path.join(plugin.localesDir, `${locale}.json`);
    if (!fs.existsSync(targetPath)) {
      failures += 1;
      console.error(`[${locale}] missing file: ${plugin.id}`);
      continue;
    }
    const targetFlat = flatten(readJson(targetPath));
    const missing = Object.keys(sourceFlat).filter((key) => !(key in targetFlat));
    const extra = Object.keys(targetFlat).filter((key) => !(key in sourceFlat));
    if (missing.length || extra.length) {
      failures += 1;
      console.error(`[${locale}] ${plugin.id}: missing=${missing.length} extra=${extra.length}`);
    }
  }
  console.log(
    failures === 0
      ? `[${locale}] ${plugins.length} plugin packs key structure OK`
      : `[${locale}] ${failures} plugin file(s) with issues`,
  );
  if (failures > 0) process.exitCode = 1;
}

const [command, locale, size] = process.argv.slice(2);
if (!command || !locale) {
  console.error('Usage: node scripts/i18n-plugin-locale-tool.mjs <split|build|check> <locale> [chunkSize]');
  process.exit(1);
}

if (command === 'split') split(locale, size ? Number(size) : 400);
else if (command === 'build') build(locale);
else if (command === 'check') check(locale);
else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
