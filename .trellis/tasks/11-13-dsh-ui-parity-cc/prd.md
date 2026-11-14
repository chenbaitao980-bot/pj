# brainstorm: dsh UI 交互对齐 Claude Code 桌面版（增量抄 CC）

## Goal

把 Claude Code 桌面版（MSIX `Claude_5.11492.2.0`）在**交互手感与信息密度**上的细节，增量移植到 DSH 冻结版（`0.2.11-rc.25`）。硬约束：不改坏现有功能、不覆盖本地定制、不触发"对齐官方"红线。

## What I already know（已核实的根因定位）

### 1) 左侧面板 hover 没有"手感"

- `resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`
  - `.wtg9ga_iconButton` 规则内**没有 transition**；同文件 4 处 `transition`，其中一处显式 `transition:none;`
  - hover 只有单档：`@media (hover:hover){.wtg9ga_iconButton:hover{background-color:var(--dsw-alias-interactive-bg-hover)}}`
- `dsh-client-ui-theme/lib/client.js`：`--dsw-alias-interactive-bg-hover:#2631480f`（浅色，6% 黑）/ `#ffffff14`（深色，8% 白）；过渡令牌只有 `--ds-transition-duration-fast:.1s`、`--ds-transition-duration-slow:.3s`、`--ds-ease-in-out:cubic-bezier(.4,0,.2,1)`
- CC 侧（已解包 `.vite/renderer/main_window/assets/MainWindowPage-lhEHjHfd.css`，251 KB）：
  - 四档叠加 alpha：`--cds-alpha-1..4`
  - hover 令牌成体系：`--cds-fill-ghost-hover:var(--cds-alpha-1)`、`--cds-fill-secondary-hover:var(--cds-alpha-1)`、`--cds-bg-neutral-hover:var(--cds-alpha-2)`、`--cds-fill-control-hover:var(--cds-alpha-3)`
  - 动效曲线：`--cds-dur-snap`、`--cds-ease-snap:cubic-bezier(.32,.72,0,1)`、`--cds-dur-fast`、`--cds-ease-out:cubic-bezier(0,.2,1)`，并配 `transition-duration/timing-function/delay`
- 结论：dsh 不是"没 hover"，是**瞬时跳变 + 只有一档底色**，所以手感发硬。

### 2) 切换任务总是"加载历史会话中"

- `dsh-client-ui-chat/lib/client.js`（680 KB，偏移 ~152693）：
  ```js
  openState === "loading" && jsx("div", { className: ChatView_module_css_default.hint, children: t("chat.loadingHistory") }),
  ```
  即会话 openState 一进 loading，消息区被整屏提示替代（`chat.loadingHistory` = "Loading history…" / zh "载入历史…"）。
- 已存在 `@deepseek-ai/dsh-session-projection-cache` 包 → 有投影缓存可用，但没有"保留上一条会话画面直到新数据到达"的 stale-while-revalidate 行为。
- CC 的做法是：**立即渲染本地已有消息，后台增量补**；切换瞬间不出现整屏 loading。

### 3) 任务面板折叠后切会话又展开（确定性 bug）

- `plugins/dsh-task-board/client.js`
  - `:662` `const [collapsed, setCollapsed] = React.useState(false);` —— 折叠是组件局部 state，不持久化
  - `:738` `if (anyActive) setCollapsed(false);` —— 有活跃任务时**强制展开**，覆盖用户选择
  - `:869` / `:918` 手动 toggle 只 `setCollapsed(v => !v)`，未写任何存储
  - 同文件 `:491-513` 已有 localStorage 用法（`NOTES_KEY`），可直接复用一个 `collapsed` 键

### 4) 工具调用没有"按动作类型分色"

