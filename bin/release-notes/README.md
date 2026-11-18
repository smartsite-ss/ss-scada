# 发布说明覆盖文件（可选）

`bin\pack-release.bat <tag>` 会自动生成两份发布说明，并随包放到
`ss-run\ss-win\release\<tag>\`：

| 文件 | 用途 | 默认生成方式 |
| ---- | ---- | ------------ |
| `RELEASE-NOTES-en.md` | GitHub Releases（英文） | `VERSION.json` 事实表 + 资产清单 + `git log <上一tag>..<tag>` 提交列表 |
| `RELEASE-NOTES-zh-CN.md` | Gitee Releases（中文） | 中文版式 + 中文分组标题（新增功能/问题修复/…）；提交标题保留英文原文 |

如需**完整人工润色的中文发布说明**（推荐 Gitee 侧提供），在本目录放一个同名文件即可，
脚本会优先采用并复制到 stage 目录；也可通过 `--notes-zh=<文件>` 指定任意路径：

```text
bin/release-notes/v7.0.3.zh-CN.md     # Gitee 中文说明
bin/release-notes/v7.0.3.en.md        # GitHub 英文说明（可选）
```

优先级（两种说明各自独立）：

1. `--notes-en=<file>` / `--notes-zh=<file>`（`--notes=<file>` 同时指定两者）
2. `ss-run/ss-win/release/<tag>/RELEASE-NOTES-*.md`（上一次打包/发布留下的定稿）
3. `bin/release-notes/<tag>.<lang>.md`（本目录的覆盖文件）
4. 自动生成

> 注意：本仓库强制英文提交信息，所以自动生成的中文说明里"更新内容"条目仍是英文原文；
> 提供覆盖文件后即为全中文文案。覆盖文件是版本归档的一部分，建议随 tag 一起提交。

**覆盖文件请保留以下两块内容**（自动生成的版本会写入，手写的需要自己维护）：

- 注意事项：附件 >100 MB 请到官方站下载、运行数据在解压目录需先备份、端口占用按控制台提示或改 `start.bat`；
- 相关下载：带版本号的官方 zip 链接（`https://smartsite.top/downloads/ss-o/win-ss-<tag>.zip`，
  可用 `--download-base=<url>` 改前缀）、GitHub Releases 与 Gitee Releases 页面链接。
