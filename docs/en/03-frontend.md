# 03 · Frontend Development (ss-editor)

The frontend is a Vue 3 + Vite pnpm workspace containing several **library packages** (`@scada-editor/*`) and one **host application** (`scada-editor-web`). During development, Vite consumes library package sources directly, so libraries don't need to be built first.

## 1. Package Structure

| Package | Path | Role |
| --- | --- | --- |
| `@scada-editor/core` | `packages/core` | Core: state management, canvas engine abstraction, shared types |
| `@scada-editor/editor` | `packages/editor` | **Editor core**: graphic editing, layers, canvas page (`graphic-editing/`, `canvas-page/`) and other Vue components |
| `@scada-editor/system` | `packages/system` | Admin console / system UI |
| `@scada-editor/plugin-sdk` | `packages/plugin-sdk` | Plugin SDK, provides the `@Graphic({})` decorator (experimental decorator) |
| `packages/plugins` | `packages/plugins` | Built-in plugins (visual components for each acquisition protocol, etc.) |
| `scada-editor-web` | `apps/web` | **Host application**: Vite config, routing, proxy, runtime modes |

## 2. Runtime Modes

The frontend is split by product mode, controlled via the Vite `--mode` flag and the corresponding `.env`:

| mode | Description | Port |
| --- | --- | --- |
| `development` (default / full shell) | Full-feature shell, includes `/preview` | **5173** |
| `data` | Data platform / system management | 5175 |
| `scada` | Editor / acquisition | 5174 |

> Port is determined by `VITE_PORT` in `.env.{mode}`, default 5173. Note that 5173 must be reserved for the full shell; data/scada use 5175/5174 respectively, to avoid redirect anomalies after the `/preview` route is taken over.

## 3. Common Commands

```bat
cd ss-editor

pnpm install                  install dependencies

pnpm dev                      start plugin CLI dev (build plugins + watch)
pnpm dev:web                  start web host only (vite --mode development)
pnpm dev:full / dev:scada / dev:data    different product modes

pnpm build:web                production build (core → editor → system → web, --mode production)
pnpm build:web:full / :scada / :data
pnpm --filter scada-editor-web preview    preview build output

pnpm typecheck               vue-tsc --noEmit
pnpm test                    unit tests (vitest)
pnpm lint                    eslint
```

## 4. Dev Server & Proxy

`apps/web/vite.config.ts`:

- The dev server default port is `5173` (can be overridden by `VITE_PORT`).
- Proxies:
  - `/api` → backend (`VITE_API_BASE_URL`, default `http://localhost:4000`), with timeout disabled to support SSE streaming responses.
  - `/socket.io` → backend (`ws: true`), for real-time data push.

The frontend locates the backend via `VITE_API_BASE_URL`; during development it defaults to `http://localhost:4000`. The debug switch `VITE_DEBUG_SKIP_AUTH` (only in `.env.development`) can skip auth on the frontend, but the **backend does not recognize** the corresponding mock token—do not use it in production.

## 5. Plugin Mechanism

- Built-in plugins live in `packages/plugins/`, built/validated/developed uniformly by `packages/plugins/scripts/plugins-cli.cjs`.
- Plugins use the `@Graphic({})` decorator (provided by `@scada-editor/plugin-sdk`); type declarations are inside `plugin-sdk`.
- For new plugins, refer to `packages/create-plugin/`.

## 6. Cross-Package Import Caveats (Pitfalls)

Editor library packages (`packages/editor`, etc.) are also compiled directly within the Vite context of the **host application `apps/web`**. In that context:

- `@scada-editor/core`, `@scada-editor/system`, etc. **workspace package aliases** work (resolved by `apps/web`'s Vite/tsconfig).
- But the editor library package's **own `@/` alias** (pointing to `packages/editor/src`) fails to resolve in the web context, raising `Failed to resolve import "@/..."`.

**Rule**: when referencing files within the same package in library source, **prefer relative paths** (e.g. `'../../canvas-page/templates/WidgetTemplatePanel.vue'`), or use the `@scada-editor/*` workspace alias; do not use `@/...` for cross-file imports, to avoid mis-resolution during web compilation. See [04 - Troubleshooting](./04-troubleshooting.md).