- `plugins/dsh-toolcall-tone/client.js`：`GROUPS` 只有两组 —— `mcp`（`#7c5cff`）、`plugin`（`#e0912f`），命中 `[data-tool^="mcp__"]` 等前缀
- `dsh-client-ui-tool/lib/client.js` 的卡根元素带 `data-tool="<wire tool name>"`（插件已依赖此属性），说明 edit / write / read / bash / pwsh / grep / glob / 思考 都可单独命中
- 结论：现在是"MCP 有色、编辑/命令无色"，与 CC 的"不同动作不同色"差距明确。

### 5) 工作时没有"简短状态消息"

- `dsh-client-ui-chat/lib/client.js`（~279704）只有一条固定运行状态：
  ```js
  const label = startTime === undefined ? t("chat.deepDiving") : t("chat.deepDivingFor", { duration: ... });
  ```
  zh：`chat.deepDiving` = "深度求索中"、`chat.deepDivingFor` = "深度求索中，用时 {duration} ···"
- 句末 `runningDivider` 是唯一"工作态"视觉；不随当前工具/文件变化。
- CC 在工作时按动作切换短状态（编辑哪个文件、跑什么命令、在思考），信息密度更高。

## Requirements（evolving）

- R1 左侧栏 hover 有平滑过渡 + 多档底色，贴近 CC 手感
- R2 切换会话不再整屏 "Loading history…"，保留上一屏直到新数据到达
- R3 任务面板折叠状态**跨会话/刷新记忆**，且活跃任务不再强制展开
- R4 工具调用按动作类型分色（编辑 / 命令 / 读取 / 思考 / MCP 至少 5 类）
- R5 工作态显示随当前动作变化的简短文案（而非固定"深度求索中"）
- R0 全部改动不得破坏现有功能；本地定制优先保留

## Acceptance Criteria（evolving）

- [ ] AC1 `[class*=iconButton]:hover` 生效时有 `transition: background-color 120ms cubic-bezier(.32,.72,0,1)`，且 hover 背景至少 2 档递进
- [ ] AC2 从会话 A 切到会话 B，消息区不出现整屏 "Loading history…"；首屏内容 < 200ms 可见（旧内容可暂时保留）
- [ ] AC3 折叠任务面板 → 切换会话 → 返回，仍为折叠；刷新后仍折叠；有活跃任务时也不被强制展开
- [ ] AC4 5 类动作各命中一条 `[data-tool]` 规则，颜色互不相同且与主题亮/暗均可读
- [ ] AC5 运行中状态行随当前工具变化（至少 edit / bash-pwsh / read / think / mcp 五类文案）
- [ ] AC6 `verify-install.ps1` 0 failed；所有改动脚本可重入（重复执行无副作用）

## Definition of Done

- 插件侧改动：`plugins/*` 源码 + `sync-live-plugins.js` 热部署验证
- bundle 侧改动（若选）：`frozen-build-src/patch-*.js` 正则唯一命中 + 幂等 + `node --check`
- `scripts/release.ps1 -Action snapshot` 先快照；`Build-FrozenSetup.ps1 -Version <新版本>` 重打包；`scripts/verify-install.ps1` 卡门
- 发布说明记录版本、改动项、回滚点

## Expected Results（预期结果清单，Step 7.5 待确认）

- [ ] hover：`.wtg9ga_iconButton` 由「无 transition + 单档 6% alpha」→「120ms cubic-bezier(.32,.72,0,1) + 至少 2 档（6% / 12%）」；CSS 断言可静态核验
- [ ] loading：切换会话可见到整屏 "Loading history…" 的次数从「每次切换 1 次」→「0 次」；用 3 次 A↔B 切换实测
- [ ] 折叠：`localStorage['dsh-taskboard:collapsed:<agentId>']` 存在且与 UI 一致；切会话/刷新后读回同值（脚本 + 手测）
- [ ] 颜色：`[data-tool]` 命中规则从 2 组 → ≥5 组，覆盖率 5/5
- [ ] 状态文案：运行态文案模板从 1 条固定 → ≥5 条按工具类型分派（代码断言 + 手测截图）
- [ ] 回归：`verify-install.ps1` 0 failed；原有 MCP/plugin 着色、任务面板计数、todo 守护行为不变

