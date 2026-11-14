# 会话追踪面板 + 待回答置顶提醒窗

## 背景

左侧栏会话越拉越多，看不到哪些会话还在跑、哪些回合已结束但自己还没看、哪些会话在等自己回答。且提问只存在于会话内的输入框上方——窗口隐藏到托盘或最小化后完全没有提示。

## 目标

1. 左侧栏最上层（工作区列表之上）加「会话追踪」面板，可折叠：
   - 等你处理（提问 / 审批 / 计划待审）
   - 运行中（含子智能体在跑的父会话）
   - 已完成待确认（completionUnread）
   - 点击任意行切到该会话。
2. 会话进入「等你处理」且主窗口隐藏 / 最小化 / 未聚焦时，弹一个置顶小窗（不抢焦点），按钮「查看会话 / 稍后」，点击回来直接打开该会话。

## 方案

- 新插件 `@local/dsh-session-tracker`（宿主半边空；客户端半边挂 `sidebar.tracker` 洞，并订阅 `uiSession.sessionStatus` 做提醒）。
- 侧栏补丁 `patch-session-tracker.js`：在 `dsh-client-ui-sidebar` 根插槽声明 `sidebar.tracker` 子洞，并在 `regionArea` 中工作区浏览器之前渲染（仅宽侧栏）。
- 桌面补丁 `patch-desktop-attention.js`：preload 暴露 `dshDesktop.attention.notify/onOpen`；main 用自绘置顶 BrowserWindow 显示提醒（Windows Toast 需要 AppUserModelID + ToastActivator 注册，本安装器不注册，故不用 Toast），`showInactive` 不抢焦点，点击 `dsh-attention://open` 还原主窗并回传会话 id。
- 数据只用客户端根投影：`sessions.list`、`uiSession.sessionStatus`、`workspaces.list`；无新宿主路由。

## 验收

- 面板分类、空态、折叠记忆、点击打开会话；子智能体在跑计入父会话、子智能体提问单独成行。
- 提醒窗：窗口前台不弹；隐藏/最小化/未聚焦弹；不重复；点击打开对应会话；稍后/聚焦/60s 关闭。
- 两个补丁幂等且 `node --check`；`verify-install` 57/0；打包 rc.12 并暂存升级。
