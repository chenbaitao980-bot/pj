# dsh-codex-cua

把 Codex Desktop（Windows）的 **computer-use** 引擎抽成 DeepSeek Harness 插件：
模型通过 `mcp__cua__*` 工具看窗口、读无障碍树、点按拖拽、输入文本。

- 引擎：`@oai/sky` 0.7.8（从 `OpenAI.Codex 26.1013.4894.0` 的 `cua_node` 运行时抽取，vendor 内置）
- 原生 helper：`vendor/@oai/sky/bin/windows/codex-computer-use.exe`（JSON-Lines over stdio）
- 桥接：`@deepseek-ai/dsh-mcp-client`（stdio MCP，serverName `cua`）
- 版本：插件 0.1.0 / 冻结包 0.2.11-rc.21+

## 工具

| 工具 | 说明 |
| --- | --- |
| `health` | 引擎自检：helper / codex CLI / 窗口数 / 审批模式 |
| `list_apps` / `list_windows` | 应用与窗口清单（窗口 id 用于后续所有调用） |
| `get_window_state` | 无障碍树 + 可选截图（JPEG，拆成 image content 返回） |
| `screenshot` | 仅截图 |
| `click` | 按 `element_index` 或坐标点击（`click_count`、`mouse_button`） |
| `type_text` / `press_key` | 输入文本 / 按键组合 |
| `scroll` / `drag` | 滚动 / 拖拽 |
| `set_value` / `secondary_action` | 直接设值 / 触发 AX 次要动作（Raise、Expand…） |
| `activate_window` / `launch_app` | 前置窗口 / 启动应用 |

工作流：`list_windows` → `get_window_state`（拿 element_index 与最新坐标）→ 操作 → 重新取态。
坐标必须来自**同一窗口的最新截图**，否则点击会落到旧布局上。

## 运行前提

- Windows x64。
- **`codex.exe`（Codex CLI）**：helper 通过 `codex app-server` 枚举应用/窗口。
  解析顺序：`CUA_CODEX_CLI` → `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`（取最新）→ `PATH`。
  没有它时 `health.codexCliExists=false`，`list_windows` 报 `failed to launch codex app-server`。
- `CODEX_HOME` 默认 `%USERPROFILE%\.codex`（helper 与 app-server 共用）。

## 配置

`cordis.patch.yml` 里的 `config`（也可用环境变量覆盖）：

| 键 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `serverName` | — | `cua` | MCP server 名，决定工具前缀 `mcp__cua__` |
| `approval` | `CUA_APPROVAL` | `auto` | `auto` 自动同意 helper 的审批请求；`deny` 一律拒绝 |
| `requestTimeoutMs` | `CUA_REQUEST_TIMEOUT_MS` | `30000` | 单次 helper 请求超时 |
| `maxTextChars` | `CUA_MAX_TEXT_CHARS` | `24000` | AX 树截断长度 |
| — | `CUA_CODEX_CLI` | 自动探测 | 显式指定 `codex.exe` |
| — | `OAI_SKY_WINDOWS_BIN` | 内置 helper | 覆盖 helper 路径 |

## 实现要点（改这个插件前必读）

1. **`globalThis.nodeRepl` shim 必须同时有 `config: {}` 和根级 `createElicitation`。**
   `helper_transport.js` 的审批判定是
   `n ?? (globalThis.nodeRepl?.config == null ? undefined : globalThis.nodeRepl)?.createElicitation`，
   缺 `config` 会直接抛 `Computer Use requires app approval but elicitations are unavailable`，
   截图与取态全部失败（DSH 的 MCP 客户端没有 elicitation 通道，只能由 shim 兜）。
2. **不要走 `node_repl.exe`。** 它的 worker 是受限沙箱：`spawn` 一律 `EPERM`（连 `cmd /c echo hi` 都不行），
   而 helper 需要拉起 `codex app-server`。所以本插件用普通 Node 进程（`process.execPath` +
   `ELECTRON_RUN_AS_NODE=1`）直接 import `@oai/sky`，由 MCP server 自己做 stdio JSON-RPC。
3. **`vendor/node_modules` 不能被打包脚本丢掉。** `@oai/sky` 从
   `vendor/@oai/sky/dist/...` 向上解析 `@statsig/js-client`，只能命中 `vendor/node_modules/@statsig`。
   冻结包流水线因此用 `frozen-build-src/ship-plugin-vendor.js`（`ship-plugin.js` 会跳过所有 `node_modules`）。
4. `state/` 是运行时产物（`sky-options.json`、`approvals.jsonl`），不进包，首次启动自动重建。

## 自检

```powershell
node mcp/server.mjs --self-test      # 打印 JSON：ok / windowCount / codexCli
```

冻结包门禁：`scripts/verify-install.ps1` 会检查 bundle 注册、`serverName: cua`、
shim 的 `config: {}` 与 `createElicitation`、以及 vendored helper 是否存在。
