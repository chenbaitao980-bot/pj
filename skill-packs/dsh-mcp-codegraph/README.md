# dsh-mcp-codegraph

冻结版内置的 CodeGraph 代码知识图谱 MCP，默认启用。

- `cordis.patch.yml`：注册 `@deepseek-ai/dsh-mcp-client`（serverName `codegraph`），
  跑 `vendor/codegraph/npm-shim.js serve --mcp`。
- `lib/index.js`：会话第一步注入 `codegraph_explore` 的使用约定——一次调用拿到逐字源码 +
  调用路径 + 爆炸半径，拿到后不要再 Read 同一批文件。

关闭：profile 里给该条目 `config.enabled: false`，或设置环境变量 `DSH_CODEGRAPH_GUIDE=0`
（`DSH_CODE_INTEL_HOOKS=0` 可同时关掉本包与 dsh-mcp-gitnexus 的注入）。
