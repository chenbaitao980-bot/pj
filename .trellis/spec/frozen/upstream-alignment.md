# 上游对齐闸门（Upstream Alignment Gate）

> **红线**：未完成本流程并取得用户明确确认之前，**禁止**把冻结版底座或功能对齐到新的官方上游版本。
> 违反者视为越过本项目红线，改动必须回退。

## 适用范围

- 把 `DeepSeek Harness` 冻结版底座升到新的官方版本；
- 吸收上游某个功能/行为改动（即使不升版本）；
- 重新解包官方安装包、替换 `resources/app/dsh` 的 bundle。

## 流程（四步，缺一不可）

### 1. 盘点官方更新（只读）

- 取官方目标版本号、发布说明/commit 区间；
- 逐条列出：**新功能 / 行为变化 / bug 修复 / 破坏性变更**；
- 标出会碰到前端 bundle（`dsh-client-ui-*`）或 dsh-purge 补丁目标文件的条目。

产出：`版本 + 功能清单`（表格，一功能一行）。

### 2. dsh-purge 冲突检查（只读）

逐项检查：

1. **目标文件是否被 purge 打过补丁**：`dsh-purge/lib/core.js` 的 `ALL_PATCHES` 覆盖的 `client.js` / `lib/index.js` / `cordis.patch.yml`；安装树里是否有对应的 `*.dshpurge.bak`。
2. **锚点是否会失效**：我们的 `frozen-build-src/patch-*.js` 与 purge 的补丁都按字面量匹配；上游改写同一区域会让任一方失配。
3. **行为是否冲突**：purge 的破甲/清洗/rewind/deny-bypass 与上游新行为（权限、沙箱、命令权威性、会话恢复等）是否互相抵消。
4. **`.dshpurge.bak` 语义**：上游升级会让 bak 与新原件不一致，revert 后是否还能回到"官方原件 + 冻结补丁"。
5. **结论标注**：每一项写 `无冲突 / 冲突 / 不确定`，冲突项写明证据（文件、行、marker）。

### 3. 用户决策闸门（必须先问）

把以下内容一次性交给用户：

- 目标版本与功能清单；
- 每项的冲突结论与证据；
- 建议：**与 dsh-purge 冲突的功能一律不对齐**（保留本地现状），其余列出"可对齐/不建议对齐"；
- 明确询问："是否对齐？对齐哪些？"

**在用户书面确认前，不得开始任何对齐改动**（包括解包、替换 payload、写补丁）。

### 4. 确认后实施

- 只实现用户点名的条目；
- 按 `AGENTS.md` 的冻结版规范：snapshot → 改 payload → 跑全部 `patch-*.js` → `verify-install.ps1` → 升版本号 → 重新打包；
- 在 `docs/releases/<version>.md` 记录：对齐了哪些、放弃了哪些及原因（引用第 2 步的冲突证据）。

## 快速检查命令

```bash
# purge 补丁目标文件
grep -n "file:" dsh-purge/lib/core.js | head -50

# 安装树里被 purge 备份过的文件
find "C:/Users/Administrator/AppData/Local/Programs/DeepSeekHarnessFrozen/resources/app/dsh/node_modules/@deepseek-ai" -name "*.dshpurge.bak"

# 我方冻结补丁锚点
ls frozen-build-src/patch-*.js

# 补丁完整性
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-install.ps1
```

## 记录模板

```md
## 上游对齐：<官方版本>

| 功能 | 类型 | purge 冲突 | 证据 | 用户决定 |
| --- | --- | --- | --- | --- |
| … | 新功能 | 无 | — | 对齐 |
| … | 行为变化 | 冲突 | core.js:7071 patched file / 锚点 A 失配 | 放弃 |

用户确认：<日期 / 原话摘要>
```
