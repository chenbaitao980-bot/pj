# computer-use 能力审计与本地增强

## 目标

检查 `dsh-computer-use-win@0.5.6` 是否能完成真人在 Windows 上能做的鼠标/键盘/窗口操作（以 Codex computer use 为基线），找出缺口并修复、测试。

## 审计

已覆盖：观察（UIA 树、截图、OCR、find/element_info）、鼠标（move/click/double/drag/scroll，左右中键，后台与前台派发）、键盘（type_text 四种方式、keypress 组合键）、窗口（list/activate/move/close）、应用启动、batch、Esc 停止、接管提示。

缺口：剪贴板读写、窗口最大化/最小化/还原/缩放、三连击、光标与屏幕信息；按住键/按住鼠标与 Win 键组合按安全取舍不实现。

## 实现（vendor/dsh-computer-use-win，0.5.6-dsh.1）

- `clipboard`（read/write/清空，仅文本，失败重试 3 次）。
- `window_state`（ShowWindow / SetWindowPos，不激活；最大化窗口拒绝 resize）。
- `cursor_pos` / `screen_info`（复用后端已有实现，暴露为 MCP 工具）。
- `click.count` 1–3；后台多击按 dblclk 序列派发。
- 设置页工具分组/计数同步为 30 个工具。

## 验证

- 屏幕外 WinForms 测试窗口（-40000,-40000）：set_value 中文回读一致、BM_CLICK 改窗口标题、ListBox 后台滚动 0→6.6%、close_window、resize 875×625→640×420、click count=1/3、剪贴板写读清空（含中文）。
- `node --check`（server/settings/client）与 PowerShell AST 解析通过；MCP tools/list 返回 30 个工具。
- 未实测（避免打扰工作台）：maximize/minimize/restore 的真实屏幕行为、前台三连击的编辑器选中效果。
