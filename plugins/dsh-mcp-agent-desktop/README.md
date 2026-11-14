# dsh-mcp-agent-desktop

把 [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) 作为 MCP 服务内置进 DeepSeek Harness 冻结版。

- **MCP 工具**：`mcp__agent-desktop__desktop_*`（67 个：snapshot / find / click / type / set_value / batch / wait / 窗口 / 剪贴板 / 通知 / 会话 …），默认启用。
- **使用约束**：会话第一步注入「快照 → 引用 → 操作 → 再快照」的约定，并说明与内置 `windows_computer_use_*` 的分工。
- **运行方式**：直接启动 vendor 里的原生 exe（`<安装目录>\vendor\agent-desktop\bin\agent-desktop-win32-x64.exe mcp`），不经 Node 启动器。
- **状态目录**：`%USERPROFILE%\.agent-desktop`。

## 配置

`cordis.patch.yml` 里两个 insert：

| 条目 | 作用 |
|---|---|
| `dsh-mcp-agent-desktop` | 插件本体（约束注入），`enabled: true` 默认开启 |
| `mcp-agent-desktop` | `@deepseek-ai/dsh-mcp-client`，stdio 连原生 exe 的 `mcp` 子命令 |

占位符 `__FROZEN_VENDOR__` 由安装器/升级器展开为 `<安装目录>/vendor`。

## 关闭

- 插件管理里停用 `dsh-mcp-agent-desktop`；或
- 环境变量 `DSH_AGENT_DESKTOP_GUIDE=0` 只关约束注入（MCP 工具仍可用）。

## 升级 agent-desktop

替换 `<安装目录>\vendor\agent-desktop`（或 payload 的 `vendor\agent-desktop`）为新的 npm 包内容即可；`bin\agent-desktop-win32-x64.exe` 路径保持不变。
