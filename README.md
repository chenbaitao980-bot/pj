# pojia

破甲 · DSH（DeepSeek Harness）一键安装与配套工作流合集。

本仓库汇总本机部署 DeepSeek Harness 所需的安装脚本、配置说明、配套插件与工具链，方便在新机器上一键复现。

## 冻结版 0.2.2-rc.1（本次更新）

| 入口 | 说明 |
|---|---|
| `DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe` | 单文件离线安装包（418 MB），内含宿主 + 插件 + 技能 + MCP + 便携 PostgreSQL |
| `README-冻结版安装包.md` | 安装 / 升级 / 自检 / 按工作区开关插件 / 重新打包 |
| `VERSION-DIFF-0.2.1-rc.5-vs-0.2.2-rc.1.md` | 与官方最新版的逐项差异（26 个新包、主进程重写、CLI 变化） |
| `frozen-build-src/` | 构建与运维脚本：`Build-FrozenSetup.ps1`、`install.ps1`、`Launch.ps1`、`Upgrade.ps1`、`Plugin-Scope.ps1`、`Doctor.ps1`、`Repair-Plugins.ps1` |
| `skill-packs/dsh-skill-trellis` | Trellis 2.0.0：SessionStart 注入 + 缺 `.trellis` 自动初始化 |
| `skill-packs/dsh-mcp-gitnexus` | GitNexus MCP 插件（默认启用 + 自动建索引 + 按工作区开关） |
| `skill-packs/dsh-mcp-codegraph` | CodeGraph MCP 插件（默认启用 + 自动建索引 + 按工作区开关） |

> 旧版 `DeepSeek-Harness-Frozen-Setup.exe`（0.2.1-rc.5）保留用于回滚。

## 目录结构

| 路径 | 说明 |
|---|---|
| `install-dsh.ps1` | DSH 主体安装脚本（Node/pnpm 环境 + npm 包安装） |
| `install-desktop.ps1` | 桌面版安装脚本（Electron 外壳 + 快捷方式） |
| `install-artex-plugin.ps1` | 把 ARTEX 插件装进指定 DSH profile（link + 选中 bundle） |
| `start-dsh.ps1` | Web 版启动脚本 |
| `README-安装说明.md` | 安装与使用说明（Web 版 / 桌面版双宿主机配置） |
| `ref.sha256` | 安装包校验值 |
| `deepseek-harness/` | DSH 运行目录（配置、插件 profile、启动脚本；依赖与凭据不入库） |
| `dsh-purge/` | dsh-purge 插件（submodule，上游 `HunYiSage/dsh-purge`） |
| `dsh-artex/` | ARTEX 插件（本仓库自研：拉取/构建/建库/启停/日志/自检/建任务，7 个 DSH 工具 + `/artex` 命令） |
| `artex/` | ARTEX 源码（submodule，同源镜像 `jiwoochris/artex-global`；上游已下线） |
| `minglink-workflows/` | 工作流插件合集（含 `dsh-workflows` submodule，上游 `Minglink/dsh-workflows`） |
| `rea/` | REA 逆向分析工具源码 |
| `.agents/skills/artex-setup/` | DSH 技能：ARTEX 安装/构建/接模型/排障的完整 runbook |
| `.claude/skills/` | Claude Code 技能：`dsh-install` |

## 未入库内容

以下内容体积大或含敏感信息，已在 `.gitignore` 中排除，需要时按脚本重新下载：

- `ghidra/ghidra.zip`（Ghidra 发行包）
- `desktop-installer/dsh-latest-windows-x64.exe`（桌面版安装包）
- `rea-test/out.json`（测试输出）
- `artex/artex.exe`、`artex/web/out/`（ARTEX 构建产物）
- `artex/.artex-runtime/`（ARTEX pid、日志、本地 PostgreSQL 集群）
- `node_modules/`、`*.zip`、`*.exe` 等依赖与二进制
- `deepseek-harness/.dsh/` 下的凭据、会话、日志、缓存

## 快速开始

```powershell
# 1. 克隆（含子模块）
git clone --recursive https://github.com/chenbaitao980-bot/pojia.git
cd pojia

# 2. 安装 DSH
pwsh -File .\install-dsh.ps1

# 3. 启动 Web 版
pwsh -File .\start-dsh.ps1
```

Web 版配置目录为 `<repo>/deepseek-harness/.dsh`，桌面版配置目录为 `%USERPROFILE%\.dsh`，两者互不相通，详见 `README-安装说明.md`。

## ARTEX（自主渗透测试系统）

上游 `Autumn-27/ARTEX` 已下线，本仓库拉的是仍在维护的同源镜像 `jiwoochris/artex-global`（AGPL-3.0），并通过 `dsh-artex` 插件接进 DSH。

```powershell
# 1. 安装插件（link 到 profile 并选中 bundle）
pwsh -File .\install-artex-plugin.ps1

# 2. 重启该 profile 的 DSH，然后在会话里让模型执行：
#    artex_setup(action="all")   → 克隆（含镜像回退）+ 编译前端/Go + 建本地 PostgreSQL
#    artex_start                 → 启动，返回 http://127.0.0.1:8787
#    artex_status / artex_logs   → 状态与日志

# 也可以完全绕开宿主，用命令行自测：
node dsh-artex\bin\artex-dsh.mjs doctor
node dsh-artex\bin\artex-dsh.mjs setup all
node dsh-artex\bin\artex-dsh.mjs start
```

细节（工具表、配置项、镜像回退链、同能力替代）见 `dsh-artex/README.md`。
