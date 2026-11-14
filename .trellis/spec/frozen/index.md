# frozen — 冻结版改造与上游对齐

本包收录 `DeepSeek Harness 冻结版`（payload、已编译 bundle、安装包、dsh-purge 协同）的强制规范。

## 为什么存在

冻结版在已编译 bundle 上叠加了大量本地补丁（dsh-purge + 冻结补丁）。上游任何一次升级都可能让补丁失配、让 purge 行为失效，或在用户不知情时改变工作台行为。因此"对齐官方"不是普通升级，而是一个需要**冲突检查和人工确认**的受控动作。

## 文件

- [`upstream-alignment.md`](upstream-alignment.md) — 上游对齐闸门（红线）：盘点 → dsh-purge 冲突检查 → 用户决策 → 实施与记录。
- [`hot-deploy.md`](hot-deploy.md) — 本地插件热部署（宿主半边如何触发 HMR 重载）与宿主 API 陷阱。

## Pre-Development Checklist

- [ ] 这是"对齐官方"类任务吗？是 → 必须先走 `upstream-alignment.md` 的四步，**未获用户确认不得开工**。
- [ ] 是否已列出官方版本与逐项功能清单？
- [ ] 是否逐项标注了与 dsh-purge 的冲突结论与证据？
- [ ] 用户是否已书面决定"对齐 / 不对齐哪些"？
- [ ] 实施是否遵守 `AGENTS.md` 冻结版规范（snapshot、只改 payload、补丁脚本化、`verify-install`、升版本）？

## Quality Check

- [ ] 未对齐的功能在发布说明里写明了原因。
- [ ] 所有 `patch-*.js` 在 payload 上幂等且 `node --check` 通过。
- [ ] `scripts/verify-install.ps1` 为 0 failed。
- [ ] 安装包与发布说明的版本、大小、SHA-256 一致。
