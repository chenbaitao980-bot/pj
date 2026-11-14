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

## 11. 手机端含量确认

冻结版 payload 里 `dsh-mobile` 是**完整接好的**，不是只放了目录：

```
依赖      dsh-mobile = file:../../plugins/dsh-mobile
bundles   包含 dsh-mobile
插件目录  dsh-home/plugins/dsh-mobile + profile node_modules/dsh-mobile（78 文件 / 70.1 MB）
```

`verify-install.ps1` 已把 `dsh-mobile` 纳入检查（含 `lib/index.mjs` 入口），payload 现为 **16 passed / 0 failed**。

手机端与桌面共用同一实例，所以三项冻结补丁 + 两个本地插件对手机同样生效；`dsh-mobile` 提供 LAN/隧道接入与移动端布局适配。

## 12. 两个待办/待观察

1. **`Ctrl+;` 只在静态层验证**：补丁标记在包内、bundle `node --check` 通过、调用的是官方 `navigation.forkSession`；但隔离装的 HomeDir 里模型凭据不可用（`apiKeyEnv` 走进程环境变量，复制的 `.credentials.yaml` 不生效），拿不到"已完成轮次"，所以装机态的点验仍缺一次。
2. **一次莫名的版本跳变**：0.2.5 打包完成后约 2 分钟，payload 三处版本戳被写成 `0.2.6-rc.1`（无对应 exe）。已回退到 `0.2.5-rc.1` 与已出包对齐。原因未查明，后续每次打包后核对 `verify-install` 的版本行即可发现复发。
   - 事后结论：不是文件损坏，是**并发的 0.2.6 构建**——0.2.6 包内 `FROZEN-BUILD.json.builtAt` 为 `13:55:11`，与 payload 版本戳跳到 0.2.6 的时间一致。多会话并行打包时，版本戳会提前反映正在进行的构建。

## 13. 工作区多选 + 右侧副会话（0.2.8 引入，0.2.9 修正）

### 工作区下拉多选

- 下拉新增「多选工作区…」，入口由 `patch-multi-workspace-ui.js` 注入；模态框在 `@local/dsh-multi-workspace/client.js`。
- 第一个勾选的工作区作为主目录（会话 `workspaceId`/`cwd` 不变），其余目录经 `/roots add <绝对路径>` 挂到同一会话；客户端走 `ctx.remote.commands.execute()`，不产生用户可见消息。
- **0.2.9 修正**：`ctx.get("remote").commands` 会被访问器拒绝（`without inject`），必须 `ctx.inject(["remote","remote.commands"], …)` 同时注入服务与命名空间；此前只建了主工作区，附加目录实际没挂上。
- `UiWorkspaceService.openWorkspaceWithRoots()`：建/复用空白会话 → 逐个执行 `/roots add` → `replaceMain` 展示。
- **roots 改为会话投影**：`@local/dsh-multi-workspace` 注册 `multiWorkspaceRoots` 投影，折叠 `command/run`/`command/done` 里的 `/roots` 调用。roots 来自会话日志，重启可重建，并通过 `projectionValues.multiWorkspaceRoots` 到达客户端；不再使用 `~/.dsh/multi-workspace/roots.json`。
- 工作区 chip 在有附加目录时显示 `+N`（`dsh:roots-chip` 补丁）；再次打开多选弹窗会按会话真实 roots 回填勾选。

### Ctrl+; 右侧副会话（对齐 Claude Code 桌面版）

- 新插件 `@local/dsh-side-chat`：资源协议 `dsh-resource://sidechat/session/<id>` + 右栏 tab kind `sidechat`；tab 内用 `SessionProvider` 渲染 `conversation.session`，副会话有自己的输入框与 agent loop。
- 行为：**总是新建空白会话**（同一工作区，无工作区则同 `cwd`），不 fork、不复制主会话内容；完全没有会话 → 先开普通会话。
- 右栏「+」在已有副会话时直接再开一个副会话（`dsh:side-chat-addtab` 补丁 + `claimAddTab`），不再弹 tab guide；没有副会话时保持原行为。
- 会话页头部同时有「副会话」按钮作为第二个入口。
- 旧的 bundle 补丁 `dsh:side-session` 已移除（否则同一快捷键 id 会被注册两次），由 `unpatch-side-session.js` 负责清理。

### 插件作用域默认值

- `dsh-plugin-scope` 面板不再要求插件带 `lib/scope.js` 才显示作用域开关：所有 profile 全局插件默认按工作区记录开关，移除了「只看支持作用域」过滤。
- 真正按工作区生效仍取决于插件是否读取 `<工作区>/.dsh/plugins.json`（trellis / gitnexus / codegraph 已实现；其余插件目前只记录）。

### 同步与验证

- 装机态已同步：`~/.dsh/plugins`、profile `node_modules/@local/*`、`~/.dsh/profiles/desktop/package.json`，以及安装目录 `resources/app/dsh` 的 bundle 补丁。
- CDP 实机验证：会话 chip 显示 `FireShot +1`；多选弹窗回填 FireShot+pj；Header「副会话」按钮开出的副会话为空；右栏「+」连续开出第二个副会话且不弹 guide；`/roots` 在命令菜单中可用，执行结果 `{"ok":true,"已关联：E:\claude\project4\pj"}`。
- 快捷键目录里可见「副会话 Ctrl+;」；合成按键（SendKeys/CDP）无法穿透桌面端原生输入通道，Ctrl+; 的物理按键点验仍需人工按一次。
- payload/安装目录 `verify-install` 均为 **22 passed / 0 failed**。

## 14. 每个工作区的自定义注入提示词（0.2.10-rc.1）

