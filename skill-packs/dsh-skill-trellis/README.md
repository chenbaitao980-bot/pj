# dsh-skill-trellis

把 [Trellis](https://github.com/mindfold-ai/Trellis) 整套工作流接进 **DeepSeek Harness（DSH）**：
16 个 `trellis-*` 技能全局可用 + **会话启动自动注入 Trellis 上下文**（等价于 Claude Code 的 `SessionStart` hook）。

装一次，所有项目生效；不需要在每个项目里 `trellis init` 才能用技能。

## 它解决什么

Claude Code 里 `.claude/settings.json` 配了 `SessionStart` hook，跑 `.claude/hooks/session-start.py`，
于是新会话第一句就是「Trellis SessionStart 上下文已加载」，模型手上立刻有：当前任务、Git 状态、
Phase Index、下一步动作。

Trellis 官方 0.6.17 的 dsh 模板写得很清楚：

> dsh is a **class-2 pull-based** Trellis host: no session-start hook auto-injects workflow context.

本插件补的就是这段空白。会话第一步（`agent/pre-step`, `step === 1`）里：

1. 从会话工作目录向上找**项目级** `.trellis/`（认 `workflow.md` / `config.yaml` / `.version`，
   显式排除用户级 `~/.trellis`，遇到 `.git` 就停止上溯）；
2. 找到后渲染上下文，二选一：
   - **优先跑项目自带的 hook 脚本**：`.claude/hooks/session-start.py`（就是 Claude Code 用的同一份，
     输出格式完全一致），或 `.trellis/hooks/session-start.py`、`.trellis/scripts/hooks/session-start.py`、`.codex/hooks/session-start.py`；
   - 没有 Python / 没有脚本 / 脚本报错时，**退回内置 JS 渲染器**（纯 node 内置模块，不依赖 python）；
3. 以带 `source.kind = 'trellis-session-start'` 的 user 消息注入本步（`<system-reminder>` 包裹），
   模型第一眼就看到任务状态，并按 `first-reply-notice` 回一句「Trellis SessionStart 上下文已加载」；
4. 同一会话只注入一次：恢复会话、上下文压缩后按可见历史去重，不会每轮刷屏。

## 安装

插件目录放 `%USERPROFILE%\.dsh\plugins\dsh-skill-trellis`，并在 profile 的
`%USERPROFILE%\.dsh\profiles\<profile>\package.json` 里登记：

```json
{
  "dependencies": { "dsh-skill-trellis": "file:../../plugins/dsh-skill-trellis" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-skill-trellis"] } }
}
```

`node_modules/dsh-skill-trellis` 指向插件目录（junction 或 pnpm link 均可），重启 DSH 生效。

## 配置（`cordis.patch.yml` 或 profile 补丁层）

```yaml
- id: dsh-skill-trellis
  config:
    enabled: true          # false = 只给技能，不做 SessionStart 注入
    useHookScript: true    # false = 强制走内置渲染器
    hookScript: ''         # 显式指定脚本（相对项目根）；指定了就以它为准，不再探测候选
    python: ''             # 显式指定解释器，缺省按 python / python3 / py 依次尝试
    timeoutMs: 20000       # 脚本超时，超时即降级内置渲染器
    maxChars: 60000        # 注入上限，超出截断并标注
    skipSubagents: true    # 子 agent 不重复注入
```

环境变量开关（优先级最高）：`TRELLIS_HOOKS=0`、`TRELLIS_DISABLE_HOOKS=1`、`DSH_TRELLIS_HOOKS=0` 任一命中即不注入。

## 自检

```bash
node scripts/smoke.mjs <项目目录>
```

覆盖：技能表 16 项、注入内容与来源标记、同会话去重、无 `.trellis` 不注入、
内置渲染器可区分、`TRELLIS_HOOKS=0` 生效、解析 Claude 信封、真实脚本可运行。

## 内置渲染器给模型的内容

`<session-context>` + `<first-reply-notice>` + `<current-state>`（开发者 / Git / 当前任务 /
活跃任务清单 / journal / spec 索引数）+ `<trellis-workflow>`（`workflow.md` 的 Phase Index 段）
+ `<guidelines>` + `<task-status>`（下一步动作）+ `<ready>`。

与官方 `session-start.py` 同一套语义，少了 monorepo `spec_scope` 精细过滤；
要完整语义就让它跑脚本（默认行为）。

## 和官方 Trellis 的关系

- Trellis 0.6.17 仍把 dsh 视为 pull-based（无 hook）。本插件把 dsh 升级成 push + pull 混合：
  启动时推一次紧凑上下文，细节仍由技能按需读 `.trellis/`。
- `trellis init --dsh` 仍可正常用；它写的 `.dsh/skills/`、`.agents/skills/` 与本插件并存，
  本插件只是让这些技能在任何项目里都能直接调用。
- `.trellis/` 不存在时不注入任何内容，也不自动 `trellis init`（避免污染别人的仓库）。

## 许可

MIT
