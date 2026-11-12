// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

const { exec } = require("child_process");
const { pathToFileURL } = require("url");
const {
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  statSync,
} = require("fs");
const { join, resolve } = require("path");
const { createHash } = require("crypto");

const PLUGINS_ROOT = resolve(__dirname, "..");
const EDITOR_ROOT = resolve(PLUGINS_ROOT, "..", "..");
const CATEGORIES_PATH = join(PLUGINS_ROOT, "categories.json");
const OUTPUT_DIR = join(PLUGINS_ROOT, "dist-plugins");
const ENV_PRODUCTION_PATH = join(EDITOR_ROOT, "apps", "web", ".env.production");

(function loadEnvFile() {
  if (!existsSync(ENV_PRODUCTION_PATH)) return;
  const content = readFileSync(ENV_PRODUCTION_PATH, "utf-8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
})();

const CDN_BASE_URL = process.env.VITE_DEPLOY_BASE
  ? (process.env.VITE_DEPLOY_BASE + 'plugins')
  : (process.env.PLUGIN_CDN_URL || '/plugins');

function loadDirectoryCategories() {
  if (!existsSync(CATEGORIES_PATH)) {
    throw new Error("categories.json not found: " + CATEGORIES_PATH);
  }
  const config = JSON.parse(readFileSync(CATEGORIES_PATH, "utf-8"));
  return config
    .filter(function (c) {
      return c.deployMode === "directory";
    })
    .map(function (c) {
      return c.id;
    });
}

function log(msg, level) {
  level = level || "info";
  const prefix =
    level === "success" ? "OK" : level === "error" ? "ERROR" : "...";
  console.log("[" + prefix + "] " + msg);
}

function computeChecksum(filePath) {
  const content = readFileSync(filePath);
  return "sha256-" + createHash("sha256").update(content).digest("hex");
}

function copyDirRecursive(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var srcPath = join(srcDir, entry.name);
    var destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function extractPluginMeta(indexPath, pluginName, category) {
  const content = readFileSync(indexPath, 'utf-8');
  const pluginMeta = { type: pluginName, label: pluginName, labelEn: pluginName };

  const typeMatch = content.match(/type:\s*['"]([^'"]+)['"]/);
  if (typeMatch) {
    pluginMeta.type = typeMatch[1];
  }

  const labelMatch = content.match(/label:\s*(?:\(\)\s*=>\s*)?(?:i18n\.global\.t\(['"]([^'"]+)['"]\)|['"]([^'"]+)['"])/);
  if (labelMatch && labelMatch[1]) {
    pluginMeta.label = labelMatch[1];
  } else if (labelMatch && labelMatch[2]) {
    pluginMeta.label = labelMatch[2];
  }

  const labelEnMatch = content.match(/labelEn:\s*['"]([^'"]+)['"]/);
  if (labelEnMatch) {
    pluginMeta.labelEn = labelEnMatch[1];
  }

  return pluginMeta;
}

function copyBuildToOutput(pluginDir, category, pluginName, version) {
  var srcDist = join(pluginDir, "dist");
  if (!existsSync(srcDist)) return;

  var destDist = join(OUTPUT_DIR, category, pluginName, version);
  mkdirSync(destDist, { recursive: true });
  copyDirRecursive(srcDist, destDist);

  var pngFile = join(pluginDir, pluginName + ".png");
  var svgFile = join(pluginDir, pluginName + ".svg");
  if (existsSync(pngFile)) {
    copyFileSync(pngFile, join(destDist, pluginName + ".png"));
  }
  if (existsSync(svgFile)) {
    copyFileSync(svgFile, join(destDist, pluginName + ".svg"));
  }

  log(
    "Copied: " + category + "/" + pluginName + " -> dist-plugins/",
    "success",
  );
}

var _viteBuild = null;
var _vuePluginFn = null;
var _fallbackLogged = false;

// pnpm does not hoist `vite` to the workspace root, so resolution must start from the
// packages that actually declare it (apps/web, packages/system). With only
// [EDITOR_ROOT, PLUGINS_ROOT] the resolve always threw, `_viteBuild` became false and
// every plugin fell back to spawning `npx vite build` (one process per plugin: ~5s
// each, plus error messages replaced by Vite's CJS-deprecation warning).
const VITE_RESOLVE_BASES = [
  EDITOR_ROOT,
  join(EDITOR_ROOT, "apps", "web"),
  join(EDITOR_ROOT, "packages", "system"),
  PLUGINS_ROOT,
];

function resolveFirstMatch(packageName) {
  for (var b = 0; b < VITE_RESOLVE_BASES.length; b++) {
    try {
      return require.resolve(packageName, { paths: [VITE_RESOLVE_BASES[b]] });
    } catch (e) {
      /* try next base */
    }
  }
  return null;
}

async function getViteBuild() {
  if (_viteBuild !== null) return _viteBuild;
  try {
    const vitePath = resolveFirstMatch("vite");
    if (!vitePath) throw new Error("vite not resolvable");
    // On Windows a bare absolute path ("F:\\...") is parsed as a URL scheme by
    // dynamic import and throws ERR_UNSUPPORTED_ESM_URL_SCHEME -- it must be a file URL.
    const viteImport = await import(pathToFileURL(vitePath).href);
    // Vite's entry is CJS here, so its API may sit on the namespace default.
    _viteBuild =
      viteImport.build ||
      (viteImport.default && viteImport.default.build) ||
      false;
  } catch (e) {
    _viteBuild = false;
  }
  return _viteBuild;
}

async function getVuePlugin() {
  if (_vuePluginFn !== null) return _vuePluginFn;
  try {
    const vuePluginPath = resolveFirstMatch("@vitejs/plugin-vue");
    if (!vuePluginPath) throw new Error("@vitejs/plugin-vue not resolvable");
    const vuePluginImport = await import(pathToFileURL(vuePluginPath).href);
    // CJS interop: the factory is either the namespace default or nested under it.
    const vuePluginCandidate =
      vuePluginImport.default && vuePluginImport.default.default
        ? vuePluginImport.default.default
        : vuePluginImport.default;
    _vuePluginFn = typeof vuePluginCandidate === "function" ? vuePluginCandidate : false;
  } catch (e) {
    _vuePluginFn = false;
  }
  return _vuePluginFn;
}

function execAsync(cmd, options) {
  return new Promise(function (resolve, reject) {
    exec(cmd, options, function (error, stdout, stderr) {
      if (error) {
        // stderr of a vite CLI run is mostly warnings (CJS deprecation, chunk sizes);
        // using it verbatim as the error message hid the real rollup failure. Keep the
        // actionable lines instead.
        var stderrText = String(stderr || "");
        var meaningful = stderrText
          .split(/\r?\n/)
          .map(function (line) {
            return line.replace(/\u001b\[[0-9;]*m/g, "").trim();
          })
          .filter(function (line) {
            return (
              line &&
              !/CJS build of Vite's Node API is deprecated/i.test(line) &&
              !/^For more info/i.test(line) &&
              !/^https?:\/\//i.test(line)
            );
          })
          .slice(-12)
          .join("\n");
        var err = new Error(meaningful || stderrText || error.message);
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      } else {
        resolve({ stdout: stdout, stderr: stderr });
      }
    });
  });
}

async function buildPluginAsync(pluginDir, category, pluginName) {
  const indexPath = join(pluginDir, "index.ts");
  const packagePath = join(pluginDir, "package.json");

  if (!existsSync(indexPath)) {
    log("Skipping " + category + "/" + pluginName + ": no index.ts", "error");
    return null;
  }

  if (!existsSync(packagePath)) {
    log(
      "Skipping " + category + "/" + pluginName + ": no package.json",
      "error",
    );
    return null;
  }

  var pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
  } catch (e) {
    pkg = {};
  }

  const version = pkg.version || "0.1.0";
  const pluginMeta = pkg.pluginMeta || extractPluginMeta(indexPath, pluginName, category);

  log("Building: " + category + "/" + pluginName + " (v" + version + ")");

  try {
    var viteBuild = await getViteBuild();
    var vuePluginFn = await getVuePlugin();

    if (viteBuild && vuePluginFn) {
      await viteBuild({
        configFile: false,
        root: pluginDir,
        plugins: [vuePluginFn()],
        build: {
          lib: {
            entry: resolve(pluginDir, "index.ts"),
            formats: ["es"],
            fileName: function () {
              return "index.mjs";
            },
          },
          outDir: resolve(pluginDir, "dist"),
          rollupOptions: {
            external: [
              "vue",
              "vue-i18n",
              "pinia",
              "vue-demi",
              "@vue/devtools-api",
              "@scada-editor/plugin-sdk",
              "@scada-editor/core",
            ],
            output: {
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
          target: "es2020",
          minify: "esbuild",
          sourcemap: false,
        },
      });
    } else {
      if (!_fallbackLogged) {
        _fallbackLogged = true;
        log(
          "Vite API not available, building via child process",
        );
      }
      const tempConfig = join(pluginDir, ".vite.config.tmp.ts");
      writeFileSync(tempConfig, [
        "import { defineConfig } from 'vite';",
        "import vue from '@vitejs/plugin-vue';",
        "import { resolve } from 'path';",
        "export default defineConfig({",
        "  plugins: [vue()],",
        "  build: {",
        "    lib: { entry: resolve(__dirname, 'index.ts'), formats: ['es'], fileName: () => 'index.mjs' },",
        "    outDir: resolve(__dirname, 'dist'),",
        "    rollupOptions: { external: ['vue','vue-i18n','pinia','vue-demi','@vue/devtools-api','@scada-editor/plugin-sdk','@scada-editor/core'] },",
        "    target: 'es2020', minify: 'esbuild', sourcemap: false,",
        "  },",
        "});",
        "",
      ].join("\n"));
      try {
        await execAsync("npx vite build --config .vite.config.tmp.ts", {
          cwd: pluginDir,
          timeout: 60000,
        });
      } finally {
        try { require("fs").unlinkSync(tempConfig); } catch (e) { /* ignore */ }
      }
    }

    const distFile = join(pluginDir, "dist", "index.mjs");
    if (!existsSync(distFile)) {
      log("Build output missing: " + distFile, "error");
      return {
        type: pluginMeta.type || pluginName,
        category: category,
        version: version,
        url: "",
        checksum: "",
        success: false,
        error: "dist/index.mjs not found",
      };
    }

    const checksum = computeChecksum(distFile);
    copyBuildToOutput(pluginDir, category, pluginName, version);
    const url =
      CDN_BASE_URL +
      "/" +
      category +
      "/" +
      pluginName +
      "/" +
      version +
      "/index.mjs";

    log("Built: " + category + "/" + pluginName + " -> " + url, "success");

    return {
      type: pluginMeta.type || pluginName,
      category: category,
      version: version,
      url: url,
      checksum: checksum,
      success: true,
    };
  } catch (error) {
    const errMsg = error.message || "Unknown error";
    log(
      "Build failed: " + category + "/" + pluginName + ": " + errMsg,
      "error",
    );
    return {
      type: pluginMeta.type || pluginName,
      category: category,
      version: version,
      url: "",
      checksum: "",
      success: false,
      error: errMsg,
    };
  }
}

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let running = 0;
  let nextIndex = 0;

  return new Promise(function (resolveAll) {
    function runNext() {
      while (running < limit && nextIndex < tasks.length) {
        // `const i` (per-iteration binding) is REQUIRED here: with `var`, every
        // callback below closes over the same mutated index, so results of the
        // early tasks were written into the wrong slot and got lost -- the build
        // reported "93 success" while all 98 plugins had actually built, and the
        // generated registry/manifest silently dropped 5 entries.
        const i = nextIndex++;
        running++;
        tasks[i]()
          .then(function (result) {
            results[i] = result;
            running--;
            runNext();
          })
          .catch(function (err) {
            results[i] = { success: false, error: err.message };
            running--;
            runNext();
          });
      }
      if (running === 0 && nextIndex >= tasks.length) {
        resolveAll(results);
      }
    }
    runNext();
  });
}

function generateRegistryJson(results) {
  const entries = [];

  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    if (!result || !result.success) continue;

    const pluginDir = join(PLUGINS_ROOT, result.category, result.type);
    const packagePath = join(pluginDir, "package.json");

    var label = result.type;
    var labelEn = result.type;
    var sdkVersionRange = "^1.0.0";

    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
        if (pkg.pluginMeta) {
          label = pkg.pluginMeta.label || result.type;
          labelEn = pkg.pluginMeta.labelEn || result.type;
          sdkVersionRange = pkg.pluginMeta.sdkVersionRange || "^1.0.0";
        }
      } catch (e) {
        /* ignore */
      }
    } else {
      const indexPath = join(pluginDir, "index.ts");
      if (existsSync(indexPath)) {
        const extracted = extractPluginMeta(indexPath, result.type, result.category);
        label = extracted.label;
        labelEn = extracted.labelEn;
      }
    }

    const baseUrl = CDN_BASE_URL + "/" + result.category + "/" + result.type + "/" + result.version + "/";
    const pngExists = existsSync(join(pluginDir, result.type + ".png"));
    const svgExists = existsSync(join(pluginDir, result.type + ".svg"));

    entries.push({
      type: result.type,
      category: result.category,
      label: label,
      labelEn: labelEn,
      version: result.version,
      url: result.url,
      checksum: result.checksum,
      deployMode: "directory",
      sdkVersionRange: sdkVersionRange,
      icon: pngExists ? baseUrl + result.type + ".png" : (svgExists ? baseUrl + result.type + ".svg" : ""),
    });
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const registry = {
    name: "scada-editor-plugins",
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    entries: entries,
  };

  writeFileSync(
    join(OUTPUT_DIR, "registry.json"),
    JSON.stringify(registry, null, 2),
  );
  log("Registry generated: " + entries.length + " entries", "success");
}

function generateCategoryManifests(results, categories) {
  for (var i = 0; i < categories.length; i++) {
    var category = categories[i];
    const categoryResults = results.filter(function (r) {
      return r && r.category === category && r.success;
    });

    if (categoryResults.length === 0) {
      // Zero-success category: still write an EMPTY manifest so it overwrites the
      // stale one produced by generate-directory-configs.cjs (which lists every
      // plugin regardless of build result). Otherwise the published package ships a
      // manifest declaring artifacts that do not exist => runtime dynamic import()
      // failures for every entry in that category.
      const emptyCatDir = join(OUTPUT_DIR, category);
      if (!existsSync(emptyCatDir)) mkdirSync(emptyCatDir, { recursive: true });
      writeFileSync(
        join(emptyCatDir, 'plugin-manifest.json'),
        JSON.stringify(
          {
            name: 'scada-editor-plugins-' + category,
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            entries: [],
          },
          null,
          2,
        ),
      );
      log(
        'Category manifest: ' + category + ' (0 built -> empty manifest written to avoid stale entries)',
        'error',
      );
      continue;
    }

    const entries = [];
    for (var j = 0; j < categoryResults.length; j++) {
      var result = categoryResults[j];
      const pluginDir = join(PLUGINS_ROOT, category, result.type);
      const packagePath = join(pluginDir, "package.json");

      var label = result.type;
      var labelEn = result.type;
      var sdkVersionRange = "^1.0.0";

      if (existsSync(packagePath)) {
        try {
          const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
          if (pkg.pluginMeta) {
            label = pkg.pluginMeta.label || result.type;
            labelEn = pkg.pluginMeta.labelEn || result.type;
            sdkVersionRange = pkg.pluginMeta.sdkVersionRange || "^1.0.0";
          }
        } catch (e) {
          /* ignore */
        }
      }

      const baseUrl2 = CDN_BASE_URL + "/" + category + "/" + result.type + "/" + result.version + "/";
      const pngExists2 = existsSync(join(pluginDir, result.type + ".png"));
      const svgExists2 = existsSync(join(pluginDir, result.type + ".svg"));

      entries.push({
        type: result.type,
        category: result.category,
        label: label,
        labelEn: labelEn,
        version: result.version,
        url: result.url,
        checksum: result.checksum,
        deployMode: "directory",
        sdkVersionRange: sdkVersionRange,
        icon: pngExists2 ? baseUrl2 + result.type + ".png" : (svgExists2 ? baseUrl2 + result.type + ".svg" : ""),
      });
    }

    const catDir = join(OUTPUT_DIR, category);
    if (!existsSync(catDir)) {
      mkdirSync(catDir, { recursive: true });
    }

    const manifest = {
      name: "scada-editor-plugins-" + category,
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      entries: entries,
    };

    writeFileSync(
      join(catDir, "plugin-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    log(
      "Category manifest: " + category + " (" + entries.length + " plugins)",
      "success",
    );
  }
}

function parseArgs(args) {
  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    if (arg === "--all") {
      return loadDirectoryCategories();
    }
    if (arg.startsWith("--category=")) {
      return [arg.replace("--category=", "")];
    }
  }
  return args.length > 0 ? [args[0]] : loadDirectoryCategories();
}

async function main() {
  const args = process.argv.slice(2);
  const categories = parseArgs(args);

  const concurrency = Math.max(
    1,
    parseInt(process.env.BUILD_CONCURRENCY || "6", 10),
  );

  log("Building directory plugins for: " + categories.join(", "));
  log("CDN base URL: " + CDN_BASE_URL);
  log("Source: " + PLUGINS_ROOT);
  log("Output: " + OUTPUT_DIR);
  log(
    "Concurrency: " + concurrency + " (set BUILD_CONCURRENCY env to override)",
  );
  console.log();

  var buildTasks = [];

  for (let i = 0; i < categories.length; i++) {
    let category = categories[i];
    const categoryDir = join(PLUGINS_ROOT, category);
    if (!existsSync(categoryDir)) {
      log("Category directory not found: " + categoryDir, "error");
      continue;
    }

    const plugins = readdirSync(categoryDir, { withFileTypes: true }).filter(
      function (d) {
        return d.isDirectory() && d.name !== "node_modules";
      },
    );

    log("Found " + plugins.length + " plugins in " + category);

    for (let j = 0; j < plugins.length; j++) {
      let plugin = plugins[j];
      const pluginDir = join(categoryDir, plugin.name);
      buildTasks.push(function () {
        return buildPluginAsync(pluginDir, category, plugin.name);
      });
    }
  }

  log("Total build tasks: " + buildTasks.length);
  console.log();

  var startTime = Date.now();
  var allResultsWithNull = await runWithConcurrency(buildTasks, concurrency);
  var allResults = allResultsWithNull.filter(function (r) {
    return r !== null && r !== undefined;
  });
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const successful = allResults.filter(function (r) {
    return r.success;
  }).length;
  const failed = allResults.filter(function (r) {
    return !r.success;
  }).length;

  log(
    "Build complete: " +
      successful +
      " success, " +
      failed +
      " failed (in " +
      elapsed +
      "s)",
  );

  if (successful > 0) {
    generateRegistryJson(allResults);
    generateCategoryManifests(allResults, categories);
  }

  if (failed > 0) {
    log("Failed plugins:", "error");
    allResults
      .filter(function (r) {
        return !r.success;
      })
      .forEach(function (r) {
        log("  " + r.category + "/" + r.type + ": " + (r.error || ""), "error");
      });
    process.exit(1);
  }
}

main();
