# 冻结版改造计划 + `/` 技能菜单 bug 定位

> 目标：在不影响当前工作台的前提下改造冻结版；每次改动升版并保留旧版本；手机端同步。

## 0. 版本与保留规则（必须遵守）

- 现行版本：`0.2.2-rc.1`（安装目录 / payload / FROZEN-BUILD.json 三处一致，已核验）。
- 每次改动：**先快照被改文件 → 再改 → 用 `Build-FrozenSetup.ps1 -Version <新版本>` 重打包**。
- 旧版本一律保留：仓库根的 `DeepSeek-Harness-Frozen-Setup*.exe` 与其 `.sha256` 不覆盖，快照进 `backup-frozen-<旧版本>-<时间戳>/`。
- 工具：`scripts/release.ps1`
  - `-Action status`：核对安装版 / payload 版 / 已出包版本 / 快照，并校验每个 Setup 的 sha256。
  - `-Action snapshot -Version <旧版本> -Include <路径...>`：按文件或目录快照，产出 `SNAPSHOT.json`（含 SHA-256），已存在则拒绝覆盖。

现状核验（2026-11-08）：

```
installed   desktop 0.2.2-rc.1   dsh runtime 0.2.2-rc.1
payload     desktop 0.2.2-rc.1   frozen 0.2.2-rc.1   upstream c59d10a
shipped     Setup.exe 392.5 MB sha OK    Setup-0.2.2-rc.1.exe 418.1 MB sha OK
backups     backup-frozen-0.2.1-rc.5-20261107-190421 (173 files / 394.7 MB)
```

## 1. `/` 不弹技能菜单 —— 代码级定位

结论：**这不是"技能"模块的问题，是输入机的 guard tier 把 `/` 整个关掉了。** 位置在
`resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`：

```js
/** Guard tier from the machine phase. */
function guardOf(phase) {
  switch (phase) {
    case "plain": return "plain";
    case "claimed": return "claimed";
    default: return "frozen";        // adjudicating / submitting / sending
  }
}
```

会话把 phase 换算成 tier 后传给触发管线：

```js
this.deps.inputTriggers?.()?.track(this.projection.detectText, caret, { tier: guardOf(this.core.state.phase) }, this.rev);
```

`dsh-client-ui-input-trigger/lib/client.js` 的纯核 `detectTrigger` 第一行就是硬闸：

```js
const detectTrigger = (draft, caret, guard) => {
  if (guard.tier === "frozen") return null;   // 直接不产生任何 hit
  ...
  if (guard.tier === "claimed") continue;     // "/" 被完整抑制，只有 "@" 还活着
```

所以：

| phase | tier | `/` | `@` |
|---|---|---|---|
| `plain` | plain | ✅ | ✅ |
| `claimed` | claimed | ❌ 被抑制 | ✅ |
| `adjudicating` / `submitting` / `sending` | frozen | ❌ | ❌ |

`claimed` 的进入点是提交机：

```js
followCommand(command) {
  if (this.phase !== "plain" && this.phase !== "claimed") return [];
  this.claim = command;
  this.phase = command === void 0 ? "plain" : "claimed";
}
...
onCommandSettled(ev) {
  this.claim = ev.command;
  this.phase = ev.command === void 0 ? "plain" : "claimed";   // 命令自己把 chip 留在了草稿里
}
```

**因此"开启目标后按 `/` 没反应"的机制是**：`/goal` 结算后命令把 claim（草稿里的命令 chip）留在输入框里，phase 停在 `claimed`，`/` 从此被抑制，而 `@` 仍然可用——正好对上"按 / 没弹出来"。

待办（下一轮）：确认 `/goal` 是否真的返回了长驻 claim。
- 若是：修 `onCommandSettled` 的成功分支——命令结算且**没有待补参数**时清 claim 回 `plain`，或在 `guardOf` 里让 `claimed` 仍放行 `/`。
- 若否：另需一条可复现会话（目标开启 + 一轮正在跑时 phase 处于 `sending`）来确认另一种触发路径。

## 2. 其它待做（按落地成本排序）