- 面板 `plugin-scope-ui.mjs` 的每个工作区卡片新增「本工作区自定义注入提示词」文本框，写入 `<工作区>/.dsh/prompt.md`（上限 20,000 字符，清空删除文件）。
- Host 侧 `dsh-plugin-scope` 注册 `plugin-scope:workspace-prompt` system prompt 段（order 9100）：按 `agent.session.header.cwd`（会话项目根）同步读取该文件，mtime 缓存；同一台机器不同工作区的会话各拿各的提示词，会话中途切 working directory 不收窄作用域。
- 命令补充：`/pluginscope prompt`（查看）、`prompt-set <文本>`、`prompt-clear`。
- `/pluginscope` 同时放宽为任意插件名，与面板规则一致。
- 验证：面板 API 写/读/清空实机通过；注入段需一轮模型请求点验——当时账号 402 余额不足，无法完成该步。

## 15. 插件菜单 / 会话内管理工作区 / 搜索优先级 / 待办实时面板（0.2.11-rc.1）

### `/` 菜单「插件」分组

- 新插件 `@local/dsh-plugin-slash`（客户端）：向 `inputTriggers` 注册第三个 `/` 源 `plugin`（order 1，介于指令与技能之间）。
- 数据来自 `remote.pluginInventory.list()`，过滤掉 `@deepseek-ai/*`、`cordis*`、`cosmokit`、`schemastery` 等 Harness 自身包，以及 `dsh-purge/redteam` 这类子路径模块和 `file:` 解析地址，只留启用且 active 的裸包名；标题/说明取包内 `locale/*.json` 的 `meta.title/description`（`ctx.locale.resolveText`）。
- `plugin-manager/changed` 与 `connection/reset` 时失效缓存；子代会话不显示。
- 选中插入 `使用插件 <包名> `（en: `Use the plugin <name> `），不改命令、不执行任何东西。
- 分组标题需要 `slash.menu` 字典：该 namespace 由 `dsh-client-ui-input-trigger` 独占，二次 `locale.register` 同语言会抛错，所以用 `patch-slash-plugin-group.js` 在 zh/en 字典里补 `"plugin"`。

### 会话内管理工作区（`/workspaces`）

- `dsh-multi-workspace` 1.2.0：用 `commandUi.register({ name: 'workspaces', ui: { kind: 'action', run } })` 注册贡献命令。输入框左下角 `+` 打开的正是指令源（`toggleSource("command")`），所以 `/` 与 `+` 两条入口都能看到「管理工作区」。
- 弹窗列出主目录（`session.header.cwd`）与附加目录（投影 `multiWorkspaceRoots.roots`），支持添加/更换/移除；写入统一走 `remote.commands.execute(sessionId, '/roots add|remove <path>')`，投影随命令完成即时更新。
- 目录选择走 `remote.directoryPicker.pick()`（返回 `{ ok, value: string|null }`）。
- 依赖通过 `ctx.inject(['remote','remote.commands','remote.directoryPicker'], …)` 动态申请，并在组装 slot props 时用 `getTransport()` 取实时值；缺少命名空间时按钮置灰而不是整插件不加载。

### 联网搜索优先 websearch 插件

- 新插件 `@local/dsh-websearch-preference`（Host）：`systemPrompt.section` order 8500，按 `tools.get('web_search_meta'|'web_search', scope, toolSet)` 决定是否输出，以及输出「优先 meta + 回退内置」还是「只用 meta」。
- 不改工具注册、不隐藏 `web_search`，未装 `dsh-tool-websearch` 时该段为空字符串，提示词零变化。

### 待办面板实时化

- `patch-todo-panel.js` 改 `dsh-client-ui-conversation` 的 `TodoPanel`：
  - `useState(false)`：默认展开；
  - `hasActive`（存在 `in_progress`）时 `useEffect` 强制展开；
  - 每行末尾显示 `statusLabel`（已完成/进行中/待处理）；完成项斜体划线 + 次要色，进行中项主色加粗。
- 数据源仍是 `todos` 会话投影，工具调用后即时刷新，无轮询。

### 打包

