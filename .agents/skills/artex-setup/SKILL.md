---
name: artex-setup
description: 在本机安装、构建、接模型、排障 ARTEX（LLM 多智能体自主渗透测试系统，Go + Next.js + PostgreSQL）以及它的 DSH 插件 dsh-artex。当用户说「装 ARTEX」「ARTEX 起不来」「/artex 没反应」「/artex 不出现」「ARTEX 没配模型」「重新编译 ARTEX」「数据库连不上」「桌面版插件没生效」「artex run 报错」时使用。
---

# ARTEX 安装与配置技能

把 ARTEX 从源码跑到能用 `/artex run` 开任务，覆盖：拉取、构建、本地 PostgreSQL、启动、LLM 注入、管理员凭据、DSH 插件装载、排障。

> 边界：ARTEX 是自主渗透测试系统。本技能只做**本机环境装配**；任何 `run`/扫描只允许指向用户自己有权测试的资产或本地靶场。

## 0. 参数速查

| 项 | 默认值 | 说明 |
|---|---|---|
| 源码 | `<repo>/artex` | submodule，上游 `Autumn-27/ARTEX` 已下线，用 `jiwoochris/artex-global` |
| 二进制 | `<repo>/artex/artex.exe` | `go build -tags embedui` 产物 |
| 运行目录 | `<repo>/artex/.artex-runtime` | pid、日志、auth.json、dsn.txt、pg 集群 |
| 服务地址 | `127.0.0.1:8787` | 前端 + API；`8788` 是流量录制代理 |
| 本地库 | `127.0.0.1:5546x` | 插件自建集群，端口从 55460 起挑 |
| 插件 | `<repo>/dsh-artex` | 工具 + 斜杠命令 |
| 管理员 | `ARTEX` | 密码在 `.artex-runtime/auth.json` |

## 1. 先判断操作哪个宿主

| 宿主 | DSH_HOME | profile | 安装方式 |
|---|---|---|---|
| Web 版 | `<repo>/deepseek-harness/.dsh` | `web` | `dsh plugin add link:…` |
| 桌面版 | `C:\Users\<你>\.dsh` | `desktop` | 手工改 package.json + junction（CLI 拒绝 desktop） |
| headless 测试 | 任意临时 home | 任意 | 复制模板后 `dsh plugin add` |

判断当前窗口：桌面版 Electron 的附件在 `C:\Users\<你>\.dsh\attachments`；Web 版在项目 `.dsh` 下。
**装错宿主 = 命令不出现**，先确认再动手。

## 2. 安装插件

```powershell
# Web 版（推荐，脚本幂等）
pwsh -File <repo>\install-artex-plugin.ps1
# 别的 profile
pwsh -File <repo>\install-artex-plugin.ps1 -Profile <名字>
```

桌面版（Electron 独占）：

```powershell
pwsh -File <repo>\install-artex-plugin.ps1 -Profile desktop -DshHome C:\Users\<你>\.dsh
```

它做两件事：

1. `profiles/<profile>/package.json`：`dependencies["dsh-artex"] = "link:<repo>/dsh-artex"`，并把 `dsh-artex` 追加进 `dsh.profile.bundles`
2. 桌面版额外在 `profiles/desktop/node_modules` 建 junction 指向插件目录

验证装载（不依赖 UI）：

```powershell
Get-Content <repo>\artex\.artex-runtime\plugin-loaded.json
# tools 应有 7 个，commands 应为 ["artex"]
```

没出现就先看宿主 stderr 的 `skipping profile bundle "dsh-artex": …`，再查第 8 节。

## 3. 构建 ARTEX（Windows 关键细节）

```powershell
cd <repo>\artex\web
$env:NODE_ENV='development'
npm ci --include=dev --no-audit --no-fund        # 缺 devDeps 会报 @tailwindcss/postcss 找不到
$env:NEXT_EXPORT='1'; $env:NODE_ENV='production'
node node_modules\next\dist\bin\next build       # 别用 npm run build:static：脚本体是 POSIX 写法，cmd 不认
robocopy out ..\server\webui\dist /MIR           # 或先删目录再复制，避免 dist/dist 嵌套
cd <repo>\artex
$env:CGO_ENABLED='0'
go build -tags embedui -ldflags "-X main.version=<版本>" -o artex.exe .\cmd\artex
```

