# Smart Site · Dev Environment Setup Manual

> Audience: engineers setting up the ss-scada source dev environment on a local machine (Windows) for the first time.
> Goal: from scratch complete code fetch → dependency install → service startup → first login.
> Related docs: [README.md](./README.md) · [01 - Environment Setup & Startup](./01-getting-started.md) · [02 - Backend Development](./02-backend.md) · [03 - Frontend Development](./03-frontend.md) · [04 - Troubleshooting](./04-troubleshooting.md)

---

## 0. Environment Overview

| Component | Description |
| --- | --- |
| OS | Windows 10/11 (this manual uses Windows as an example) |
| Code repo | `ss-scada` (frontend `ss-editor` + backend `ss-services/ss-node`, two pnpm workspaces) |
| Frontend | Vue 3 + Vite 5 + Pinia + Naive UI + ECharts + Monaco |
| Backend | NestJS 10 + TypeORM + SQLite3 + Socket.IO + ioredis + Swagger |
| Package manager | pnpm (lockfile v9.0, global pnpm 10.x compatible) |
| Runtime ports | Backend 4000 · Frontend 5173 (data 5175 / scada 5174) |

---

## 1. Hardware & Software Prerequisites

| Dependency | Version | Purpose | Install method |
| --- | --- | --- | --- |
| Node.js | **18.x or above** (20.x / 24.x recommended) | Run pnpm scripts, Vite, NestJS | Install LTS from https://nodejs.org |
| npm | Ships with Node | Install pnpm globally | No separate install |
| pnpm | Compatible with lockfile v9.0 (global 10.x fine) | Workspace dependency management | `npm i -g pnpm@10` |
| Visual Studio Build Tools | includes "Desktop development with C++" | Compile native modules (sqlite3 / serialport) | Visual Studio Installer |
| Python 3.x | any 3.x | required by node-gyp | Install from official site and add to PATH |

> **Verification commands** (all should print version numbers normally):
> ```bat
> node --version
> npm --version
> pnpm --version
> python --version
> ```

---

## 2. Get the Code

```bat
:: If not cloned yet (example uses the gitee remote; replace with your repo URL)
git clone https://gitee.com/stuhu/ss-scada.git
cd ss-scada

:: Confirm current branch (default master)
git branch --show-current
```

Key repository paths:

```
ss-scada/
├─ bin/                     startup / install scripts
├─ docs/                    this doc and developer guide
├─ ss-editor/               frontend workspace
└─ ss-services/ss-node/     backend workspace
```

---

## 3. Install Package Manager (pnpm)

If pnpm is not installed yet:

```bat
npm i -g pnpm@10
```

> ⚠️ **pnpm self-managed version issue (already avoided, do not delete the config)**
> The project `package.json` pins the pnpm version via `packageManager`. By default pnpm tries to
> auto-install that version under `node_global\.tools`; on some machines this directory is protected and causes
> an `EPERM` error. The repo has written into `ss-editor/.npmrc` and `ss-services/ss-node/.npmrc`
> `manage-package-manager-versions=false` to disable this behavior. **Do not delete these two lines**, otherwise a fresh environment will hit the same pitfall.

---

## 4. Install Dependencies

Recommended one-click install (frontend + backend):

```bat
bin\install-deps.bat
```

The script is equivalent to running separately:

```bat
cd ss-editor            && pnpm install
cd ss-services/ss-node  && pnpm install
```

The install pulls ~16 backend library packages and several frontend packages, and compiles native modules. If `pnpm install` errors on a native module (node-gyp related), go back to **Step 1** to confirm VS Build Tools and Python are correctly installed, then re-run.

> Reproducible install (CI, etc.): add `--frozen-lockfile` in both workspaces.

---

## 5. Configure Environment Variables (.env)

The backend loads multiple env files (see [02 - Backend Development](./02-backend.md)); dev load order:

```
.env.local (local override, gitignored, optional) → .env.{productMode} → .env.base
```

For first-time setup, initialize like this:

```bat
cd ss-services/ss-node
:: Copy the template to a local file (.env.local is not committed; holds local secrets/overrides)
copy .env.example .env.local
:: Or adjust based on the example mode file directly
copy .env.dev .env.local
```

Common variables (already have defaults in `ss-services/ss-node/.env.base` and `.env.dev/.env.data`, **usually no change needed for local startup**):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | 4000 | Backend HTTP port |
| `APP_PRODUCT_MODE` | full | full / scada / data (controls which modules load) |
| `JWT_SECRET` | built-in default | replace in production |
| `INFLUXDB_URL` | http://localhost:8086 | Time-series DB (no change needed if undeployed; only used by data module) |
| `CORS_ORIGINS` | includes 5173/4000 | Frontend CORS allowlist |
| `LOG_DIR` | `ss-run/.../logs` | Log directory (auto-created) |

