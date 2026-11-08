# dsh-artex

把 [ARTEX](https://github.com/jiwoochris/artex-global)（LLM 多智能体自主渗透测试系统，Go 单二进制 + Next.js 前端 + PostgreSQL）接进 DeepSeek Harness 的插件。

插件只做**本机运行环境**的事：拉源码、编译、建本地库、启停、看日志、自检。它自己不发起任何扫描或利用动作——具体测试行为由 ARTEX 的 agent 在用户给定的范围内执行。

> ⚠️ 上游 `Autumn-27/ARTEX` 已下线（2026-10 前后仓库不可见）。本仓库固定的是仍维护的同源镜像 `jiwoochris/artex-global`（English/KO/ZH/ES/JA 五语，AGPL-3.0，保留上游模块路径 `github.com/Autumn-27/artex`）。`artex_setup` 内置了镜像回退链，见文末「换源」。

## 安装

```powershell
# 在仓库根目录
pwsh -File .\install-artex-plugin.ps1                 # 装进 Web 版（profile web）
pwsh -File .\install-artex-plugin.ps1 -Profile xxx    # 装进别的 profile
pwsh -File .\install-artex-plugin.ps1 -Profile desktop -DshHome C:\Users\<你>\.dsh   # 桌面版
```

Web 版脚本等价于：

```powershell
$env:DSH_HOME = '<repo>\deepseek-harness\.dsh'
dsh plugin --profile web add link:<repo>\dsh-artex
```

桌面版 profile 被 Electron 独占（`dsh plugin` 会报 `managed exclusively by the Electron application`），
脚本改成「写 package.json + 在 profile 的 `node_modules` 里建 junction」，效果一样。
桌面版会热加载 profile 配置（改完 `cordis.patch.yml` 触发重载），一般不用重启。

Web 版装完**重启该 profile 的 DSH**：配置在进程启动时合成，热装不会凭空长出工具。

## 斜杠命令

输入框敲 `/ar` 应补全出 `/artex`（不起模型消息，直接对宿主执行）：

| 命令 | 作用 |
|---|---|
| `/artex` 或 `/artex status` | 状态 |
| `/artex doctor` | 依赖自检 |
| `/artex run <任务说明>` | 新建任务并让 ARTEX 的 planner/worker 直接开跑 |
| `/artex tasks` / `/artex task <id>` | 任务列表 / 详情 |
| `/artex pause <id>` / `/artex resume <id>` | 暂停 / 恢复任务 |
| `/artex start` / `/artex stop` / `/artex restart` | 启停 |
| `/artex logs [行数] [server\|build\|pg]` | 日志 |
| `/artex setup [clone\|build\|db\|all]` | 拉取/构建/建库 |
| `/artex login <密码>` | 在 UI 里改过管理员密码后，更新本地凭据 |
| `/artex help` | 帮助 |

命令注册失败会退回 `/artex-cmd`；装载回执 `plugin-loaded.json` 的 `commands` 字段能直接看出注册成了什么。
界面里看不到 `/artex` 就先刷新窗口（Ctrl+R）；仍没有，确认当前窗口用的是哪个宿主——Web 版与桌面版各有一份 profile。

冷启动时 bundle 被跳过，先看宿主 stderr 里的 `skipping profile bundle "dsh-artex": …`：最常见的是 `package.json` 带了 UTF-8 BOM（`SyntaxError: Unexpected token '﻿'`）——用无 BOM 的 UTF-8 重存再重启。旧版 Windows PowerShell 的 `Set-Content -Encoding UTF8` 会写 BOM，改 JSON 时注意。

## 一句话开跑

```
/artex run 对 http://127.0.0.1:3000 做本地靶场测试，只做信息收集与常见 Web 漏洞验证
```

插件会：没起服务就先起 → 确认引擎有可用 LLM → `POST /api/tasks` 建任务（`seed_first_intent=true`，worker 不用等首轮规划）→ 返回任务号与详情页链接。
ARTEX 自己拆目标、跑工具、把资产/漏洞记进图；进度在 `http://127.0.0.1:8787/function/tasks/detail?id=<id>`。

## 工具

| 工具 | 作用 |
|---|---|
| `artex_status` | 安装 / 构建 / 运行 / 版本 / 数据库 / 健康接口，并给下一步建议 |
| `artex_doctor` | 依赖链自检：源码、产物、Go/Node/npm/Git、PostgreSQL 工具与库可达性、服务健康 |
| `artex_setup` | `action=clone\|build\|db\|all`：克隆（带镜像回退）、编译前端 + Go 二进制、建本地 PostgreSQL 集群 |
| `artex_start` | 启动服务（前端已内嵌），可选 `addr`/`proxy`/`dsn`，等健康检查通过再返回地址 |
| `artex_stop` | 按 pid 文件 / 端口找到进程并连同子进程树一起结束 |
| `artex_logs` | 读 `server` / `build` / `pg` 三类日志的尾部 |
| `artex_task` | `create/list/get/pause/resume`：让模型也能建任务、看进度、暂停恢复 |

## 配置

profile 的 `cordis.patch.yml` 里覆盖同 id 行即可（bundle 自带默认值）：

```yaml
- id: dsh-artex
  config:
    addr: 127.0.0.1:8787
    proxy: 127.0.0.1:8788
    dsn: ''              # 空 = 用 .artex-runtime/dsn.txt 或本机自建集群
    pgBin: ''            # 空 = 自动找 PATH / C:\Program Files\PostgreSQL\*\bin
    autoStart: false     # 宿主启动时是否顺带拉起 ARTEX
    healthTimeoutMs: 90000
    auth:
      password: ''       # 空 = 自动生成，写在 .artex-runtime/auth.json
    llm:
      enabled: true
      provider: anthropic
      model: deepseek-v4.1-flash
      baseUrl: https://opencode.ai/zen/go
      apiKeyName: OPENCODE_GO_API_KEY   # 会自动去项目 .env / 当前 DSH_HOME 找
      headers:                          # 非空时起本机转发补头（OpenCode Go 要 x-opencode-session）
        x-opencode-session: artex
```

- 管理员密码：首次启动由 `ARTEX_ADMIN_PASSWORD` 直接初始化，密码在 `artex/.artex-runtime/auth.json`；setup token 也固定在那里。UI 里改过密码后，用 `/artex login <新密码>` 同步。
- LLM key 查找顺序：`llm.apiKey` → `llm.apiKeyEnv` 指向的环境变量 → 项目 `deepseek-harness/.dsh/.env` → `$DSH_HOME/.env` 或 `.credentials.yaml` → `~/.dsh` 同名文件。
- 带 `headers` 时，插件会以独立子进程起 `bin/llm-proxy.mjs`（`127.0.0.1:56251` 起自动挑端口），ARTEX 的 base URL 指向它；key 仍由 ARTEX 自己带在请求里，只落在内存。

完整默认值在 `lib/artex.js` 的 `DEFAULTS`。

## 目录

| 路径 | 内容 |
|---|---|
| `artex/`（仓库根） | ARTEX 源码（git submodule，浅克隆） |
| `artex/artex.exe` | 编译产物（未入库） |
| `artex/.artex-runtime/` | pid、日志、`config.json`、`dsn.txt`、`auth.json`、LLM 转发 pid、本地 PostgreSQL 集群（未入库） |

## 自测

不经过 DSH，先验证内核：

```powershell
node dsh-artex\bin\artex-dsh.mjs doctor      # 依赖自检
node dsh-artex\bin\artex-dsh.mjs setup all   # 克隆 + 构建 + 建库
node dsh-artex\bin\artex-dsh.mjs start       # 启动并等健康检查
node dsh-artex\bin\artex-dsh.mjs status
node dsh-artex\bin\artex-dsh.mjs stop
node dsh-artex\test\smoke.mjs                # 注册 + 输出契约测试
```

经过 DSH 验证（本轮实测用的就是这个）：

```powershell
$env:DSH_HOME = '<repo>\.artex-test-home'
$dsh = '<repo>\deepseek-harness\node_modules\.bin\dsh.cmd'

# 一次性准备：从模板复制一个 headless profile，再装插件
& $dsh --profile artex-hl --from-default-profile headless
& $dsh plugin --profile artex-hl add link:<repo>\dsh-artex
# 再给这个 profile 配好模型（cordis.patch.yml 的 llm-pi-ai / agent-default-model）

& $dsh artex-hl '调用 artex_status 工具，把返回内容原样贴出来'
```

`artex-hl` 是从 `headless` 模板复制、再 `dsh plugin add link:<repo>\dsh-artex` 的测试 profile。
插件加载后会在 `<repo>\artex\.artex-runtime\plugin-loaded.json` 写一份回执（pid、装载时间、工具清单），
不依赖模型是否会调用工具，也能确认「插件已挂载」。

## 换源 / 找不到 ARTEX 时

`artex_setup(action="clone")` 按顺序尝试：

1. `jiwoochris/artex-global`（本仓库固定源，维护中）
2. `BaaRai/ARTEX`、`Hinln/ARTEX`、`RuoJi6/ARTEX`（同源镜像/备份）
3. `Autumn-27/ARTEX`（上游，已下线，仅占位）

都不通时的同能力替代（人工放置源码到 `artex/` 也行）：

| 工具 | 关系 |
|---|---|
| `bluechips-zhao/DITING`（谛听） | 基于 ARTEX 的工作台（Go + Next.js + PostgreSQL） |
| `AntiFox-AI/antifox` | 基于 ARTEX 的多智能体渗透平台 |
| `Ernket/CodeScan-Artex` | ARTEX 二开，偏代码审计 |
| `IlyassCODEX/ARTEX` | 另一个独立实现（Python，Web 安全分析） |

## 常见问题

- **Windows 下 `npm run build:static` 失败**：脚本体是 POSIX 写法（`NEXT_EXPORT=1 next build`），cmd 不认。插件已改成直接调 `next/dist/bin/next`，无需手动处理。
- **`npm ci` 漏装 devDependencies**：`NODE_ENV=production` 时 npm 会跳过 devDeps，前端构建会因为缺 `@tailwindcss/postcss` 失败。插件固定带 `--include=dev`。
- **端口被占**：自建 PostgreSQL 会自动挑空闲端口（从 55460 起）；想固定就设 `pgPort`。
- **首次访问要设置管理员密码**：ARTEX 首次启动会把 setup token 打在日志里（`artex_logs` 能看到），到 `/setup` 页填入。
