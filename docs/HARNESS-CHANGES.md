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

### 7.1 沙箱跑通后的实测结论（2026-11-08）

驱动方式修正：`page.keyboard.type()` 直接打不进 Lexical，必须先 `document.querySelector('[contenteditable=true]').focus()` 再 `keyboard.type`；`locator.click()` 在这个 composer 上不聚焦。

**基线**：全新会话输入 `/` → `role=listbox` 出现，25 条候选（8 条命令 + 17 条技能）。

**开启目标后**：输入 `/goal 长任务测试` 回车 → 目标建立（本轮因缺少模型凭据立即失败 → 显示「已暂停的目标」），随后再输入 `/` →

```
listboxes: 1   optionCount: 30
```

**菜单照常弹出，命令和技能都在**。所以"开启目标导致 `/` 不出技能"在干净环境里**不成立**，此前所有代码层假设也全部被证伪：

| 假设 | 结论 |
|---|---|
| composerBlock 阻断输入框 | 证伪（无任何插件调用 `set`） |
| 命令成功后 claim 残留 | 证伪（`onSubmitSettled` 成功必回 plain） |
| userText 规则 id 冲突 | 证伪（commands 包无该调用） |
| 目标存在就压死 `/` | 证伪（实测 30 条候选） |

**剩余唯一未测的状态：目标正在跑（会话 busy）时的 `/`。** 沙箱缺 `OPENCODE_GO_API_KEY`，一轮立刻失败，拿不到 running 状态。下一轮在该沙箱里补上凭据（用本机已有 key），让目标真正跑起来，再测 `/`——那条路径对应 `guardOf(phase)` 的 `sending → frozen` 分支，是现在唯一还能解释"按了没反应"的机制。

沙箱凭据不写入仓库，只进 `.harness-sandbox/`（已 gitignore）。

## 8. 装机/打包含量自检

`scripts/verify-install.ps1 -Tree <目录>` 一次核对三类事实：版本戳是否一致、三个冻结补丁标记是否还在、两个本地插件是否注册且文件存在。

实测：

```
payload (D:\dsh-freeze-new\payload)          14 passed, 0 failed   version 0.2.4-rc.1
已安装 (…\DeepSeekHarnessFrozen, 0.2.2-rc.1)  7 passed, 7 failed   三个补丁 + 两个插件全部缺失
```

已安装那 7 个 FAIL 是**正确结果**——它还是 0.2.2-rc.1 的老包。以后装完 0.2.4-rc.1 再跑一次，应该 14 项全 PASS；跑出 FAIL 就说明包没打对，而不是功能有 bug。

## 9. 0.2.4-rc.1 隔离装机验证

用 payload 的 `install.ps1` 装到 `E:\claude\project4\pj\.install-test`（HomeDir 独立），**没碰当前工作台**：

```
59783 files / 2284.2 MB
verify-install → 14 passed, 0 failed   version 0.2.4-rc.1
```

装出来的实例能正常启动（`dsh web --port 52800`），且 `__FROZEN_NODE__` 占位符已被安装器替换干净——说明安装链路的占位符替换是好的。

**发现一个关键状态**：全新装完、还没真正创建会话时，首页处于「hero」态：

- composer 不可聚焦（`editor.focus()` 返回 false）
- 「选择工作区」chip `enabled:false / receivesEvents:false`

原因在源码里：`storedChipTitle = pendingWorkspace?.title ?? (sessionId === void 0 ? void 0 : …)`——**没有 sessionId 时 chip 永远是占位文案**，`inert` 恒为 true，于是 `/` 在这个状态下打不出来（也打不出任何东西）。

这条正好解释了"按 / 没反应"的一个真实可能：**在没有真正会话的首页/空白态按 `/` 本来就不会有菜单**。下一轮要验证：点「新建会话」真正建出空白会话后，chip 是否恢复可用、我们的「不使用工作区」项是否出现并被点得到。

### 9.1 修正：上一节的 hero 失效是测试假象，不是应用 bug

上一节说"全新装完首页 composer 不可聚焦、chip disabled"——**那是被「预览版说明」模态框的遮罩挡住导致的**（`occludedBy: div`、`fixed z=1000`）。我先前只删了 dialog 节点、没删遮罩，于是整页 `receivesEvents:false`。真正把模态框按掉之后：

```
dialogs: 0   fixed 遮罩: 0
chip enabled: true   composer focusable: true
```

所以 hero 态没有失效问题，那条结论作废。

### 9.2 「不使用工作区」在装机版上完整跑通

在隔离装好的 0.2.4-rc.1（52800）上实测：

```
选择工作区 → 菜单三项：
  默认工作区
  不使用工作区          ← 我们的补丁
  添加工作区…

点「不使用工作区」后：
  侧栏出现「未分组」分组，新会话建在里面
  顶部 chip 从「选择工作区」变成 pj（cwd 的 basename，说明 chipTitle 回退生效）
  composer 可聚焦 = true
  再打 `/` → 菜单正常弹出（命令 + 技能齐全）
```

这条把「无工作区新建会话」从"补丁写对了"升级为"装机版真机可用"。

## 10. 重要纠错：插件"没加载"是我跑错了 profile

上一轮在隔离装机里发现 `style[data-plugin-css="@local/dsh-toolcall-tone/highlight.css"]` 不存在、`__DSH_BOOT__` 里也没有 `@local`，一度怀疑插件 manifest 有问题。

真实原因：`dsh web` 启动的是 **profile `web`**，而安装器把插件注册在 **profile `desktop`** 里。装机 HomeDir 下 `profiles/web` 只是模板（只有 `@deepseek-ai/dsh-base` + `dsh-web-app`），插件当然不在。**桌面壳本身启动的是 `desktop`，实际不受影响。**

把 `profiles/desktop` 复制成 `profiles/web` 后重测：

```
bootHasLocal: true
localHits: ["@local/dsh-toolcall-tone", "@local/dsh-toolcall-tone/client.js&rev=9eea4885cd12", …]
stylePresent: true
styleHasMcp:  true          # 样式表里确实有 [data-tool^="mcp__"]
```

GitNexus MCP 也随之启动，说明整条插件链是活的。

**方法论教训**：用 `dsh web` 验证冻结版功能时，必须先把 `profiles/desktop` 镜像到 `profiles/web`，否则测的是模板 profile。

同时把插件 manifest 的 `dsh.client` 对齐到已验证可用的 `dsh-plugin-scope` 形状（`inject` 非空、去掉 `immediately`），随 0.2.5-rc.1 重新出货。