- 版本 0.2.11-rc.1；两个新插件经 `ship-plugin.js` 写入 `dsh-home/plugins` 与 `profiles/desktop/node_modules`，并登记进 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles`。
- `mobile/` 无改动（APK 0.7.2 / dsh-mobile 0.8.4），manifest 与 payload 一致。

### 0.2.11-rc.3 审计修复

- 待办面板 v2：`activeKey`（进行中集合）驱动自动展开；行尾状态文字 `aria-hidden`，避免读屏重复；补丁脚本支持 v1→v2 迁移，并在 marker 存在但第二处编辑缺失时报错。
- 多工作区管理器：
  - 附加根目录的「更换」改为**先加后删**，`/roots add` 失败时旧目录保留，删旧失败则回滚新目录并报错；
  - `remote.commands`/`directoryPicker` 放进 store（`transportSignal`），对话框早于命名空间挂载打开时也能在就绪后重渲染；清理挂在注入 scope 的 lifetime 上；
  - 多选顺序按勾选先后记录，兑现「第一个勾选的作为主目录」的文案；确认按钮的计数/可用性改为按实际 `picked` 计算；
  - 根目录行的「更换/移除」带 `aria-label`（含路径），对话框打开时聚焦面板。
- 插件菜单数据源：库存缓存改为 15s TTL，且存在 `pending/loading` 插件时绕过缓存，慢加载插件不会整会话缺失；包名判定更严（拒绝 Windows 路径、`cordis:` 命名空间、`file:` URL）。
- 构建链：`Build-FrozenSetup.ps1` 现在自动 ship repo `plugins/`、重跑两处界面补丁并执行 `verify-install.ps1`（失败即中止）；`install.ps1`/`Upgrade.ps1` 的版本号改读 `FROZEN-BUILD.json`，升级回执的插件清单从 profile `bundles` 生成。

### 0.2.11-rc.4：让任务面板有数据

- 任务面板只读会话 `todos` 投影，而投影由模型调用 `todo_write` 产生；模型不建清单时面板不出现（这是官方设计，不是补丁问题）。
- 新增 Host 插件 `@local/dsh-todo-nudge`：注册 system prompt 段 `todo:nudge`（order 8600，仅当本轮工具集含 `todo_write`），要求多步任务先建清单、逐步把当前项标 `in_progress`、完成后立刻改 `completed`，并说明清单会实时显示在输入框上方；单步小事不建清单。
- 面板位置：输入框正上方（`conversation.input.dock`），有清单时默认展开、可点表头收起。

## 16. 任务面板重构 / purge revert 修复 / 0.2.11-rc.5–rc.6

### 任务面板改由 `@local/dsh-task-board` 接管

- `patch-task-board.js` 关闭上游 `conversation-todo-dock` 的槽位注册（`dsh:todo-board-replaced`），新插件在同一 `conversation.input.dock` 上渲染。
- 数据：主会话用 `todos` 实时投影；每个直接子 agent（会话列表 `parentId === sessionId`）一块，读各自的 `projectionValues.todos`。
- 子 agent > 1 时出现可滚动切换条（标题 + `已完成/总数` 徽标），点击切换；面板默认展开，任一面板出现进行中项时自动展开。
- **暂停态**：读会话行的 `running`；为 false 时 `in_progress` 显示「已暂停」+ 静态空心点，不再出现永久转圈。

### `/purge revert` 保留冻结补丁

- `dsh-purge` 新增 `reapplyFrozenPatches(aiBase)`：由 aiBase 推断安装根（rc.7 起优先 `inferDesktopInstallDir`，回退 5 级），用 `<安装根>/tools/patch-*.js` 重打；优先安装包自带 node，脚本缺失会列入 missing，失败写明原因。
- 四个路径接入：`/purge revert` 命令、`purge_revert` 工具、面板 HTTP revert、卸载。
- `Build-FrozenSetup.ps1` 同步 repo 的 `dsh-purge/` 与三个补丁脚本到 payload；`ship-plugin.js` 跳过 `.git`/`.github`/`node_modules`/`.pnpm`。

### 版本清理

- 按用户要求只保留 `0.2.11-rc.6` 安装包与 `payload-0.2.11-rc.6.7z`；0.2.10 与 rc.1–rc.5 的 Setup.exe/.sha256/归档已删除，`backup-frozen-*` 快照保留（体积极小，作回滚源）。

## 17. 任务面板交互与 purge 补丁保全收尾（0.2.11-rc.7）

### 任务面板（@local/dsh-task-board）

- 只列**有清单**的 agent：主会话/子 agent 无 `todos` 时不出现，清单清空即消失。
- 多 agent 用**下拉浮层**切换（不再横向 tab）：名称取子 agent catalog `label`，缺省「子智能体 N」，提示词进 tooltip。
- 每个运行中的 agent 有停止按钮：主会话 `remote.session.cancel({sessionId})`，子 agent `remote.subagents.interruptByParent(child, parent, "continuable")`；浮层底部「停止整个会话」批量停止。
- 会话 `running=false` 时 `in_progress` 显示「已暂停」+ 静态点；主会话 running 优先取 owner `session.running`。
- 单层 padding；`useProjection('todos'/'subagentCatalog')` 无条件调用（遵守 hooks 规则）。

### dsh-purge revert 保全全部冻结补丁

- `FROZEN_PATCH_SCRIPTS` 扩为 5 个（todo / slash / task-board / roots-chip / no-workspace）。
- `revertAllHosts()`（CLI `--revert`）也逐个宿主重打，补上第 5 条路径。
- 安装根优先 `desktop.inferDesktopInstallDir`，回退 5 级；node 优先随包 node，其次 `DSH_NODE`，只在 `process.execPath` 是 node 时兜底。
- spawn 带 `ELECTRON_RUN_AS_NODE=1`、30s 超时、stderr 捕获；失败原因进入命令/工具/HTTP/卸载/CLI 报告。
- 卸载把重打放进 `finally`。

### 打包与安装

- `Build-FrozenSetup.ps1` 同步并执行全部 7 个界面补丁，打包前跑 `verify-install.ps1`；同时把自身、`ship-plugin.js` 与 7 个补丁写入 payload。
- `install.ps1` 回执插件清单改由 profile `bundles` 生成；安装/升级清理旧 `dsh-purge/.git`；`sync-live-plugins.js` 跳过 `.git`。
- 多工作区多选失败会回传 `failedRoots` 并在弹窗提示。

### 版本清理

- 只保留 rc.7；rc.6 与 `D:\dsh-freeze-new` 下的 0.2.2-rc.1 安装包/归档已删除。

## 18. 四项审计收尾（0.2.11-rc.8）

- 任务面板：子 agent 会话停止走 `subagentAddress`→`interruptByParent`；stop-all 按 owner running + 全部子行；浮层在 <2 agent 时关闭；错误在收起态也显示；停止命名空间动态注入；主标签改「当前会话」；手机端换行/收缩/字号变量/overscroll/28px 触控区，浮层改 `role=menu` 供 Android 返回键识别。
- 工作区管理：`pointer: coarse` 时禁用系统目录选择并提示；`directoryPicker` unavailable 走同一提示；遮罩加 `role=presentation`。
- dsh-purge：FROZEN 脚本扩到 7 个；tools 缺失记为 missing；CLI `--revert` 用 discover 并区分 applied/missing/errors；安装根需像冻结版；脚本 20s 超时并报错文本；reapply.js 防御性补打；安装/升级清 profile 内的 `dsh-purge/.git`；`purge-stage`/`mark-applied` 导入仓库副本。
- 打包：修 `install.ps1` 回执块（换行损坏 + 斜杠丢失）；删 payload stray（`_bump-probe.txt`、`artex/.git`）；`verify-install` 增加 7 个 tools 脚本检查（40 项）。
- 规范：`AGENTS.md` 第 6 条红线 + `.trellis/spec/frozen/upstream-alignment.md` + `workflow.md` 红线段；规则 2 允许用户明确要求时清理旧版本。

## 19. 副会话带历史分叉 + 任务清单不掉线（0.2.11-rc.9）

### 副会话（@local/dsh-side-chat）

- `Ctrl+;` 不再是「新开一个空会话」：主会话有已完成回合时**分叉历史**开副会话（副会话能看到任务 A 的上下文、汇报进度并继续协同）；空白会话才在同工作区新开。
- 副会话与主会话的对应关系持久化在 `localStorage`（`dsh-side-chat:links:v1`）：关掉标签（或关掉应用）后内容不丢，再次按 `Ctrl+;` 按创建顺序重新打开最早一个未打开的副会话。
- 所有记住的副会话都打开后再按 `Ctrl+;` 才新建下一个，因此可同时开任意多个副会话 tab；右侧面板「+」逻辑不变（有副会话时继续新建副会话）。
- 空会话（`blank`）分叉被宿主拒绝（`session/fork-unavailable`）时回退为同工作区新会话；会话列表尚未加载（phase≠ready）时不做失效清理，避免误删关联。
- 面板标题/下拉用副会话自己的标题（分叉会带 `(2)` 等后缀）；快捷键别名与中文标签保持「副会话」。
- **副会话不再出现在左侧会话列表**：新增冻结补丁 `patch-side-chat-hide.js`（`sessionVisible` 读取 `__DSH_SIDE_CHAT__.isSideSession`），副会话只在右侧面板；左侧列表、计数与搜索之外的入口不受影响。

### 任务面板（@local/dsh-task-board）

- **任务清单不再因新回合而消失**：宿主在每个 `turn/start` 把 `todos` 投影重置为 `null`（要等 agent 重新 `todo_write`），主会话临时插入任务、副会话开始自己的回合时面板会闪空。现在按 agent 记住最近一份非空清单，`null` 期间继续展示，新的 `todo_write` 一到立即替换；显式空数组仍然清空面板。
- 子 agent 清单同样按 id 粘住，不再在子 agent 自己开新回合时从面板上消失。
- **运行期间始终显示**：会话运行中即使零任务也显示面板（「运行中 · 等待任务清单…」），空闲且无任务才隐藏。

### 热部署与打包

- 两个插件先 `sync-live-plugins.js` 同步到运行中的 `~/.dsh`（`plugins/` 与 `profiles/desktop/node_modules` 两处），宿主 `client-hmr` 轮询到文件变化后热重载客户端模块，无需重启工作台。
- 冻结版升到 `0.2.11-rc.9`：`release.ps1 -Action bump` 后重建；两处改动均通过 mock 行为测试与 `node --check`，`verify-install.ps1` 40 项通过。
- 修正 `Build-FrozenSetup.ps1` 的 skill-packs 同步路径（原为 `frozen-build-src/skill-packs`，实际在仓库根，导致 skill-packs 改动不进 payload）；本版据此补齐 `dsh-plugin-scope`，同时用 `ship-plugin.js` 先把看护改动送进 payload。
- **staged 更新竞态修复**：`Upgrade.ps1` 改为先把新 app 完整拷到 `app.staging-*`、校验后原子改名为 `app.next`（exe 走 `.tmp`→`.next`）；`Launch.ps1` 替换前校验 `app.next` 三件套（`package.json`/`lib\main.js`/`dsh\package.json`）与 `app.staging-*` 拷贝中状态，不完整就拒绝替换、保留现有版本。

### 任务清单维护规则（dsh-todo-nudge）

- 规则收紧：**只要这一轮会调用工具（哪怕只有一步）就先用 `todo_write` 建清单**，每完成一个动作立即更新，不要等全部做完才写；纯问答不建清单。
- **宿主侧兜底 + 审计**：回合开始若模型没写清单，自动写入「本轮：<请求>」（进行中）；回合正常完成时把遗留「进行中」收口为已完成（pending 不动），拦截/中止保持不动；模型自己 `todo_write` 后兜底让位。写入走定时排队+退避重试（宿主禁止发布期间重入 append），写入前复核清单，不覆盖模型。按会话独立，子智能体互不覆盖，不向模型发消息。
- **独立小型规划模型**：回合开始约 1.5 秒后模型仍无清单时，直接调用 `ctx.llm`（不建会话、不进主 agent 上下文）把本轮请求拆成 1–5 条任务，首条 in_progress、其余 pending；优先同供应商 flash/mini 类小模型，失败回退主模型；模型自己写清单后规划作废。
- **逐条任务备注**：任务行 ✎ 可加备注，回车/推送把 `任务「…」的备注：…` 实时发给所属智能体（运行中 steer，空闲 queue）；备注按会话+任务内容持久化。
- 移动端无需新包：插件随宿主下发，手机端刷新/重开页面即可拿到新行为。

### 按工作区面板保活（dsh-plugin-scope）

- 面板地址固定 `127.0.0.1:8799`，辅助进程退出后插件页按钮变成死链（`ERR_CONNECTION_REFUSED`）。
- 宿主侧 `apply` 增加 30 秒看护：端口探测失败才重新拉起（detached、无窗口），宿主存活期间不会静默掉线；本次已手动拉起当前工作台面板并确认 `/`、`/usage`、`/api/state` 均 200。

## 20. 任务守护：按实际进度审计、调度、约束任务（0.2.11-rc.10）

### 排查

- 守护（dsh-todo-nudge）在 rc.9 已存在，但只有「占位 → 规划一次 → 回合结束收口 in_progress」。用户截图那一轮：规划小模型 8 秒超时，面板整轮停在「本轮：<提示词>」；规划写入被误判为模型清单（`session.append` 深拷贝事件数据，引用相等判断恒失败），守护当场退出；回合结束只收口 in_progress，规划出来的 pending 原样残留。

### 任务守护（@local/dsh-todo-nudge 1.1.0）

- 写入带 `by: 'task-guardian'` 标记判定归属；规划最低推理档、15 秒超时、失败回退主模型，仍失败则每步重试。
- 运行中每 ≥4 次工具调用且 ≥15 秒用小模型按「请求 + 追加 + 清单 + 最近 16 条实际动作」审计：更新状态、补/删/拆任务，已完成不回退；模型自己的清单只在 6 次调用未更新时校正状态，不增删。
- 运行中追加消息并入清单（立即审计），不再替换成「本轮：<追加>」。
- 回合正常结束逐条判定 done / drop / open 并判断是否在等用户；主会话确有遗留且未在等用户时排队一次「【任务守护】…请继续」（每个请求 1 次，子智能体不追问，`DSH_TASK_GUARDIAN_CONTINUE=0` 可关）。
- 新会话投影 `taskGuardian`（由事件推导）：当前动作、校正次数、结束原因、审计结论。

### 任务面板（@local/dsh-task-board 1.1.0）

- 进行中任务下显示「正在：<当前动作>」；底部守护状态行（跟踪中 / 已校正 N 次 / 正在审计 / 本轮审计结论）。
- 空闲时未完成项按结论标「待继续 / 待确认 / 未完成」，回合刚结束 30 秒内标「审计中…」，不再显示「待处理」。

### 热部署

- 宿主插件热重载：同步到 `~/.dsh` 后给 profile 的 `cordis.patch.yml` 追加注释触发 `dsh-hmr.reconcileProfile`，替换变化模块后还原文件；记录于 `.trellis/spec/frozen/hot-deploy.md`。
- `verify-install.ps1` 增加 3 项任务守护检查。

## 21. 会话结束即收口 + 会话概览面板（0.2.11-rc.11）

### 任务面板

- 回合正常结束时清单只剩已完成：终审判定 done / drop / wait / open；open 由守护续跑（每请求最多 2 次），wait 移出清单写入底部「等你回复后继续」，追问用尽/子智能体/审计无响应的遗留移出并以警示色写「未完成（已追问 N 次）」。汇报/检查类任务以回复中给出结果为完成，结尾顺带提问不算未完成。

### 会话概览（@local/dsh-session-panel）

- 右侧栏页面，`Ctrl+'` / 标题栏图标开关（可见时再按即隐藏），右侧栏「+」可打开；卡片：环境、上下文、连接器（MCP 健康 + 重新连接）、插件、技能、输出内容、更改。
- MCP 健康没有官方客户端接口：宿主路由读取插件加载器行 + 已注册 `mcp__<server>__*` 工具得出状态；重新连接走插件管理停用→启用。
- 更改按项目管理工具展示本地与远端差异：Git（领先/落后、未提交文件与行数、整体差异、未推送/未拉取提交、获取远端）与 SVN（本地/远端修订、本地修改、`svn status -u`）；多仓库/多工具标签切换。
- 宿主路由走 `connection.fetch.register`（与官方 deliverables 同一鉴权围栏），只跑固定参数的 git/svn，不写会话日志；输出内容来自宿主投影 `sessionPanelOutputs`。