## Out of Scope（候选）

- 不整体换视觉语言（不引 Tailwind / 不换字体 / 不重做布局）
- 不照搬 CC 的图标集与品牌色
- 不修改官方包版本、不触发上游对齐红线
- 不动移动端

## Technical Notes

- 运行时：`C:\Users\Administrator\AppData\Local\Programs\DeepSeekHarnessFrozen`（`0.2.11-rc.25`）
- payload：`D:\dsh-freeze-new\payload`
- 插件源码：`E:\claude\project4\pj\plugins\`（`dsh-task-board`、`dsh-toolcall-tone`、`dsh-session-panel` …）
- 热部署：`node frozen-build-src/sync-live-plugins.js ~/.dsh plugins/<a>`（客户端半边 client-hmr 自动重载；宿主半边需碰 `cordis.patch.yml`）
- 已有补丁范式：`frozen-build-src/patch-session-tracker.js`（3.2 KB，最短样例）
- CC 取证：`.tmp-asar-list.cjs` 解 `app.asar`；CC 主窗口 CSS 已落到 `.tmp-cc/MainWindowPage.css`

## Spec Conflicts

- 检查 `.trellis/spec/frozen/index.md`：本次不是"对齐官方"，**不触发** upstream-alignment 红线
- `AGENTS.md` 规则 1（本地优先）/3（只改 payload）/4（补丁脚本化）**与方案一致**
- 潜在张力：`hot-deploy.md` 提示"运行中的会话插件会 dispose 再 apply，内存态清空"——R3 的折叠状态必须落 localStorage 才能扛住热重载

---

## Step 2 复杂度

**Complex**（5 个子系统、跨插件层 + 编译 bundle、需要重打包新版本）。

## Step 4 技术选型（research-first 结论）

### ② 的加载链路（已读到源码）

- `dsh-api-session-controller/lib/types/client/sessions/session.js`（未压缩 ESM，带 JSDoc）
  - `openState = 'cold'` → `open()` → `doOpen()`：**同步**置 `'loading'` 并 `markDirty()`，然后 `new SessionEventStream(...)` + `await events.open(HISTORY_PAGE_OPTIONS)`
  - `HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: 50, minTurns: 2 } }`
  - 成功后 `openState = 'open'`；`resync()` 会先置回 `'cold'`
- `transport.js`：`SessionEventStream extends RemoteJournalStream`，首帧走 `remote.session.follow({ address, activate: true, assistantStream: true })`，返回 `type: 'snapshot'`（records + projections + assistantStream）后 yield `'opened'`
- 结论：**loading 期间 events 里没有任何记录**，UI 只能空屏。要"直接展示"只能提前 open（预取），否则只能改视觉。

### ② 预取可行性（已证实）

- 客户端插件能拿到会话管理器：`dsh-session-tracker/client.js:509` `sessionsStore: ctx.sessions.list`、`:541` `ctx.sessions.list.getSnapshot().byId`、`:576` `ctx.sessions.list.subscribe(check)`；`dsh-side-chat/client.js:175` 同款；宿主侧 `dsh-side-chat/index.js:298` 用 `ctx.sessions.get(parentId)`
- 会话行渲染在 `dsh-client-ui-workspace/lib/client.js` @131802：`onClick: () => { onOpen(node.id); }`、`onPointerEnter: marquee.enter`
- 所以：patch 一处 `onPointerEnter` → `window.__dshPrefetchSession?.(node.id)`，插件提供 `ctx.sessions.get(id)?.open()` 实现，即可 hover 预取。

### 实测基线（只读：readFileSync + 逐帧 zstd 解压 + 尾部 500 条 JSON.parse）

| 样本 | 压缩 | 解压 | 帧数 | 行数 | 纯数据侧耗时 |
|---|---|---|---|---|---|
| 最大会话 | 7.07 MB | 22.85 MB | 4873 | 8489 | **576 ms** |
| 次大 | 7.02 MB | 25.32 MB | 6455 | 11124 | **539 ms** |
| 1.46 MB | 1.46 MB | 5.14 MB | 1089 | 1991 | 97 ms |
| 中位 279 KB | 0.27 MB | 0.94 MB | 100 | 195 | 15 ms |
| 最小 | ~0 | ~0 | 2 | 5 | 0.5 ms |

全库：123 个 `.zstd`，75.8 MB，中位 279 KB；`<=1MB` 104 个、`1–10MB` 19 个。

**推论**：中位会话 15ms —— 用户看到的"加载历史"不是慢，是**整屏文字替换**这个视觉行为；只有大会话（P90 97ms、Top10 500–600ms）才真慢。因此 ② 必须"预取 + 骨架"双管，单靠优化解压无意义。

## Step 5 发散

- **future**：CC 的手感来自整套 alpha 阶梯；若只加 transition 不建 4 档令牌，后续每加一个 hover 元素都要再改一次。→ 建 `--dsh-alpha-1..4` + `--dsh-dur-snap` + `--dsh-ease-snap` 三件套，一次到位。
- **related**：`dsh-session-panel` 已有 `COLLAPSE_KEY = 'dsh-session-panel:collapsed:v1'` 持久化范式，可直接复制给 task-board，避免自创键名风格。
- **related**：`dsh-toolcall-tone` 的 CSS 走 `color-mix()` + `box-shadow inset`，新增分组只需扩 `GROUPS`，选择器由 `selectorsOf()` 自动生成 —— 不要改成手写选择器。
- **failure**：预取若对每个可见会话都 open，会挂起 N 条 `follow` 长连接；必须限定 hover + 去抖 + 只保留最近 1 个预取。
- **failure**：⑤ 若在 RunningStatus 里直接读 DOM，会与 React 每秒 tick 打架（闪字）。必须走 `window.__dshRunningLabel` 单点注入，由插件提供纯函数文案。
- **failure**：折叠若要"记住用户意图"，必须区分「用户折叠」与「系统因活跃任务展开」，否则下次拉回仍是展开；用两个键（`collapsed` 用户意图 + `autoExpanded` 运行时状态）避免互相覆盖。

## Step 7 方案与 ADR-lite

**已选：A —— 插件层 + 1 个 chat/workspace 双点 bundle patch**

- ADR-1：**不整体替换主题令牌**，只新增 `--dsh-alpha-*` 并在补丁内覆盖 hit 到的选择器。理由：`dsh-client-ui-theme` 136KB，改令牌面太大，回滚成本高。
- ADR-2：**② 用预取 + 骨架，不改数据层**。理由：`doOpen` 的 loading 是协议决定的（follow 首帧前无数据），改数据层要动 `RemoteJournalStream`，风险远大于收益。
- ADR-3：**⑤ 走 `window.__dshRunningLabel` 注入点**，不在 patch 里写死文案。理由：文案要能热更新、要能中英双语、要随工具类型扩展，写死会把每次调整都变成一次重打包。
- ADR-4：**③ 保留 `anyActive` 自动展开**（用户已确认），只补持久化与"展开后不覆盖用户折叠意图"。
- ADR-5：**④ 扩 `GROUPS` 到 6 组**（edit/write、bash/pwsh、read/search、think/plan、mcp、plugin），颜色走 CSS 变量，暗色主题用 `color-mix` 自适应。

## Step 7.5 预期结果清单（待用户签字）

| # | 指标 | 基线（实测/静态） | 目标 | 验证方式 |
|---|---|---|---|---|
| ① | 侧栏 hover 过渡 | `.wtg9ga_iconButton` 规则内 `transition` 命中 **0**；hover 底色 **1 档**（`#2631480f` 6%） | `transition` 命中 ≥1（`120ms cubic-bezier(.32,.72,0,1)`）；hover 底色 **≥2 档**（6% / 12%） | 读注入样式表断言 + 手测 |
| ② | 整屏「载入历史…」出现次数 | 每次切到未打开会话 = **1 次**；数据侧 P50 **15ms** / P90 **97ms** / 最大 **576ms** | 文字提示 **0 次**（改骨架）；hover ≥150ms 后点击 → `openState === 'open'`，loading **0 次** | 3 次 A↔B 切换 + console 断言 |
| ③ | 折叠持久化 | `collapsed` 不落盘（0 个存储键）；`anyActive` 强制展开 | localStorage 键 `dsh-task-board:collapsed:v1:<agentId>` 存在且跨刷新一致；有活跃任务仍展开 | 脚本读 localStorage + 手测 |
| ④ | 工具分色组数 | `GROUPS` = **2 组**（mcp / plugin） | `GROUPS` ≥ **6 组**，覆盖 `data-tool` 名单 ≥6/6 | 统计生成 CSS 选择器 |
| ⑤ | 运行态文案模板数 | **1 条**（`chat.deepDiving` / `chat.deepDivingFor`） | ≥ **6 条**按工具分派，保留 `用时 {duration}` 后缀 | 代码断言 + 手测截图 |
| R | 回归 | `verify-install.ps1` 现状 0 failed | 仍 0 failed；所有 patch 幂等；旧 Setup 保留 | 打包流水线 |

