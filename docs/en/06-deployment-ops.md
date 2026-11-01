# Smart Site · Deployment & Operations Manual

> Audience: engineers responsible for platform deployment, configuration, backup, upgrade, and day-to-day operations.
> For getting started and feature usage, see [User Manual](./05-user-manual.md); for source development and extension, see [Developer Guide](./README.md).

---

## 1. Deployment Architecture Overview

The platform uses a front-backend separated architecture:

- **Frontend**: Vue 3 + Vite built into static assets, served by a web server (e.g. Nginx).
- **Backend**: NestJS service providing REST API (`/api/v1`), Swagger (`/api-docs`), WebSocket (`/socket.io`).

The frontend and backend can be trimmed into different combinations by **product mode** (see Section 3) for deployment on demand.

---

## 2. Environment Requirements

| Dependency | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 18 (20 LTS recommended) | Run backend and build frontend |
| pnpm | ≥ 8 (root `package.json` pins `pnpm@11`) | Workspace dependency management |
| InfluxDB | 2.7+ (optional) | Time-series data storage |
| Redis | optional | Real-time data cache |
| VS Build Tools + Python 3 | Required for compiling native modules on Windows | Compile `better-sqlite3` / `serialport` etc. |

---

## 3. Three Product Modes

Controlled via the `APP_PRODUCT_MODE` env var (backend) and Vite `--mode` (frontend):

| Mode | Backend Port | Frontend Port | Notes |
| --- | --- | --- | --- |
| `full` (default) | 3000 | 5173 | Editor + data platform, full |
| `data` | 4000 | 5175 | Data platform only (disables `/editor`, `/preview`) |
| `scada` | 4100 | 5174 | Configuration editor only (disables `/system/*`) |

> Ports are determined by `PORT` / `VITE_PORT` in `.env.base` / product-mode `.env` / frontend `.env.{mode}`, and can be adjusted as needed.

---

## 4. Build

```bash
# Backend (repo root; builds each workspace package under ss-services/ss-node)
pnpm build:server

# Frontend (full / per-mode)
cd ss-editor
pnpm build:web:full      # core → editor → system → web
pnpm build:web:scada
pnpm build:web:data

# Or one-click full build from repo root
pnpm build:all
```

Build artifacts: backend `ss-services/ss-node/apps/ss-node-server/dist`, frontend `ss-editor/apps/web/dist`.

---

## 5. Deployment Methods

### 5.1 Direct Run (Lightweight / Intranet)

```bash
# Backend production mode
cd ss-services/ss-node
NODE_ENV=production PORT=4000 pnpm start:prod

# Frontend: serve ss-editor/apps/web/dist via Nginx / static server
```

### 5.2 Nginx Reverse Proxy (Recommended)

```nginx
server {
    listen 80;
    server_name your-domain;

    # Frontend static assets
    location / {
        root /path/to/ss-editor/apps/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend REST API and Swagger
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket (Upgrade header must be allowed)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 5.3 Docker (Example)

```yaml
# docker-compose.yml (example, trim as needed)
version: "3.8"
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - PORT=4000
      - JWT_SECRET=change-me
      - APP_PRODUCT_MODE=full
    ports:
      - "4000:4000"
  frontend:
    image: nginx:alpine
    volumes:
      - ./ss-editor/apps/web/dist:/usr/share/nginx/html:ro
      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "80:80"
  # optional: influxdb / redis
```

The backend `Dockerfile` uses a multi-stage build: install dependencies and run `pnpm build:server`, then copy only the files needed to run, and run `pnpm start:prod` with `node`.

---

## 6. Configuration

### 6.1 Backend Environment Variables (`ss-services/ss-node/.env`)

| Variable | Description | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | Backend listen port | `4000` |
| `JWT_SECRET` | JWT signing secret (**change in production**) | `change-me` |
| `JWT_EXPIRES_IN` | Token validity | `7d` |
| `APP_PRODUCT_MODE` | Product mode `full`/`scada`/`data` | `full` |
| `INFLUXDB_URL` | Time-series DB address (optional) | — |
| `INFLUXDB_TOKEN` / `ORG` / `BUCKET` | Time-series DB auth and bucket | — |
| `LOG_LEVEL` | Log level `debug`/`info`/`warn`/`error` | `debug` |

### 6.2 Frontend Environment Variables (`ss-editor/apps/web/.env*`)

| Variable | Description | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Backend API address | `http://localhost:4000` |
| `VITE_WS_URL` | WebSocket address | `ws://localhost:4000` |
| `VITE_DEBUG_SKIP_AUTH` | Dev only: skip login auth | `false` |

---

## 7. Data Storage & Backup

- **Metadata DB**: global metadata is stored in `ss-node.db`; each project's data is stored in project isolation under `{projectDir}/db/system.db` (both SQLite, auto-created on first startup).
- **Time-series data**: stored in the corresponding Bucket once InfluxDB is enabled.
- **Backup**:
  - SQLite: stop the service (or under WAL mode) and copy the `.db` file; periodic archiving recommended.
  - InfluxDB: use `influx backup` for offline / online backup.
- **Restore**: replace the corresponding `.db` / restore the Bucket with the backup file.

---

## 8. Upgrade

1. Pull the new version code;
2. Reinstall dependencies (`pnpm install`);
3. Run the build (see Section 4);
4. Replace the frontend `dist` and backend `dist`;
5. Restart the service.
6. **Back up the database before upgrading** (see Section 7). Database schema migration is handled by TypeORM synchronize / migration.

---

## 9. Monitoring & Logs

- **Health check**: probe via the backend readiness endpoint or process monitoring.
- **Logs**: verbosity is controlled by `LOG_LEVEL`; production recommends `info`/`warn`; logs can go to stdout or a file, integrated with a log collection system.
- **Frontend**: issues can be diagnosed with the browser console and network panel.

---

## 10. Security Recommendations

- **Change `JWT_SECRET`**: in production, replace it with a high-entropy random value.
- **Enable HTTPS**: terminate TLS at the Nginx / reverse proxy layer.
- **Network isolation**: only open necessary ports; never write important business data to the demo site.
- **Least privilege**: assign permissions by role (admin / user / viewer).

---

## 11. FAQ

- **Port conflict**: confirm `PORT` / `VITE_PORT` is not occupied, or adjust the corresponding `.env`.
- **SQLite database lock**: ensure single-process access, or enable WAL mode; check for other processes holding the `.db`.
- **InfluxDB connection failed**: verify `INFLUXDB_URL` / `TOKEN` / `ORG` / `BUCKET`.
- **Device connection failed**: check network connectivity and protocol parameter config, and review device status logs.
- For more troubleshooting, see [04 - Troubleshooting](./04-troubleshooting.md).
