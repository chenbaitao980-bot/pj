---
name: dsh-install
description: 在当前项目里安装、配置、排障 DeepSeek Harness（DSH）及其插件（dsh-purge 红队、workflow-lite 工作流、桌面壳）。当用户要求「装 DSH」「装 dsh-purge」「桌面版插件没生效」「换模型供应商」「DSH 启动失败」「/purge status」时使用。
---

# DSH 安装与配置技能

本项目下的 DSH 是**自包含安装**，所有状态在 `deepseek-harness/.dsh`，可整体拷走。
桌面版是另一套独立的 `C:\Users\<你>\.dsh`，两者互不影响。

## 一、先判断要操作哪一份 DSH

这一步搞错，后面全白做。

```bash
# Web 版（项目内）
E:/claude/project4/pj/deepseek-harness/.dsh/profiles/

# 桌面版（用户目录）
C:/Users/<你>/.dsh/profiles/
```

| 宿主 | DSH_HOME | profile 名 | 能否用 CLI 管理 |
|---|---|---|---|
| `dsh web` | `deepseek-harness\.dsh` | `web` | ✅ |
| `dsh headless` | 同上 | `headless` | ✅ |
| 官方桌面 EXE | `C:\Users\<你>\.dsh` | `desktop` | ❌ 保留名 |

**`desktop` 是 Electron 独占的保留名**：`dsh --profile desktop --dump-config` 会报
`managed exclusively by the Electron application`。要看配置只能直接读文件。

## 二、Web 版基础安装

```bash
mkdir -p deepseek-harness && cd deepseek-harness
npm init -y
npm install @deepseek-ai/dsh@0.2.1-rc.2
```

**版本锁定很重要**：dsh-purge 只适配 `0.2.1-rc.2` / `rc.5`，`rc.3`、`rc.4` 明确不支持。

启动：

```bash
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh web --port 3080
```

`dsh plugin add` 底层调用 pnpm，PATH 里没有会失败：

```bash
corepack enable pnpm
corepack prepare pnpm@latest --activate
```

## 三、模型供应商配置

配置写在各 profile 的 `cordis.patch.yml`，**只写这两段**：

```yaml
- id: llm-pi-ai
  config:
    providers:
      <路由名>:
        displayName: <显示名>
        api: anthropic-messages        # 或 openai-completions / openai-responses
        apiKeyEnv: <KEY_ENV_NAME>
        baseURL: <端点>
        defaultContextWindow: 1000000
        defaultMaxTokens: 16384
        models:
          - id: <模型 id>
            name: <模型 id>
            contextWindow: 1000000
- id: agent-default-model
  config:
    provider: <路由名>
    model: <模型 id>
```

密钥写进 `.dsh/.credentials.yaml`，**文件头必须 `version: 1`**，否则启动直接失败：

```yaml
version: 1
refs:
  <KEY_ENV_NAME>: <密钥明文>
```

已有供应商对照：

| 供应商 | api | baseURL | 模型 |
|---|---|---|---|
| OpenCode Go | `anthropic-messages` | `https://opencode.ai/zen/go` | `deepseek-v4.1-flash` |
| 星火 MaaS | `anthropic-messages` | `https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic` | `astron-code-latest` |
| DeepSeek 官方 | 不用 pi-ai | — | 内置路由，只配 `DEEPSEEK_API_KEY` |

**不要整份复制 `cordis.patch.yml` 到别的 profile**：web 那份带插件 insert 条目，没装包的 profile 会报 `failed to import`。只复制上面两段。

验证：

```bash
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh --profile web --dump-config | grep -A12 "<路由名>"
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh headless "只回答两个字：你好"
```

## 四、装 dsh-purge

### Web profile

```bash
cd deepseek-harness
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh plugin --profile web add E:/claude/project4/pj/dsh-purge
```

本地路径安装会有一条 peerDependencies 警告，可忽略。

### Desktop profile

```bash
dsh plugin --profile desktop add https://codeload.github.com/HunYiSage/dsh-purge/tar.gz/refs/heads/master
```

