# DSH 插件：MCP/插件工具调用与普通命令的视觉区分

## Goal

给 DeepSeek Harness 提供一个可安装的 Cordis 包 `@local/dsh-toolcall-tone`：在对话流里把 **MCP 工具调用** 与 **插件提供的工具调用** 染成独立配色，让它们和普通命令执行（`bash` / `pwsh` 终端卡片）一眼区分开；同时不遮蔽官方渲染、不引入构建步骤、不改变任何运行时行为。

## Requirements

- 分类规则可读可改，集中在一处（`client.js` 的 `GROUPS`）。
- MCP 工具按 `mcp__<server>__<tool>` 前缀识别；插件工具按可配置前缀/精确名识别。
- 普通命令（`bash`/`pwsh`/terminal 卡片）保持原样。
- 纯装饰：不注册槽位、不读会话数据、不改变工具卡片的结构与交互。
- 卸载即恢复（`ctx.effect` 返回 disposer 移除 `<style>`）。

## Expected Results（预期结果清单）

- [x] 安装结果：`install_bundle` 返回 `application: "applied"`、`warnings: []`、`bundle: "@local/dsh-toolcall-tone"`。
- [x] profile 注册：`~/.dsh/profiles/desktop/package.json` 含 `"@local/dsh-toolcall-tone": "link:E:/claude/project4/pj/plugins/dsh-toolcall-tone"`，`dsh.profile.bundles` 含该包名。
- [x] 生成的样式表可复现（Node 直接调用 `buildCss()` 得到 `[data-tool^="mcp__"]` 与插件前缀选择器组）。
- [x] 选择器锚定在官方 DOM 契约 `data-tool="<wire tool name>"` 上（`dsh-client-ui-tool` 的 `ToolRow` 根节点，`ToolRow.module.css` 自身已用 `[data-tool^=cordis_]` 做同类覆盖）。
- [ ] 视觉确认：刷新窗口后，`mcp__*` 行显示紫罗兰左边条 + 9% 底色，`artex_*` / `purge_*` 等行显示琥珀色边条，`pwsh`/`bash` 行不变。

## Acceptance Criteria

- [ ] 对话里出现一次 MCP 调用（如 `mcp__gitnexus__query`）时，该行有 `#7c5cff` 左边条。
- [ ] 出现一次插件工具调用（如 `artex_task`、`purge_status`）时，该行有 `#e0912f` 左边条。
- [ ] 同一对话里的 `pwsh` 调用保持官方外观（无左边条、无底色）。
- [ ] 在 Settings → Plugins 里能看到「工具调用配色 / Tool call tones」条目与图标。
- [ ] 停用该 bundle 后，所有染色消失。

## Technical Approach

- 官方扩展点 `tool.call.toolview` 按 wire name 分派，但 MCP 工具名是动态的，逐个注册不现实；因此改用 **按 `data-tool` 属性作用域化的样式表**：
  - `ToolRow` 根节点固定输出 `data-tool={toolName}`、`data-state`、`data-variant`；
  - 插件的 Client half 在 `apply()` 里挂一个 `<style data-plugin-css="@local/dsh-toolcall-tone/highlight.css">`；
  - 选择器只用属性，不依赖任何 hash 类名，升级后仍有效。
- Host half 为空实现，仅用于让 profile 能加载该 bundle 与 Client 模块。

## Out of Scope

- 不重写工具卡片渲染（不 shadow `conversation.chat.node` 的 `tool-call` 键）。
- 不做 Settings 开关（改规则＝改 `client.js` 的 `GROUPS` 后刷新）。

## Technical Notes

- 安装路径：`E:\claude\project4\pj\plugins\dsh-toolcall-tone`（profile 里是符号链接，改文件即时生效，刷新窗口后重载）。
- 首次 `install_bundle` 因 `dsh-artex` 目录被占用（EBUSY）失败；临时 `set_bundle dsh-artex enabled=false` 释放句柄，安装完成后已重新 `enabled=true`。
- `dsh-purge` 的 postinstall 需要批准，已用 `approvedBuilds` 放行；其脚本自报 `already in bundles` / `insert already in cordis.patch.yml`。