也可以一条命令：

```powershell
node <repo>\dsh-artex\bin\artex-dsh.mjs setup all
```

Go 1.26.3+、Node 22+；`embedui` 标签必须有，否则前端不内嵌。

## 4. 本地 PostgreSQL

不需要手工装库，`artex_start` 会：

1. 找 `initdb/pg_ctl/createdb`（PATH → `C:\Program Files\PostgreSQL\*\bin`）
2. 在 `.artex-runtime/pg/data` 建集群（`--auth=trust --locale=C`）
3. 从 55460 起挑空闲端口，写 `dsn.txt`
4. `pg_ctl -D … -l … -w start` + `createdb artex`

**坑**：`pg_ctl` 会把 stdio 句柄交给 postgres，用管道收集输出会永远等不到 EOF。调用时必须 `stdio: 'ignore'`（插件已处理）。

已有现成库时用 `dsn` 覆盖：

```powershell
node <repo>\dsh-artex\bin\artex-dsh.mjs start --dsn "postgres://user:pass@host:5432/artex?sslmode=disable"
```

## 5. 启动 / 停止 / 日志

```powershell
node <repo>\dsh-artex\bin\artex-dsh.mjs doctor    # 依赖自检
node <repo>\dsh-artex\bin\artex-dsh.mjs start     # 起服务（含库自愈）
node <repo>\dsh-artex\bin\artex-dsh.mjs status
node <repo>\dsh-artex\bin\artex-dsh.mjs stop
node <repo>\dsh-artex\bin\artex-dsh.mjs logs --lines 100 --kind server
```

成功标志：

```
GET /api/health → {"ok":true,"service":"artex","version":"…"}
[engine] LLM configured from env: anthropic / <model>
```

停止只结束本插件拉起的进程；`shutdown` 不会带走别的宿主/CLI 起的服务（按 ownPid 判断）。

## 5.1 Windows：静默启动（消掉不停闪跳的黑窗）

**症状**：服务健康、任务在跑，但屏幕上每隔几秒闪跳一扇黑色窗口，标题形如
`管理员: C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`，并且标题一直在变。

**根因**：插件用 `spawn(binary, args, { windowsHide: true })` 起 ARTEX → **ARTEX 进程没有控制台**。
worker 每一步都 `exec` 一个控制台子进程（`powershell -NoProfile -NonInteractive -Command "cd …\tasks\…; python -u …"`），
没有父控制台可继承，每个子进程都要新建一个；而 Win10/11 的默认终端是 Windows Terminal，
系统就委托 `WindowsTerminal.exe -Embedding` / `OpenConsole.exe -Embedding` 为它开一扇新窗，
进程结束再关掉 ⇒ 屏幕上就是不停「跳动」。

**30 秒判定**（先确认是不是这条，别背锅给病毒）：

```powershell
$ax = (Get-CimInstance Win32_Process -Filter "Name='artex.exe'").ProcessId
# 没有 conhost 子进程 = ARTEX 自己没有控制台 = 命中
Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Where-Object { $_.ParentProcessId -eq $ax }
# 弹窗时间戳应与 worker 子进程时间戳逐个对齐
Get-CimInstance Win32_Process -Filter "Name='WindowsTerminal.exe'" | Select-Object ProcessId,CreationDate
```

`artex.exe` **有** conhost 子进程 ⇒ 不是这条，去查其它定时任务/守护脚本（重点看计划任务、Run 键、WMI 订阅）。

**修法：给 ARTEX 一个隐藏控制台，让全部子孙继承它**

不改 `artex.js`、不重编译：外层用 `Start-Process -WindowStyle Hidden` 起 `cmd`，`cmd` 再前台跑 `artex.exe`。
ARTEX 与所有子进程共用一个不可见控制台，系统不再新建窗口。