## Out of Scope（定稿）

- 不整体换视觉语言（不引 Tailwind / 不换字体 / 不重做布局）
- 不照搬 CC 图标集与品牌色
- 不修改官方包版本、不触发上游对齐红线
- 不动移动端
- 不改 `RemoteJournalStream` / 网关协议

## Step 9 实施记录（0.2.11-rc.26）

### 9.1 六项落点

| # | 实现位置 | 方式 |
| - | -------- | ---- |
| ① 侧栏 hover | 新插件 `plugins/dsh-cc-touch/client.js` | 仅注入 `<style>`：四档 alpha + 120ms snap 过渡 + 双档 hover + `:active` + `:focus-visible`；特异性用 `html [class*="..."]:hover` 压过原单档规则，原规则不删 |
| ② 载入历史 | `frozen-build-src/patch-cc-parity.js` step 1-3 | chat 的 loading 分支改骨架（`aria-label` 保留语义）+ workspace 会话行 `onPointerEnter` 调 `window.__dshPrefetchSession` |
| ③ 折叠持久化 | `plugins/dsh-task-board/client.js` | `dsh-task-board:collapsed:v1` + `userCollapsed`；`collapsed = userCollapsed && !anyActive`；两处按钮走 `toggleCollapsed()` |
| ④ 分色 | `plugins/dsh-toolcall-tone/client.js` | `GROUPS` 2 → 6（edit/exec/read/think/mcp/plugin） |
| ⑤ 工作态文案 | `patch-cc-parity.js` step 4 + cc-touch | `window.__dshRunningLabel()` 按 `[data-tool][data-state="running"]` 分派动词与文件名，回退原「深度求索中」 |
| ⑥ 运行中列表 | `plugins/dsh-session-tracker/client.js` | 删 `runningRows`，header 徽标「N 运行」保留 |