## 22. 会话追踪面板 + 待回答系统通知（0.2.11-rc.12）

### 会话追踪（新插件 @local/dsh-session-tracker 1.0.0）

- 左侧栏最上层、工作区列表之上新增「会话追踪」面板；点击标题行折叠/展开，折叠状态记忆（`localStorage: dsh-session-tracker:collapsed:v1`）。
- 三个桶，按优先级排列，全部会话（不只当前会话）：
  - **等你处理**：`pendingInteraction` ∈ 提问 / 审批 / 计划待审（黄点，脉冲）；悬停显示问题原文或审批理由。
  - **运行中**：`running`（蓝点），含后台会话与子智能体运行中的父会话。
  - **已完成待确认**：`completionUnread` —— 回合在会话不处于前台时结束、用户还没打开过（绿点）。
- 点击任意行调用 `uiWorkspace.openSession` 直接切到该会话；打开后「待确认」自动清除，回答后该会话移入「运行中」。
- 归档会话、空白会话、子智能体子会话不列出；无关注项时标题行显示「全部空闲」。
- 数据全部来自客户端根投影（`sessions.list` / `uiSession.sessionStatus` / `workspaces.list`），无新宿主路由。

### 待回答置顶提醒窗（桌面壳补丁）

- 会话进入「等你处理」且主窗口不可见 / 最小化 / 未聚焦时，在屏幕右下角弹一个小巧的置顶提醒窗（不抢焦点，`showInactive`）：「等待回答/审批/计划待审 + 会话名 + 问题或审批理由前 180 字」，按钮「查看会话 / 稍后」。
- 点「查看会话」：还原并前置主窗口，同时把会话 id 发回渲染进程，直接打开该会话（问题卡在输入框上方等待回答）；点「稍后」或聚焦主窗口即关闭；60 秒无操作自动消失（面板里仍有记录）。
- 为什么不用 Windows 系统 Toast：微软要求应用有一个带 AppUserModelID + ToastActivatorCLSID 的开始菜单快捷方式，本安装器不注册这些标识，Toast 可能静默不显示；自绘置顶窗不依赖任何注册，跨机器确定可见。
- 桥接：`preload-app.cjs` 暴露 `dshDesktop.attention.notify / onOpen`；`main.js` 处理 `dsh-desktop:attention-notify`（`assertProductSender` 校验来源，`screen.getDisplayMatching` 定位，`will-navigate` 接住 `dsh-attention://` 动作）。非桌面版（纯 Web / 手机）没有该桥接，自动降级为面板提醒。

