📖 简体中文 | 📖 [English](#-english-summary)

# 🌈 Smart Site — 开源 SCADA 组态软件与工业数据可视化平台

Smart Site 是一套面向工业场景的开源 SCADA 平台：**组态编辑器（HMI / SCADA Editor）+ 数据中台 + 后端服务**一体化。支持拖拽式监控画面编辑、设备数据采集（Modbus / OPC UA / MQTT / Siemens S7）、数据标签与模板、报警引擎、脚本引擎、报表、时序数据存储与多语言国际化。

> ✨✨✨ **在线演示** ✨✨✨
>
> - **访问地址**：<https://smartsite.top/>
> - **测试账号**：`test` / `test`（登录即可体验组态编辑器与数据中台全部功能）
>
> 演示站点为公开共享实例，工艺画面与数据均为模拟产生，仅用于功能体验，请勿写入重要业务数据。

如果这个项目对您有帮助，欢迎点一个 **Star** ⭐️ 支持，您的关注是我们持续更新的动力 🚀

---

## 🎯 Smart Site 想解决什么？

针对传统组态软件的五大痛点，逐一给出答案：

| 传统组态软件的痛点 | Smart Site 的答案 |
| --- | --- |
| **点位授权**：按点数收费，项目越大成本越高 | 开源免费（Apache-2.0），**无点位数限制**，无授权锁 |
| **信创支持**：依赖 Windows + IE / ActiveX，国产化适配困难 | 全栈 Web 技术栈（Node.js + Vue3），支持 **Linux 部署与国产化环境**，浏览器即用，无 ActiveX 依赖 |
| **使用复杂**：工程管理器、IO 服务器、组态编辑器、组态运行器、历史数据服务器……多进程多组件，安装运维成本高 | **单包一体化**：采集、组态、运行、历史库融为一体，解压即用（Windows 单包 / Docker），双击 `start.bat` 上线 |
| **Web 能力不完整**：仅客户端所见即所得，Web 端发布效果打折 | **原生 Web 架构**：编辑器与运行端均基于浏览器，**所见即所得**，桌面 / 移动端一致体验 |
| **扩展性封闭**：闭源黑盒，AI 时代难以集成与二次开发 | 面向 AGI 时代的模块化设计——**统一为先、简单至上**：数据采集插件化 + 进程隔离化，显示图元插件化 + 目录化，前后端脚本分离化，每个环节皆可独立扩展 |

同时覆盖组态工程的日常场景：

- 工厂 / 水厂 / 电厂 / 泵站等**监控大屏与 HMI 画面**的零代码组态搭建
- Modbus、OPC UA、MQTT、S7 等**多协议设备数据采集**与统一管理
- 设备数据的**实时监测、历史曲线与报警**（确认 / 恢复 / 分析）
- 行业模板与画布模板**复用**，快速复制同类工程

## ✨ 为什么选择 Smart Site？

| 能力亮点 | 说明 |
| --- | --- |
| 🎨 拖拽式组态 | 图元库（工业 / 电力 / SVG / 3D / 图表等）+ 画布模板 + 布局模板，所见即所得 |
| 🔌 多协议采集 | Modbus TCP/RTU、OPC UA、MQTT、Siemens S7、Virtual 模拟器，插件化扩展 |
| 📈 实时 + 历史一体 | WebSocket 实时推送、InfluxDB / SQLite 时序存储、历史曲线与聚合查询 |
| 🚨 完整报警引擎 | 报警规则 / 延迟消抖 / 确认清除 / 屏蔽 / 事件中心 / 告警数据分析 |
| 🧩 开放扩展 | 图元插件 SDK、脚本引擎（Monaco）、外部数据源、REST API + WebSocket |
| 📦 开箱即用 | Windows 单包发布（免安装免编译）、Docker 化部署、初始化向导 |

## ✨ 核心功能

| 功能模块 | 描述 |
| --- | --- |
| 组态编辑器 | 拖拽式画面编辑、图元数据绑定、动画 / 轮播 / 运行预览、多页面管理 |
| 图元与素材库 | 工业图元插件（分类启停）、动图 / PNG / 指示灯 / 开关按钮图库、画布 / 布局模板 |
| 数据中台 | 项目管理、页面管理、设备管理（设备树 / 分组 / 状态）、系统概览 |
| 设备采集 | 采集器插件管理、Pipeline 指标监控、设备模板点表库（DCS / PLC 行业模板） |
| 数据标签 | 点表配置、量程 / 死区 / 换算、数据类型与读写方向、实时值与质量 |
| 报警与事件 | 报警规则、报警记录（确认 / 清除 / 屏蔽）、事件历史、告警变量分析 |
| 脚本引擎 | Monaco 在线编辑、定时 / 事件触发、运行监控与审计 |
| 报表系统 | 报表方案、汇总与明细（行列透视）、Excel 导出 |
| 历史数据 | 多变量历史曲线、聚合间隔、查询方案保存 |
| 系统管理 | 用户 / 角色权限、菜单、审计日志、数据库运维、基础服务管理（启停 / 健康检查） |
| 国际化 | 中 / 英 / 繁多语言、明暗主题 |

## 🛠️ 技术栈

| 分层 | 技术 |
| --- | --- |
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Konva（画布渲染）· vue-i18n · Naive UI |
| 后端 | NestJS · TypeORM · SQLite / InfluxDB · Socket.IO · JWT + RBAC |
| 协议采集 | modbus-serial · node-opcua · mqtt · snap7 类 S7 驱动 · 虚拟模拟器 |
| 工程 | pnpm monorepo · Vitest / Jest · Playwright E2E · Windows 单包发布器 |

## 🏗️ 环境要求

| 环境 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18（建议 20 LTS） | 前后端构建与运行 |
| pnpm | ≥ 8 | 包管理器（monorepo 工作区） |
| 操作系统 | Windows / Linux | 开发与部署均支持 |
| InfluxDB 2.7+ | 可选 | 时序数据存储（不装则回落 SQLite） |
| Redis | 可选 | 实时数据缓存（不装则回落内存） |

## 🚀 快速开始

- **免安装体验（Windows）**：下载已打包版本，解压直接运行 → <https://smartsite.top/downloads/05-win-ss-en.7z>
- **源码部署**：完整的安装、启动、构建与部署指南 👉 [`docs/01-getting-started.md`](./docs/01-getting-started.md)（开发规范见 [`AGENTS.md`](./AGENTS.md)）

```powershell
# 源码启动（推荐使用 bin/ 脚本，勿直接 pnpm dev）
.\bin\start.bat        # 全栈：编辑器 5173 + 后端 3000
.\bin\start-data.bat   # 仅数据中台（前端 5175 / 后端 4000）
.\bin\start-scada.bat  # 仅组态编辑器（前端 5174 / 后端 4100）
```

## 🚨 版本说明：开源版与商业版

Smart Site 采用 **开源版 + 商业版** 双轨模式：

| | 开源版（本仓库） | 商业版 |
| --- | --- | --- |
| 授权 | Apache-2.0，免费商用（保留版权声明） | 商业授权，含品牌定制 / 去 Logo 授权 |
| 组态与采集 | 组态编辑器 + 数据中台 + 多协议采集，**全部核心功能** | 在开源版基础上按需扩展 |
| RAG 知识库 | — | ✅ 内置 RAG 知识库：工程文档 / 手册 / FAQ 的智能检索与问答 |
| 脚本能力 | 基础脚本（定时触发、在线编辑） | ✅ 前后端完整脚本能力：更丰富的 API 与触发方式、服务端任务编排 |
| AI 能力 | — | ✅ AI 接入深度集成：生成与优化工程数据（设备 / 点表 / 报警规则）、AI 生成组态页面 |
| 多语言 | 中 / 英文基础支持 | ✅ 多语言深度支持：语种扩展、术语库与翻译管理 |
| 服务 | 社区支持（Gitee / GitHub Issue） | 专属技术支持与 SLA、培训、定制开发 |
| 适用 | 个人学习、中小项目、产品验证 | 企业级交付、批量部署、行业深度定制 |

**商业合作 / 技术咨询联系方式**：

<table>
  <tr>
    <td align="center"><img src="docs/contact/official-account.jpg" width="258"/><br/><strong>微信公众号</strong><br/>产品动态与更新通知</td>
    <td align="center"><img src="docs/contact/video-account.jpg" width="258"/><br/><strong>视频号</strong><br/>产品演示与使用教程</td>
    <td align="center"><img src="docs/contact/developer-wechat.png" width="258"/><br/><strong>开发者微信</strong><br/>技术交流与商务咨询</td>
  </tr>
</table>

**联系电话**：15116488853（技术咨询与商务合作）

> 如果本项目对您有帮助，欢迎 **关注公众号与视频号**，并帮忙 **点赞、转发** 给更多有需要的朋友。

---

## 📖 English Summary

**Smart Site (SS)** is an open-source SCADA and industrial data visualization platform: a drag-and-drop HMI/SCADA editor, a data middle platform, and backend services in one solution.

**What problems it solves** (vs. traditional SCADA/HMI software):

1. **No point-count licensing** — free and open source, unlimited tags
2. **Xinchuang (domestic IT) ready** — full web stack (Node.js + Vue3), runs on Linux/browsers, no ActiveX/IE dependency
3. **Dramatically simpler** — acquisition, configuration, runtime and historian unified in one single package instead of multiple components (project manager / IO server / runtime / historian); unzip and run
4. **True web & WYSIWYG** — editor and runtime are both browser-native, consistent on desktop and mobile
5. **AGI-era extensibility** — modular by design ("unified first, simplicity first"): pluggable & process-isolated data collection, directory-based pluggable graphics primitives, separated front/back-end scripting

- **Online demo**: <https://smartsite.top/> (account `test` / password `test`)
- **Device acquisition**: Modbus TCP/RTU, OPC UA, MQTT, Siemens S7, plugin-based collectors
- **Core features**: HMI editor, data tags & device templates, alarm engine, script engine, reporting, historical trends, i18n (zh/en/zh-TW), light/dark themes
- **Tech stack**: Vue 3 + Vite + Konva / NestJS + TypeORM + SQLite/InfluxDB + Socket.IO
- **Quick start**: download the prebuilt Windows package (<https://smartsite.top/downloads/05-win-ss-en.7z>) and run `start.bat`, or build from source — see [`docs/01-getting-started.md`](./docs/01-getting-started.md)

### Editions: Open Source vs Commercial

| | Open Source (this repo) | Commercial |
| --- | --- | --- |
| License | Apache-2.0, free for commercial use (keep copyright notice) | Commercial license incl. white-label / logo removal |
| HMI & acquisition | Full core features (editor + data platform + multi-protocol acquisition) | Enterprise extensions on demand |
| RAG knowledge base | — | ✅ Built-in RAG: intelligent retrieval & Q&A over engineering docs / manuals / FAQ |
| Scripting | Basic scripts (timer triggers, online editing) | ✅ Full front & back-end scripting: richer APIs & triggers, server-side task orchestration |
| AI integration | — | ✅ Deep AI integration: generate & refine engineering data (devices / tags / alarm rules), AI-generated HMI pages |
| Multi-language | Basic zh / en support | ✅ Extended languages, terminology base & translation management |
| Support | Community (Gitee / GitHub issues) | Dedicated support & SLA, training, custom development |

**Contact**: 15116488853 · WeChat QR codes below · <https://smartsite.top/>

---

## 🖼️ 系统截图

以下为系统运行界面截图（图片位于仓库 `docs/screenshots/` 目录，对应线上演示站点 <https://smartsite.top/> 的实际界面，在 Gitee 上可直接查看），每张截图前附对应功能说明。

**01 · 组态编辑器：污水处理预沉池系统（画面编辑）** —— 顶部工具栏 / 左侧图元库 / 中央画布 / 右侧属性面板，拖拽式组态与数据标签绑定。

![界面截图 1](docs/screenshots/screenshot-01.png)

**02 · 画布属性与背景设置** —— 画布尺寸、背景图片 / 背景色、渲染模式（Canvas 原生渲染 / DOM 渲染）、视口选择与窗口联动；深色沉淀池工艺画面与实时数值。

![界面截图 2](docs/screenshots/screenshot-02.png)

**03 · 多语言界面（英文）** —— 编辑器支持中 / 英文切换；浅色主题下的预沉池工艺监控画面与背景应用色设置。

![界面截图 3](docs/screenshots/screenshot-03.png)

**04 · 自来水厂 SCADA 系统** —— 加氯系统工艺流程画面编辑：构筑物、管路、仪表等图元组合与实时参数标注。

![界面截图 4](docs/screenshots/screenshot-04.png)

**05 · 火电厂风烟系统画面** —— 风机、烟道、电机等工业图元，绑定电流 / 温度 / 压力等实时数据。

![界面截图 5](docs/screenshots/screenshot-05.png)

**06 · 变电站配电一次图** —— 母线与配电间隔图元，电压 / 功率等遥测数据实时监测。

![界面截图 6](docs/screenshots/screenshot-06.png)

**07 · 定时器与脚本引擎** —— 定时器触发器与间隔配置，Monaco 脚本编辑器（API 代码补全）与脚本调试面板。

![界面截图 7](docs/screenshots/screenshot-07.png)

**08 · 运行预览：压缩机 K101A** —— 发布后画面运行态，底部多页面轮播切换（6/24）。

![界面截图 8](docs/screenshots/screenshot-08.png)

**09 · 污水处理站监控工程（运行态）** —— 全厂工艺流程运行画面，多页面轮播浏览（5/24）。

![界面截图 9](docs/screenshots/screenshot-09.png)

**10 · 污水处理预沉池系统（运行态）** —— 预沉池 / 调节池 / 提升泵运行状态与 PH 等实时值（11/24）。

![界面截图 10](docs/screenshots/screenshot-10.png)

**11 · 1号机组发风烟系统（运行态）** —— 风机运行状态与电流 / 温度实时监测（17/24）。

![界面截图 11](docs/screenshots/screenshot-11.png)

**12 · 数据中台 · 系统概览** —— 设备统计（在线 / 离线 / 告警）、设备状态分布、最近报警活动与快捷入口。

![界面截图 12](docs/screenshots/screenshot-12.png)

**13 · 数据中台 · 项目管理** —— 项目卡片（状态 / 页面数 / 占用 / 版本），管理、设为默认、一键打开编辑器。

![界面截图 13](docs/screenshots/screenshot-13.png)

**14 · 数据中台 · 页面管理** —— 项目下页面缩略图列表，支持编辑 / 预览（24 个页面）。

![界面截图 14](docs/screenshots/screenshot-14.png)

**15 · 数据中台 · 设备管理** —— 设备树分组 + 设备卡片（协议 / 地址 / 采集周期 / 点表数 / 最新上传时间），在线状态与启停。

![界面截图 15](docs/screenshots/screenshot-15.png)

**16 · 设备详情 · 实时数据** —— 数据标签列表（地址 / 数据类型 / 读写 / 扫描周期 / 当前值 / 质量），WebSocket 实时推送、采集暂停 / 恢复、历史数据查看。

![界面截图 16](docs/screenshots/screenshot-16.png)

**17 · 设备详情 · 历史数据** —— 多变量历史曲线查询：时间范围、聚合间隔、自动刷新与查询方案保存。

![界面截图 17](docs/screenshots/screenshot-17.png)

**18 · 采集管理** —— 采集器插件卡片（计算量 / Modbus TCP·RTU / S7 PLC / Virtual / MQTT / OPC UA）：运行状态、消息与错误统计、停用 / 重启 / 监控、全局 Pipeline 监控。

![界面截图 18](docs/screenshots/screenshot-18.png)

**19 · 事件中心 · 历史事件** —— 报警记录列表（级别 / 告警类型 / 状态 / 处理方式），支持确认 / 清除 / 查看数据。

![界面截图 19](docs/screenshots/screenshot-19.png)

**20 · 告警变量数据分析** —— 告警前后时段曲线、上限线与告警点 / 恢复点标注。

![界面截图 20](docs/screenshots/screenshot-20.png)

**21 · 脚本管理** —— Monaco 在线脚本编辑与运行监控（状态 / 触发类型 / 定时执行：每分钟 · 每5分钟 · 每15分钟 · 每小时）。

![界面截图 21](docs/screenshots/screenshot-21.png)

**22 · 报表管理 · 报表汇总** —— 报表方案与聚合周期（按天），指标汇总卡片 + 行列透视，一键导出 Excel。

![界面截图 22](docs/screenshots/screenshot-22.png)

**23 · 报表管理 · 报表明细** —— 指标 × 日期矩阵明细，支持行列切换与导出。

![界面截图 23](docs/screenshots/screenshot-23.png)

**24 · 设备模板管理** —— 行业模板点表库（如中控 ECS-700 DCS）：点位 / 地址 / 数据类型 / 读写 / 扫描周期，按行业分类复用。

![界面截图 24](docs/screenshots/screenshot-24.png)

**25 · 组态管理 · 画布模板** —— 内置画布模板（报警中心 / 仪表盘 / 数据大屏 / 能源管理 BMS / 暖通机房 / 工业监控 / 登录页 / 移动端 H5 / OEE 看板等），一键套用。

![界面截图 25](docs/screenshots/screenshot-25.png)

**26 · 组态管理 · 布局模板** —— 系统布局模板（标准监控 / 大屏可视化 / 顶部导航 / 浅色看板 / 左侧导航），预览 / 编辑 / 属性配置。

![界面截图 26](docs/screenshots/screenshot-26.png)

**27 · 组态管理 · 图库（动图 GIF）** —— 风机、火焰等动图素材，支持分类管理与上传。

![界面截图 27](docs/screenshots/screenshot-27.png)

**28 · 组态管理 · 图库（工业 PNG 素材）** —— 泵、电机、罐体、管道等行业分类素材库。

![界面截图 28](docs/screenshots/screenshot-28.png)

**29 · 组态管理 · 图库（指示灯 / 信号灯素材）** —— 指示灯、报警灯等状态图元素材。

![界面截图 29](docs/screenshots/screenshot-29.png)

**30 · 组态管理 · 图库（开关 / 按钮素材）** —— 旋钮、ON/OFF 开关、按钮等交互素材。

![界面截图 30](docs/screenshots/screenshot-30.png)

**31 · 组态管理 · 图元插件管理** —— 按分类（基础 / 图表 / 工业 / SVG / 3D / 电力 / 矿产…）启停图元插件。

![界面截图 31](docs/screenshots/screenshot-31.png)

**32 · 系统管理 · 数据库运行** —— 系统库与各项目 SQLite（大小 / 表数量 / 备份时间），支持清空事件表 / 日志表、收缩数据库。

![界面截图 32](docs/screenshots/screenshot-32.png)

**33 · 系统管理 · 基础服务管理** —— Redis / InfluxDB / NanoMQ / Nginx 等基础服务的启停、重启、配置、日志与健康检查。

![界面截图 33](docs/screenshots/screenshot-33.png)

**34 · 系统管理 · 系统健康** —— 队列检查（数据库 / InfluxDB / 内存 / 磁盘）、CPU / 内存指标、磁盘分区与运行环境信息。

![界面截图 34](docs/screenshots/screenshot-34.png)

**35 · 采集管理 · Pipeline 指标监控** —— 采集总量 / 错误数 / 活跃连接 / 平均处理时间 / 运行时长，变量指标实时值与追踪查看。

![界面截图 35](docs/screenshots/screenshot-35.png)

---

## 许可证 / License

[Apache-2.0](./LICENSE)