### 9.2 语义决策

- ③ 折叠完全由用户控制（rc.27 修正）：`collapsed = userCollapsed`，删掉了 `anyActive` 渲染期覆盖；会话跑着也能折，状态按 Session 持久化。rc.26 的「活跃强制展开」已废弃（用户 2026-11-13 明确否决）。
- ② 不改数据层：`HISTORY_PAGE_OPTIONS`（500 条 / 50 条 / 2 轮）与 `RemoteJournalStream` 均未动，只改视觉与预取时机（hover ≥150ms 且仅 `openState==='cold'`）。

### 9.3 校验

- `node --check` 全部通过（cc-touch、task-board、toolcall-tone、session-tracker、patch-cc-parity）。
- `scripts/verify-install.ps1 -Tree D:\dsh-freeze-new\payload`：**99 passed, 0 failed**。新增 3 条 patch 断言 + `patch-cc-parity.js` 工具存在性。
- 打包：`Build-FrozenSetup.ps1 -PayloadRoot D:\dsh-freeze-new\payload -Version 0.2.11-rc.26 -OutDir E:\claude\project4\pj`。

### 9.4 操作约束（新增，长期有效）

- **每次优化完成后都要升级冻结包**（用户 2026-11-13 明确要求）。
- **仓库根目录最多保留 3 个 `DeepSeek-Harness-Frozen-Setup-*.exe`**，超出时删最旧；删除记录写进对应 `docs/releases/<version>.md`。
- PowerShell 5.1 脚本（`Build-FrozenSetup.ps1`、`verify-install.ps1`）必须 UTF-8 **带 BOM**；编辑后若丢 BOM，中文串会按 GBK 解码并抛 `Unexpected token`。