1. **不用工作区新建对话**（已定位到可改的两处，见 §4）
2. **并行副会话**：用 `subagents` + `conversation.view`/`sidebar.right` 组合，主会话运行时开多个副会话面板。
3. **多工作区**：会话模型是单 `workspaceId` + 单 `cwd`，需要动 Host 侧会话头与文件作用域，属于改运行时。
4. **手机端同步**：`mobile/DSH-Remote-*.apk` + `Install-MobilePlugin.ps1`，随冻结版一起升版。

## 3. 已完成的独立交付

- `@local/dsh-toolcall-tone`：MCP / 插件工具调用独立配色，已安装生效（见 `.trellis/tasks/11-08-mcp-toolcall-highlight/prd.md`）。

## 4. 「不用工作区新建对话」——可行性已用代码坐实

### 4.1 Host 侧已经支持（不需要改）

`dsh-api-session-controller/lib/index.js` 的 `create(request)`：

```js
if (request.workspaceId !== void 0 && request.cwd !== void 0)
  throw new RemoteError("gateway/bad-request", "session.create accepts workspaceId or cwd, not both", {});
let workspace;
if (request.workspaceId !== void 0) { workspace = this.ctx.workspaceRegistry.get(request.workspaceId); ... }
const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd;
```

即：**`session.create` 本来就可以只传 `cwd`、不传 `workspaceId`**（还给了 `defaultCwd` 兜底）。侧栏也早有 `UNGROUPED_KEY` 分组承接不属于任何工作区的会话。所以这不是运行时限制，是纯前端限制。

### 4.2 真正的两道前端闸

**(a) 新建会话的客户端创建路径只发 workspaceId**

`dsh-client-ui-workspace/lib/client.js`：

```js
return this.createNamed({
  workspaceId: workspace.workspaceId,
  ...blank === void 0 ? {} : { sessionId: blank },
  ...options.agentPreset === void 0 ? {} : { agentPreset: options.agentPreset }
});
```

**(b) 没有工作区 chip 时输入框直接 inert**

`dsh-client-ui-conversation/lib/client.js`（ConversationRoot）：

```js
const inert = sessionId === void 0 || hero && chipTitle === void 0;
const inputBar = renderSlot("conversation.composer.bar", {
  variant: hero ? "hero" : "composer",
  ...inert ? { disabled: true, placeholder: t("placeholder.workspace"), ... } : ...
});
```

`chipTitle` 来自选中的 workspace，没有 workspace 就永远 `undefined` → composer 永久 disabled，于是"不添加工作区"在 UI 上无法成立。

### 4.3 落地做法（下一轮）

1. 改 `dsh-client-ui-conversation`：`inert` 判定改为「有 sessionId 且有 cwd 即可输入」，无 workspace 时用 cwd 作为 chip 文案。
2. 改 `dsh-client-ui-workspace`：`WorkspacePicker` 增加「不使用工作区」项，走 `sessions.create({ cwd })`（cwd 默认取 `defaultCwd`，或经 `ctx.remote.directoryPicker.pick()` 选目录）。
3. 两处都在 frozen payload 里，按 §0 规则先快照、改完 `-Version 0.2.3-rc.1` 重打包，旧包与快照保留。

### 4.4 为什么必须动冻结版

两处都在 `resources/app/dsh/node_modules/@deepseek-ai/` 的已编译 bundle 里，不是插件能覆盖的扩展点（`conversation.composer.bar` 虽是槽位，但 `inert` 计算在宿主组件内部，shadow 槽位拿不到它）。用户已明确授权改冻结版并按规范升版。

### 1.1 修正：claim 不是残留源（已用代码证伪）

`dsh-client-ui-conversation` 的 `onSubmitSettled(ev)`：

```js
if (ev.ok) {
  this.phase = "plain";
  this.claim = void 0;          // 成功结算一定清 claim，回 plain
  ...
}
const text = ev.message ?? ev.outcome?.text;
this.claim = ev.command;        // 只有失败才把 claim 挂回去
this.phase = ev.command === void 0 ? "plain" : "claimed";
```

