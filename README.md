# pojia

破甲 · DSH（DeepSeek Harness）一键安装与配套工作流合集。

本仓库汇总本机部署 DeepSeek Harness 所需的安装脚本、配置说明、配套插件与工具链，方便在新机器上一键复现。

## 目录结构

| 路径 | 说明 |
|---|---|
| `install-dsh.ps1` | DSH 主体安装脚本（Node/pnpm 环境 + npm 包安装） |
| `install-desktop.ps1` | 桌面版安装脚本（Electron 外壳 + 快捷方式） |
| `start-dsh.ps1` | Web 版启动脚本 |
| `README-安装说明.md` | 安装与使用说明（Web 版 / 桌面版双宿主机配置） |
| `ref.sha256` | 安装包校验值 |
| `deepseek-harness/` | DSH 运行目录（配置、插件 profile、启动脚本；依赖与凭据不入库） |
| `dsh-purge/` | dsh-purge 插件（submodule，上游 `HunYiSage/dsh-purge`） |
| `minglink-workflows/` | 工作流插件合集（含 `dsh-workflows` submodule，上游 `Minglink/dsh-workflows`） |
| `rea/` | REA 逆向分析工具源码 |
| `.claude/skills/` | Claude Code 技能：`dsh-install` |

## 未入库内容

以下内容体积大或含敏感信息，已在 `.gitignore` 中排除，需要时按脚本重新下载：

- `ghidra/ghidra.zip`（Ghidra 发行包）
- `desktop-installer/dsh-latest-windows-x64.exe`（桌面版安装包）
- `rea-test/out.json`（测试输出）
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
