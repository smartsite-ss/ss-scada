// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { join, resolve, dirname } from 'path';
import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { vitePluginBundledPlugins } = _require('../../packages/plugins/scripts/vite-plugin-bundled-plugins.cjs');

const SHARED_DEPS = [
  'vue',
  'vue-i18n',
  'pinia',
  'vue-demi',
  '@vue/devtools-api',
  '@scada-editor/core',
  '@scada-editor/plugin-sdk',
  'three',
];

const SHARED_DEP_FILES: Record<string, string> = {
  'vue': 'dist/vue.esm-browser.prod.js',
  'vue-i18n': 'dist/vue-i18n.esm-browser.prod.js',
  'pinia': 'dist/pinia.esm-browser.js',
  'vue-demi': 'lib/index.mjs',
  '@vue/devtools-api': 'lib/esm/index.js',
  'three': 'build/three.module.js',
};

const SHARED_DEP_OUTPUT: Record<string, string> = {
  'vue': 'vue.esm.js',
  'vue-i18n': 'vue-i18n.esm.js',
  'pinia': 'pinia.esm.js',
  'vue-demi': 'vue-demi.esm.js',
  '@vue/devtools-api': 'vue-devtools-api/index.js',
  '@scada-editor/core': 'scada-core.esm.js',
  '@scada-editor/plugin-sdk': 'scada-plugin-sdk.esm.js',
  'three': 'three.esm.js',
};

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatBuildTime(date: Date): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:4000';
  // Note: the build command uses `vite build --mode full|scada|data`,
  // mode is the product mode (full/scada/data), not 'production'.
  // Therefore, detecting a production build must use command, not mode.
  const isProd = command === 'build';
  // Deployment base path: defaults to root; the H5 embed scenario injects VITE_BASE=/scada-preview/ via bin/build-h5-shell.bat,
  // Lets the shell mount under an H5 site sub-path (same-origin reverse proxy, avoiding third-party Cookie restrictions).
  // All dynamically concatenated absolute resource paths (importmap, etc.) must be based on appBase; do not hardcode '/assets/'.
  const appBase = env.VITE_BASE || '/';
  const APP_VERSION = getAppVersion();
  const BUILD_TIME = formatBuildTime(new Date());

  return {
    base: appBase,
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
        },
      },
    },
    plugins: [
      vitePluginBundledPlugins(),
      vue() as any,
      {
        name: 'strip-baidu-tongji-in-dev',
        // Baidu Analytics is kept only in releases (production builds); stripped from index.html in dev mode,
        // Avoid reporting stats to hm.baidu.com during local development.
        transformIndexHtml(html) {
          if (isProd) return html;
          return html.replace(/<!--[\s\S]*?Baidu Tongji[\s\S]*?<\/script>\s*/i, '');
        },
      },
      {
        name: 'inject-dev-importmap',
        // Inject import map INLINE (not external file) in dev mode so
        // browser-side dynamic import("@plugins/electric/...") resolves
        // to @fs protocol URLs. Inline avoids caching issues.
        transformIndexHtml(html) {
          if (isProd) return html;
          const mapPath = resolve(__dirname, 'public', 'import-map.json');
          let mapJson = '';
          try {
            mapJson = readFileSync(mapPath, 'utf-8');
          } catch (_e) {
            console.warn('[inject-dev-importmap] import-map.json not found, skipping');
            return html;
          }
          return html.replace(
            '</head>',
            `  <script type="importmap">\n${mapJson}\n  </script>\n  </head>`,
          );
        },
      },
      {
        name: 'copy-dist-plugins',
        // Dev server startup: copy directory plugin assets (images/icons) from
        // dist-plugins/ to public/plugins/ so Vite can serve them at /plugins/* URLs.
        // .mjs files are EXCLUDED in dev mode — plugins are loaded via @fs protocol
        // from TS source, not from pre-built .mjs. Importing .mjs from /public causes
        // Vite warnings ("should not be imported from source code").
        configureServer() {
          if (isProd) return;
          const srcDir = resolve(__dirname, '..', '..', 'packages', 'plugins', 'dist-plugins');
          const destDir = resolve(__dirname, 'public', 'plugins');
          if (existsSync(srcDir)) {
            try {
              // Exclude .mjs (loaded via @fs/Vite alias from TS source) and
              // .json (plugin-manifest.json, registry.json) — manifests
              // are separately synced by generate-directory-configs.cjs --dev
              // via syncPublicManifest(). Copying .json from dist-plugins/
              // would overwrite dev manifests with production .mjs URLs.
              copyDirRecursive(srcDir, destDir, (p) => !p.endsWith('.mjs') && !p.endsWith('.json'));
            } catch (_e) {
              console.warn('  [copy-dist-plugins] Failed to copy dist-plugins to public/plugins:', (_e as Error).message);
            }
          }
        },
      },
      {
        name: 'shared-deps',
        enforce: 'post',
        transformIndexHtml(html) {
          if (!isProd) return html;

          const importMap: { imports: Record<string, string> } = { imports: {} };
          SHARED_DEPS.forEach(function (dep) {
            importMap.imports[dep] = appBase + 'assets/' + SHARED_DEP_OUTPUT[dep];
          });

          const scriptTag =
            '<script type="importmap">\n' +
            JSON.stringify(importMap, null, 2) +
            '\n</script>';

          return html.replace('</head>', '  ' + scriptTag + '\n  </head>');
        },
        async writeBundle() {
          if (!isProd) return;

          const distAssets = resolve(__dirname, 'dist', 'assets');
          if (!existsSync(distAssets)) {
            mkdirSync(distAssets, { recursive: true });
          }

          for (const dep of SHARED_DEPS) {
            const outputName = SHARED_DEP_OUTPUT[dep];
            if (!outputName) continue;

            let src: string | null = null;

            if (dep === '@scada-editor/core') {
              src = resolve(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.es.js');
            } else if (dep === '@scada-editor/plugin-sdk') {
              src = resolve(__dirname, '..', '..', 'packages', 'plugin-sdk', 'dist', 'index.js');
            } else if (dep === '@vue/devtools-api') {
              const relativePath = SHARED_DEP_FILES[dep];
              if (relativePath) {
                const editorDir = resolve(__dirname, '..', '..');
                src = resolveDepPath(dep, relativePath, editorDir);
              }
              if (src && existsSync(src)) {
                const srcDir = dirname(src);
                const destDir = join(distAssets, 'vue-devtools-api');
                copyDirRecursive(srcDir, destDir);
                continue;
              }
            } else {
              const relativePath = SHARED_DEP_FILES[dep];
              if (relativePath) {
                const editorDir = resolve(__dirname, '..', '..');
                const resolvedPath = resolveDepPath(dep, relativePath, editorDir);
                src = resolvedPath || resolve(__dirname, 'node_modules', dep, relativePath);
              }
            }

            if (src && existsSync(src)) {
              const dest = join(distAssets, outputName);
              copyFileSync(src, dest);
            } else {
              console.warn('  [shared-deps] WARN: not found ' + dep + ' → ' + outputName);
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@scada-editor/shared': resolve(__dirname, '../../packages/shared/src'),
        '@scada-editor/system': resolve(__dirname, '../../packages/system/src'),
        '@scada-editor/core': resolve(__dirname, '../../packages/core/src'),
        '@scada-editor/editor': resolve(__dirname, '../../packages/editor/src'),
        '@scada-editor/plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/src'),
        '@plugins': resolve(__dirname, '../../packages/plugins'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api', 'import'],
        },
      },
    },
    optimizeDeps: {
      include: [],
      exclude: [
        '@scada-editor/system',
        '@scada-editor/shared',
        '@scada-editor/core',
        '@scada-editor/editor',
        '@scada-editor/plugin-sdk',
      ],
    },
    server: {
      // Ports are separated by product mode (.env.data=5175 / .env.scada=5174), default full=5173:
      // 5173 must be reserved for the full shell (includes /preview); if data/scada also starts on 5173 it occupies the shell port,
      // Also, data mode has no /preview route; when H5 iframe opens /preview it redirects to /system (admin backend).
      port: env.VITE_PORT ? Number(env.VITE_PORT) : 5173,
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          // SSE long-connection support: disable timeout and buffering to ensure streaming endpoints like agent/execute do not disconnect
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              // Remove content-length that middleware may add (streaming SSE responses should not have a fixed length)
              const ct = proxyRes.headers['content-type'] || '';
              if (ct.includes('text/event-stream')) {
                delete proxyRes.headers['content-length'];
              }
            });
          },
        },
        '/socket.io': {
          target: apiBase,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        external: isProd ? SHARED_DEPS : [],
        // CODE-14: also enable manualChunks in production builds to avoid packing all app code into a single index.js (3.3MB).
        // Split strategy:
        //   - editor: editor code (includes three.js usage, large deps like xlsx/html2canvas); not loaded on the login page
        //   - system: system management views + shared module (40+ views); the login page only needs LoginView, but barrel exports put the whole package in one chunk
        //   - vendor: remaining node_modules third-party dependencies
        //   - xlsx / html2canvas: oversized standalone dependencies form their own chunk, loaded only when the corresponding feature is triggered
        // Note: packages/shared/ is merged into the system chunk and no longer a separate chunk.
        // Reason: the _export_sfc helper injected by the Vue SFC compiler at compile time (named ct/ie after minification) gets split by Rollup into
        // "首次使用它的 SFC" chunk (i.e. the system chunk). If shared becomes its own chunk, SFCs in shared
        // will cross-chunk import _export_sfc from the system chunk, and the system chunk in turn imports content from the shared chunk,
        // forms a shared ↔ system circular dependency, triggering the "Cannot access 'X' before initialization" TDZ error.
        // Since LoginView does not import shared, this merge does not affect login-page load performance.
        output: {
          manualChunks(id) {
            // The app source is split by subsystem (based on packages/ path matching, consistent with resolve.alias)
            if (id.includes('packages/editor/')) return 'editor';
            if (id.includes('packages/system/') || id.includes('packages/shared/')) return 'system';

            // Third-party dependency breakdown
            if (id.includes('node_modules/')) {
              if (id.includes('xlsx') || id.includes('xlml') || id.includes('cpexcel')) return 'xlsx';
              if (id.includes('html2canvas')) return 'html2canvas';
              if (id.includes('chart.js') || id.includes('chartjs')) return 'chart';
              return 'vendor';
            }
          },
        },
      },
    },
  };
});

function resolveDepPath(packageName: string, relativePath: string, editorDir: string): string | null {
  try {
    const pkgJsonPath = require.resolve(packageName + '/package.json', { paths: [editorDir] });
    const pkgDir = dirname(pkgJsonPath);
    const filePath = join(pkgDir, relativePath);
    if (existsSync(filePath)) return filePath;
  } catch (_e) {
    /* fallback to pnpm search */
  }

  const pnpmDir = join(editorDir, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;

  const dirs = readdirSync(pnpmDir);
  const pnpmPkgName = packageName.replace(/\//g, '+');
  let pkgDir: string | null = null;
  for (const dir of dirs) {
    if (dir.startsWith(pnpmPkgName + '@')) {
      pkgDir = dir;
      break;
    }
  }
  if (!pkgDir) return null;

  const resolvedPath = join(pnpmDir, pkgDir, 'node_modules', packageName, relativePath);
  return existsSync(resolvedPath) ? resolvedPath : null;
}

function copyDirRecursive(srcDir: string, destDir: string, filter?: (filePath: string) => boolean) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, filter);
    } else {
      if (filter && !filter(srcPath)) continue;
      copyFileSync(srcPath, destPath);
    }
  }
}