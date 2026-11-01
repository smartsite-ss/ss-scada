# 02 · Backend Development (ss-services/ss-node)

The backend is a NestJS monorepo composed of **16+ library packages (`@ss-node/*`)** and one **NestJS application (`ss-node-server`)**. The application assembles modules on demand via `app.module.ts` based on the "product mode".

## 1. Package Structure

| Package | Role |
| --- | --- |
| `@ss-node/ss-sdk` | Shared SDK: common DTOs, types, i18n resources (i18n load path points to this package's `src/i18n`) |
| `@ss-node/ss-core` | Core capabilities: auth/guards, Redis, EventBus, Logger, PathResolver, WebSocket gateway, AI module |
| `@ss-node/ss-i18n` | Internationalization service |
| `@ss-node/ss-datatag` | Measurement points / data tags |
| `@ss-node/ss-datasource` | Data source management |
| `@ss-node/ss-device` | Device management: status service, gateway, controllers (real-time data push) |
| `@ss-node/ss-system` | System management: setup wizard, backup, health check, config, basic services |
| `@ss-node/ss-alarm` | Alarming |
| `@ss-node/ss-project` | Projects and widget templates |
| `@ss-node/ss-report` | Reports |
| `@ss-node/ss-script` | Script execution |
| `@ss-node/ss-storage` (+ `ss-storage-influx` / `-influx3` / `-tdengine`) | Time-series storage (InfluxDB / TDengine) |
| `@ss-node/ss-collector/*` | Acquisition protocols: modbus / mqtt / opcua / s7 / virtual, sharing `ss-collector-sdk` |
| `@ss-node/ss-cli` | Command-line tools |
| `ss-node-server` | **App entry**: `apps/ss-node-server/src/{main.ts,app.module.ts}` |

## 2. Product Modes

Modules are loaded on demand via the `APP_PRODUCT_MODE` environment variable, default `full`:

| Mode | Behavior |
| --- | --- |
| `full` (default) | Both scada and data modules loaded |
| `scada` | Only scada (editor/acquisition) modules |
| `data` | Only data (data platform/system management) modules |

Environment variable load order (`buildEnvFilePaths` in `app.module.ts`):

```
Production (NODE_ENV=production):   process.cwd()/.env (single file)
Development:                         .env.local (local override, gitignored) → .env.{productMode} → .env.base
When APP_PRODUCT_MODE is unset:    .env.{APP_ENV|dev} → .env.base
```

## 3. Configuration (.env)

Backend config is spread across several env files (all under `ss-services/ss-node/`):

- `.env.base` — common config (base port, path vars, etc.)
- `.env.dev` / `.env.data` / `.env.scada` — per product-mode config
- `.env.example` — **template**, can be copied to `.env.local` / `.env.dev`
- `.env.local` — local override, **not committed** (gitignored)

Common variables:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP listen port (default 4000) |
| `APP_PRODUCT_MODE` | full / scada / data |
| `JWT_SECRET` | Token signing secret |
| `INFLUXDB_URL/TOKEN/ORG/BUCKET` | Time-series database |
| `MQTT_BROKER_URL` / `OPCUA_SERVER_URL` / `MODBUS_TCP_*` | Acquisition protocols |
| `CORS_ORIGINS` | Allowed frontend origins for CORS (defaults include 5173/4000) |
| `LOG_DIR` / `LOG_LEVEL` | Log directory and level |
| `SS_RUN_DIR` / `RUN_DIR` / `DICTS_DIR` / `TEMPLATES_DIR` | Runtime data directories (point to `ss-run/ss/...`) |

> Runtime data is by default placed outside the repo under `ss-run/ss/...` (Phase C of `start-backend.bat` creates `ss-run/ss/data/init` and copies the SQL files).

## 4. Common Commands

```bat
cd ss-services/ss-node

pnpm install                       install dependencies
pnpm build                        pnpm -r build (build all packages + app)
pnpm build:packages                build library packages only (excludes app)
pnpm --filter <pkg> build          build a single package (e.g. @ss-node/ss-device)

pnpm dev                           equivalent to pnpm --filter ss-node-server dev
pnpm --filter ss-node-server start:dev    dev hot-reload (nest watch)
pnpm --filter ss-node-server start:prod   production run (dist/main)
pnpm --filter ss-node-server typecheck   tsc --noEmit
pnpm -r test                       full test suite (jest, passWithNoTests)
```

App entry scripts (`apps/ss-node-server/package.json`):

- `start:dev`：`NODE_ENV=development + nest start --tsc --watch`
- `start:prod`：`APP_ENV=pro + node --require reflect-metadata dist/main`

## 5. Development Workflow Tips

- **Incremental hot reload**: `start:dev` uses `nest build --tsc --watch` + incremental compilation; changes to the app or any library source trigger an automatic restart.
- **Watch for circular dependencies**: there are inter-package circular dependencies (`ss-alarm ↔ ss-project`, `ss-device ↔ ss-system`). `pnpm -r build` has unreliable topological ordering on cyclic graphs and may build a package before its dependencies, resulting in `TS2307`. If this happens, manually build the key packages in dependency order first (`ss-system → ss-device → ss-alarm → ss-project`), then run `pnpm -r build`. See [04 - Troubleshooting](./04-troubleshooting.md).
- **Type artifacts**: each library package's `package.json` uses `dist/index.d.ts` as the `types` entry; dependent packages resolve it via tsconfig `paths` or `node_modules` symlinks. Make sure the dependency package's `dist/index.*` is generated (build succeeded).
- **Swagger**: after startup, visit `http://localhost:4000/api/docs` to view and debug endpoints.

## 6. Health Check Endpoints

| Path | Description |
| --- | --- |
| `GET /api/v1/health` | Simple health check (public) |
| `GET /api/v1/health/details` | Detailed health |
| `GET /api/v1/health/liveness` / `/readiness` | K8s probes |
| `GET /api/v1/setup/status` | Initialization status (`initialized`/`steps`) |