所以"`/goal` 成功后 chip 一直留着把 `/` 憋死"这个假设**不成立**。剩下两条候选：

- **候选 A（最可能）**：目标在跑时会话一直 busy，`composerBlock !== void 0`，输入框被置为 blocked（占位符变成阻断原因），`/` 根本进不到触发管线。
  验证方式：目标运行中看输入框是否变灰、占位符是否变成提示语。若是，则"`/` 没反应"是 composer 被阻断，不是菜单 bug。
- **候选 B**：某条命令**失败**后 claim 挂回、phase 停在 `claimed`，此时 `/` 被 `detectTrigger` 的 `guard.tier === "claimed"` 分支跳过，只有 `@` 还活着。

两种候选的修法不同：A 要放开"目标运行中仍允许发命令"；B 要改 `guardOf`/`detectTrigger` 的 claimed 策略。**在拿到一次现场观察前不动刀**，避免把输入机改坏。

## 5. 规范：本地优先于官方（已写入 AGENTS.md）

官方上游功能与本地冻结版功能冲突时，**保留本地功能**；官方只作增量吸收，不得覆盖或回退本地定制。配套规则：只改 payload、补丁脚本化且可重入、改前快照、改后升版、旧版本一律保留、手机端同步。

## 6. 副会话（Ctrl+;）——已打进 payload

实现：`frozen-build-src/patch-side-session.js`，在 `dsh-client-ui-workspace` 的快捷键注册处插入一条 `session.side`。

- 绑定：桌面 `Ctrl+;`（`code: "Semicolon"`, `modifiers: ["primary"]`），Web 端退化为 `Ctrl+Alt+;`，与官方 `session.fork` 的 Web 降级规则一致。
- 行为：调用官方 `navigation.forkSession(originId)`——fork 出的是**真会话**，有自己的 agent loop，主会话在后台继续跑。
- 多副会话：`sideOrigin` 记住你第一次按时的会话，之后每按一次都从**同一个主会话**再开一个副会话，不会出现"fork 的 fork"链。
- 守卫：无会话 → blocked(`shortcut.noSession`)；空白会话且没有已知主会话 → blocked(`shortcut.noCompletedTurn`)；fork 失败沿用官方 `reportForkFailure` 分类提示。
- 校验：`node --check` 通过，278631 → 279749 字节。

未做（下一轮）：副会话的并行可见面板（右侧 `sidebarRightTabs` 已确认可按 kind 注册 tab body，`ctx.sidebarRight.openTab(kind)` 可编程打开），以及把副会话回答回灌主会话。

## 7. 可驱动的沙箱宿主（复现 UI 用，已跑通）

桌面端的 web origin 需要 token，外部浏览器进不去；但用 payload 自带的 runtime 起一个**独立实例**就可以：

```powershell
$env:DSH_HOME='E:\claude\project4\pj\.harness-sandbox'
robocopy D:\dsh-freeze-new\payload\dsh-home\profiles\desktop $env:DSH_HOME\profiles\web /E
# 先把沙箱 profile 里 dsh-artex 的 enabled / autoStart 改成 false，避免和正在跑的 ARTEX 抢 8787
& D:\dsh-freeze-new\payload\resources\runtime\primary-runtime\dependencies\node\bin\node.exe `
  D:\dsh-freeze-new\payload\resources\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js `
  web --port 52700 --host 127.0.0.1 --no-open
```

启动行会打印带 token 的地址（`http://127.0.0.1:52700/?token=...`），Tabbit 直接用这个地址就能驱动真实 UI。

**已验证**：页面加载、侧栏、composer、插件弹窗都正常渲染。
**未通过**：首启的「用户须知 / 预览版说明」两个模态框挡着 composer，点击"继续"后仍有一个 dialog 存在，`/` 打不进去（`editorText` 始终为空）。下一步改成按 dialog 内按钮文本精确定位并逐个确认，或直接清掉对应的 localStorage 标记再 reload。
**注意**：模态框里有一个按钮会拉起 `platform.deepseek.com` 的 OAuth 授权页（已关闭，未授权）。驱动脚本里要避开这类按钮。
