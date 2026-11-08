# DeepSeek Harness 冻结版 · 单文件安装包（0.2.2-rc.1）

| 项目 | 值 |
|---|---|
| 产物 | `DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe` |
| 大小 | 438,414,826 字节（418 MB） |
| SHA256 | `EBCDF913BE786A0C48E8AF3092571324A224D2D2C5E83B7611FA6E66AD2F9022` |
| 构建时间 | 2026-11-07 20:25 (Asia/Shanghai) |
| 宿主版本 | DeepSeek Harness `0.2.2-rc.1` / Electron `44.7.0` / win-x64 |
| 上游 commit | `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8` |
| 冻结标记 | `app-update.yml` 不落盘、更新器 `enabled = () => false`、无 `dshMandatoryUpdatePolicy` |
| 安装方式 | 双击，无需管理员，**全程离线** |

---

## 一、这一版改了什么

对照 `VERSION-DIFF-0.2.1-rc.5-vs-0.2.2-rc.1.md`，四个问题的修复都在这一版里：

| # | 问题 | 修复 |
|---|---|---|
| 1 | 冻结版落后官方 | 底座升到 `0.2.2-rc.1`：26 个新包（动作卡片、消息引用、右键菜单、文件拖拽/另存、个性化与插件推荐、Forge 变更请求、LiveShare、fs-patch、PTC/native 执行器、逐轮统计…），dsh-purge 补丁重打，冻结策略原样保留 |
| 2 | Trellis 没有 Claude Code 那种 SessionStart 提示 | `dsh-skill-trellis 2.0.0`：`agent/pre-step` 第一步注入 `.trellis` 紧凑上下文（与官方 `session-start.py` 同源），带 `first-reply-notice`，模型首句会明确回「Trellis SessionStart 上下文已加载 / ✓」；项目里没有 `.trellis` 时**自动跑 `trellis init -y --dsh`**（每进程每根目录只试一次，失败提示手动命令） |
| 3 | 插件里没有 codegraph / gitnexus | 新增 `dsh-mcp-gitnexus 1.0.0`、`dsh-mcp-codegraph 1.0.0` 两个**正式插件包**（出现在插件列表、默认启用），各自带 MCP 注册 patch，并在会话第一步注入「先查图谱再改代码」的硬约束，模型会自动调用 `impact` / `codegraph_explore` |
| 4 | 拷到别的电脑提示「禁用第三方插件」 | `profiles\desktop\node_modules` 整目录随包（35 MB / 1938 文件），安装前跑 `tools\check-plugins.mjs` 自检；发现缺依赖先从安装包模板整目录重灌，仍不行才摘掉坏 bundle |

---

## 二、一键安装

1. 把 EXE 拷到新电脑，双击。
2. 未签名会弹 SmartScreen：**更多信息 → 仍要运行**。
3. 进度条走完 → 点「是」立即启动。

默认落位：

```
程序：%LOCALAPPDATA%\Programs\DeepSeekHarnessFrozen
配置：%USERPROFILE%\.dsh
```

静默 / 自定义：

```powershell
.\DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe --silent
.\DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe --silent --nolaunch
.\DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe --dir=D:\DSHFrozen
.\DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe --silent --noregister
# 换一个 DSH_HOME（默认 %USERPROFILE%\.dsh）：
$env:DSH_FROZEN_HOME='D:\dsh-home'; .\DeepSeek-Harness-Frozen-Setup-0.2.2-rc.1.exe --silent
```

安装器会：

