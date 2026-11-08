<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 冻结版改造规范（强制）

适用于对 `DeepSeek Harness 冻结版` 的一切改动（`resources/app/dsh` 内的已编译 bundle、payload、安装包）。

1. **本地优先于官方**：官方上游功能与本地冻结版功能冲突时，**保留本地功能**。官方改动只作增量吸收（新增能力、修 bug），不得覆盖、回退或以"标准化"为由改写本地定制。
2. **保留旧版本**：任何改动前先用 `scripts/release.ps1 -Action snapshot` 快照被改文件，改完用 `Build-FrozenSetup.ps1 -Version <新版本>` 重打包。旧 Setup.exe、旧 `.sha256`、旧 `backup-frozen-*` 一律不删不覆盖。
3. **只改 payload**：改动落在 `D:\dsh-freeze-new\payload`，不直接改运行中的安装目录，避免影响当前工作台。
4. **补丁脚本化**：对已编译 bundle 的改动写成 `frozen-build-src/patch-*.js`，每处替换用正则+唯一命中校验，带已应用标记可重入；改完必须 `node --check`。
5. **手机端同步**：升版时同步 `mobile/`（APK / tgz / manifest）与 `Install-MobilePlugin.ps1`。
