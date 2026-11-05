# DeepSeek Harness 本地工作站

本目录是一个自包含的 DSH 安装，所有状态都在 `./.dsh` 里，可以整个文件夹拷走。

## 一键启动

| 文件 | 作用 |
|---|---|
| `启动-Web版.cmd` | 启动 Web 版，浏览器访问 `http://127.0.0.1:3080` |
| `启动-桌面版.cmd` | 启动桌面托盘应用（已校验的 exe 在 `desktop-app/`） |

## 已接好的模型

- 供应商：**OpenCode Go**（Anthropic Messages 协议）
- 端点：`https://opencode.ai/zen/go`
- 模型：`deepseek-v4.1-flash`（1M 上下文）
- 密钥：`.dsh/.credentials.yaml` 的 `refs.OPENCODE_GO_API_KEY`

## 已装的插件

| 插件 | 版本 | 说明 |
|---|---|---|
| `dsh-purge` | 1.1.90 | 红队评测，会话标题旁有 dock 按钮 |
| `@xiaoso/dsh-workflow-lite` | 0.9.0 | 工作流画布，会话页顶部有「工作流」标签 |
| `dsh-desktop-plugin` | 1.5.12 | 桌面壳下载/更新 |

## 换模型供应商

编辑 `.dsh/profiles/<profile>/cordis.patch.yml`，改两处：

1. `- id: llm-pi-ai` 下的 `providers.<路由名>`（`api` / `baseURL` / `apiKeyEnv` / `models`）
2. `- id: agent-default-model` 下的 `provider` 和 `model`

再把新密钥写进 `.dsh/.credentials.yaml`。

**注意**：不要整份复制 web 的 `cordis.patch.yml` 到其它 profile——那份文件里带着 dsh-purge / workflow-lite 的插槽条目，没装这些包的 profile 会报 `failed to import`。只复制 `llm-pi-ai` 和 `agent-default-model` 两段。

验证：

```bash
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh --profile web --dump-config | grep -A12 "<路由名>"
```

## 常用命令

```bash
# 一次性任务
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh headless "你的任务"

# 看合成后的完整配置
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh --profile web --dump-config

# 装插件
DSH_HOME=$PWD/.dsh ./node_modules/.bin/dsh plugin --profile web add <包名或本地路径>
```

## 注意

- **解锁 `desktop` profile 需要桌面应用**：CLI 拒绝操作 `desktop` 这个名字，它由 Electron 独占管理。
- **`0.2.1-rc.3` / `rc.4` 不能用 dsh-purge**。本目录锁在 `0.2.1-rc.2`，升级前先确认插件支持范围。
- 安装插件依赖 pnpm，已通过 `corepack enable pnpm` 启用。

详细说明见 Obsidian 库中的《DeepSeek Harness 本地开箱即用部署与模型配置》。
