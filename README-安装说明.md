# 三件套 · 本机安装与使用

根目录：`E:\claude\project4\pj`

## 一、两个宿主，两套配置（重要）

桌面版和 Web 版**各自读各自的目录**，互不相通：

| 宿主 | 配置目录 | 启动方式 |
|---|---|---|
| Web 版 | `E:\claude\project4\pj\deepseek-harness\.dsh` | `start-dsh.ps1` |
| 桌面版 | `C:\Users\Administrator\.dsh` | 开始菜单/桌面「DeepSeek Harness」 |

两套我都配好了同样的东西：OpenCode Go 模型 + dsh-purge + workflow-lite。

## 二、当前状态

| 项目 | Web 版 | 桌面版 |
|---|---|---|
| DSH 本体 | 0.2.1-rc.2，可启动 | 0.2.1-rc.5（你已装，在 `D:\deepseek`） |
| OpenCode Go 模型 | 已配，实测跑通 | 已配 |
| dsh-purge | 已装，配置里可见 | 已装，配置里可见 |
| workflow-lite | 已装 | 已装 |
| REA 静态分析 | 已跑通 | — |
| ARTEX + dsh-artex 插件 | 已拉源码、已编译、已跑通（本轮实测） | — |

## 二·五、ARTEX 怎么起

```powershell
pwsh -File .\install-artex-plugin.ps1          # 装进 web profile
# 重启 DSH 后，会话里：artex_setup(action="all") → artex_start
```

不想动宿主就用命令行：

```powershell
node dsh-artex\bin\artex-dsh.mjs doctor   # 依赖自检
node dsh-artex\bin\artex-dsh.mjs start    # 起服务，默认 http://127.0.0.1:8787
node dsh-artex\bin\artex-dsh.mjs status
node dsh-artex\bin\artex-dsh.mjs stop
```

首次访问 `http://127.0.0.1:8787` 会要管理员密码，setup token 在日志里（`artex_logs` 或 `.artex-runtime\artex.log`）。
数据库是本机 PostgreSQL（插件自建集群，端口从 55460 起自动挑，数据在 `artex\.artex-runtime\pg`）。

## 三、启动

```powershell
# Web 版
powershell -ExecutionPolicy Bypass -File ".\start-dsh.ps1"
```

桌面版双击桌面「DeepSeek Harness」即可。

## 四、启动后必做的三步（一次即可）

这两步脚本代替不了，是 dsh-purge 的设计：

1. 会话标题旁点 **dsh-purge** 图标 → **清洗** → **应用**（应用后自动重启）
2. 聊天框输入 `/purge status` 验证
3. **工作流中心** → **导入** → 选 `minglink-workflows\dsh-workflows\workflows\破甲制作.wflite.zip`

> dsh-purge 的状态**按宿主分开记录**。Web 端点过「应用」，桌面版还要再点一次。

## 五、换模型供应商

**Web 版**改：`deepseek-harness\.dsh\profiles\web\cordis.patch.yml`
**桌面版**改：`C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml`

```yaml
- id: llm-pi-ai
  config:
    providers:
      供应商名:
        displayName: 显示名
        api: anthropic-messages
        apiKeyEnv: 你的变量名
        baseURL: https://...
        models:
          - id: 模型ID
- id: agent-default-model
  config:
    provider: 供应商名
    model: 模型ID
```

密钥分别放在：
- Web：`deepseek-harness\.dsh\.env`
- 桌面版：`C:\Users\Administrator\.dsh\.env`

改完不用重启，下次请求生效。

## 六、REA 用法

```bash
# 静态分析一个 JS / Electron 应用（不需要额外引擎）
rea analyze-javascript-application "D:/app/path" --json

# 检查环境具备哪些能力
rea doctor
```

native 二进制分析需要 Hopper / Ghidra / IDA / JADX 之一，见下方状态。

## 七、已知限制

- **REA native 引擎**：Ghidra 12.1.4 已下载到 `ghidra/`（需要 JDK 21，本机是 17）；Hopper/IDA/JADX 是商业或需单独提供的工具，不在仓库内。
- **Node 版本**：本机 22.22.2，REA 要求 ≥ 22.23.4，不影响当前使用。
- **dsh-purge 的 `/purge status`** 只有在点过「应用」之后才有输出，未安装的补丁不会凭空出现。
- **ARTEX 上游已下线**：`Autumn-27/ARTEX` 已 404，仓库里固定的是同源镜像 `jiwoochris/artex-global`；`artex_setup` 还带 `BaaRai/ARTEX`、`Hinln/ARTEX`、`RuoJi6/ARTEX` 回退，全不通时会提示改用 DITING / antifox 等同能力替代。
- **ARTEX 依赖 PostgreSQL**：插件会自己在 `artex\.artex-runtime\pg` 建集群（端口从 55460 起自动挑），也可以把 `dsn` 配成现成库；没有 PostgreSQL 工具链时 `artex_doctor` 会明说。
- **ARTEX 首次访问要设管理员密码**：一次性 setup token 只打在启动日志里，不联网传输。