Frontend env (`ss-editor/apps/web/.env.development`, provided with the repo):

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_PORT` | 5173 | Frontend dev port |
| `VITE_API_BASE_URL` | http://localhost:4000 | Backend address (Vite proxy target) |
| `VITE_DEBUG_SKIP_AUTH` | true (development) | Dev-only skip auth; backend does not recognize mock token—do not use in production |

---

## 6. Start Services

### 6.1 Start Backend

```bat
bin\start-backend.bat
```

The script runs in phases (log prefix `[STARTUP] Phase A/B/C/D`):

1. **Phase A** `pnpm install`
2. **Phase B** `pnpm build` (`pnpm -r build`, builds all packages + app, slow on first run)
3. **Phase C** copies SQL init scripts to `ss-run/ss/data/init/`
4. **Phase D** `nest start --tsc --watch` hot reload

On first build, if you see `TS2307: Cannot find module '@ss-node/...'`, it is usually a topological order issue caused by circular dependencies; manually build the key packages in order and then do a full build—see [04 - Troubleshooting, item 2](./04-troubleshooting.md).

### 6.2 Start Frontend

Open another terminal:

```bat
bin\start-frontend.bat
```

Equivalent to `pnpm --filter scada-editor-web dev` (Vite, default 5173). After startup, visit http://localhost:5173 .

### 6.3 One-click Full Stack (Optional)

```bat
bin\start.bat
```

---

## 7. First Run · Setup Wizard

A fresh repo has an empty database and the backend is in an "uninitialized" state; logging in directly returns **401** (expected).

1. Open http://localhost:5173 in a browser; the frontend guides you into the **setup wizard (/setup)**.
2. Complete in order:
   - **Step 1 Create admin account** (username/password/email required)
   - **Step 2 Basic config** (site name, timezone, language)
   - **Step 3 Data config**
   - **Step 4 Finish**
3. Log in with the admin account just created.

> Quick admin creation from CLI (equivalent to Step 1):
> ```bash
> curl -X POST http://localhost:4000/api/v1/setup/step1 \
>   -H 'Content-Type: application/json' \
>   -d '{"username":"admin","password":"admin123","email":"admin@smartsite.local"}'
> ```

---

## 8. Verify the Environment Is Ready

| Check | Command / Address | Expected Result |
| --- | --- | --- |
| Backend alive | `GET http://localhost:4000/api/v1/health` | `{"code":200,"data":{"status":"ok"}}` |
| Init status | `GET http://localhost:4000/api/v1/setup/status` | `initialized: true` (after wizard) |
| API docs | http://localhost:4000/api/docs | Swagger UI opens |
| Frontend page | http://localhost:5173 | Editor / admin console loads normally |
| Real-time data | Frontend device monitoring page | WebSocket real-time refresh (depends on `/socket.io` proxy) |

The backend startup log is redirected to `bin/_backend.log` by default, and the frontend to `bin/_frontend.log`; check these two files first when troubleshooting.

---

## 9. Quick Reference: Common Setup Issues

| Symptom | Cause | Handling |
| --- | --- | --- |
| `pnpm` directly reports EPERM writing `.tools` | self-managed version switch rejected | disabled via `.npmrc`, don't delete; otherwise `corepack disable` |
| `pnpm -r build` reports `TS2307` cannot find `@ss-node/*` | circular-dependency topo order + incomplete dist | build `ss-system→ss-device→ss-alarm→ss-project` in order first, then `pnpm -r build` |
| reports cannot find `uuid` / missing types | incomplete pnpm store extraction | use `import { randomUUID } from 'node:crypto'` |
| frontend `Failed to resolve import "@/..."` | editor lib package `@/` alias conflicts in web context | use relative path or `@scada-editor/*` alias inside lib packages |
| login 401 / not initialized | empty database | run setup wizard (Section 7) |
| native module compile failed | missing C++ toolchain / Python | install VS Build Tools + Python 3 then reinstall |
| `EADDRINUSE` port occupied | old process not exited | use `netstat` to find the occupant, kill the old `cmd`+`node` process tree |

See [04 - Troubleshooting](./04-troubleshooting.md) for detailed causes and commands.

---

## 10. Daily Dev Commands Cheat Sheet

```bat
:: Backend
cd ss-services/ss-node
pnpm --filter ss-node-server start:dev    hot-reload dev
pnpm --filter <pkg> build                 single-package build
pnpm -r build                             full build

:: Frontend
cd ss-editor
pnpm dev:full                            start web (development mode)
pnpm build:web                           production build (--mode production)
pnpm typecheck / pnpm test               type check / unit tests
```

> ⚠️ The production build must use `--mode production`; files like `.env.full` contain debug switches, and misuse will cause auth anomalies in production.