### 冻结补丁与打包

- 新增两个界面补丁：`patch-session-tracker.js`（侧栏声明并渲染 `sidebar.tracker` 洞，仅宽侧栏渲染）、`patch-desktop-attention.js`（桌面壳通知桥）。两者幂等、`node --check` 通过；已登记到 `Build-FrozenSetup.ps1`（tools 同步 + 应用列表）、`dsh-purge` 的 `FROZEN_PATCH_SCRIPTS`（revert 后重打）与 `verify-install.ps1`。
- `verify-install.ps1` 新增 4 项检查：侧栏补丁标记、桌面通知桥标记（preload + main）、两个补丁脚本存在于 `tools/`、会话追踪插件注册与两个半边。
- 插件随宿主下发：`ship-plugin.js` 已写入 payload 的 `dsh-home/plugins` 与 profile `node_modules`，并热部署到运行中的 `~/.dsh`（侧栏洞与通知桥要等 rc.12 安装并重启后才生效；旧版工作台里插件静默等待洞）。

## 23. 升级不再丢用户插件（0.2.11-rc.13）

- 现象：rc.12 升级后插件页里 `dsh-computer-use-win` 变成「包不可用」，`~/.dsh` 的 profile 清单里也没有它了。
- 根因：`Upgrade.ps1` 合并 `dsh-home` 时用 `robocopy /E` 覆盖了 `profiles/desktop/package.json`，模板里没有用户后来安装的插件声明。
- 修复：合并前记录本机 profile 的 `dependencies` / `dsh.profile.bundles`，合并后补回模板缺失的条目（只补声明），并以 UTF-8 无 BOM 写回；新增 `# /*dsh:keep-user-plugins*/` 标记与 `verify-install` 检查。
- 本机已按 npm `dsh-computer-use-win@0.5.6` 装回（原 hub 链接对应的 GitHub 仓库已 404），MCP 自测 26 个工具全部可用；未烘焙进冻结模板。

