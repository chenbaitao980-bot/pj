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
2. **先快照再升版**：任何改动前先用 `scripts/release.ps1 -Action snapshot` 快照被改文件，改完用 `Build-FrozenSetup.ps1 -Version <新版本>` 重打包。默认保留旧 Setup.exe / `.sha256` / `backup-frozen-*` 供回滚；只有用户**明确要求**清理旧版本时才可删除，并在 `docs/releases/<version>.md` 里记录删了哪些。
3. **只改 payload**：改动落在 `D:\dsh-freeze-new\payload`，不直接改运行中的安装目录，避免影响当前工作台。
4. **补丁脚本化**：对已编译 bundle 的改动写成 `frozen-build-src/patch-*.js`，每处替换用正则+唯一命中校验，带已应用标记可重入；改完必须 `node --check`。打包流水线必须同步并执行 `frozen-build-src/patch-*.js`，并用 `scripts/verify-install.ps1` 卡住缺补丁的包。
5. **手机端同步**：升版时同步 `mobile/`（APK / tgz / manifest）与 `Install-MobilePlugin.ps1`；确认移动端是否需要新包，若需要则让下载入口指向最新适配版本。
6. **对齐官方版本 = 人工闸门（红线，绝对不可逾越）**：把冻结版底座/功能对齐到新的官方上游之前，必须：
   1) 先梳理官方目标版本与**逐项功能更新清单**（版本号、新增/修复/行为变化）；
   2) 逐项做 **dsh-purge 冲突检查**（purge 补丁目标文件、`.dshpurge.bak`、补丁锚点、rewind/清洗行为；见 `.trellis/spec/frozen/upstream-alignment.md`）；
   3) **与 dsh-purge 冲突的功能一律不对齐**（保留现状并记录原因）；
   4) 把「版本 + 功能清单 + 冲突结论」交给用户，**由用户明确决定是否对齐、对齐哪些**；
   5) 未得到用户书面确认前，不得开始任何对齐改动。
   违反此条视为越过项目红线。