- 停掉同目录旧实例，清理上一版残留的 `resources\app.next` / `app.old-*`
- 删除 `resources\app-update.yml`、`resources\app.asar`（冻结）
- 备份旧配置到 `%USERPROFILE%\.dsh-frozen-backup-<时间戳>`
- 把 `dsh-home` 合并进 `%USERPROFILE%\.dsh`（含 `plugins\` 与 `profiles\desktop\node_modules\`，不动 sessions/attachments）
- 把 `__FROZEN_NODE__ / __FROZEN_VENDOR__ / __FROZEN_ARTEX__ / __FROZEN_PG__`
  在 **profile 与每个插件的 `cordis.patch.yml`** 里替换成新机器绝对路径
- 跑插件依赖自检 → 必要时从模板重灌 `node_modules`
- 建 `vendor\bin` 命令入口、运行时 junction、用户 PATH 与 `DSH_HOME`
- 建桌面 / 开始菜单快捷方式（指向 `Launch.ps1`，启动时先应用待生效更新）
- 写 `HKCU\...\Uninstall\DeepSeekHarnessFrozen` 卸载登记与 `install-receipt.json`

---

## 三、已经装了旧版？三种升级方式

**A. 直接覆盖安装（最简单）**：关掉宿主 → 双击新 EXE。安装器会先杀同目录实例再落盘。

**B. 不打断当前会话（staged）**：

```powershell
# 在解包出来的 payload 目录里执行
powershell -ExecutionPolicy Bypass -File Upgrade.ps1 -SourceDir "D:\dsh-freeze-new\payload"
```

它把新 `resources\app` 放到 `resources\app.next`、新宿主放到 `DeepSeek Harness.exe.next`，
把桌面快捷方式改指向 `Launch.ps1`。**当前会话继续用旧代码跑**，关掉再双击快捷方式时
`Launch.ps1` 才做原子替换（旧目录改名 `app.old-<时间戳>` 留作回滚，只保留最近一份）。

`Upgrade.ps1` 还会启动一个后台守候进程 `Finalize-Update.ps1`：宿主**无论怎么退出**
（点关闭、任务管理器、重启前登出），它都会在进程消失后自动完成替换并清掉 `pending-update.json`，
下次启动就是新版——不需要记得用快捷方式。想手动触发：

```powershell
powershell -ExecutionPolicy Bypass -File "<安装目录>\Finalize-Update.ps1"            # 等宿主退出后替换
powershell -ExecutionPolicy Bypass -File "<安装目录>\Launch.ps1" -SwapOnly -NoWait   # 立刻替换（宿主已退出时）
```

> 实测（2026-11-07）：伪造宿主进程运行时保持 `app` 不变，进程退出后 2 秒内完成替换、
> `pending-update.json` 被清除、`install-receipt.json` 的 `mode` 自动改为 `in-place`。

**待生效内容已实机启动验证**：把 `resources\app.next` 与 `DeepSeek Harness.exe.next` 用硬链接拼成一份
沙盒安装目录，配独立 `DSH_HOME` 启动，Electron 正常出窗（标题 `DeepSeek Harness`），
DSH_HOME 下自动生成 `.agent-presets / dsh-purge / redteam / sessions / storages`，
`%TEMP%\dsh-purge-desktop.log` 里能看到 `assemble.rewrite / inject.read` 正常跑
（说明 dsh-purge 补丁在 0.2.2-rc.1 上照常工作）。

**C. 完全重装**：

```powershell
powershell -ExecutionPolicy Bypass -File "<安装目录>\Uninstall.ps1"   # 默认保留 .dsh
# 再双击新 EXE
```

---

## 四、里面有什么

| 组件 | 版本 / 状态 |
|---|---|
| 桌面宿主 | `0.2.2-rc.1`，`resources\app` 已解开，`app.asar` 已移除 |
| dsh-purge | `1.1.90`，补丁已预置进 `resources\app\dsh`（53 个 `*.dshpurge.bak` 可回滚） |
| dsh-artex | `0.2.0`，`root` 指向随包 ARTEX，`pgBin` 指向便携 PostgreSQL |
| dsh-tool-websearch | `0.1.1`，54 个免 API key 引擎 |
| dsh-skill-trellis | **`2.0.0`**，16 个 `trellis-*` 技能 + SessionStart 注入 + 缺 `.trellis` 自动初始化 |
| dsh-skill-grill-me / officecli / darwin | `1.0.0` |
| dsh-mcp-gitnexus | **`1.0.0`**，MCP `gitnexus`，默认启用，注入影响面分析约束 |
| dsh-mcp-codegraph | **`1.0.0`**，MCP `codegraph`，默认启用，注入 `codegraph_explore` 用法 |
| ARTEX | 源码 + 预编译 `artex.exe` + `web\out`（约 86 MB） |
| workflow-lite | `@xiaoso/dsh-workflow-lite 0.9.0` |
| 技能 | **90 个**（trellis 全家桶、office、obsidian、security、frontend…） |
| GitNexus / CodeGraph / Trellis CLI | `1.6.12` / `1.6.2` / `0.6.17` |
| PostgreSQL | `16.15` 便携版，已实测 `initdb` 可用 |
| Node / Python / pnpm | `24.21.0` / `3.12.14` / `11.28.5`（宿主自带） |
| profile node_modules | **随包离线**：1938 文件 / 35 MB，新机器无需 `pnpm install` |

模型配置：`opencode-go / deepseek-v4.1-flash`（`reasoningEffort: max`），
凭据在 `%USERPROFILE%\.dsh\.credentials.yaml`（沿用打包机器的 Key）。

---

## 五、装完自检

在会话里：

```
/purge status
```

应看到 `desktop` 宿主、`0.2.2-rc.1`、补丁已清洗。

**Trellis 钩子**（问题 2 的验收点）：

- 打开任意**有** `.trellis/` 的项目 → 模型第一条回复开头会有一句「Trellis SessionStart 上下文已加载」；
- 打开**没有** `.trellis/` 但有 `.git` / `package.json` 的项目 → 插件自动跑 `trellis init -y --dsh`，
  同一轮里告诉用户「已自动初始化」，并建议 `/skill trellis-start`；
- 想关：profile 里 `dsh-skill-trellis.config.enabled: false`，或环境变量 `TRELLIS_HOOKS=0`。

**代码图谱**（问题 3 的验收点）：

- 插件列表里能看到 `dsh-mcp-gitnexus`、`dsh-mcp-codegraph` 且为启用状态；
- 会话里 `mcp__gitnexus__list_repos`、`codegraph_explore` 可用；
- 问「这个函数谁在调用 / 改它会影响什么」时，模型会先走 `impact` / `context`，而不是 grep。

命令行：

```powershell
gitnexus --version     # 1.6.12
codegraph --version    # 1.6.2
trellis --version      # 0.6.17
```

**插件依赖**（问题 4 的验收点）：

```powershell
powershell -ExecutionPolicy Bypass -File "<安装目录>\Repair-Plugins.ps1" -CheckOnly
# 期望：所有包 OK；退出码 0
```

---

## 六、按工作区开关插件（新增）

三个插件（trellis / gitnexus / codegraph）都支持「全局默认 + 工作区覆盖」，优先级：

1. **工作区文件** `<项目根>\.dsh\plugins.json`（最高）
2. **profile 的 workspaces 映射**（路径前缀匹配，最长优先）
3. **profile 全局默认**（`config.enabled` / `config.autoInit`）

```json
{
  "trellis":   { "enabled": true,  "autoInit": true },
  "gitnexus":  { "enabled": false },
  "codegraph": { "enabled": true,  "autoInit": false },
  "*":         { "enabled": true }
}
```

- `enabled: false`：该工作区不注入约束、不自动初始化；
- `autoInit: false`：仍注入用法约束，但不自动建索引 / 不自动 `trellis init`；
- `"*"`：该工作区所有插件的兜底。

一键设置：

```powershell
powershell -ExecutionPolicy Bypass -File "<安装目录>\Plugin-Scope.ps1" -Workspace D:\proj -Show
powershell -ExecutionPolicy Bypass -File "<安装目录>\Plugin-Scope.ps1" -Workspace D:\proj -Plugin gitnexus -Enabled $false
powershell -ExecutionPolicy Bypass -File "<安装目录>\Plugin-Scope.ps1" -Workspace D:\proj -Plugin all -Enabled $true
powershell -ExecutionPolicy Bypass -File "<安装目录>\Plugin-Scope.ps1" -Workspace D:\proj -Reset
```

profile 级按路径覆盖：

```yaml
- id: dsh-skill-trellis
  config:
    enabled: true
    workspaces:
      "D:/work/legacy": { enabled: false }
      "D:/work/new":    { enabled: true, autoInit: false }