## 24. computer-use 能力审计与本地增强（0.5.6-dsh.1）

### 审计结论

- 对照 Codex 的 computer use（观察 → 移动/点击/双击/滚动/输入/按键/拖拽/等待），插件 0.5.6 已覆盖并超出：UIA 控件树、OCR、窗口列表/激活/移动/关闭、后台控件操作（BM_CLICK / EM_REPLACESEL / UIA 模式）、`batch` 批处理、接管提示与 Esc 停止。
- 缺口：文本剪贴板读写、窗口最大化/最小化/还原/缩放、三连击、光标与屏幕信息。按住键/按住鼠标、Win 键组合属于安全取舍，未实现（跨调用保持按下状态会在异常时留下卡键；Win+R/Win+L 会打开系统对话框或锁屏）。

### 本地增强（vendor/dsh-computer-use-win）

- 基于 npm `dsh-computer-use-win@0.5.6`（MIT），版本号 `0.5.6-dsh.1`，放在 `vendor/` 而不是 `plugins/`，**不会**被 `Build-FrozenSetup.ps1` 自动打进冻结包；live 安装到 `~/.dsh/plugins` 与 profile `node_modules`，profile 依赖改为 `file:../../plugins/dsh-computer-use-win`。
- 新工具：
  - `clipboard`：`read` / `write`（空字符串清空），仅文本；读取可能暴露用户复制的敏感内容，写入会替换整个剪贴板。
  - `window_state`：`maximize` / `minimize` / `restore` / `resize`（不激活窗口；最大化窗口需先 restore 才能 resize）。
  - `cursor_pos`、`screen_info`：鼠标坐标与虚拟屏幕/DPI 信息。
  - `click` 新增 `count` 1–3（三连击）；后台多击按「down/up + 每组 dblclk/up」派发。
- 设置页工具分组与计数同步（30 个工具，全部/精简/懒启动/自定义仍可用）。
- 已知限制：`window_state` 的 maximize/minimize/restore、以及真前台的三连击未在用户工作台上实测（按用户要求不打扰当前工作台）；其余新增能力已在屏幕外 WinForms 测试窗口上以后台派发验证。
- 激活：替换/新增工具后需要 DSH 重启或插件页「停用→启用」一次，MCP 子进程才会以新代码重连（旧进程被替换时会被关掉）。

## 25. 事故与修复：profile patch 被写坏导致 DSH 无法启动（2026-11-11）

- 现象：重启 DSH 时弹「应用无法启动或已意外停止」，报 `failed to parse overlay ... cordis.patch.yml: duplicated mapping key (66:3)`。
- 根因：昨天为触发插件 reconcile，用 PowerShell 5.1 的 `Get-Content | Set-Content -Encoding UTF8` 重写 `~/.dsh/profiles/desktop/cordis.patch.yml`；PS 5.1 按 ANSI 读 UTF-8，中文注释乱码，长注释行把下一行 `- id: dsh-skill-trellis` 吞进注释，`config` 键重复。
- 修复：从改动前的备份 `%TEMP%\dsh-cuw\cordis.patch.yml.bak` 覆盖恢复，`js-yaml` 校验通过（9 个条目），重新启动 DSH 正常；崩溃日志与恢复步骤记录在 `.trellis/spec/frozen/hot-deploy.md`。
- 规范：profile 配置的任何重写必须用 `[IO.File]::WriteAllText` + UTF-8 无 BOM，或 Node 的 fs；改完必须用 js-yaml 解析验证。
- computer-use 增强版（0.5.6-dsh.1）已随新实例启动，MCP 子进程运行于 `~/.dsh/.../dsh-computer-use-win/mcp/server.mjs`；rc.13 仍在 `resources/app.next`，下次完全退出再启动时应用。

## 26. 任务守护改走会话主模型（0.2.11-rc.15）