```powershell
$skill = "<repo>\.agents\skills\artex-setup"

# 生成 + 静默启动（推荐）
powershell -NoProfile -ExecutionPolicy Bypass -File "$skill\scripts\start-artex-silent.ps1" -Repo <repo>

# 只生成不启动：先看它会写什么
... -GenerateOnly      # 产出 <repo>\artex\.artex-runtime\start-hidden.cmd

# 已在跑、要换配置重启（会杀 artex + 残留外壳 cmd，再重起）
... -Force

# 或手工：脚本已生成时
Start-Process cmd.exe -ArgumentList '/c','"<repo>\artex\.artex-runtime\start-hidden.cmd"' -WindowStyle Hidden
```

脚本做的事（都不碰 ARTEX 源码）：DSN 取 `config.json` / `dsn.txt`；凭据取 `auth.json`；
LLM 配置**直接问插件**（临时 `.mjs` 里 `import { createArtex }` 取 `config.llm`）再用 profile 的
`cordis.patch.yml` 里 `- id: dsh-artex` 段覆盖；`llm.headers` 非空且转发没起时自动拉起
`bin/llm-proxy.mjs`。写完 `.cmd` 用 `Start-Process -WindowStyle Hidden` 起 `cmd`，等
`/api/health` 通过后把真实 artex PID 回写 `artex.pid`，并把外壳 PID 记进 `artex-shell.pid`。

`start-hidden.cmd` 的要点（脚本会按当前环境自动生成）：

- 必须 `set` 齐 `ARTEX_CONFIG / ARTEX_PG_DSN / ARTEX_SKILL_DIR / ARTEX_LANG /
  ARTEX_ADMIN_PASSWORD / ARTEX_SETUP_TOKEN / ARTEX_LLM_PROVIDER / ARTEX_LLM_MODEL /
  ARTEX_LLM_BASE_URL / ANTHROPIC_API_KEY`；缺 `ARTEX_PG_DSN` 会直接
  `database configuration not found` 退出（现象=`进程已退出，日志无新增`）
- 用 `>> artex.log 2>&1` 追加，`artex logs --kind server` 照常可读
- 起来后把**真实 artex PID** 写回 `.artex-runtime/artex.pid`，`status`/`stop` 才能对上
- 数据库要先在跑：`pg_ctl -D .artex-runtime\pg\data status`（`artex_stop` 若把 pg 一起带走，用
  `pg_ctl -D … -l … start` 拉回，55460 起来即可）

