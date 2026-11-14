# 热部署本地插件（不重启工作台）

冻结版的本地插件（`plugins/*`）分宿主半边与客户端半边，热部署路径不同。

## 步骤

1. 快照：`scripts/release.ps1 -Action snapshot -Version <当前版本> -Include <payload 与 ~/.dsh 里将被覆盖的文件>`。
2. 同步：`node frozen-build-src/sync-live-plugins.js ~/.dsh plugins/<a> plugins/<b>`（写 `~/.dsh/plugins` 与 `~/.dsh/profiles/desktop/node_modules` 两处）。
3. 客户端半边（`client.js`）：`client-hmr` 轮询到 bundle 变化后自动热重载，无需操作。
4. 宿主半边（`index.js`）：`dsh-hmr` 只监视 profile 配置（`module root` 默认关闭），**不会**因插件文件变化自己重载。
   给 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一行注释即可触发 `reconcileProfile`：它比对已加载模块与磁盘，替换变化的插件模块（停旧 → 清 ESM 缓存 → 重新 apply）。
   确认生效后把该文件还原（再触发一次 reconcile，无变化模块 = 空操作）。
5. 用插件自己的日志/标记确认已重载（例如 `~/.dsh/todo-nudge.log`、`~/.dsh/session-panel.log` 首行在 apply 时重写）。
6. **新插件**：`sync-live-plugins.js` 把它写进 profile `package.json` 的 `dsh.profile.bundles`，`dsh-hmr` 的清单监视看到 bundles 变化会直接 reconcile 并启动它，不需要再碰 `cordis.patch.yml`。

## 注意

- 运行中的会话：被替换的插件会 dispose 再 apply，内存状态清空。宿主插件要能在回合中途被加载（按事件懒接管当前回合）。
- 安装目录下的 `dsh-home` 是安装模板，热部署不改它（AGENTS.md 规则 3）；`verify-install -Tree <安装目录>` 在升级前对新插件标记报 FAIL 属预期，以 payload 校验为准。

## 宿主 API 陷阱（2026-11 记录）

- `session.append(type, data)` 会对 `data` 做 JSON 快照：事件里的对象 **不是** 你传进去的那个引用。用引用相等判断"这是我写的"永远不成立——改用数据里的标记字段（任务守护用 `by: 'task-guardian'`）。
- `todo/write` 的 `data` 没有运行时 schema 校验，额外字段会原样进日志；`todos` 投影只取 `data.todos`。
- 插件可在运行时 `ctx.sessionProjections.register()` 自定义投影；schema 只需提供 `.parse()`。客户端用 `useProjection('<key>')` 读取，实时帧携带任意已注册键；首屏 baseline 可能剥离未知键，组件要能处理 `undefined`。
- 宿主侧排队一条消息开启新回合：`ctx.agents.get(id).followup(message)`（`steer` = 下一步插入，`inject` = 不唤醒）。
- 本地插件的宿主↔客户端通道：宿主 `inject: ['connection']` 后 `ctx.connection.fetch.register({ path: '/api/<name>.<method>', methods, requestBody: 'buffered', fetch })`，客户端同源 `fetch('/api/…')`。在鉴权围栏内且只对主人身份开放，不写会话日志（官方 deliverables 同一机制）。不要用 `remote.commands.execute` 轮询——它会把命令写进会话日志。
- MCP 健康没有客户端接口：宿主侧用 `ctx.loader.entries()`（`options.name === '@deepseek-ai/dsh-mcp-client'`，`fiber.state`：0 pending / 1 loading / 2 active / 3 failed / 4 disposed / 5 unloading）+ `ctx.tools.definitions()` 中 `mcp__<server>__*` 的工具数判断；重连 = `remote.pluginManager.setPluginEnabled(entryId, false → true)`，`entryId` 即 loader 行的 `id`。

## 事故记录：不要用 PowerShell 5.1 文本命令改 UTF-8 配置（2026-11-10）

- 给 profile 的 `cordis.patch.yml` 追加注释后，用 `Get-Content | Where-Object | Set-Content -Encoding UTF8` 还原，PS 5.1 按 ANSI 读取 UTF-8，中文注释变成乱码；长注释行还把下一行 `- id: dsh-skill-trellis` 吞进注释，造成 `config` 重复、DSH 启动时 YAML 解析失败。
- 正确做法：只追加/删除时用 `Add-Content -Encoding UTF8`（PS 5.1 会带 BOM 但可接受），**任何重写一律用** `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))`，或直接用 Node `fs.readFileSync/writeFileSync('utf8')`。
- 改完用 `js-yaml` 验证：`node -e "require('js-yaml').load(fs.readFileSync(p,'utf8'))"`（runtime 的 `dsh/node_modules/js-yaml` 可用）。
- 事故备份：`%TEMP%\dsh-cuw\cordis.patch.yml.bak` 恢复了文件；DSH 崩溃日志在 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`。

## 一条命令热部署（2026-11-13 起）

```
node scripts/dev-hot.mjs                       # 全部插件同步一次
node scripts/dev-hot.mjs --watch               # 改完即同步（推荐）
node scripts/dev-hot.mjs --only dsh-task-board
node scripts/dev-hot.mjs --reconcile           # 额外 bump cordis.patch.yml
```

- 做三件事：
ode --check 校验入口 → 调 rozen-build-src/sync-live-plugins.js 镜像到 `~/.dsh/plugins/<dir>` 与 `~/.dsh/profiles/desktop/node_modules/<pkg>` → 新插件或 manifest 变更加一行 `# dev-hot <ts> <name>` 让宿主 reconcile。
- 已注册插件的**内容改动**不需要 reconcile：`@deepseek-ai/dsh-client-hmr` 每 500ms 轮询入口产物 mtime/ctime/size，变了就把新 bundle 换进已打开的页面（React 状态会丢，会话/工作区状态保留）。
- 因此改 `client.js` 的循环是：存盘 → 等 0.5-1s → 界面自己换。**不用重装、不用刷新、不用重启**。
- 宿主半边（`index.js`）改了才需要 reconcile，因为宿主插件是普通 Cordis fiber，不走 client bundle 轮询。
- 局限：**已编译 bundle 的 patch 不走这条路**（`dsh-client-ui-chat` 等），那类改动仍要重打包安装。