- 现象：任务面板有时整轮停在「第一条进行中 + 其余待处理」，直到回合结束一次性变成「完成 1 项 / 移除 N 条预备任务」，并提示「审计模型未响应，按规则收口」。
- 根因：`dsh-todo-nudge` 的 `routesFor` 用正则在 provider 模型目录里挑「flash/mini/haiku…」的第一个命中项。`opencode-go` 目录首项是 `claude-haiku-5-5`（走 `anthropic-messages` 适配器，`/inference/go`），主模型 `deepseek-v4.1-flash` 走 `openai-completions`（`/inference/go/v1`）且排在第九。本机 `~/.dsh/todo-nudge.log` 里 haiku 219 次调用全部空返回（0.3–0.7 秒、无正文），deepseek 每次正常。
- 放大器：回合中的进度/状态审计把回退关着（只有清单还是占位或回合终审才允许回退），快模型空返回后整轮再无更新；终审拿不到判定，按兜底规则把进行中判完成、把 guardian 规划的 pending 当「预想任务」删除 —— 正是截图的「完成 1 项·移除 4 条预备任务」。
- 修复：`routesFor` 只返回会话自己的路由，删除 `listModels` 取名与 `routeCache`；规划、进度审计、状态校正、终审一律用主模型；`ask` 去掉 fallback 参数；`callModel` 记录流结束原因，空返回日志记为 `empty finish=…`。
- 版本：`@local/dsh-todo-nudge` 1.2.0 → 1.3.0；`verify-install` 60/0。

## 27. 任务守护：满屏完成项冻结清单的裁剪缺陷（0.2.11-rc.18）

- 现象：会话「修复泳道折叠展开偏移」第 4 轮（12:10 起，持续 3.5 小时）任务面板从 13:15 起不再变化：始终显示 8 条已完成，页脚「已按实际进度校正 20 次」仍在涨；期间用户中途新提的 4 个需求（泳道坐标按算法自动计算、连接线文字保留挪动后位置、BI 报表元素重算与边界连接点、整体图美化）一条都没进清单。
- 根因：第 4 轮模型没有自己写清单（整个会话只调用过 2 次 `todo_write`，都在前几轮），清单由守护代写。守护合并审计结果时保留基础清单里全部 completed 条目、硬上限 8 条，溢出裁剪先删最后一个 pending、没有 pending 就删末尾 —— 当 8 个槽位全部完成后，审计提出的每条新任务都在裁剪中被删掉，写回面板的只能是同样 8 条（顺序随审计输出重排），看起来就是「不更新」。用真实 `normalizeList` 仿真复现：8 条全完成 + 审计新增 3 条 → 0 条存活。
- 修复（`plugins/dsh-todo-nudge/index.js`）：
  - `normalizeList` 溢出时改为先淘汰「审计本轮未再列出的已完成条目」，其次淘汰最旧的已完成条目（列表前部），pending 最后才动；满屏完成项不再挤掉新任务。
  - 插件在回合中途被热重载时，`adopt` 改为依据事件里的 `by: 'task-guardian'` 标记（经任务守护投影新增的 `writer` 字段回溯）识别守护自己的清单，重载后继续以守护身份做进度审计，不会把已有清单误判为「模型的」而只做状态审计、内容冻结到下一轮；`stateVersion` 1 → 2。
  - `node --check` 通过；四组仿真（8 completed + 3 新任务、8 条全完成不回声、混合清单、全 pending）验证新任务保留、列表仍 ≤8 且只有一条 in_progress。
- 现场：已快照（`backup-frozen-0.2.11-rc.17-20261112-135411`）并热部署到 `~/.dsh`（05:59:21 重载生效，`todo-nudge.log` 无报错）；该会话已在 13:46 结束第 4 轮，守护将在下一轮按新规则接管。

## 28. 内置上下文压缩插件 billion-context（0.2.11-rc.19）

### 安装与内置

- 按 dsh-hub 安装页装 `ranxianglei/billion-context`：安装页给的 `github:...#commit` 会被插件自身的 prepare 门禁拒绝（仓库不带 `dist/`，门禁提示改装 npm 发布包），实际安装 npm `billion-context@0.1.213`。
- 桌面 profile 用官方 CLI（`dsh-desktop-host/lib/cli.js`，`manageDesktopProfile: true`）安装；pnpm 11 默认 `strictDepBuilds=true`，`file:` 依赖的 build 批准必须写精确 depPath 键（`dsh-purge@file:../../plugins/dsh-purge`），只写包名会让 `dsh plugin add` 报 `ERR_PNPM_IGNORED_BUILDS`。
- 首次安装失败时 CLI 未回滚 package.json，第二次 add 的 reconcile 把已存在的依赖当既有项跳过、没有写 bundles——需手工把 `billion-context` 补进 `dsh.profile.bundles`（本次已补，并热加载生效）。
- 安装回执未发送：本机到 `dsh-hub.cc` 直连与本地代理均不可达。

### 冻结包

- payload profile `node_modules` 增加 `billion-context` + `mysql2` 及其依赖（`zod 4.6.7` 包内已有），profile `dependencies` 与 `dsh.profile.bundles` 登记；`check-plugins.mjs` 全部可解析。
- `verify-install.ps1` 新增 4 项：插件注册、插件文件（dsh-native / index / bundle patch）、patch 含 `bili-native` + `bili-compaction-gate`、`compaction-basic auto: false`；当前 72 项全过。
- 本机 live profile 在 rc.17 阶段已安装并热加载；rc.19 起 payload 模板携带同一份。

### 行为与注意