```

`config.enabled: false` 仍是总开关（插件不注册监听）；工作区配置只能在总开关之内做更细的开关。
工作区关闭时，MCP 工具仍在工具表里（服务由 profile 注册一次），但插件不再注入使用约束、也不会自动建索引。

实测记录（2026-11-07）：

| 场景 | 结果 |
|---|---|
| `.dsh/plugins.json` 三者全 `enabled:false` | 三个插件注入消息数 = 0 |
| 工作区开 `gitnexus` + `autoInit:false` | 注入 1 条、`.gitnexus` 未创建 |
| 工作区只配 `gitnexus`，codegraph 继承全局 | codegraph 注入并自动 `codegraph init`（`.codegraph` 生成） |
| `workspaces: {"d:\\scope-test": {enabled:false}}` | 三者注入消息数 = 0 |

---

## 六点五、插件页「按工作区」Tab（0.2.2-rc.1 包内）

`dsh-plugin-scope 1.1.0` 在插件页注册 `plugins.tab`（id `workspace-scope`，label「按工作区」，order 50），
Tab 内容内嵌本地面板 `http://127.0.0.1:8799/`：

- 面板由 `Launch.ps1` 在宿主启动时自动拉起（`tools\plugin-scope-ui.mjs --no-open`），卸载时由 `Uninstall.ps1` 结束
- 面板列出本机所有工作区 × trellis/gitnexus/codegraph × `enabled`/`autoInit` 三态（开/关/继承）
- 只写 `<工作区>\.dsh\plugins.json`，POST 带随机 token，仅监听 127.0.0.1
- 同一插件包还带 `/pluginscope` 命令，纯终端也能改

