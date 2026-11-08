# 冻结版 0.2.1-rc.5 ↔ 官方 0.2.2-rc.1 差异与同步清单

> 生成时间：2026-11-07 19:5x　·　对比对象：
> - 冻结版（已安装）：`%LOCALAPPDATA%\Programs\DeepSeekHarnessFrozen`，`0.2.1-rc.5`，commit `d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`
> - 官方最新（本次下载）：`E:\claude\project4\pj\desktop-installer\deepseek-harness-0.2.2-rc.1-win-x64.exe`，`0.2.2-rc.1`，commit `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`
>
> 数据来源：NSIS 安装包 → `app-64.7z` → `app.asar` 解包后的真实文件（不是发布说明）。

## 一、底座与体积

| 项目 | 0.2.1-rc.5（冻结） | 0.2.2-rc.1（官方） | 说明 |
| --- | --- | --- | --- |
| 桌面壳 `lib/main.js` | 518,709 字符 | 820,712 字符 | 主进程重写量很大，新增独立 worker 与多套 UI 装配 |
| `lib/` 文件 | `main.js` + preload ×4 + welcome | 追加 `operation-report-worker.js`（141 KB） | 崩溃/操作报告改为独立线程上报 |
| 运行时包数量 | 305 | 329 | 新增 26 个包，移除 1 个 |

## 二、新增能力（26 个包，按用户可见程度归类）

### 1. 对话输出：动作卡片 / 引用 / 文件操作
- `dsh-action-cards` + `dsh-client-ui-action-cards`：回答下方出现**动作卡片**（共享 proposal 工具 + 卡片状态 + 用户动作 + 状态提示），不再是纯文本结尾。
- `dsh-message-quotes`：选中文本**引用回复**，渲染为 Markdown blockquote。
- `dsh-client-ui-file-drag`、`dsh-client-ui-file-actions`：把文件从应用里**拖出去**、原文件另存、图片复制到剪贴板（失败有本地化提示）。
- `dsh-deliverable-file-references`：模型输出文件链接/交付物的统一规范（Web 与 Desktop 一致）。

### 2. 个性化与插件推荐
- `dsh-personalized-recommendations`、`dsh-creation-recommendations`、`dsh-client-ui-creation-recommendations`：**按对话需要现场生成可持久化的界面插件**（定位选择、生成进度、保留/撤销/恢复）。
- `dsh-plugin-recommendations`、`dsh-client-ui-plugin-recommendations`、`dsh-plugin-detail`：官方插件推荐卡片、插件详情文档（README / 图片 / npm CDN 文件源）。
- `dsh-official-bundles`：安装包自带的官方 bundle 清单（模板 profile、可选、按需、退役包），插件管理器的“受保护/展示”口径来自这里。

### 3. 变更请求（Forge）与 LiveShare
- `dsh-experimental-forge` + `-github` + `-session` + `-bundle` + `dsh-experimental-client-ui-forge`：**会话级变更请求面板**（PR/MR 注册表、状态轮询、GitHub provider 走 host 侧 `gh`），新建会话可选 worktree。
- `dsh-experimental-liveshare` + `-protocol`：**会话共享**（独立 Relay，view / bounded-write 两档权限，fork 与附件上传独立开关）。

### 4. 编辑器 / 执行器 / 文件写入
- `dsh-fs-patch`：Codex 风格 **patch 解析器 + LF 文本更新器**，匹配失败会给出结构化原因（配合 `apply_patch` 类工具）。
- `dsh-tool-executor-native`、`dsh-tool-executor-ptc`：工具执行层拆成 native / PTC 两条通道，PTC 带 SDK prompt 生成。
- `dsh-experimental-client-ui-stats`：**逐轮/逐步统计视图**（上下文、耗时、缓存、工具成本表）。
- `dsh-client-ui-context-menu`：插件可扩展的类型化右键菜单（捕获目标 + 统一 Web 呈现）。

### 5. 被移除
- `dsh-client-ui-deepseek-model-label-1017`：旧版模型标签组件退役。

### 6. CLI 侧变化
- `@deepseek-ai/dsh` 0.2.2-rc.1 的 `bin` 仍为 `dsh`，但新增 `--dump-config` / `--dump-config-schema` / `--dump-default-config`，并明确 **`desktop` profile 由 Electron 独占**（CLI 不允许直接 boot）。
- engines：`node >= 24.9.0`（冻结版内置 24.21.0，满足）。

## 三、同步结果（本次已落地到冻结版）

| 项 | 状态 |
| --- | --- |
| 底座升级到 `0.2.2-rc.1`（`DeepSeek Harness.exe`、`resources/app`、`resources/runtime`） | ✅ 已 staged 并冻结 |
| 重新应用 dsh-purge 1.1.90 补丁（`resources/app/dsh`，53 个文件备份） | ✅ |
| 冻结：`app-update.yml` 不落盘、`enabled = () => false`、删除 `dshMandatoryUpdatePolicy` | ✅ |
| `resources/runtime` 与新版 `versions.json` / `runtime.json` 对齐（Node 24.21 / Python 3.12 / PG16） | ✅ |
| 26 个新包随 `resources/app/dsh` 一起进包（无需联网） | ✅ |
| 自定义层（dsh-purge / dsh-artex / websearch / skill packs / workflow-lite / MCP）全部保留 | ✅ |
| 新增：`dsh-skill-trellis 2.0.0`（SessionStart 注入 + 缺 `.trellis` 自动初始化） | ✅ |
| 新增：`dsh-mcp-gitnexus 1.0.0` / `dsh-mcp-codegraph 1.0.0`（插件化、默认启用、自动调用约束） | ✅ |
| 离线插件完整性：`profiles/desktop/node_modules` 整目录随包（35 MB / 1938 文件） | ✅ |

## 四、刻意不跟随的部分

- **官方自更新通道**：`dshDesktopUpdateChannel: nightly` 保留在清单里，但 updater 已被禁用，不会把冻结版拉回官方版。
- **强制更新策略**：`dshMandatoryUpdatePolicy` 从 app manifest 移除，避免登录前弹强制升级。
- **官方遥测/账号绑定页**：`preload-platform-account.cjs` 保留（结构需要），但 profile 里 `ui-settings-account` 的 `step` 固定为 `done`、`completion: api-key`，不引导平台账号。