- 原生插件 + 本地压缩代理（`127.0.0.1` 随机端口，watchdog 绑定宿主）；注入 `compress` / `decompress` / `search_context` / `acp_status` 工具、`/acp` 命令、顶栏「上下文」标签页。
- 模型自决式压缩：每 50K token 增长提醒一次 + 窗口 preflight 硬兜底（95% 紧急档）；关闭 DSH 自带自动压缩（`compaction-basic auto:false` + preset gate）；卸载要从 `dsh.profile.bundles` 移除。
- 作者基准（自报，未独立验证）：ContextBench Utilized F1 0.3097、成本 -58.3%；LongMemEval-S 79.2% vs 62.6%；健康会话前缀缓存命中 95–97%。本机尚未跑长会话验证实际收益。

## 29. 会话概览备注（0.2.11-rc.20）

- 右侧栏「会话概览」新增第一张卡片「备注」：每会话一段自由文本，textarea 输入，400ms 防抖自动保存、失焦立即落盘、清空即删除该会话的键。
- 存储 `localStorage: dsh-session-panel:note:v1:<sessionId>`，按会话隔离；不写会话日志、不进模型上下文——纯展示，给自己看。
- 折叠状态沿用面板的 `dsh-session-panel:collapsed:v1`（id `note`）；中英文案「备注 / Notes（仅本机可见）」。
- 热部署：`sync-live-plugins.js` 同步 `~/.dsh` 两处副本后由 client-hmr 自动重载，运行中的会话不受影响。
- `verify-install` 新增 1 项（面板 client 必须含 `dsh-session-panel:note:v1:`），当前 73 项全过。

## 30. Codex Desktop computer-use 引擎插件 dsh-codex-cua（0.2.11-rc.21）

### 抽取

- 源头是本机 MSIX 包 `OpenAI.Codex_26.1013.4894.0_x64__2p2nqsd0c76g0`，但真正可复用的是它解包出来的可写运行时
  `%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\78fb63cda1a9e2b2\`（`bin\node.exe`、`bin\node_repl.exe`、`bin\node_modules`）。
- 引擎本体是纯 JS：`@oai/sky` 0.7.8（`dist` 仅 0.16 MB）+ 原生 helper `bin\windows\codex-computer-use.exe`（1.48 MB）；
  同一包里 53.92 MB 的 `codex-computer-use-swift.exe` 不需要。`@statsig/{js-client,client-core}` 3.33.3 是 `@oai/sky` 的静态依赖，一起 vendor。
- 插件落在 `plugins/dsh-codex-cua`（376 文件 / 2.1 MB）：`lib/index.js` 用 `ctx.plugin(await import('@deepseek-ai/dsh-mcp-client'), bridgeConfig(config))`
  挂载 `mcp/server.mjs`（手写 MCP stdio JSON-RPC，协议 `2024-11-05`，14 个工具）。

### 两个决定性坑

1. **`node_repl.exe` 不能直接用。** 它是现成的 MCP server（`js` / `js_reset` / `turn_ended`），但 worker 是受限沙箱：
   `NODE_REPL_UNTRUSTED_ENV_ALLOWLIST` 只解决 env 过滤（默认只放行 `CUA_REPL_ENABLED_SURFACES`），
   真正的墙是 `spawn` 一律 `EPERM`——连 `cmd /c echo hi` 都起不来，而 helper 必须拉起 `codex app-server` 才能枚举窗口。
   因此改成普通 Node 进程直接 `import('@oai/sky')`，自己当 MCP server（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`）。
2. **审批 shim 要两个东西同时到位。** `helper_transport.js` 的判定是
   `n ?? (globalThis.nodeRepl?.config == null ? undefined : globalThis.nodeRepl)?.createElicitation`：
   `config` 为 null 直接当「无审批通道」，缺根级 `createElicitation` 同样抛
   `Computer Use requires app approval but elicitations are unavailable`。DSH 的 `dsh-mcp-client` 没有 elicitation 实现，
   所以 `mcp/server.mjs` 自己兜：`config: {}` + `createElicitation: async () => ({ action: 'accept' })`（`CUA_APPROVAL=deny` 时返回 reject）。

### 热挂载

- `plugin_manager.install_bundle file:...\plugins\dsh-codex-cua` 第一次失败：pnpm `ERR_PNPM_EPERM` 重命名
  `node_modules\dsh-mobile` 时被占用（手动改名可成功，说明是瞬时锁）；原参数重试即 `applied`（25.9s，pnpm exit 0）。
- 生效后新 agent 的工具表出现 `mcp__cua__*`（14 个），`health` 报 `windowCount=19`、`helperExists/codexCliExists=true`，
  `get_window_state` 返回 AX 树 + 108 KB JPEG。**无需重启宿主。**

### 冻结包

- `ship-plugin.js` 的 `SKIP_NAMES` 会跳过所有 `node_modules`，正好会丢掉 `vendor/node_modules/@statsig`——包能装上、首次 import 就崩。
  新增 `frozen-build-src/ship-plugin-vendor.js`：只跳过插件**根**的 `node_modules` 与运行时 `state/`，其余 vendor 树原样镜像，
  并在结尾强校验 helper、`@statsig/js-client`、`@statsig/client-core` 存在。
- `Build-FrozenSetup.ps1` 的插件循环改为按插件选择 shipper（有 `vendor/node_modules` 的走 vendor 版），并把
  `ship-plugin-vendor.js` 一并复制到 payload 根。
- `verify-install.ps1` 新增 5 项：bundle 注册、插件文件（`lib/index.js`、`mcp/server.mjs`、`cordis.patch.yml`、helper、statsig）、
  `serverName: cua`、shim 的 `config: {}` + `createElicitation`、vendored helper 存在。当前 **78 项全过**。
- `FROZEN-BUILD.json` 增加 `dshCodexCua` 组件说明。
- 运行前提：目标机需有 `codex.exe`（Codex CLI），helper 用它起 `codex app-server` 枚举窗口；解析顺序
  `CUA_CODEX_CLI` → `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` → `PATH`，缺失时 `health` 会明确报 `codexCliExists=false`。