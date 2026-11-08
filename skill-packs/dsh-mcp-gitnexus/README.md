# dsh-mcp-gitnexus

冻结版内置的 GitNexus 代码图谱 MCP，默认启用。

- `cordis.patch.yml`：注册 `@deepseek-ai/dsh-mcp-client`（serverName `gitnexus`），
  命令与脚本路径用 `__FROZEN_NODE__` / `__FROZEN_VENDOR__` 占位，安装器按本机绝对路径替换。
- `lib/index.js`：会话第一步注入使用约束，让模型自动调用 `query` / `context` / `impact` /
  `detect_changes` / `rename`，而不是用 grep + Read 循环硬啃。

关闭：profile 里给该条目 `config.enabled: false`，或设置环境变量 `DSH_GITNEXUS_GUIDE=0`
（`DSH_CODE_INTEL_HOOKS=0` 可同时关掉本包与 dsh-mcp-codegraph 的注入）。
