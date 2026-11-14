# 交付清单（本轮三项任务）

> 生成：2026-11-07　·　约束：**全程未重启、未修改正在运行的 DeepSeek Harness**（profile / `resources\app` 均未动）

## 一、按工作区开关插件

| 交付物 | 位置 | 状态 |
|---|---|---|
| 本地控制面板 | `<安装目录>\tools\plugin-scope-ui.mjs` + `.cmd` | **正在运行**：http://127.0.0.1:8799/ |
| 聊天命令 `/pluginscope` | `skill-packs/dsh-plugin-scope`（host 侧） | 已进安装包，安装/升级后可用 |
| 插件页「按工作区」Tab | 同上（`lib/client.js`，`plugins.tab` / id `workspace-scope`） | 已进安装包，结构已单测 |
| 数据格式 | `<工作区>\.dsh\plugins.json` | 与插件运行时同源 |

优先级：**工作区文件 > profile `workspaces:` 前缀 > profile 全局**。全局总开关仍在插件页。

已验证：

- 面板 `/api/state` 列出 5 个真实工作区；`/api/set` 写入成功；无 token → 403
- 面板显示「生效值 + 继承(开/关)」，用伪造 home 验证过 YAML 解析（trellis=false / gitnexus=false+autoInit=true / codegraph=true）
- `/pluginscope` 8 个用例全过（status / on / off / autoinit-* / all / 非法参数 / reset）
- 客户端模块在 Node 里跑通：注册 `plugins.tab`、id `workspace-scope`、order 50、label「按工作区」、视图含 iframe

未验证：插件页里 Tab 的**实际渲染**（需要安装/升级后的新 profile）。

## 二、Trellis 增量升级

| 交付物 | 位置 | 状态 |
|---|---|---|
| 升级器 | `frozen-build-src\Update-Trellis.ps1` | 完成，四条路径实测 |
| 会话内版本检查 | `dsh-skill-trellis`（24h 缓存 / 3s 超时 / 静默失败） | 完成，已进包 |

规则：只做增量；`templates/assets/docs/README/LICENSE/CHANGELOG` 冲突保留本地并写 `conflicts-<ver>.txt`；原版先备份 `vendor\trellis.bak-<旧版>-<时间戳>`；官方删除的文件默认保留（`-Prune` 才删）。

实测记录：

```
CheckOnly        本地 0.6.17 == 官方 0.6.17 → exit 0（当前无新版）
DryRun -Force    新增 0 / 更新 0 / 相同 831 / 冲突 0 / 已删 0
0.6.16→0.6.17    新增 1（补回 ablate.js）/ 更新 1（package.json）/ 备份生成
冲突分支          改过的 README 保留 + conflicts-0.6.17.txt
```

## 三、移动端

| 交付物 | 位置 | 说明 |
|---|---|---|
| DSH Remote APK | `mobile\DSH-Remote-v2.5.1.apk`（65.36 MB） | 遥控端；**Android 前台服务常驻通知 = 后台运行**；已验证 ZIP 结构 / 11 dex / 4 ABI |
| dsh-mobile 插件 | `mobile\dsh-mobile-0.8.4.tgz`（28.2 MB） | 给 DSH 本体加手机通道（LAN / CF Tunnel / Caddy / FRP / cpolar / iroh）+ PWA + Web Push；默认 `initiallyEnabled:false`、只听 127.0.0.1 |
| 一键安装器 | `frozen-build-src\Install-MobilePlugin.ps1` | 默认干跑；`-Apply` 才写 profile；`-Remove` 回滚 |
| 清单 | `mobile\manifest.json` | 含两个产物的 sha256、版本、来源、候选清单 |

## 四、冻结包

`DeepSeek-Harness-Frozen-Setup-0.2.11-rc.11.exe`　507,049,058 字节　SHA256 `9A4C33A123BAF2BE0B7B0D6F54616E91BA4BC7FD47760869888D5D1796632A3C`

内含：0.2.11-rc.11 宿主（purge 已打、更新器已禁）+ 12 个 bundle + 90 技能 + GitNexus/CodeGraph/Trellis + `dsh-plugin-scope` + `tools/*` + 全套运维脚本。

## 五、只剩三步需要你点头（都不需要我改宿主）

1. **看 Tab**：关掉宿主 → 双击桌面「DeepSeek Harness 冻结版」→ 走完 staged 更新 → 插件页应出现「按工作区」Tab。
2. **装移动通道**（可选）：`Install-MobilePlugin.ps1 -Apply`，然后设置 → Mobile 页自己开监听与隧道。
3. **手机装 APK**：`mobile\DSH-Remote-v2.5.1.apk`，填电脑的 DSH 地址即可。

## 六、回滚

- Tab/命令：从 `dsh.profile.bundles` 删掉 `dsh-plugin-scope`
- 面板：`Uninstall.ps1` 会按命令行结束它；也可手动结束 `plugin-scope-ui.mjs` 进程
- 移动插件：`Install-MobilePlugin.ps1 -Apply -Remove`
- Trellis：`vendor\trellis.bak-<版本>-<时间戳>` 改名回 `vendor\trellis`
- 宿主：`resources\app.old-<时间戳>`（Launch.ps1 保留最近一份）

## 七、已知边界

- 插件页红框处官方没有插槽，无法"原地放下拉框"；用同页 Tab 实现，语义与文件格式一致
- 插件页是 profile 级、root 作用域，拿不到"当前工作区"，所以面板列**所有**工作区而不是跟随当前会话
- 写侧必须走本地面板（官方 `workspaceFiles` 只读；自定义 Remote 需要 `TYPERT_REMOTE` 生成物）
- 沙盒验证时曾让 ARTEX 在打包源里建了 PG 集群，已排除 `.artex-runtime` 并回归到 2285 MiB；以后沙盒要把 artex 指到临时目录且 `autoStart: false`
