# Smart Site · User Manual

> Audience: engineers, operators, and managers who use this platform for configuration screen editing, device onboarding, and data visualization operations.
> This document focuses on "how to use". For installation and deployment, see [Deployment & Ops](./06-deployment-ops.md); for source development and extension, see [Developer Guide](./README.md).

---

## 1. Platform Overview

Smart Site is an industrial configuration and data visualization platform, providing two main entry points:

| Entry | Path | Purpose |
| --- | --- | --- |
| Configuration Editor | `/editor` | Drag-and-drop monitoring screen editing, element binding, data linkage |
| Data Platform | `/system` | Device management, data tags, data sources, alarms, reports, scripts |

Core capabilities: drag-and-drop configuration editing, element-to-data binding, industrial protocol acquisition (Modbus / OPC UA / MQTT / S7 / virtual), data tags and templates, alarm engine, script engine, multilingual i18n (Chinese / English).

---

## 2. Login & Accounts

- **Self-hosted access**: open `http://<host>:<frontend-port>/system` or `/editor` in a browser (see [Deployment & Ops](./06-deployment-ops.md) for ports).
- **Demo site**: <https://smartsite.top/>, test account `test` / password `test` (public shared instance—do not write important business data).
- **First startup**: when the database is uninitialized, opening the frontend guides you into the **setup wizard**; create the `admin` account first to log in.
- **Role-based access (RBAC)**: `admin` / `user` / `viewer`, assigned with least privilege.
- **Language switch**: the UI supports switching between Chinese / English (via vue-i18n).

---

## 3. Configuration Editor (`/editor`)

### 3.1 Project Management

- Create / open / delete projects; a project can contain multiple **pages**.
- Supports project **import / export** (project package, for migration and backup).

### 3.2 Screen Editing

- Canvas is rendered with Konva, supporting zoom, grid, alignment guides, layer management, undo / redo.
- Drag elements from the **element library** onto the canvas; elements can be repositioned, resized, rotated, and re-layered.
- The element library is grouped by plugin. Common groups:
  - `basic`: basic shapes, text, buttons, input boxes, etc.
  - `chart`: ECharts-based charts (line, bar, pie, etc.)
  - `industrial`: industrial controls (gauges, valves, pipes, etc.)
  - `electric`: electrical symbols

### 3.3 Element Binding & Data Linkage

- Select an element → bind a **data tag (datatag)** or device measurement point in the **properties panel**.
- Real-time values can be displayed as text / color / visibility: thresholds and expressions can be configured for linkage.
- Event interactions: click to jump to a page, open a dialog, trigger a script, etc.

### 3.4 Preview & Publish

- Preview the running result via `/preview`.
- After saving, publish as a runtime screen accessible from the data platform or frontend.

---

## 4. Data Platform (`/system`)

### 4.1 Device Management

- CRUD on devices, group management.
- Real-time **connection status** monitoring: online / offline / abnormal.
- Acquisition protocol config: Modbus (TCP/RTU), OPC UA, MQTT, S7, virtual (simulated), etc.

### 4.2 Data Tags (datatag)

- Bind device measurement points; define name, unit, data type, acquisition period.
- Data tags are the **data source** bound to elements, the key object linking "acquisition—display".

### 4.3 Data Sources (datasource)

- Connect external data sources (database / API) to extend data origins.

### 4.4 Alarm Management

- Configure alarm **rules** (thresholds / conditions) and alarm levels.
- Alarm **acknowledge / clear**; on trigger, pushed to the frontend in **real time** via WebSocket.

### 4.5 Reports (report)

- Generate reports on a schedule or manually; data comes from data tags / historical data.

### 4.6 Script Engine (script)

- Write custom calculation / linkage scripts to extend business logic.

---

## 5. Real-Time Data

- The frontend receives real-time pushes via WebSocket (Socket.IO); **no refresh needed** to see real-time values, alarms, and device status changes.
- Subscription granularity is per **project** (room isolation), ensuring data isolation and security.

---

## 6. Usage Tips & Notes

- The demo site / demo data are **simulated**, with no real process or business data—do not write important information.
- Each project's data is **stored in project isolation**, facilitating parallel multi-project management.
- It is recommended to first get familiar with the editor and data-linkage flow via "Import Sample Project".

---

## 7. FAQ

- Cannot log in / API 401: verify account/password and whether the JWT has expired; in dev you may refer to the frontend `VITE_DEBUG_SKIP_AUTH`.
- Real-time data not refreshing: check the WebSocket connection (whether the network / proxy allows `/socket.io`).
- Device offline: check network and protocol parameter config; see [Deployment & Ops · FAQ](./06-deployment-ops.md#常见问题) and [04 - Troubleshooting](./04-troubleshooting.md).