或桌面版界面：「插件」→「添加插件」→「安装第三方插件」。

**压缩包地址只能用 `codeload.github.com`**，`github.com/.../archive` 会 302 导致 `fetch failed`。

### 装完核对三件事（缺一不可）

```bash
D="<profile 目录>"
# 1. bundles 里有 dsh-purge
grep dsh-purge "$D/package.json"
# 2. 包实际存在
ls "$D/node_modules/dsh-purge/package.json"
# 3. 有本体 insert 块（没有它界面不出按钮）
grep -A5 "insert:" "$D/cordis.patch.yml"
```

第三项应包含：

```yaml
- insert:
    - id: dsh-purge
      name: dsh-purge
      inject: [systemPrompt, tools]
      config:
        enabled: true
```

缺 insert 时补：

```bash
node "$D/node_modules/dsh-purge/scripts/ensure-profile-bundle.mjs"
```

### 然后点「应用」

装 ≠ 生效。

1. **完全退出宿主**（桌面版托盘右键退出，不是关窗口）
2. 重开
3. 会话标题旁 → **dsh-purge** →「清洗」→「应用」
4. 成功会自动重启一次

**判断是否真的应用过**——找备份文件：

```bash
find "<DSH_HOME>" -name ".dshpurge.bak" 2>/dev/null
```

有 = 已应用；没有 = 只装没点。

验证：

```
/purge status
```

应打出 `DSH_HOME` 和 86 条补丁，路径指向当前宿主。

## 五、装 workflow-lite 工作流插件

```bash
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh plugin --profile web add @xiaoso/dsh-workflow-lite
```

重启后会话页顶部出现「工作流」标签。

工作流包在 `minglink-workflows/dsh-workflows/workflows/破甲制作.wflite.zip`，
在「工作流中心」→「导入」加载。

## 六、桌面壳

```bash
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh plugin --profile web add dsh-desktop-plugin
```

首次启动 `dsh web` 时它会自动下载 exe 到 `%LOCALAPPDATA%\Programs\dsh-desktop-windowos\`
并创建桌面快捷方式「DeepSeek Harness」。

校验 exe：

```bash
curl -sL https://github.com/RAFOLIE/dsh-desktop-windowos/releases/download/<tag>/<exe>.sha256
sha256sum "<exe 路径>"
```

首次双击会弹 SmartScreen 警告（未签名），点「更多信息 → 仍要运行」。

## 七、排障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `MISSING_CREDENTIAL` | 该 profile 没有密钥或配置 | 复制模型两段配置 + 写 `.credentials.yaml` |
| `credentials.yaml uses the pre-release flat layout` | 缺 `version: 1` | 文件头加 `version: 1` |
| `failed to import: Cannot find package 'dsh-purge'` | 整份复制了带插件条目的 patch，但没装包 | 只保留模型两段配置 |
| `already queued: dsh-purge` | 走了插件市场 | 改用命令行 `dsh plugin add` |
| `entry "redteam-store" not found` 等 | 旧红队包条目，本版不带 | **可忽略** |
| `plugin root not found / set DSH_BASE` | 官方宿主在 app.asar 里 | 点「应用」会自动解开，不用手跑脚本 |
| `managed exclusively by the Electron application` | `desktop` 是保留名 | 直接读 profile 文件，或用桌面界面 |
| 界面没有 dsh-purge 按钮 | 没重启 / insert 缺失 | 查 `cordis.patch.yml` 的 insert 块 |
| `self-update failed: github api unreachable` | 桌面端自更新连不上 GitHub | 不影响使用 |

## 八、关键禁令

- **不要**整份复制 `cordis.patch.yml` 跨 profile
- **不要**用 `github.com/.../archive` 装插件（用 codeload）
- **不要**跳到 `0.2.1-rc.3` / `rc.4`（dsh-purge 不支持）
- **不要**用 CLI 操作 `desktop` profile
- **不要**把密钥写进 `cordis.patch.yml`，只写环境变量名
- `--dump-config` 里的 `not found` 分两种：`entry "xxx" not found` 是旧条目（正常），`failed to import` 是真错误