**验收**：恢复任务后连续观察 40 秒 —— 弹窗 0、ARTEX 子进程 > 0：

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'WindowsTerminal.exe','OpenConsole.exe' }   # 期望：空
Get-CimInstance Win32_Process -Filter "ParentProcessId=$ax"                                            # 期望：持续有 powershell
```

**六个坑（都踩过）**：

| 坑 | 现象 | 结论 |
|---|---|---|
| 想改 `artex.js`：把 `spawn(binary,…)` 换成用 PowerShell 包一层 | 外壳进程在，`artex.exe` 从没出现，日志不新增 | Node→PowerShell 的参数投递不可靠；**外壳要放最外层**（`Start-Process`），别塞在 spawn 里 |
| `Start-Process cmd -ArgumentList '/c','"…exe" -addr … >> log 2>&1'` | 引号被 PowerShell 吃掉一层，进程不启 | 命令行先落成 `.cmd` 文件，再 `cmd /c "文件"` |
| 用 `artex_start` 或 `artex-dsh.mjs start` 起 | 弹窗回来 | 这两条都走 `windowsHide:true` 老路径；要常驻静默就用 `start-hidden.cmd` |
| `.ps1` 存成 UTF-8 **无 BOM** | PowerShell 5.1 按 ANSI 读，中文注释把脚本读崩：`Unexpected token '…' in expression` | 存 UTF-8 **带 BOM**（本技能自带脚本已是）；或统一用 PowerShell 7 |
| 起脚本报 `无法将"pwsh"项识别为…` | 机器上只有 Windows PowerShell 5.1 | 用 `powershell -NoProfile -ExecutionPolicy Bypass -File …`，别硬写 `pwsh` |
| `-Force` 重启后残留多个隐藏 cmd 外壳 | `taskkill /T` 只杀子进程，杀不掉父级 cmd | 用脚本的 `-Force`（会顺手清 `start-hidden.cmd` 的 cmd）；手工时按命令行匹配 taskkill |

**功能完全不受影响**：env、`-addr/-data/-proxy` 参数、日志、pid、`artex_stop`（`taskkill /PID … /T /F` 杀整棵树）
全部照旧，只是多了一层隐藏控制台宿主。

## 6. 接 LLM（最容易被忽略的一步）

不配模型时任务能建但不会跑，日志是 `no LLM provider configured — engine idle`。

ARTEX 读环境变量：

```
ARTEX_LLM_PROVIDER=anthropic|openai
ARTEX_LLM_MODEL=<模型 id>
ARTEX_LLM_BASE_URL=<端点>
ANTHROPIC_API_KEY=… 或 OPENAI_API_KEY=…
```

插件在 `start()` 时注入，来源（按优先级）：

1. `dsh-artex` 配置的 `llm.apiKey`
2. `llm.apiKeyEnv` 指向的环境变量
3. `<repo>/deepseek-harness/.dsh/.env`
4. `$DSH_HOME/.env` / `$DSH_HOME/.credentials.yaml`
5. `~/.dsh/.env` / `~/.dsh/.credentials.yaml`

**OpenCode Go 这类聚合端点**会强制 `x-opencode-session` 头，ARTEX 不会发。插件的做法：`llm.headers` 非空时用独立子进程起一个本机转发（`bin/llm-proxy.mjs`，默认从 56251 起挑端口），ARTEX 的 base URL 指向它，代理补头后转发；key 仍由 ARTEX 自己带在请求里，不落盘。

配置写在 profile 的 `cordis.patch.yml`：

```yaml
- id: dsh-artex
  config:
    llm:
      enabled: true
      provider: anthropic
      model: deepseek-v4.1-flash
      baseUrl: https://opencode.ai/zen/go
      apiKeyName: OPENCODE_GO_API_KEY
      headers:
        x-opencode-session: artex
