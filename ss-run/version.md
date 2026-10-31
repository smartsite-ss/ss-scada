# Smart Site (ss-scada) Release History / 发布历史

> 本文档为历史发布说明汇总。新版本发布时在「发布记录总表」中追加一行，并在下方追加该版本的详情章节。
> This document is the cumulative release history. Append a row to the summary table on each release,
> then add a detail section below.

## 发布记录总表 / Release Summary

| 版本 Version | 日期 Date | Commit | 产物 Artifact | 档位/端口 Tier/Port | 自测试 Self-Test | 发布说明 Summary |
| --- | --- | --- | --- | --- | --- | --- |
| 1.0.0 | 2026-10-26 | `d0c91d0` | `04-win-node.zip` 269.1 MB | lite / 4200 | PASS (health 200) | 首次发布：单包自包含发布打包器落地；修复生产空库首启迁移链；默认账号 admin/test 播种。First release: single-package publisher; fixed empty-DB migration boot chain; seeded default accounts. |

---

## 1.0.0 — 2026-10-26

### 元信息 / Metadata

| 项目 Item | 值 Value |
| --- | --- |
| 版本 / Version | 1.0.0 |
| 发布日期 / Release date | 2026-10-26 |
| 代码状态 / Code state | commit `d0c91d0` (master) |
| 产物 / Artifact | `ss-run/ss-win/04-win-node.zip`（269.1 MB）+ `.sha256` |
| SHA-256 | `d2b456294608070d260e9bbf824791f436fce9cf9c80e2797515d2c6d9d1d956` |
| 随包运行时 / Bundled runtime | Node.js v24.18.0（`node/node.exe`，目标机免装 Node） |
| 自测试 / Self-test | PASS — health 200（10s）· 首页 200 · SPA 深路由 200（lite-staged, 4200） |

### 变更要点 / Highlights

| # | 变更 / Change | 类型 / Type |
| --- | --- | --- |
| 1 | 单包发布打包器 `bin/publish-smart-site.cjs`（自包含目录 + zip + sha256 + Windows 服务脚本 + 打包自测试）/ Single-package publisher (self-contained folder + zip + sha256 + service scripts + packaging self-test) | feat |
| 2 | 生产空库首启迁移链修复：`InitialSchema` 按权威 schema dump 重生成（49 表 / 46 索引，全幂等）；4 个中间迁移加存在性防御；启动期 Phase 1.5 迁移执行器 / Fixed empty-DB boot chain: `InitialSchema` regenerated from authoritative dump (49 tables / 46 indexes, idempotent), existence guards on intermediate migrations, Phase 1.5 migration runner | fix |
| 3 | schema dump 工具归档 `bin/dump-schema.cjs`；发布产物目录加入 `.gitignore` / Schema dump tool archived; release artifacts gitignored | chore |

### 包形态 / Package Profile

| 项目 Item | 值 Value |
| --- | --- |
| 产品模式 / Product mode | full（组态编辑器 + 数据中台 / editor + data platform） |
| 档位 / Tier | lite — `REDIS_HOST` 留空，`HISTORICAL_DATA_BACKEND=sqlite`（零外部服务 / zero external services） |
| 形态 / Form | 自包含 / self-contained（所有路径指向包内，整目录可搬迁 / all paths inside the package） |
| 数据 / Data | 随包 `data/` 仅代码资产；排除 `images/` `images-lg/` `projects/` / code assets only, media excluded |
| 基础服务 / Base services | 不随包（lite 档无需 Redis / InfluxDB / NanoMQ / not bundled, not required） |

### 部署 / Deployment

1. 拷贝整个 `04-win-node/` 目录或解压 zip 到目标机 / Copy the folder (or unzip) to the target machine
2. 校验（可选）/ Verify (optional): `certutil -hashfile 04-win-node.zip SHA256`
3. 运行 `start.bat`（免安装、免管理员权限 / no install, no admin rights）
4. 打开 `http://localhost:4200/` 登录 / Open and log in
5. 健康检查 / Health check: `http://localhost:4200/api/v1/system/health`
6. 目标机预检 / Pre-check: `self-test.bat`；服务模式 / Service mode: `install-service.bat` / `uninstall-service.bat`

### 默认账号 / Default Accounts

| 用户名 Username | 密码 Password | 角色 Role | 说明 Notes |
| --- | --- | --- | --- |
| `admin` | `admin` | admin | 超级权限 `*:*`，**首次登录后立即改密** / full permissions, change password immediately |
| `test` | `test` | user | 演示/测试普通用户 / demo & testing |

> 今后以 `--no-user-data` 打出的新包用户表为空：首启走 setup 向导，或交付前手工播种 /
> Future `--no-user-data` packages start with an EMPTY user table: use the setup wizard on first
> launch, or seed accounts before delivery.

### 已知限制 / Known Limitations

- 独立插件热更新发布（`build:plugins` 产物 + importmap 单例）暂不可用，插件随 web 应用构建打包 / Standalone plugin hot-update publishing not available; plugins bundled into web build
- `capability.json`（AI 页面生成组件快照）未随包，仅影响 AI 页面生成器 / AI page-generation snapshot not bundled; normal runtime unaffected
- lite 档历史数据存 SQLite，适合中小规模，不适合长期高频归档 / SQLite historical storage fits small/medium deployments, not long-term high-frequency archiving

---

<!-- 新版本详情追加到这里 / Append new release details here -->
