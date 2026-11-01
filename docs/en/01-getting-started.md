# 01 · Environment Setup & Startup

## 1. Prerequisites

| Dependency | Version | Notes |
| --- | --- | --- |
| Node.js | **18.x or above** (verified on 20.x / 24.x) | Also requires `npm` (for installing pnpm globally) |
| pnpm | Compatible with lockfile `lockfileVersion: '9.0'` (global pnpm 10.x works) | See "pnpm version note" below |
| Build toolchain | Windows: Visual Studio Build Tools (with C++) + Python 3 | For compiling native modules (see below) |

### Native Modules

The backend depends on several native modules that need local compilation: `sqlite3`, `bcryptjs` (pure JS, no native), `serialport` (used by some collector plugins), etc. If compilation fails during `pnpm install`, install the following first:

- **Visual Studio Build Tools**: select the "Desktop development with C++" workload.
- **Python 3.x** (add to PATH, required by node-gyp).

Usually no extra config is needed after installation; pnpm will automatically invoke `node-gyp` to compile.

### pnpm Version Note (Important)

The project `package.json` pins the pnpm version via `packageManager`. On some machines, pnpm's **self-managed version switching** tries to write files under `node_global\.tools` and fails with a permission denied error (EPERM), causing the `pnpm` command to fail outright.

This repo has already added the following to `.npmrc` in both sub-workspaces:

```ini
manage-package-manager-versions=false
```

This uses the globally installed pnpm directly and avoids the problem. **Do not remove these two config entries**, otherwise a fresh environment may hit the same issue again. See [04 - Troubleshooting](./04-troubleshooting.md).

---

## 2. Installing Dependencies

Recommended: install with the root script in one step:

```bat
bin\install-deps.bat
```

The script runs the following in order:

```bat
cd ss-editor           && pnpm install
cd ss-services/ss-node && pnpm install
```

> Installs dependencies only, **no build**. Add `--frozen-lockfile` for a reproducible install.

You can also run `pnpm install` manually in each workspace.

---

## 3. Startup (Development Mode)

### Method A: Start Separately (Recommended, easier to read logs)

```bat
:: Terminal 1: backend
bin\start-backend.bat

:: Terminal 2: frontend
bin\start-frontend.bat
```

`start-backend.bat` runs four phases in order:

1. **Phase A** `pnpm install` (if not installed)
2. **Phase B** `pnpm build` (uses `pnpm -r build` to build all 24 packages + the app)
3. **Phase C** copies SQL init scripts to `ss-run/ss/data/init/`
4. **Phase D** `nest start --tsc --watch` starts the hot-reload service

Once done, access:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000, Swagger: http://localhost:4000/api/docs

### Method B: One-click Full Stack

```bat
bin\start.bat
```

Internally calls `start-backend.bat` and `start-frontend.bat` in sequence.

---

## 4. First Run · Setup Wizard

A freshly cloned repo has an empty database. The first request to the backend returns an "uninitialized" status (`GET /api/v1/setup/status` → `initialized:false`), and logging in with `test/test` returns **401** (this is expected).

Follow the frontend guide into the **setup wizard (/setup)** and complete at least:

1. **Step 1 Create admin account** (`POST /api/v1/setup/step1`, requires `username/password/email`)
2. **Step 2 Basic config** (site name, timezone, language)
3. **Step 3 Data config**
4. **Step 4 Finish initialization**

Then you can log in with the created admin account.

---

## 5. Production Build

### Backend

```bat
cd ss-services/ss-node
pnpm -r build                       :: build all packages and the app
pnpm --filter ss-node-server start:prod   :: APP_ENV=pro, run dist/main (NODE_ENV=production)
```

In production, the `.env` is generated as a single file in the service directory by the publish script (`publish-node.bat`).

### Frontend

```bat
cd ss-editor
pnpm build:web                    :: core → editor → system → web (vite build --mode production)
pnpm --filter scada-editor-web preview
```

> ⚠️ The production build **must use `--mode production`**. Files like `.env.full` contain debug switches (e.g. skip auth) and are for development only; the backend does not recognize mock tokens, and misuse will cause anomalies in production.

---

## 6. Directory Overview

```
ss-scada/
├─ bin/                 startup / install scripts
├─ docs/                this documentation
├─ ss-editor/           frontend workspace (pnpm workspace)
│  ├─ packages/
│  │  ├─ core/          @scada-editor/core
│  │  ├─ editor/        @scada-editor/editor (editor core)
│  │  ├─ system/        @scada-editor/system (admin console)
│  │  ├─ plugin-sdk/    @scada-editor/plugin-sdk
│  │  ├─ plugins/       built-in plugins
│  │  └─ apps/web/      scada-editor-web host application
│  └─ pnpm-workspace.yaml
└─ ss-services/ss-node/  backend workspace (pnpm workspace)
   ├─ packages/         @ss-node/* business libraries (14+)
   ├─ apps/ss-node-server/  NestJS app entry
   └─ pnpm-workspace.yaml
```