### 9.5 热部署（rc.27 新增）

- 新增 `scripts/dev-hot.mjs`：`node --check` 校验入口 → 调 `sync-live-plugins.js` 镜像到 `~/.dsh/plugins/<dir>` 与 `~/.dsh/profiles/desktop/node_modules/<pkg>` → 新插件才 bump `cordis.patch.yml` 触发 reconcile。
- `--watch` 模式下保存即同步；已注册插件的内容改动由 `@deepseek-ai/dsh-client-hmr`（500ms 轮询入口 mtime/ctime/size）自动替换进已打开页面，不用重装、不用刷新。
- 局限：已编译 bundle（`dsh-client-ui-chat` 等）的 patch 不走这条路，仍需重打包安装。

### 9.6 冻结包交付原则

- 安装包必须自包含：只把本项目文件夹里的 `DeepSeek-Harness-Frozen-Setup-<ver>.exe` 拷到目标机，双击安装，本机现有全部功能即可用（插件、技能、profile 离线依赖、runtime、artex、mobile 都在 payload 内）。
- 每次优化完成后出包；仓库根目录最多保留 3 个 Setup，超出删最旧并在对应 `docs/releases/<version>.md` 记录。

### 9.7 rc.28：空闲批量预取（秒开）

用户 2026-11-13 20:06 反馈「切换对话还是有载入历史，能不能秒开」。rc.26 的骨架只改了「loading 时显示什么」，没消掉 loading 本身。

`plugins/dsh-cc-touch/client.js` 的第二个 `ctx.effect` 增加：

- `WARM_LIMIT = 8`，按 `ctx.sessions.list.getSnapshot().byId` 的 `updatedAt` 降序取前 8 个；
- `warmRecent()` 串行 `open()`，间隔 120ms，只对 `openState === 'cold'`；
- 启动 1.2s 后首次执行；`list.subscribe` 变化时 30s 节流 + 600ms 防抖重扫；
- dispose 清 `prefetchTimer` / `sweepTimer` / `sweepDelay` / `stopList`。

内存上界：`HISTORY_PAGE_OPTIONS` 每 Session 500 条，8 个封顶。`open()` 幂等，已打开的会话被跳过。

### 9.8 交付与工作流铁律（用户 2026-11-13）

- 冻结包是**自包含单文件**：目标机只需拷 `DeepSeek-Harness-Frozen-Setup-<ver>.exe`，双击安装即带全部功能（插件 / 技能 / 离线 node_modules / Node·Python·PG runtime / artex / mobile），不依赖 `D:\dsh-freeze-new` 或项目目录。
- **每次改本项目都要：① 热部署到 `~/.dsh`（`node scripts/dev-hot.mjs`），② 不影响用户当前正在用的工作台，③ 出冻结包。**
- Setup 最多保留 3 个，超出删最旧。
