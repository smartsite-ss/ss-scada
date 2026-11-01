# 04 · Troubleshooting

This document summarizes real issues encountered when setting up ss-scada on a new machine for the first time, along with their solutions. Most are already fixed in the repo config; refer here only if they recur in a new environment.

---

## 1. `pnpm` command fails outright: EPERM writing to `node_global\.tools`

**Symptom**: running any `pnpm` command reports `EPERM: operation not permitted`, failing to create a directory under `E:\develop\node\node\node_global\.tools`.

**Cause**: the project `package.json` pins the pnpm version via `packageManager`. pnpm's "self-managed version switching" tries to download and install that version into the global `.tools` directory, which is protected and cannot be written to.

**Fix** (already written into the repo, **do not remove**): disable self-managed versioning in the `.npmrc` of both sub-workspaces:

```ini
# ss-editor/.npmrc 与 ss-services/ss-node/.npmrc
manage-package-manager-versions=false
```

Then just use the globally installed pnpm. If it still errors, try `corepack disable` or ensure `pnpm` is on the PATH.

---

## 2. `pnpm -r build` reports `TS2307: Cannot find module '@ss-node/ss-device'` etc.

**Symptom**: when building the `ss-project` package, it says it cannot find types for `@ss-node/ss-alarm` / `ss-device` etc.

**Cause (two factors combined)**:
1. Some packages' `dist` artifacts are incomplete (e.g. missing `dist/index.d.ts`), left over from a previous interrupted build.
2. There are **circular dependencies** between packages (`ss-alarm ↔ ss-project`, `ss-device ↔ ss-system`). `pnpm -r build` has unreliable topological ordering on cyclic graphs, and may build `ss-project` before its dependencies, causing resolution to fail.

**Fix**:
- First build the key packages manually in dependency order to ensure their `dist/index.*` is fully generated:
  ```bat
  pnpm --filter @ss-node/ss-system build
  pnpm --filter @ss-node/ss-device build
  pnpm --filter @ss-node/ss-alarm build
  pnpm --filter @ss-node/ss-project build
  ```
- Then run the full build:
  ```bat
  pnpm -r build
  ```
- If it still reports a missing module later, first confirm the package's `dist/index.d.ts` exists (`pnpm --filter <pkg> build` to rebuild it).

---

## 3. `TS2307: Cannot find module 'uuid'` or missing `uuid` types

**Symptom**: `ss-project` compilation reports it cannot find the `uuid` module/types.

**Cause**: in the local pnpm store, the `uuid` package (multiple versions) is missing its `dist/*.d.ts` (the runtime `index.js` still exists)—a systemic issue from an incomplete store extraction.

**Fix (recommended)**: avoid the external `uuid` dependency and use Node's built-in crypto:
```ts
import { randomUUID as uuidv4 } from 'node:crypto';
```
This repo's `widget-template.service.ts` already uses this style. If you really need to add `uuid`, make sure its `.d.ts` is complete in the store, otherwise use the built-in alternative above.

---

## 4. Frontend Vite: `Failed to resolve import "@/..."` from editor source

**Symptom**: when starting the frontend, Vite fails to resolve `@/canvas-page/...` while processing a file under `packages/editor/...`, and the error path has an `../../packages/editor/...` prefix (meaning it was compiled in the `apps/web` context).

**Cause**: the editor library package's `@/` alias points to `packages/editor/src`, but the host app `apps/web`'s Vite alias `@` points to `apps/web/src`—they conflict.

**Fix**: inside editor library packages, use **relative paths** or the `@scada-editor/*` workspace alias to reference same-package files; do not use `@/...`. This repo's `graphic-editing/layer/SidePanel.vue` has been changed to:
```ts
import WidgetTemplatePanel from '../../canvas-page/templates/WidgetTemplatePanel.vue';
```

---

## 5. Login returns 401 / system says not initialized

**Symptom**: after first backend startup, the frontend login with `test/test` returns 401, or the backend returns `setup/status` of `initialized:false`.

**Cause**: a freshly cloned repo has an empty database and no admin account yet (this is normal, not a fault).

**Fix**: open the frontend in a browser and follow the guide into the **setup wizard**, or call:
```bash
curl -X POST http://localhost:4000/api/v1/setup/step1 \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123","email":"admin@smartsite.local"}'
```
Then complete Steps 2/3/4 to log in.

---

## 6. Native module compilation failed (sqlite3 / serialport, etc.)

**Symptom**: native module compilation errors (`node-gyp` related) during `pnpm install`.

**Fix**: install the Windows build toolchain:
- **Visual Studio Build Tools** (select "Desktop development with C++")
- **Python 3.x** (add to PATH)

Re-run `pnpm install`.

---

## 7. Port already in use (4000 / 5173 / 5174 / 5175)

**Symptom**: backend/frontend startup reports `EADDRINUSE`.

**Troubleshoot**:
```bat
netstat -ano | findstr ":4000 :5173 :5174 :5175" | findstr LISTENING
```
Make sure there are no leftover `start-backend.bat` / `start-frontend.bat` processes (note that one script starts a `cmd` parent process + a `node` child process; the whole tree must be terminated).

---

## 8. Health Checks & Logs

- Backend health: `GET http://localhost:4000/api/v1/health` (`{"code":200,"data":{"status":"ok"}}`).
- Initialization status: `GET http://localhost:4000/api/v1/setup/status`.
- Backend logs: the startup script redirects output to `bin/_backend.log` by default; frontend logs to `bin/_frontend.log`.
- Application startup logs are prefixed with `[STARTUP] Phase A/B/C/D` for easy identification of where it stalls.
