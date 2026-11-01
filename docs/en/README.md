# Smart Site · Developer Guide

This repository is Smart SCADA (ss-scada), structured as a pnpm multi-workspace (monorepo) that contains two independent workspaces:

| Workspace | Path | Purpose | Tech Stack |
| --- | --- | --- | --- |
| Frontend Editor | `ss-editor/` | Web SCADA visualization editor / admin console | Vue 3 + Vite 5 + Pinia + Naive UI + ECharts + Monaco + TypeScript |
| Backend Service | `ss-services/ss-node/` | NestJS business services & data acquisition gateway | NestJS 10 + TypeORM + SQLite3 + Socket.IO + ioredis + Swagger |

The root `bin/` directory provides one-click startup scripts: `install-deps.bat` (install dependencies), `start-backend.bat` (start backend), `start-frontend.bat` (start frontend), `start.bat` (full stack).

---

## Documentation System (Four Categories)

| Category | Document | Description |
| --- | --- | --- |
| Quick Start | [Environment Setup & Startup](./01-getting-started.md) · [Dev Environment Setup Manual](./07-dev-environment.md) | Prerequisites, dependency install, first run, production build |
| User Manual | [User Manual](./05-user-manual.md) | Usage of the configuration editor and data platform |
| Developer Guide | This document (Developer Guide) · [Backend Development](./02-backend.md) · [Frontend Development](./03-frontend.md) | Architecture, package structure, product/runtime modes, dev workflow, plugin mechanism |
| Deployment & Ops | [Deployment & Ops](./06-deployment-ops.md) · [Troubleshooting](./04-troubleshooting.md) | Production deployment, configuration, backup, upgrade, monitoring, troubleshooting |

---

## Quick Start (TL;DR)

```bat
:: 1. Install dependencies (frontend + backend)
bin\install-deps.bat

:: 2. Start backend (install → build all packages → copy SQL → nest watch)
bin\start-backend.bat

:: 3. Open another terminal to start frontend (Vite, default 5173)
bin\start-frontend.bat
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000 (Swagger docs: http://localhost:4000/api/docs)
- On first startup the database is uninitialized: opening the frontend redirects you to the **setup wizard**; create the admin account first to log in.

> Port note: the backend defaults to `4000` (determined by `.env.base` / product mode); the frontend defaults to `5173`, proxying `/api` and `/socket.io` to the backend. See the corresponding sections for details.