不想用这个 Tab：把 `dsh-plugin-scope` 从 `dsh.profile.bundles` 删掉即可，宿主其它部分不受影响。
## 七、为什么不会被官方升级覆盖

三层物理措施：

1. `resources\app-update.yml` 不存在 —— electron-updater 只在它存在时启用。
2. `resources\app\lib\main.js` 的更新器开关被改成 `enabled = () => false`。
3. `resources\app\package.json` 里 `dshMandatoryUpdatePolicy` 已删除。

另外 `app.asar` 已删除（宿主固定从目录加载），官方 `Uninstall DeepSeek Harness.exe` 不在包里。

**不要运行官方安装包**：会覆盖成未冻结版本。

---

## 八、卸载

设置 → 应用 →「DeepSeek Harness 冻结版」→ 卸载，或：

```powershell
powershell -ExecutionPolicy Bypass -File "<安装目录>\Uninstall.ps1"
powershell -ExecutionPolicy Bypass -File "<安装目录>\Uninstall.ps1" -PurgeHome   # 连 .dsh 一起删
```

卸载会清：快捷方式、注册表、PATH（vendor\bin + pgsql\bin）、运行时 junction、
`DSH_HOME` 环境变量、安装目录。默认**保留** `%USERPROFILE%\.dsh`。

---

## 九、注意事项

- **未签名**：SmartScreen 会拦一次；企业环境需自行加白。
- **API Key 已内置**：`.credentials.yaml` 带打包机器的 Key，换机建议改成自己的。
- **路径自适应**：不写死用户名/盘符；`__FROZEN_*` 占位符在安装时展开。
- **磁盘**：安装后约 2.3 GB；解压过程需额外约 2.4 GB 临时空间。
- **首次启动**稍慢几秒：`resources\app` 是目录形态、文件较多。
- **日志**：`%TEMP%\dsh-frozen-setup-*.log`、`%TEMP%\dsh-frozen-install-*.log`、
  `%TEMP%\dsh-frozen-upgrade-*.log`、`%TEMP%\dsh-frozen-launch-*.log`。
- **PowerShell 脚本编码**：所有 `.ps1` 都是 **UTF-8 with BOM**，否则 Windows PowerShell 5.1 会按
  GBK 解析而报语法错误。
- **dsh-purge 备份**：`resources\app` 内保留 `*.dshpurge.bak`；不想要可手删。

---

## 十、重新打包

源码与脚本都在 `E:\claude\project4\pj\frozen-build-src\`：

```
Build-FrozenSetup.ps1   一键重建：同步 skill-packs → 打 dsh-purge 补丁 → 冻结 → 7z → 拼 EXE
install.ps1             安装（含插件自检/自愈、占位符展开、快捷方式、卸载登记）
Launch.ps1              启动器：先把 resources\app.next / exe.next 原子替换，再拉起宿主
Upgrade.ps1             不打断运行实例的原地升级（staged）
Repair-Plugins.ps1      插件依赖自检 / 摘除坏 bundle / 回滚
Doctor.ps1              安装后体检
Uninstall.ps1           卸载
check-plugins.mjs       profile 插件依赖静态检查（被 install/Repair/Doctor 调用）
freeze-app.js           禁用更新器 + 移除强制更新策略
purge-stage.mjs         对 staged 运行时应用 dsh-purge 补丁
```

重建命令：

```powershell
cd E:\claude\project4\pj\frozen-build-src
powershell -ExecutionPolicy Bypass -File .\Build-FrozenSetup.ps1 `
  -PayloadRoot D:\dsh-freeze-new\payload -Version 0.2.2-rc.1 -OutDir E:\claude\project4\pj
```

单文件格式：`[stub.exe 30208][7za.exe 1334784][payload.7z][40 字节尾标]`，
尾标 = `DSHFZ7P1` + `exeOff(=30208)` + `zaLen` + `arcOff` + `arcLen`（全部 int64 LE）。