```

改完 `/artex restart`（或 CLI stop+start）。校验：

```powershell
# 需要登录后的 token；插件内部自动登录
node <repo>\dsh-artex\bin\artex-dsh.mjs status
# 日志里应出现 LLM configured from env
```

## 7. 管理员凭据与 API

- 首次启动用 `ARTEX_ADMIN_PASSWORD` 直接初始化（用户名 `ARTEX`），免去 `/setup` 手填
- `setup token` 由 `ARTEX_SETUP_TOKEN` 固定，一起写在 `.artex-runtime/auth.json`
- 登录：`POST /api/auth/login {username:"ARTEX", password}` → `{token}`，之后 `Authorization: Bearer <token>`
- 用户若在 UI 改过密码：`/artex login <新密码>`（写回 auth.json 并重登）
- 建任务：`POST /api/tasks {name, description, goal, seed_first_intent:true}`；`seed_first_intent` 让 worker 立刻开工，不等首轮 planner
- 暂停/恢复：`POST /api/tasks/{id}/control {action:"pause"|"resume"}`

## 8. 排障清单（按命中率排序）

| 症状 | 原因 | 处置 |
|---|---|---|
| 冷启动后 `/artex` 消失，回执不更新 | `package.json` 带 UTF-8 BOM，rc.5 加载器 `JSON.parse` 失败并静默 skip | 用无 BOM UTF-8 重存；`Set-Content -Encoding UTF8` 在旧 PowerShell 会写 BOM |
| 命令/工具都不见了 | bundle 被跳过或宿主没重载 | 看 stderr `skipping profile bundle`；改 `cordis.patch.yml` 触发 HMR，或重启宿主 |
| `artex_start` 起来就退出 | 库没起，日志 `ping postgres … refused` | 插件会自愈重启集群；仍失败看 `logs --kind pg` |
| `npm ci` 后构建缺 `@tailwindcss/postcss` | `NODE_ENV=production` 跳过 devDeps | `npm ci --include=dev` |
| `npm run build:static` 报 `'NEXT_EXPORT' 不是内部或外部命令` | 脚本体是 POSIX 写法 | 直接 `node node_modules\next\dist\bin\next build` |
| 起了库但 `pg_ctl` 卡住不返回 | 守护进程继承了 stdio 管道 | 用 `stdio:'ignore'` 调 `pg_ctl`，只等退出码 |
| 关掉宿主后 ARTEX 没了 | 插件 shutown 清理了它拉起的进程 | 正常行为；要常驻就单独用 CLI 起 |
| 屏幕每隔几秒闪跳一扇黑 PowerShell 窗 | ARTEX 无控制台，worker 每个 console 子进程都要新建控制台，Win11 默认终端为它开新窗 | 用 `start-hidden.cmd` 以隐藏控制台启动（见 5.1） |
| 静默启动后 `artex.exe` 不出现、日志不新增 | 命令行内联引号被 `Start-Process` 吞掉，或漏了 `ARTEX_PG_DSN` | 落 `.cmd` 文件再 `cmd /c`；按 5.1 的 env 清单补全 |
| 静默启动脚本一跑就 `Unexpected token` / 中文乱码 | `.ps1` 存成了 UTF-8 无 BOM，PS 5.1 按 ANSI 解析 | 另存为 UTF-8 **带 BOM**；`$OutputEncoding` 无关 |
| 重启后剩好几个隐藏 `cmd` | `taskkill /T` 不杀父级 cmd | 用 `start-artex-silent.ps1 -Force`，它会清掉 `start-hidden.cmd` 的残留外壳 |
| 端口被占 | 8787/8788/5546x 冲突 | `status` 看端口；换 `addr`/`proxy`/`pgPort` |
| LLM 400/MissingSessionID | 端点要求自定义头 | 配 `llm.headers` 让插件起转发 |
| 401 | UI 改过管理员密码 | `/artex login <新密码>` |
| 跑 `pwsh -File …` 报「无法将 pwsh 项识别为 cmdlet」 | 机器上只有 Windows PowerShell 5.1，没有装 PowerShell 7 | 换成 `powershell -NoProfile -ExecutionPolicy Bypass -File …`（§2/§3 的命令同理） |

## 9. 验收清单

```powershell
node <repo>\dsh-artex\test\smoke.mjs       # 应 12/12
```

逐项：

1. `GET /api/health` → `{"ok":true,"service":"artex"}`
2. `/api/auth/status` → `{"initialized":true}`
3. 日志出现 `LLM configured from env`
4. `plugin-loaded.json`：`tools` 7 个、`commands:["artex"]`
5. `/artex run <本地目标>` → 任务 `created → running`，worker 领取意图
6. `GET /` 返回 200 且 `<title>ARTEX…`

## 10. 文件地图

| 文件 | 作用 |
|---|---|
| `dsh-artex/lib/artex.js` | 路径、构建、库、启停、LLM 注入、凭据 |
| `dsh-artex/lib/api.js` | 登录、任务、暂停/恢复、stats |
| `dsh-artex/lib/llm-proxy.js` | 补头转发（子进程 `bin/llm-proxy.mjs`） |
| `dsh-artex/lib/index.js` | 7 个工具 + `/artex` 命令 |
| `dsh-artex/bin/artex-dsh.mjs` | 不依赖宿主的 CLI |
| `dsh-artex/test/smoke.mjs` | 自测 |
| `.agents/skills/artex-setup/scripts/start-artex-silent.ps1` | 生成 `start-hidden.cmd` 并以隐藏控制台静默启动（无弹窗） |
| `artex/.artex-runtime/start-hidden.cmd` | 静默启动脚本（自包含 env，`cmd /c` 直接跑）；无弹窗就靠它 |
| `artex/.artex-runtime/` | 运行期状态（未入库） |
