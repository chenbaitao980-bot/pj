---
name: trellis-test
description: "自动测试生成、回归验证、安全审计、覆盖完整性检查。影响分析(codegraph+gitnexus)→测试计划→并行生成(子Agent)→运行+自动修复→中文报告（含历史回归测试用例、手动验证建议、自愈修复次数）。支持Python/Go/Java/JS/TS/Rust/PHP/Ruby/Kotlin/Android等。触发词：/trellis-test、测试、回归、覆盖检查、测试报告"
trigger: /trellis-test
---

# trellis-test — 自动测试生成与验证

## 强制规则（不可违反）

1. **必须按 Step 0→1→1e→1f→2→3→3e→4→4d→4e→5→6 顺序执行**，任何理由不得跳过或重排
2. **禁止使用 ponytail / 偷懒模式执行本技能**。trellis-test 是严谨的测试验证流程，不得以「够用就行」「简单点」「下次再补」等理由跳过、缩减或弱化任一 Step 的完整执行。所有规则必须不折不扣执行。
3. **每个 Step 完成后必须验证输出物存在且非空**，验证失败则重试一次，再失败则终止并报告
4. **所有表格标签必须用中文**：风险等级用「高/中/低」、测试层级用「直接/上游/下游/同级」、优先级用「强制/建议/可选」、审计结论用「通过/不通过/需确认」
5. **对中风险以上符号必须生成全部四层测试**（直接 + 上游 + 下游 + 同级），不允许只生成单层
6. **回归测试必须覆盖所有历史修复提交**（不限时间范围），每个 fix 至少一个可执行用例。**不得遗漏**：必须对爆炸半径内每个源文件搜索全部历史 fix 提交，按功能域分组生成回归测试，无遗漏。搜索关键词必须覆盖 `fix/bug/hotfix/patch/resolve/correct/adjust/repair/修/缺陷/纠正/修正/调整/回滚/rollback`，且必须对每个源文件执行 `git log --all --grep`，不可只搜单个文件。
7. **报告全文必须中文**，不得出现任何英文标签或术语
8. **最低覆盖率门禁**：全部通过后，测试覆盖的符号数必须 ≥ 受影响符号数的 90%，否则报告标红
9. **禁止偷工减料**：AI 不得以「效率」「简洁」「够用就行」等理由跳过或弱化任一 Step 的完整执行。高风险符号必须生成全部四层测试（直接+上游+下游+同级）；中风险符号同高风险处理。每层用例的充分性由「分支覆盖门禁 + 业务不变量全过」判定（见规则 10），禁止为凑数量堆砌无分支覆盖价值的废用例。
10. **用例充分性门禁（替代总量底线）**：不再以用例总数 ≥40 为底线；改为「量由分支缺口驱动」——每个被改纯函数/核心逻辑的分支覆盖 ≥ 门禁（默认 90%，config.json 可调），且该函数声明的业务不变量断言全部通过。Step 3 生成后运行分支覆盖统计，未覆盖分支自动补用例（见「Step 3 并行检测力强化」）。
11. **每个变更点至少一个专用测试文件**：不允许将多个变更点的测试塞进同一文件。每个变更点独立一个 test_<变更描述>.py。
12. **索引新鲜度前置检查**：Step 1 之前必须验证 codegraph/gitnexus 索引的时间戳 ≥ 最后一次 git commit 的时间戳，索引过期则重建
13. **破坏性验证必须覆盖所有源文件**：不是只验证 main 修复文件。每个有代码变更的源文件（app.py、tcp_proxy.py、user_store.py 等）都必须做 R-G-R 验证。验证不通过该文件视为测试不合格。
14. **每个 Step 完成后必须执行 `/goal`**：在完成 Step 出口的验证后，必须显式输出 `/goal` 命令（如 `/goal 环境就绪 — pytest 可用，.trellis/tests/lib/ 已创建`）。不执行 `/goal` 视为该 Step 未完成，不得进入下一步。
15. **历史 fix 冲突以最新为准（含行为反转确认例外）**：同一功能域的多个 fix 在新旧冲突时，以最新 commit 的行为作为回归测试的标准。**例外（行为反转确认，强制）**：当新 fix 使某函数行为发生反转（旧行为 X → 新行为 ¬X）时，禁止直接「以最新为准」忽略旧行为。必须：(a) 用 `git log --all -- <源文件>` 识别同一函数被反向修改的 commit 对；(b) 为旧方向保留独立回归用例并运行确认其**变红**（红 = 反转证据）；(c) 在 Step 5 报告「行为反转确认」章节显式记录反转并判定「有意反转」或「意外回归」。只有判定为有意反转后，旧方向用例才可标记 `OBSOLETE`，不得静默删除。
16. **AB 验证必须做代码恢复确认**：Step 4d 第 6 步的恢复验证不可跳过。任何文件恢复失败，不得进入 Step 4e。报告「AB 验证」章节每行必须有「代码已恢复」列且为确认状态。
17. **上游依赖链新鲜度检查不可跳过**：Step 4b 必须检查受影响符号的上游依赖变更，`.dep_stale` 未清空不得进入 Step 4c。
18. **预期值/实际值校验门禁**：Step 4e 必须提取每个失败测试的预期值和实际值，写入 `.fix_stats`。判定为 `needs_human` 的测试不得进入下一轮修复。报告新生成测试清单和历史回归测试清单的每行必须有预期值、实际值、判定三列。
19. **并行策略决策不可跳过**：Step 1d 必须评估依赖关系并写入 `.parallel_plan`，AI 不可自行跳过判断直接顺序执行。
20. **索引强制刷新**：Step 0a 必须先刷新 codegraph+gitnexus 再验证，`.index_stale` 存在时报告必须标记索引过期警告。
21. **违反以上任何一条** = 本次调用无效，需要重新 `/trellis-test`
22. **Step 6 必须执行产物清理与暂存门禁** — Step 6 必须先 `git add` 有价值文件（测试库、报告、配置），再删除中间产物。不执行直接退出的 = 本次调用无效
23. **Step 6 出口 `/goal` 必须验证 git 暂存状态** — 输出 `/goal 测试库更新 + 产物清理完成` 前必须确认 `git status --short .trellis/tests/lib/` 显示已暂存
24. **数据安全门禁（强制）** — 测试必须用临时目录（`tempfile.TemporaryDirectory()`）+ `create_detached()` 单例隔离，**禁止测试读写真实运行时数据文件**（`accounts.json`/`users.json`/`online_sessions.json`/`*_ip_map.json`/`tenants/*/users.json`）。Step 0 必须做运行时数据基线快照，Step 6 必须比对并恢复被测试污染的运行时数据文件。
25. **只留必要文件（强制）** — 运行结束后仅保留：报告、测试库(`.trellis/tests/lib/`)、`config.json`、`.regression_index`、`.fix_stats`、`.spec_audit_report`、`.env_availability`（环境预检证据，供降级审计）。必须删除：中间产物、`__pycache__/`、`.pytest_cache/`、`backup/`、`imported/`、`generated/`、`regression/` 工作目录。**不得留下测试产生的运行时数据污染**（规则 24）。
26. **模板内嵌 JS 语法门禁（强制）** — 当变更涉及「Python 模板生成 HTML/JS」的代码（render/_page 函数、f-string 或三引号字符串内嵌 `<script>`，如 `_build_admin_page`/`attack_js`）时：Step 3 必须为该变更点生成「渲染产物 JS 语法校验」测试——调用渲染函数 → 提取全部 `<script>` 内容 → `node --check`（子进程）。Step 4c 运行后必须确认该门禁测试已执行且通过。**子串存在性断言（`assert "xxx" in html`）不算语法校验**：Python 三引号字符串会把 `\'` 吞成 `'`，产出的 JS 可能语法非法但子串都在（如 `unbanIp('' + ip)`），此时整页内联脚本失效、面板静默 loading 无数据——只有 JS 引擎验语法能拦住。node 不可用时降级为 Python JS 解析器（`pyjsparser`/`esprima`），仍不可用则标记 `js_check_skipped` 并在 Step 5 报告标注 ⚠️。任何 JS 语法非法却通过 = 测试不合格，回到 Step 3 重新生成。
27. **降级禁止偷懒（无证据不降级，强制）** — 任何「X 不可用」的降级/跳过声明必须附**验证证据**：实际尝试调用的命令 + 输出 + 退出码（如 `node --version` 输出、实际运行 `_step4c_run.py` 的失败输出），并对照 Step 0 写入的 `.env_availability` 预检记录。无证据的降级声明 = 该调用无效，需重跑该 Step。兜底产物必须严格遵循本 skill 定义的降级路径（gitnexus 不可用 → 纯 codegraph+grep；node 不可用 → `pyjsparser`/`esprima`），不允许自创替代品。每次降级必须写入报告「降级记录」章节（Step / 降级点 / 验证证据 / 兜底产物 / 是否影响完整性）。
28. **环境自愈（强制，先自愈再降级）** — 项目语言所需的测试运行器（pytest/maven/gradle/jest/npm 等）缺失时，**必须先自愈**，禁止把「环境不可用」当作合法的降级/跳过理由写进报告。自愈顺序：①探测项目语言（存在 `pom.xml`/`build.gradle`/`package.json`/`*.py`/`go.mod` 判定）→ 确定所需运行器；②运行器缺失时依次尝试 `winget install` → `choco install` → `scoop install` → 官方/镜像下载 zip 解压（附验证 `mvn -v`/`pytest --version`/`node --version` 等）；③仍不可用则改用**项目可用的等效直接运行器**——如 Java 无 maven 时用 `javac`（配合本地依赖 classpath）+ `junit`/`JUnitCore` 直编直跑，Python 无 pytest 时用 `python -m unittest`/自写断言 runner——保证测试**真正运行**而不是被跳过。**Step 0 必须先完成运行器自愈，再进入 Step 1**。仅当「安装失败（附命令+输出+退出码）+ 无等效运行时」才允许降级，且报告「降级记录」必须给出可复现的替代执行路径。**用这条规则替代任何「环境不支持就记录局限」的行为**。

## 流程（必须按顺序）

```
Step 0: 环境检测           强制刷新 codegraph+gitnexus → .trellis/tests/lib/ 就绪 → /goal 门禁
Step 1: 影响分析             codegraph + gitnexus → .affected_symbols
Step 1d: 并行策略决策（不可跳过）评估依赖关系 → 确定哪些 Step 可并行 → 写入 .parallel_plan
Step 1e: 历史回归发现+用例生成  git log → .history_fixes → 分析每个fix生成回归用例
Step 1f: 爆炸范围覆盖完整性检查  affected_symbols ↔ 已有测试 → 标记未覆盖符号
Step 2: 测试计划             展示计划（含爆炸半径+历史回归+spec清单+覆盖完整性） → 确认即进入 Step 3
Step 3: 并行生成测试         子Agent 生成 test_*.py → .trellis/tests/generated/（含模板内嵌 JS 语法门禁用例）
Step 3e: 路径覆盖检验+手动验证建议  git diff 分支提取 → 标记 I/O 路径+生成验证建议
Step 4: 运行+修复            4a同步→4b查已有测试+新鲜度→4c运行→4d AB验证→4e修复循环（统计自愈次数）
Step 5: 报告（中文）          中文报告含：变更说明+覆盖完整性+历史回归+AB验证结果+手动验证建议+自愈修复次数
Step 6: 更新测试库 + 产物清理  合并 generated/ → lib/，git add 有价值文件，删除中间产物
```

## 八个设计规则

1. **Step 不跳过** — AI 必须按 0→1→1e→1f→2→3→3e→4→5→6 顺序执行，输出物验证通过才能进下一步
2. **每个 Step 出口必须执行 `/goal`** — 完成输出物验证后立即输出对应的 `/goal` 命令，作为该 Step 完成的显式标志。不执行 `/goal` 则不允许进入下一步。
3. **爆炸半径不遗漏** — Step 1b 必须 codegraph/gitnexus 查 affected_symbols，Step 1f 必须交叉检查每个符号是否被测试覆盖
4. **历史回归必须生成用例** — Step 1e 按 git→svn→本地备份三级兜底搜索全部历史 fix（扩展关键词 + 全量不限条数兜底），不能只查最近四周。每个历史 fix 生成可执行的回归测试用例
5. **新鲜度保真** — TestedSource hash vs HEAD 版本级校验，外加基于 hash 范围的完整内容级 diff 校验（覆盖 TestedSource 到 HEAD 的全部中间 commit）。过期自动删除+重新生成
6. **全量重跑** — 修复循环只重跑全部 SELECTED_TESTS（不缩减），/goal 文件跟踪，通过才 Step 5
7. **AI 不交互式等待** — 所有决策通过文件（.fix_goal、.manual_verify_items、.fix_stats）传递，无 read -r
8. **结果可审计（中文报告）** — 每个 Step 输出 JSON 到 .trellis/tests/，Step 5 汇总中文报告，包含覆盖完整性、覆盖率门禁结果、历史回归测试清单、手动验证建议、自愈修复次数

> 违反后果：跳过流程 = 无效调用，需要重新 /trellis-test

---

## Step 0: 环境检测

**入口**: 无（起始步骤）
**出口**: 确认项目语言对应的测试运行器可用（缺失则按强制规则 28 自愈安装/定位），`.trellis/tests/` 下 `lib/regression/`、`lib/coverage/` 目录存在

```bash
# 确认可用
echo "codegraph: $(codegraph_explore --version 2>/dev/null || echo OK)"
echo "gitnexus: $(which gitnexus 2>/dev/null || echo MCP)"
# 工具可用性预检（防后续"不可用"假声明 — 强制规则 27）
# node 版本预检（模板内嵌 JS 语法门禁需要，见强制规则 26），写入 .env_availability 供后续 Step 对照
echo "node: $(node --version 2>/dev/null || echo UNAVAILABLE)"
echo "node:$(node --version 2>/dev/null || echo UNAVAILABLE)" > .trellis/tests/.env_availability
python -c "import pytest; print(f'pytest {pytest.__version__}')" 2>/dev/null || pip install pytest -q

# === 运行器自愈（强制规则 28）：探测项目语言 → 确定所需运行器 → 缺失则安装/定位 ===
# 先自愈，再进入 Step 1。禁止把「运行器缺失」当降级理由。
RUNNER_NEEDED=""
if [ -f pom.xml ] || ls */pom.xml 2>/dev/null | grep -q .; then RUNNER_NEEDED=maven; fi
if [ -z "$RUNNER_NEEDED" ] && { [ -f build.gradle ] || ls */build.gradle 2>/dev/null | grep -q .; }; then RUNNER_NEEDED=gradle; fi
if [ -z "$RUNNER_NEEDED" ] && [ -f package.json ]; then RUNNER_NEEDED=node; fi
if [ -z "$RUNNER_NEEDED" ] && ls *.py 2>/dev/null | grep -q .; then RUNNER_NEEDED=pytest; fi
case "$RUNNER_NEEDED" in
  maven)
    if command -v mvn >/dev/null 2>&1; then echo "✅ maven: $(mvn -v 2>/dev/null | head -1)"
    else
      echo "⚠️ maven 缺失 → 尝试自愈（强制规则 28）: winget/choco/scoop/官方zip..."
      (winget install Apache.Maven -h --accept-package-agreements --accept-source-agreements 2>/dev/null \
        || choco install maven -y 2>/dev/null \
        || scoop install maven 2>/dev/null) \
        || { curl -fsSL -o /tmp/maven.zip "https://archive.apache.org/dist/maven/maven-3/3.8.8/binaries/apache-maven-3.8.8-bin.zip" 2>/dev/null \
             && (unzip -qo /tmp/maven.zip -d /tmp/ 2>/dev/null || python -c "import zipfile;zipfile.ZipFile('/tmp/maven.zip').extractall('/tmp/')" 2>/dev/null) \
             && export PATH="/tmp/apache-maven-3.8.8/bin:$PATH"; }
      command -v mvn >/dev/null 2>&1 && echo "✅ maven 自愈成功: $(mvn -v 2>/dev/null | head -1)" \
        || echo "❌ maven 自愈失败（记入降级记录；若项目有等价 javac+JUnitCore 路径则用之，保证测试真正运行）"
    fi ;;
  gradle) [ -f gradlew ] && echo "✅ gradle wrapper: ./gradlew" || echo "⚠️ gradle 缺失且无 wrapper → choco/scoop 安装或下载 gradle" ;;
  node) command -v node >/dev/null 2>&1 && echo "✅ node: $(node --version)" || echo "⚠️ node 缺失 → 安装" ;;
  pytest) python -c "import pytest; print(f'✅ pytest {pytest.__version__}')" 2>/dev/null || pip install pytest -q ;;
  *) echo "✅ 未识别到标准项目构建文件；按语言兼容性表选等效 runner（如 javac+JUnitCore）保证测试真跑" ;;
esac
# Java 无 maven 时的等效路径（强制规则 28 例）：javac 直编 + JUnitCore 直跑
command -v javac >/dev/null 2>&1 && echo "javac: $(javac -version 2>&1 | head -1)"

# skill 配套脚本：优先项目级路径，否则从 skill 目录加载
_S4B=".trellis/scripts/_step4b_find.py"; [ -f "$_S4B" ] || _S4B="$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}" 2>/dev/null)")/_step4b_find.py"; [ -f "$_S4B" ] && python "$_S4B" --check 2>/dev/null || true
mkdir -p .trellis/tests/lib/regression .trellis/tests/lib/coverage

# 运行时数据基线快照（数据安全门禁 — 强制规则 24）
# 测试前记录真实数据文件快照，Step 6 比对并恢复被污染的文件
mkdir -p .trellis/tests/.data_backup
for f in accounts.json users.json online_sessions.json remote/noconfig/account_ip_map.json tenants/*/users.json; do
  if [ -f "$f" ]; then cp "$f" ".trellis/tests/.data_backup/$(echo "$f" | tr '/' '_')" 2>/dev/null; fi
done
echo "✅ 运行时数据基线快照完成 → .trellis/tests/.data_backup/"
```
验证：项目所需运行器可用则继续；缺失则按强制规则 28 自愈（安装/等效 runner），全部尝试失败才终止并报降级。

### 0a 索引刷新（强制，不可跳过）

在进入 Step 1 之前，**强制刷新** codegraph 和 gitnexus 索引。不是"检查新鲜度"，是"先刷新再验证"。

```bash
# 获取最后一次 git commit 的时间戳（Unix epoch）
LAST_COMMIT_TS=$(git log -1 --format=%ct 2>/dev/null || echo 0)
echo "最后 commit: $(date -d @$LAST_COMMIT_TS 2>/dev/null || echo $LAST_COMMIT_TS)"

# 并行刷新 codegraph + gitnexus（互不依赖）
echo "--- 并行刷新 codegraph + gitnexus 索引 ---"

# 1. 后台刷新 codegraph
python -c "
import os, sys
try:
    import codegraph
    codegraph._watch_all()
    cg_dir = '.codegraph'
    if os.path.isdir(cg_dir):
        latest = max(
            (os.path.getmtime(os.path.join(root, f)) for root, _, files in os.walk(cg_dir) for f in files),
            default=0
        )
        print(f'codegraph 索引时间: {int(latest)}')
        if latest >= $LAST_COMMIT_TS:
            print('codegraph: 刷新成功')
            sys.exit(0)
        else:
            print('codegraph: 刷新后仍落后 commit，可能文件 watcher 延迟')
            sys.exit(1)
    else:
        print('codegraph: 无 .codegraph 目录')
        sys.exit(1)
except Exception as e:
    print(f'codegraph 刷新失败: {e}')
    sys.exit(1)
" 2>&1 &
PID_CG=$!

# 2. 后台刷新 gitnexus
(node .gitnexus/run.cjs analyze 2>/dev/null || npx gitnexus analyze 2>/dev/null) && \
echo "gitnexus: 刷新成功" || echo "⚠️ gitnexus 刷新失败（爆炸半径分析可能不完整）" &
PID_GN=$!

# 3. 等待全部完成
wait $PID_CG $PID_GN
echo "--- 双索引刷新完成 ---"

# 3. 最终验证：索引时间戳 ≥ commit 时间戳 → 通过
CODEGRAPH_TS=$(python -c "
import os
cg_dir = '.codegraph'
if os.path.isdir(cg_dir):
    latest = max((os.path.getmtime(os.path.join(root, f)) for root, _, files in os.walk(cg_dir) for f in files), default=0)
    print(int(latest))
else:
    print(0)
" 2>/dev/null || echo 0)
GITNEXUS_TS=$(python -c "
import os
gn_dir = '.gitnexus'
if os.path.isdir(gn_dir):
    latest = max((os.path.getmtime(os.path.join(root, f)) for root, _, files in os.walk(gn_dir) for f in files), default=0)
    print(int(latest))
else:
    print(0)
" 2>/dev/null || echo 0)

REBUILD_FAILED=0
if [ "$CODEGRAPH_TS" -lt "$LAST_COMMIT_TS" ] 2>/dev/null; then
    echo "❌ codegraph 索引仍过期: $CODEGRAPH_TS < $LAST_COMMIT_TS"
    REBUILD_FAILED=1
fi
if [ "$GITNEXUS_TS" -lt "$LAST_COMMIT_TS" ] 2>/dev/null; then
    echo "❌ gitnexus 索引仍过期: $GITNEXUS_TS < $LAST_COMMIT_TS"
    REBUILD_FAILED=1
fi
if [ "$REBUILD_FAILED" -eq 1 ]; then
    echo "⚠️ 索引刷新失败，继续执行但爆炸半径分析可能不完整"
    echo "索引刷新失败" > .trellis/tests/.index_stale
else
    echo "✅ 索引刷新成功: codegraph=$CODEGRAPH_TS gitnexus=$GITNEXUS_TS"
    rm -f .trellis/tests/.index_stale
fi
```

**出口 Goal**: `/goal 环境就绪 — pytest 可用，.trellis/tests/lib/ 已创建，codegraph+gitnexus 索引已刷新`

如果 `.trellis/tests/.index_stale` 存在（索引刷新失败），Step 5 报告必须标记 ⚠️ 索引过期，爆炸半径分析不完整。

## Step 1: 影响分析

**入口**: `.trellis/tests/` 目录存在
**出口**: `.trellis/tests/.affected_symbols` 文件存在且非空，包含爆炸半径内所有符号
**出口 Goal**: `/goal 影响分析完成 — .affected_symbols 非空，爆炸半径文件列表已提取`

### 1a 获取变更
**入口**: 项目有 git 仓库
**出口**: `.trellis/tests/.affected_files` 存在，列出所有变更文件（源码 + 测试）
```bash
git diff --name-only HEAD > .trellis/tests/.affected_files
```
**回归知情输入（点6，强制）**: 把本次任务的「故障现象/用户报障/修复意图」描述写入 `.trellis/tests/.bug_context`（来源：PRD、task 描述、用户最新消息；无则写「无」）。Step 3 生成用例时必须引用它——为每个已知故障模式至少造 1 个直击用例，防止"刚修好的 bug 下次再漏"。
**非功能变更过滤**: 如果 `.affected_files` 中只包含以下类型文件，跳过完整 flow 并输出「仅非功能变更，无需测试」：
- 依赖文件（`requirements*.txt`, `Pipfile*`, `pyproject.toml`, `package.json`, `yarn.lock`）
- CI 配置（`.github/`, `.gitlab-ci.yml`, `Jenkinsfile`）
- 文档（`*.md`, `*.rst`, `docs/`）
- 纯配置文件（`*.cfg`, `*.ini`, `.editorconfig`）

过滤逻辑：
```bash
# 检查是否所有变更都是非功能文件
NON_FUNC_PATTERN='requirements.*\.txt|Pipfile|pyproject\.toml|package\.json|yarn\.lock|\.github/|\.gitlab-ci|Jenkinsfile|\.md$|\.rst$|docs/|\.cfg$|\.ini$|\.editorconfig'
if grep -qvE "$NON_FUNC_PATTERN" .trellis/tests/.affected_files 2>/dev/null; then
    echo "有功能变更，继续" > /dev/null
else
    echo "仅非功能变更，跳过" > /dev/null
    exit 0
fi
```
### 1b 符号级分析 (codegraph + gitnexus)
**入口**: `.affected_files` 存在
**出口**: `.trellis/tests/.affected_symbols` 存在，每行格式 `符号名|文件:行号|风险等级|说明`
必须调用 `codegraph_explore` 和 `gitnexus impact(target=symbol, direction="upstream")` 获取爆炸半径。
如果 `.trellis/tests/.index_stale` 存在（gitnexus 不可用），降级为纯 codegraph 分析 +
`grep -r` 调用点展开作为上游依赖补充。降级时所有 affected_symbols 风险等级默认标记为「中」（无法通过 gitnexus 精确评估）。
写入 `.trellis/tests/.affected_symbols`。

**affected_symbols 标准格式**（严格遵循，不可自定义）：
```
符号全名|文件路径:行号|风险等级(高/中/低)|变更说明
```
示例：
```
_ACCOUNT_IP_MAP_EXPIRE_SECONDS|remote/noconfig/hijack/setup_mitm.py:85|低|常量 3600→604800
_bind_account_user|remote/noconfig/app.py:534|中|已有 account_id 不覆盖 guard
make_presence_reporter._report|remote/noconfig/hijack/ecs_proxy.py:71|低|添加 IP 映射预查
```
每行一个符号，**不得合并多符号到一行**，**不得遗漏 codegraph 返回的上游依赖符号**。

**提取爆炸半径文件列表**: 从 `.affected_symbols` 提取每个符号的 `文件:行号` → 去重得到爆炸半径文件列表 `F`
```bash
# 从 affected_symbols 提取文件列表，与 affected_files 合并去重
awk -F'|' '{print $2}' .trellis/tests/.affected_symbols | cut -d: -f1 | sort -u > .trellis/tests/.blast_files
cat .trellis/tests/.affected_files .trellis/tests/.blast_files | sort -u > .trellis/tests/.search_files
```
`.search_files` 用于 Step 1e 搜索历史 fix，覆盖爆炸半径内所有代码文件的历史。无 git 时降级到 svn/本地兜底（同当前逻辑）。

### Step 1d: 并行策略决策（强制、不可跳过）

**入口**: `.trellis/tests/.affected_symbols` 和 `.search_files` 存在
**出口**: `.trellis/tests/.parallel_plan` 存在，记录哪些 Step 可并行
**出口 Goal**: `/goal 并行策略已确定 — .parallel_plan 已写入`

> **这是强制 Step，不得跳过。** AI 必须评估每个 Step 的依赖关系，显式判断能否并行。

```bash
# 评估当前上下文，确定哪些 Step 可并行运行
# 写入 .parallel_plan：
# 格式: step_name | can_parallel | parallel_count | reason
#
# 决定能否并行的判断依据：
# - Step 1e（回归测试生成）：每个功能域独立，互不依赖 → 可以并行
# - Step 3（测试生成）：每个符号独立，已在并行 → 维持
# - Step 3e（路径覆盖+手动验证）：依赖 Step 3 全部完成 → 不可并行
# - Step 4c（测试运行）：测试文件之间无共享状态 → 可以并行
# - 其他 Step：检查前置输出是否被后续 Step 共享 → 共享则不可并行
#
# 示例输出：
# Step 1e | can_parallel | 8 | 82个fix按功能域分8组
# Step 3  | already_parallel | N | 按符号并行子Agent
# Step 3e | no | - | 依赖Step 3全部完成才能做
# Step 4c | can_parallel | <测试文件数> | 按文件并行pytest
#
# 注意：不能并行≠跳过。不能并行的 Step 仍需顺序执行。
```

AI 判断并行策略后，必须按 `.parallel_plan` 执行。实际运行时可以调整并行度，但不能跳过判断过程。

### 1e 历史回归发现 + 回归用例生成

**入口**: `.search_files` 包含受变更及其爆炸半径内的源文件列表
**出口**: `.trellis/tests/regression/` 下存在对应每个历史 fix 的回归测试文件，`.trellis/tests/.regression_index` 已更新
**出口 Goal**: `/goal 历史回归完成 — 所有历史 fix 已生成回归测试，破坏性验证通过`

#### 1e.1 获取历史修复记录（不限时间范围）

按优先级尝试以下三种方式，**第一种可用就用第一种，不叠加**：

**方式一：git（优先，分组并行搜索）**
```bash
# 搜索所有历史（不限 --since），只取影响爆炸半径内文件的 fix 类提交
# 使用扩展关键词覆盖更多措辞风格
# 按文件分组并行运行（每组 4 个文件，后台执行后合并结果）
python -c "
import subprocess, os, sys
try:
    with open('.trellis/tests/.search_files') as f:
        files = [l.strip() for l in f if l.strip().endswith(('.py','.java','.kt','.go','.rs','.ts','.js'))]
except:
    files = []
if not files:
    sys.exit(0)
# 分组（最多 4 组并行）
n = max(1, len(files) // 4)
batches = [files[i:i+n] for i in range(0, len(files), n)]
procs = []
for i, batch in enumerate(batches):
    tmp = f'.trellis/tests/.hf_{i}'
    kw = 'fix|bug|修|hotfix|patch|regression|缺陷|feat|resolve|correct|adjust|repair|纠正|修正|调整|回滚|rollback|补丁'
    with open(tmp, 'w') as fh:
        procs.append((subprocess.Popen(['git','log','--oneline','--all','--grep='+kw] + batch, stdout=fh, stderr=subprocess.DEVNULL), tmp))
for p, tmp in procs:
    p.wait()
# 合并结果
with open('.trellis/tests/.history_fixes', 'w') as out:
    for _, tmp in procs:
        if os.path.exists(tmp):
            out.write(open(tmp).read())
            os.remove(tmp)
" 2>/dev/null
# 兜底方式二：若方式一返回为空（关键词未匹配到任何 commit），使用 --all 不加 --grep 全量拉取
# 再按文件名全量拉取（不限条数），确保没有遗漏
if [ ! -s .trellis/tests/.history_fixes ]; then
  for f in $(grep -E '\.(py|java|kt|go|rs|ts|js)$' .trellis/tests/.search_files 2>/dev/null); do
    git log --oneline --all -- "$f"
  done > .trellis/tests/.history_fixes 2>/dev/null
  echo "# 兜底: 未匹配到关键词 commit，使用全量历史（不限条数）" >> .trellis/tests/.history_fixes
fi
```
如果仓库没有 `.git` 目录或 `git log` 失败，进入方式二。

**方式二：svn（git 不可用时）**
```bash
for f in $(grep -E '\.(py|java|kt|go|rs|ts|js)$' .trellis/tests/.search_files 2>/dev/null); do
  svn log --search "fix\|bug\|修\|hotfix\|patch\|regression\|缺陷\|feat" "$f"
done > .trellis/tests/.history_fixes 2>/dev/null
```
如果 `svn log` 也失败（非 SVN 工作区），进入方式三。

**方式三：本地代码对比（无 VCS 时）**
```bash
# 查找可能的历史备份目录
for dir in .bak backup backups .history .backup; do
  if [ -d "$dir" ]; then
    echo "# 找到备份目录: $dir" >> .trellis/tests/.history_fixes
    # 对比当前文件和备份文件的差异，找出修复过的函数
    find "$dir" -name "*.py" -type f 2>/dev/null | head -20 | while read -r bak; do
      cur="${bak#$dir/}"
      if [ -f "$cur" ]; then
        diff_lines=$(diff -u "$bak" "$cur" 2>/dev/null | grep -E "^[-+].*def |^[-+].*class " | head -10)
        if [ -n "$diff_lines" ]; then
          echo "# diff: $cur" >> .trellis/tests/.history_fixes
          echo "$diff_lines" >> .trellis/tests/.history_fixes
        fi
      fi
    done
    break
  fi
done
# 兜底：标记无历史记录
if [ ! -s .trellis/tests/.history_fixes ]; then
  echo "# 无版本控制历史，跳过历史回归" > .trellis/tests/.history_fixes
fi
```

> **规则**：git → svn → 本地备份，三级兜底。全部不可用时，报告注明「无版本控制历史，跳过历史回归测试」。

#### 1e.2 分析每个历史 fix 并生成回归测试

对 `.history_fixes` 中每个 fix commit，执行以下操作：

1. **提取改动**：`git show <hash> --stat` + `git diff <hash>^..<hash>` 获取改动的文件和代码
2. **理解修复意图**：用 `codegraph_explore` 分析修复的函数/文件，理解 bug 根因
3. **生成回归测试**：对每个 fix commit，在 `.trellis/tests/regression/` 下生成回归测试。按功能域分组（而非按 commit hash），文件命名规则：`test_regr_<功能域>.py`，例如 `test_regr_tenant_atn.py`、`test_regr_canonical_merge.py`、`test_regr_name_handling.py`。同一功能域的多个 fix 合并到同一个文件。

回归测试用例的格式：
```python
"""
回归测试: <fix commit 标题>
原 bug: <bug 根因描述>
修复方式: <修复做了什么>
对应提交: <commit hash>
Layer: REGRESSION

=== 必问三答 ===
Q1: 触发条件是什么？
A1: <前置状态 + 触发动作的具体条件>

Q2: 旧代码在这条件下会怎样？
A2: <旧行为 + 去掉修复代码后本测试会 FAIL>

Q3: 新代码在这条件下会怎样？
A3: <新行为 + 本测试会 PASS>

=== 入参/出参标准 ===
入参: <函数调用参数值 + 前置系统状态>
出参: <返回值断言 + 系统状态断言>
"""
# 测试用例验证修复后的行为不再出现原 bug
```

每个回归测试用例必须是**三段式**：
1. **前置状态（Arrange）**：调用前的系统状态（其他用户存在、ATN 已设置、账号已绑定等）
2. **触发动作（Act）**：被测函数的调用
3. **输出验证（Assert）**：返回值断言 + 系统状态断言（to_dict、get_user、其他用户不受影响等）

三段式中任何一段为空 → 测试不合格，需要补充。

**破坏性验证**：每个回归测试生成后，AI 必须执行红-绿-红验证：
1. 暂时注释修复代码 → 运行测试 → 确认 FAIL（红）
2. 恢复修复代码 → 运行测试 → 确认 PASS（绿）
3. 再次注释修复代码 → 确认 FAIL（红，排除巧合）
4. 恢复代码，在测试文件末尾留注释块：

```python
# === 破坏性验证 ===
# 注释掉 <文件名:行号> 后运行:
#   python -m pytest test_file.py -k test_name
# 预期: FAIL (AssertionError: <预期消息>)
# 恢复后: PASS
```

如果红-绿-红验证不通过，测试不合格，标记 `[DESTRUCTIVE_FAILED]` 并回退重新生成。

**行为反转检测（强制，生成回归测试时执行）**：对每个历史 fix，用 `git log --all -- <源文件>` 检查同一函数是否被后续 commit 反向修改。判定信号：
- 同一函数名在后续 commit 的 diff 中出现方向相反的逻辑（覆盖 ↔ 阻止、允许 ↔ 禁止、`if not x: return` ↔ `if x: return`、返回 A ↔ 返回 ¬A）；
- 该 fix 的回归断言对当前代码必红（旧方向断言 vs 当前行为相反，即去掉反转后本测试会 PASS）。

检出反转后：为旧方向生成独立回归用例 → 运行确认变红（反转证据）→ 记录到 `.fix_stats.reversals_confirmed` → 按最新行为更新断言。**不得因该 fix 其他行为正常就整体跳过反转确认**（一个 fix 拆出的多条行为要逐条检查，只钉住未反转的部分 = 漏检）。

4. **更新回归索引**：追加到 `.trellis/tests/.regression_index`：
```
<commit_hash> | <fix标题> | test_regr_<功能域>.py | <生成日期>
```

> **规则**：每个历史 fix 至少生成一个回归测试。如果 fix 涉及多个文件/函数，生成多个测试用例。
> **爆炸范围内所有源文件的所有历史 fix 必须全覆盖**：对受变更影响的每个源文件，提取其全部历史 fix 提交（不限时间范围），每个提交生成对应的回归测试。不允许遗漏任何一个历史 fix。
> 如果 `.history_fixes` 为空（该区域无历史修复），跳过此步并记录。

### 1f 爆炸范围覆盖完整性检查

**入口**: `.affected_symbols` 存在
**出口**: `.trellis/tests/.coverage_gaps` 存在，每行标记覆盖状态
**出口 Goal**: `/goal 覆盖检查完成 — .coverage_gaps 已标记所有符号的覆盖状态`

在生成新测试之前，检查「受影响符号」是否已有测试覆盖。标记未覆盖的符号。

```bash
# 对每个 affected_symbol，搜索已有测试
> .trellis/tests/.coverage_gaps
while IFS= read -r line; do
  sym=$(echo "$line" | awk '{print $1}' | tr -d ' ')
  count=$(grep -rl "$sym" tests/ .trellis/tests/ 2>/dev/null | grep -c "test_" 2>/dev/null || echo 0)
  if [ "$count" -eq 0 ]; then
    echo "$line|NOT_COVERED" >> .trellis/tests/.coverage_gaps
  else
    echo "$line|COVERED(${count}tests)" >> .trellis/tests/.coverage_gaps
  fi
done < .trellis/tests/.affected_symbols
```

**输出**: `.trellis/tests/.coverage_gaps` — 每行 `符号名|风险|状态`，Step 2 和 Step 5 使用。

## Step 2: 展示测试计划

**入口**: `.trellis/tests/.affected_symbols` 和 `.trellis/tests/.coverage_gaps` 存在
**出口**: 计划展示后直接进入 Step 3 测试生成，无需等待用户确认

**出口 Goal**: `/goal 测试计划已展示 — 直接进入 Step 3 测试生成阶段`

展示表格（**用中文输出**）：

| 受影响符号 | 风险等级 | 已有测试 | 历史回归 | 覆盖完整性 | 需生成 |
|-----------|---------|---------|---------|-----------|-------|
| （符号名） | 高/中/低 | 直接×N/上游×N… | test_regr_xxx… | ✅已覆盖/❌未覆盖 | 直接/上游/…/— |

数据来源：
- 风险等级: Step 1b 的 gitnexus impact 结果
- 已有测试: Step 1f 的 `.coverage_gaps`
- 历史回归: Step 1e 的 `.regression_index` + 回归文件列表
- 需生成: 风险等级为中或高→生成全部四层（直接+上游+下游+同级）；风险等级为低→生成直接层+至少一层上游或同级。每层用例充分性由「分支覆盖门禁 + 不变量全过」判定（Step 3 检测力强化自动补足分支缺口），不再以固定数量为底线。
- **测试计划必须展示「用例充分性门禁」**：列出每个被改纯函数/核心逻辑的待覆盖分支缺口估计 + 声明的业务不变量清单。展示「预计分支覆盖率」与「不变量条数」；分支缺口由 Step 3「并行检测力强化」自动补足，不再以用例总数 ≥40 为底线（强制规则 10）。

展示后直接进入 Step 3 测试生成。**展示必须包含「未覆盖符号」的醒目提示**，用 ❌ 标记。

## Step 3: 生成测试

**入口**: Step 2 的「需生成」列已确定
**出口**: `.trellis/tests/generated/$(date +%Y/%m)/` 下所有需要的测试文件存在，且每个文件的 TestedSource 中 commit-hash 等于当前 HEAD
**出口 Goal**: `/goal 测试生成完成 — 所有 generated 文件 TestedSource 版本号与 HEAD 一致，模板内嵌 JS 变更点已含 JS 语法门禁用例`

**安全检查（关键词触发）**：遍历 `.affected_symbols` 匹配安全关键词（auth/token/password/encrypt/injection/xss/cert/secret/permission/安全），命中则 spawn 子 Agent 生成安全专项测试，追加到「需生成」列表：

```
输入: .affected_symbols + 变更代码
输出: .security_test_cases → 追加到生成队列
```

根据 Step 2 的「需生成」列，对每个符号并行启动子 Agent 生成对应层的测试：

- 风险等级为**中或高**：必须生成全部四层：
  - **直接层**：测试该函数自身的各类输入输出（正常值、边界值、异常值）
  - **上游层**：测试调用该函数的各调用方行为（PushRequest、presence handler、tenant_manager 等）
  - **下游层**：测试该函数的产出对下游的影响（get_user 可见性、to_dict 序列化、_save_persisted 持久化等）
  - **同级层**：测试与该函数同级的交互（add_user + update_user_name 协同、add_user + remove_user 时序等）
- 风险等级为**低**：生成直接层 + 至少一层上游或同级测试，不允许只生成直接层
- **每个 affected_symbol 的用例充分性由「分支覆盖 ≥ 门禁 + 不变量全过」判定**（规则 10），并在 Step 3 检测力强化中自动补足分支缺口；越多越好，不设上限，但不为凑数堆废用例。
- **用例充分性门禁**：每个被改纯函数/核心逻辑分支覆盖 ≥ 90%（config 可调）且业务不变量全过；不足时由 Step 3 检测力强化补足分支缺口（规则 10）。

四层测试的 Agent prompt 模板（以 Python 为例）：

```markdown
Agent prompt 必须包含:
- 源文件完整源码（codegraph_explore 输出）
- 测试框架: {从 config.json 读取 runner 字段}
- 标准入参/出参: Input 显式定义, Expected 显式写出
- 文件头: TestedSource: {symbol1} + {symbol2}@{commit-hash}（多符号用 ` + ` 分隔，commit-hash 必须与 HEAD 一致）
- 如果测试用例涉及多个函数（如 add_user 测试也调用 get_user），所有涉及函数都必须列在 TestedSource 中
- Layer: 直接（或 上游/下游/同级）
- 输出路径: .trellis/tests/generated/$(date +%Y/%m)/test_{symbol}_{layer}.py
```

对于非 Python 项目，将上述模板中的路径后缀 `.py`、测试框架命令、文件命名规则按语言兼容性表替换。

每生成一个测试文件后，验证 TestedSource 的 commit-hash 与 `git rev-parse HEAD` 输出一致，不一致则重新生成。

**四层测试文件示例**（以 Python user_store.add_user 为例）：
```
test_add_user_direct.py              → 测试 add_user 自身的合并/创建/边界
test_add_user_upstream.py            → 测试 push handler、tenant_manager 等调用方
test_add_user_downstream_peer.py     → 测试 get_user/remove_user/to_dict 影响 + 与 update_user_name 交互
```

### Step 3 并行检测力强化（6 点内嵌，不新增串行等待）

> **检测力 = 生成用例覆盖的输入空间；空间用机械手段补齐，不靠 AI 灵感。** 以下 6 点全部放进 Step 3 的并行执行：点 1/2/6 内嵌进每个符号的生成子 agent prompt，点 3/4/5 是生成后的并行 pass（每文件独立、互不依赖）。

**生成期内嵌（打进每个符号子 agent 的 prompt）**：

1. **决策表穷举** — 对每个被改**纯函数**，先提取其信号/分支组合（如 `isStaleErrorTranslation` 的 translationProvider×grammarProvider×llmError×文本 四信号真值表），**逐组合枚举**生成用例，再补常规用例。禁止"想到哪测到哪"；穷举把人为漏掉的组合机械覆盖。
2. **不变量断言 + 属性测试** — 为每个纯函数声明 1-3 条业务不变量（如"真实模型 + 有效译文 + 无 llmError → 必须非 stale"），用随机输入对不变量跑 ≤100 轮，撞出人想不到的组合。断言必须是业务语义，不得是 `assert True` 式占位。
6. **回归知情输入** — 引用 Step 1a 的 `.bug_context`，显式列出"由本次已知故障模式推导的用例"，每个故障模式至少 1 个直击用例。

**生成期后置 pass（并行，每文件独立）**：

3. **分支覆盖反推** — 生成完成后对每个被改纯函数跑 branch coverage；**未覆盖分支自动补 1 个直击用例**。把"凭灵感生成"变成"按缺口机械补"，未覆盖分支即漏网风险。
4. **真实响应回放** — 仅当符号触碰外部 I/O（fetch/requests/LLM/数据库等）时启用：采集 1-3 个**真实响应**（含 `finish_reason:'length'`、空 content、异常等特征）存为 fixture，测试**回放**真实响应而非 mock 发明。无真实样本则跳过并在报告标注「无样本，回放跳过」，不阻塞。
5. **变异标定** — 对每个被改函数注入 ≤5 个微小变异（`!==`→`===`、去掉守卫等），跑测试看能否抓出；**未抓住的变异 = 检测盲区 → 自动补 1 个用例锁死该行为**。与 Step 4d 的 R-G-R 互补：R-G-R 验证「修复本身」，变异标定衡量「测试的检测力」。
6. **模板内嵌 JS 语法门禁（render 产物校验）** — 变更点若包含 Python 模板生成 HTML/JS（`render`/`*_page`/`attack_js` 等），生成后必须跑「渲染 → 提取全部 `<script>` → `node --check`」并作为独立测试用例入库：Python 三引号字符串里 `\'` 会被 Python 吞成 `'`，产出的 JS 可能语法不合法但子串都在（`unbanIp('' + ip)` 即真实事故），渲染回归测试只断言子串存在抓不到——必须用 JS 引擎验语法。node 缺失用 `pyjsparser` 兜底，两者皆无则该测试 `pytest.skip` 并标记 `js_check_skipped`，报告注明 ⚠️。

## Step 3e: 路径覆盖检验 + 生成手动验证建议

> 依赖 Step 3 完成。在 Step 1d 确定并行策略时标记为 `can_parallel`。

**入口**: git diff 已提取（或从 Step 1a 复用）
**出口**: `.trellis/tests/.manual_verify_items` 文件存在，包含所有优先级的验证项
**出口 Goal**: `/goal 手动验证项已识别 — .manual_verify_items 已写入`

### 3e.1 路径覆盖检验
用 `git diff` 提取变更代码中的 I/O 路径。扫描以下四类调用，判断是否出现在变更中：

| I/O 类型 | 具体扫描目标 |
|---------|------------|
| 网络请求 | `requests.post/get/put`、`httpx`、`aiohttp`、`urllib`、`curl` |
| 文件读写 | `open()`、`Path().read/write`、`json.dump/load`、`yaml.safe_load/dump` |
| 进程调用 | `subprocess.run/Popen`、`os.system`、`os.popen` |
| 套接字 | `socket.connect/send/recv`、`create_connection` |

对匹配到的每个 I/O 调用，标记为「只能手动验证」（因为单元测试中该外部服务不可达）。

### 3e.2 生成手动验证建议

对每个变更点，生成一行手动验证建议并写入 `.trellis/tests/.manual_verify_items`：

| 验证点 | 验证方法 | 预期结果 | 优先级 |
|--------|---------|---------|-------|
| （什么功能） | （怎么操作：在手机上打开游戏XX页面/在电脑点击XX按钮/连接路由器WiFi后启动游戏） | （用户能看到什么） | 强制/建议/可选 |

优先级规则：
- **强制**（必须手动验证）：涉及网络 I/O、外部服务、无线 E2E、真实设备测试——**验证方法必须写具体设备操作，不得含「看日志」「查xx」「观察日志」等非手动描述**
- **建议**（建议验证）：复杂逻辑、多模块交互、边界条件
- **可选**（可选验证）：简单传参、纯函数、已有单元测试覆盖的

所有优先级的验证项都必须写入最终报告，不得省略。

## Step 4: 运行 + 修复

**入口**: 所有测试文件已生成（regression + generated），`.trellis/tests/config.json` 存在
**出口**: SELECTED_TESTS 全部通过，或 5 轮修复后自动终止
**出口 Goal**: `/goal 测试运行完成 — SELECTED_TESTS 全部通过，.fix_stats 已写入`

### 4a 同步 + 4b.7 Spec 审计（并行）

4a 复制测试文件和 4b.7 Spec 审计互不依赖，可以同时运行：

```bash
# 并行：
#   ├─ 4a: cp 生成文件到 tests/
#   └─ 4b.7: 扫描 .trellis/spec/ 做合规审计
cp .trellis/tests/generated/$(date +%Y/%m)/test_*.py tests/ 2>/dev/null || true &
PID_4A=$!

# 4b.7 Spec 审计 — 独立读 .trellis/spec/，不依赖 4a 的测试文件
# 扫描 .trellis/spec/ 下所有与爆炸半径相关的 spec 文件。按以下规则类型映射表逐条验证：
#
# | 规则类型 | 代码扫描目标 | 验证方法 |
# |---------|------------|---------|
# | 数据一致性 | 检查合并/复制/移动路径是否同步了关联字段 | 对每个关联字段，追踪所有读/写路径 |
# | 安全约束 | 检查校验函数调用后是否有 return/跳过/终止 | 追踪 `if not valid: return` 分支 |
# | 流程约束 | 检查 A→B 调用时参数来源是否正确 | 检查调用点实参与上游数据源的链路 |
# | 持久化约束 | 检查数据变更路径是否调用 `_save_persisted` | 追踪修改后是否调用持久化函数 |
# | 并发约束 | 检查锁的获取顺序和覆盖范围 | 检查 `with lock:` 是否包裹了所有读写 |
#
# 审计结果写入 .trellis/tests/.spec_audit_report，格式：
# spec_file | 规则原文 | 规则类型 | 验证结果(通过/不通过/需确认) | 证据(代码行)

wait $PID_4A
```
### 4b 查已有测试 + 新鲜度

```bash
HEAD_HASH=$(git rev-parse HEAD)
```

对每个测试文件的 TestedSource 头部中 commit-hash 与 `$HEAD_HASH` 做比较：
- 一致 → 初步判断新鲜，进入**内容级新鲜度检查**
- 不一致 → **标记为 stale 并记录**。如果 stale_tests 存在，**回到 Step 3 重新生成对应符号的测试**，完成后回到 Step 4b 重新验证新鲜度。
- 最多允许 2 次「Step 4b → Step 3 → Step 4b」循环。超过则终止并报告「无法获取新鲜测试」。

**内容级新鲜度检查**（TestedSource 版本号一致时的补充校验，每文件独立，并行执行）：
```bash
# 对每个 fresh 测试文件，提取 TestedSource hash + 符号名
# 用 TestedSource hash 到 HEAD 的范围检查全部中间 commit 的变更
# 如果被测函数有变更但测试未更新 → 标记 stale
# 每个文件检查独立，后台并行（>> 行级原子写入 .content_stale）
for f in $(grep -rl "TestedSource:" tests/ 2>/dev/null); do
  (
  # 提取 TestedSource hash（格式：sym1 + sym2@commit_hash）
  TS_LINE=$(grep "TestedSource:" "$f")
  TS_HASH=$(echo "$TS_LINE" | sed 's/.*@//' | tr -d ' ')
  # 支持多符号格式：TestedSource: sym1 + sym2@hash
  SYMS=$(grep "TestedSource:" "$f" | sed 's/.*TestedSource: //;s/@.*//;s/ *+ */\n/g')
  echo "$SYMS" | while IFS= read -r SYM; do
    [ -z "$SYM" ] && continue
    FILE_LINE=$(grep -rn "def $SYM\|class $SYM" remote/ 2>/dev/null | head -1 | cut -d: -f1-2)
    if [ -n "$FILE_LINE" ]; then
      SYM_FILE=$(echo "$FILE_LINE" | cut -d: -f1)
      SYM_LINE=$(echo "$FILE_LINE" | cut -d: -f2)
      # 用 TestedSource hash 到 HEAD 的范围，覆盖全部中间 commit 的变更
      DIFF_RANGE="HEAD~1..HEAD"
      [ -n "$TS_HASH" ] && [ "$TS_HASH" != "HEAD" ] && DIFF_RANGE="${TS_HASH}..HEAD"
      if git diff "$DIFF_RANGE" -- "$SYM_FILE" 2>/dev/null | grep -A5 "^@@.*${SYM_LINE}" | grep -q "^[+-]"; then
        ASSERT_COUNT=$(grep -c "assert " "$f" 2>/dev/null || echo 0)
        CHANGE_COUNT=$(git diff "$DIFF_RANGE" -- "$SYM_FILE" 2>/dev/null | grep -c "^[+-]" || echo 0)
        if [ "$ASSERT_COUNT" -lt $((CHANGE_COUNT / 5)) ] 2>/dev/null; then
          echo "⚠️ 内容级过期: $f 被测符号 $SYM 有 $CHANGE_COUNT 行变更但仅 $ASSERT_COUNT 个断言"
          echo "$f" >> .trellis/tests/.content_stale
        fi
      fi
    fi
  done
  ) &
done
wait
如果 `.content_stale` 非空，这些测试加入 stale_tests 列表，同版本号不一致的处理逻辑。

**上游依赖链新鲜度检查（强制）**：内容级检查只验证被测函数自身源码有无变更，但 A → B（A 变更影响 B）的场景会漏掉。必须补充检查：

```bash
# 对每个 fresh 测试文件，检查其被测函数的上游依赖是否在 affected_symbols 中
# 若上游依赖函数发生了变更，测试也应标记为 stale
# 每文件独立检查，后台并行（>> 行级原子写入 .dep_stale）
> .trellis/tests/.dep_stale
for f in $(grep -rl "TestedSource:" tests/ 2>/dev/null); do
  (
  TS_LINE=$(grep "TestedSource:" "$f")
  TS_HASH=$(echo "$TS_LINE" | sed 's/.*@//' | tr -d ' ')
  SYM=$(echo "$TS_LINE" | sed 's/.*TestedSource: //;s/@.*//')
  # 从 affected_symbols 查该符号是否因上游依赖变更而被影响
  # affected_symbols 格式：符号名|文件:行号|风险等级|说明
  # 如果符号在 affected_symbols 中，且有 "被影响" 等上游依赖说明
  while IFS='|' read -r affected_sym _ risk desc; do
    if [ "$affected_sym" = "$SYM" ]; then
      # 判断是否为上游依赖导致（非自身变更）
      # 自身变更的内容级检查已在前面完成
      # 此处检查：如果该符号的源码自身未变，验证是否有上游依赖变化
      SYM_FILE=$(grep -rn "def $SYM\|class $SYM" remote/ 2>/dev/null | head -1 | cut -d: -f1)
      if [ -n "$SYM_FILE" ]; then
        DIFF_RANGE="HEAD~1..HEAD"
        [ -n "$TS_HASH" ] && [ "$TS_HASH" != "HEAD" ] && DIFF_RANGE="${TS_HASH}..HEAD"
        SYM_CHANGED=$(git diff "$DIFF_RANGE" -- "$SYM_FILE" 2>/dev/null | grep -c "^[+-]" || echo 0)
        if [ "$SYM_CHANGED" -eq 0 ] && echo "$desc" | grep -qi "上游\|依赖\|调用\|影响"; then
          echo "$f|$SYM|上游依赖变更|$desc" >> .trellis/tests/.dep_stale
        fi
      fi
      break
    fi
  done < .trellis/tests/.affected_symbols 2>/dev/null
  ) &
done
wait
如果 `.dep_stale` 非空，每个匹配行对应的测试加入 stale_tests 列表，回到 Step 3 重新生成。
**此检查不可跳过。** `.dep_stale` 未处理完不得进入 Step 4c。

```bash
_S4B=".trellis/scripts/_step4b_find.py"; [ -f "$_S4B" ] || _S4B="$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}" 2>/dev/null)")/_step4b_find.py"; [ -f "$_S4B" ] && python "$_S4B" > .trellis/tests/_4b_result.json || echo '{"fresh_tests":[],"stale_tests":[],"needs_generate":[]}' > .trellis/tests/_4b_result.json
```
读取结果：`fresh_tests` 直接加入 SELECTED_TESTS，`stale_tests` 自动删除，`needs_generate` 进入 Step 3 补充。
### 4c 运行测试
```bash
_S4C=".trellis/scripts/_step4c_run.py"; [ -f "$_S4C" ] || _S4C="$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}" 2>/dev/null)")/_step4c_run.py"; [ -f "$_S4C" ] && python "$_S4C" \\
  --selected-tests "$(cat .trellis/tests/_4b_result.json | grep all_tests)" \\
  --config .trellis/tests/config.json \\
  --output-file .trellis/tests/_4c_results.jsonl
```

### Step 4d: AB 验证（红-绿-红，必做）

**入口**: Step 4c 运行完成，有测试结果
**出口**: `.fix_stats` 含 `destructive_validated_files` 字段，所有变更源文件已完成 R-G-R 且代码已恢复
**出口 Goal**: `/goal AB验证完成 — 所有变更源文件 R-G-R 通过，代码已恢复确认`

> **这是强制 Step，不得跳过。** 每个有代码变更的源文件都必须做 AB 验证，不做不能进 Step 4e。

AB 验证（R-G-R）步骤：

对爆炸半径内**每个有代码变更的源文件**（不仅限于 main 修复文件），执行以下操作：

1. **注释掉该文件的变更代码段**
2. **运行该文件对应的测试 → 确认 FAIL（红）**
3. **恢复变更代码 → 运行测试 → 确认 PASS（绿）**
4. **再次注释 → 确认 FAIL（红，排除巧合）**
5. **恢复代码**
6. **恢复验证：确认代码确实已恢复** ⚠️ 必做

**第 6 步（恢复验证）具体操作：**

```bash
# 对每个做过 R-G-R 的文件，确认恢复后的代码包含预期的活动代码（而非注释状态）
# 例如：setup_mitm.py 应包含 "_ACCOUNT_IP_MAP_EXPIRE_SECONDS = 604800"（非注释）
# 例如：tcp_proxy.py 应包含 "if name:"（非注释）
# 用 grep 匹配活动代码特征行
grep -n 'if name:' remote/noconfig/hijack/tcp_proxy.py 2>/dev/null | grep -v '^\s*#'
if [ $? -ne 0 ]; then
  echo "❌ 恢复失败！tcp_proxy.py 中 if name: 仍被注释"
  exit 1
fi
```

如果第 6 步发现代码未恢复，**立即报错终止流程**，不允许进入 Step 4e。用户需要手动 `git checkout -- <文件>` 恢复。

每个文件至少选择 1 个最能代表该文件变更的关键测试进行 R-G-R 验证。

验证结果写入 `.fix_stats`：
```
destructive_validated_files:
  - file: remote/noconfig/hijack/setup_mitm.py
    test: test_constant_defined_as_604800
    a_result: FAIL (3600)
    b_result: PASS (604800)
    restored: true  # 恢复验证通过
  - file: remote/noconfig/hijack/ecs_proxy.py
    test: test_empty_account_id_triggers_ip_lookup
    a_result: FAIL (no lookup)
    b_result: PASS (lookup present)
    restored: true
  - file: remote/noconfig/app.py
    test: test_log_format_contains_source_placeholder
    a_result: FAIL (no source=)
    b_result: PASS (source= present)
    restored: true
```

每个文件的 `restored` 字段必须为 `true`。任何文件 `restored: false` 或缺失该字段，视为 AB 验证未完成，不得进入 Step 4e。

### 4e 修复循环（统计自愈次数）

- 创建 `.fix_goal` 文件跟踪状态，格式：
  ```
  round=1
  initial_failures=3
  total_tests=70
  fixes_applied=2
  remaining_failures=1
  status=in_progress
  ```
- **空断言检测**（每轮修复前执行）：扫描所有 SELECTED_TESTS，找出含无效断言的测试：
  ```bash
  # 扫描测试文件中 assert True / assert None / assert 1 / 无 assert 的测试函数
  python -c "
  import ast, glob, sys
  weak_tests = []
  for f in glob.glob('tests/test_*.py') + glob.glob('tests/regression/test_*.py'):
      try:
          with open(f) as fh:
              tree = ast.parse(fh.read())
          for node in ast.walk(tree):
              if isinstance(node, ast.FunctionDef) and node.name.startswith('test_'):
                  asserts = [n for n in ast.walk(node) if isinstance(n, ast.Assert)]
                  if not asserts:
                      weak_tests.append((f, node.name, '无断言'))
                  else:
                      for a in asserts:
                          if isinstance(a.test, ast.Constant) and a.test.value in (True, 1, None):
                              weak_tests.append((f, node.name, f'永真断言: {ast.dump(a.test)}'))
      except Exception:
          pass
  if weak_tests:
      for f, name, reason in weak_tests:
          print(f'{f}::{name} — {reason}')
      sys.exit(1)  # 标记需要修复
  else:
      print('✅ 所有测试含有效断言')
  " 2>&1 || echo "⚠️ 存在弱断言测试，标记到 .fix_goal"
  ```
  若检测到弱断言测试，记录到 `.fix_goal` 并标记 `weak_assertions=yes`，在修复轮次中提醒补充断言。
- **修复策略：必须区分「代码 bug」vs「测试 bug」** ⚠️ 每轮修复前执行此诊断：
  ```bash
  # 对每个失败的测试，判断失败根因类型：
  # 
  # 类型1 - 产品代码 bug：产品代码行为违反约定，测试正确 → 修复产品代码
  #   判定依据：测试预期值与 spec/PRD 一致，但产品代码返回了错误结果
  #   典型：result 应为 None 但返回了对象；应抛异常但静默通过了
  #
  # 类型2 - 测试代码 bug：产品代码行为正确，测试本身写错了 → 修复测试代码
  #   判定依据：测试预期值与 spec/PRD 矛盾，或 mock 的数据格式与真实接口不符
  #   典型：mock 返回值字段名拼错；测试逻辑遗漏了前置条件
  #
  # 类型3 - 测试需要同步更新（本次改动的预期结果变化）：非 bug，是测试过期
  #   判定依据：本次 git diff 故意改了该函数的行为/返回值，旧测试预期不再适用
  #   典型：函数改名为新版本，旧测试还在测旧名；返回值新增了字段，旧测试 assert 字段数
  #   处理：更新测试预期值以匹配新行为，**不得改产品代码**
  #
  # 类型4 - 环境问题：依赖不可用、网络不通、超时 → 跳过该测试，标记环境依赖
  #
  # 类型5 - 行为反转：同一函数被反向修改，失败测试断言的是反转前的行为
  #   判定依据：git log 显示同一函数被反向修改（旧行为 X → ¬X），且失败测试断言的是旧行为
  #   与类型3的区别：类型3 是"本次 diff 故意改行为"的常规演进；类型5 必须显式确认反转方向，
  #   不能当作普通测试过期静默更新
  #   处理：不得静默按类型3 更新测试。先生成旧方向回归用例确认变红 → 报告「行为反转确认」
  #        章节记录 → 判定「有意反转」（保留新行为，旧方向用例标 OBSOLETE）或
  #        「意外回归」（回滚产品代码，保留旧行为测试）
  #
  # 诊断命令：
  #   git diff HEAD~1..HEAD -- <被测文件>  # 看本次是否故意改了行为
  #   对比测试预期值与 spec 描述              # 看测试是否符合需求
  #
  # 重点：类型3 最容易被误判为类型1。
  # 如果本次 diff 显示函数返回值/行为是故意改的，旧测试预期值过期 → 类型3（更新测试），不是修代码。
  # 类型5（行为反转）最容易与类型3混淆：类型3 直接更新测试，类型5 必须先生成旧方向用例
  # 确认变红、再记录到报告。禁止把行为反转静默按类型3 处理。
  ```
  误判后果：把类型2/3 当类型1 修会引入新 bug（改产品代码迎合错误/过期的测试）。
  **不确定时标记为「需人工确认」并输出到报告，禁止自行猜测修复。**
- **预期值/实际值校验**（每轮修复前执行，写入选定测试文件脚注和 `.fix_stats`）：
  ```bash
  # 对每个失败的测试，提取断言行的预期值和实际值
  # 将预期值、实际值、AI 判定结果写入测试文件末尾注释块：
  #
  # === 失败诊断 ===
  # 测试: test_add_user_empty_name
  # 预期值: result["name"] == "default"
  # 实际值: result["name"] == ""
  # AI 判定: 类型3（测试过期）
  # 人工确认: 待确认
  # ===
  #
  # 写入 .fix_stats（每轮覆盖）：
  # failure_diagnostics:
  #   - test: test_add_user_empty_name
  #     expected: "result['name'] == 'default'"
  #     actual: "result['name'] == ''"
  #     judgment: code_bug | test_bug | test_outdated | reversal | environment | needs_human
  #     fixed: true | false
  #
  # reversals_confirmed（检出行为反转时写入）：
  #   - func: _bind_account_user
  #     old_behavior: 覆盖 account_id
  #     new_behavior: 不覆盖已有 account_id
  #     old_direction_test: test_regr_account_id.py
  #     red_confirmed: true
  #     verdict: intentional_reversal | accidental_regression
  #
  # 未通过预期值/实际值校验的测试（judgment=needs_human），不得进入下一轮修复，
  # 直接终止并输出「需人工确认：<测试名>、<预期值>、<实际值>」
  ```
- 分析失败根因 -> 修复 -> 全量重跑 SELECTED_TESTS
- 每轮修复后更新 `.fix_goal`：累加 `round`、更新 `fixes_applied`、`remaining_failures`
- **无交互式暂停**：STALL_ROUND 计数到 5 时自动终止并输出修复日志给用户
- 全部通过则 `rm .fix_goal`，同时将最终统计数据写入 `.fix_stats`：
  ```
  initial_failures=3
  total_fix_rounds=2
  total_fixes_applied=2
  final_status=PASSED
  duration_seconds=45
  ```

**出口 Goal**: `/goal Step 4e 完成 — SELECTED_TESTS 全部通过或已自动终止`

#### Step 4f — 运行时验证（前端桥接）

_此步骤仅在检测到前端项目时执行，不影响其他类型项目_

检测条件（满足任一即视为前端项目）：
```bash
IS_FRONTEND=false
test -f package.json && grep -qiE '"react"|"vue"|"next"|"vite"|"angular"|"nuxt"|"svelte"' package.json 2>/dev/null && IS_FRONTEND=true
ls vite.config.* next.config.* vue.config.* nuxt.config.* 2>/dev/null | grep -q . && IS_FRONTEND=true
find src/ -name '*.jsx' -o -name '*.tsx' -o -name '*.vue' 2>/dev/null | grep -q . && IS_FRONTEND=true
```

如果是前端项目，调用 `Skill(trellis-frontend)` 做运行时验证。验证目标从当前变更的 `.affected_symbols` 和 `git diff` 推断。

trellis-frontend 返回后判断：

- **✅ 运行时验证通过**（无问题）→ 继续到 Step 5 报告，记入测试报告
- **❌ 有修复**（trellis-frontend 改了代码）→ **回到 Step 4a**（同步 → 查新鲜度 → 运行测试 → AB 验证 → 修复循环 → Step 4f 重新桥接），确保修复不破坏已有测试。最多允许 **2 轮**完整循环，超限则终止并输出「运行时验证超限，需人工介入」

## Step 5: 报告（中文）

**入口**: Step 4 全部通过（或 5 轮后终止）
**出口**: 中文报告文件写入 `_TASK_DIR/test_report.md`，包含所有九部分内容
**出口 Goal**: `/goal 报告已生成 — _TASK_DIR/test_report.md 含完整九部分内容，覆盖率门禁已检查，报告头含历史回归数+本次新增数`

Step 5 的所有输出必须使用**中文**。报告文件写入 `_TASK_DIR/test_report.md`。

### 5.1 收集数据

```bash
_TASK_DIR=$(ls -dt .trellis/tasks/*/ 2>/dev/null | head -1) || _TASK_DIR=".trellis/tests/"
_S5R=".trellis/scripts/_step5_report.py"; [ -f "$_S5R" ] || _S5R="$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}" 2>/dev/null)")/_step5_report.py"; [ -f "$_S5R" ] && python "$_S5R" \
  --affected-symbols "$(cat .trellis/tests/.affected_symbols)" \
  --history-fixes .trellis/tests/.history_fixes \
  --test-results .trellis/tests/_4c_results.jsonl \
  --spec-audit .trellis/tests/.spec_audit_report \
  --output-file "${_TASK_DIR}test_report.md"
```

### 5.2 报告内容（必须包含）

报告必须包含以下七个部分，**全部用中文书写**：

---

#### 一、概述
- 测试任务名称、分支、commit、运行时间
- **总测试数（用例级）| 通过 | 失败 | 错误 | 跳过**
- **其中：历史回归测试数 | 本次新增测试数**（用例级，即各 def test_* 函数个数）
- **涉及文件**: 变更文件列表（Step 1a 的 .affected_files）+ 爆炸半径内文件列表（Step 1b 的 .blast_files），去重后列出
- 运行时长

#### 二、爆炸范围覆盖完整性

展示表格：所有受影响符号及其覆盖状态。

| 符号 | 风险等级 | 已有测试 | 状态 |
|------|---------|---------|------|
| func_a | 高 | 3 直接 + 2 上游 | ✅ 完整覆盖 |
| func_b | 中 | 1 直接 | ⚠️ 仅直接层 |
| func_c | 低 | 无 | ❌ 未覆盖 |

**必须包含「未覆盖符号」的醒目提示**，用 ❌ 标记、加粗。

**最低覆盖率门禁检查**（强制规则 7）：

```bash
# 计算覆盖率：COVERED_SYMBOLS / TOTAL_SYMBOLS >= 90%
TOTAL=$(grep -c "|" .trellis/tests/.coverage_gaps 2>/dev/null || echo 0)
COVERED=$(grep -c "COVERED" .trellis/tests/.coverage_gaps 2>/dev/null || echo 0)
if [ "$TOTAL" -gt 0 ]; then
  RATE=$((COVERED * 100 / TOTAL))
  if [ "$RATE" -lt 90 ]; then
    echo "❌ 覆盖率门禁未通过: ${COVERED}/${TOTAL} = ${RATE}% (需 ≥90%)"
    echo "覆盖率门禁: ❌ 未通过 (${COVERED}/${TOTAL} = ${RATE}%，需 ≥90%)" >> .trellis/tests/.coverage_gate
  else
    echo "✅ 覆盖率门禁通过: ${COVERED}/${TOTAL} = ${RATE}%"
    echo "覆盖率门禁: ✅ 通过 (${COVERED}/${TOTAL} = ${RATE}%)" >> .trellis/tests/.coverage_gate
  fi
fi
```

覆盖率门禁结果写入报告中的「爆炸范围覆盖完整性」章节末尾。

#### 二（续）爆炸半径历史回归映射

展示每个受影响符号关联的历史回归测试。用于确认爆炸半径内每个符号的历史变更是否都被回归测试覆盖。

| 受影响符号 | 所在文件 | 回归到的历史 Fix | 回归测试文件 |
|-----------|---------|-----------------|------------|
| add_user | user_store.py | b9842ef(ATN携带), 1ddc16c(push+canonical), ebeb693(step4), 69b7672(first-wins) | test_regr_canonical_merge.py |
| update_user_name | user_store.py | 912f5b5(昵称更新), 8dff33f(strip) | test_regr_name_handling.py |
| push handler | app.py | 1ddc16c(push+canonical), b70caa0(auto-create), bbf76a3(IP映射) | test_regr_name_handling.py, test_regr_push_body_ip.py |

数据来源：Step 1e 的 `.regression_index` + Step 1b 的 `.affected_symbols` → 按符号关联功能域 → 按功能域关联回归测试文件。

生成规则：
1. 从 `.affected_symbols` 读出每个符号
2. 从 `.regression_index` 读出每个功能域的回归测试文件
3. 按「符号 → 功能域 → 回归测试文件」的链路建立映射
4. 填入上表

**必须包含「无历史回归覆盖的符号」的醒目提示**，用 ⚠️ 标记。

#### 三、变更测试明细（每个变更点）

对每个变更，包含：
1. **变更内容**：改了什么（文件+函数+行号）
2. **改前行为**：旧代码做了什么
3. **改后行为**：新代码做了什么
4. **改前/改后行为对比**：用文字描述「改前：旧代码行为 → 结果；改后：新代码行为 → 结果」

> 如果变更涉及条件分支（如 if-else），在描述中标注分支条件。
> 变更点是纯新增代码（无旧行为）时，只描述「改后」行为。

#### 四、新生成测试清单

列出本次新增的所有测试用例。每个用例必须包含预期值、实际值和判定结果：

| 测试文件 | 测试用例 | 预期值 | 实际值 | 判定 |
|---------|---------|-------|-------|------|
| test_ip_map_expiry.py | test_constant_defined_as_604800 | 604800 | 604800 | ✅ 一致 |
| test_presence_reporter_account_id.py | test_account_id_from_arg_included_in_payload | account_id=acc_test123 | account_id=acc_test123 | ✅ 一致 |
| ... | ... | ... | ... | ... |

数据来源：测试文件中 `=== 失败诊断 ===` 注释块的预期值/实际值（通过测试无该注释块，标记为 ✅ 一致）。

**必须列出所有新增测试。** 有测试未列出或预期值/实际值未填写的，报告视为不合格。

#### 五、历史回归测试清单

| Fix Commit | 原 Bug | 回归测试文件 | 预期值 | 实际值 | 判定 | 状态 |
|-----------|--------|------------|-------|-------|------|------|
| a1b2c3d | 合并丢 ATN | test_regr_a1b2c3d.py | user.assigned_tenant_names 非空 | user.assigned_tenant_names 非空 | ✅ 一致 | ✅ 通过 |
| e4f5g6h | 昵称不同步 | test_regr_e4f5g6h.py | user.name == "新名" | user.name == "新名" | ✅ 一致 | ✅ 通过 |

数据来源：Step 4e 的 `.fix_stats` 中的 `failure_diagnostics` 字段。
**每行必须有预期值、实际值、判定三列，缺失或为空的报告视为不合格。**  

#### 五·五、行为反转确认（强制）

当本轮或历史处理中检出行为反转时，必须列出。**该章节只在检出反转时存在；未检出时写明「本轮无行为反转」。** 行为反转的判定不限于本次 diff——历史 fix 与最新行为方向相反时也必须在此确认。

| 函数 | 旧行为断言 | 新行为断言 | 旧方向回归测试 | 红-绿确认 | 判定 |
|------|-----------|-----------|--------------|-----------|------|
| _bind_account_user | set_account_id 被覆盖调用 | set_account_id 不被调用 | test_regr_account_id.py | ❌红(旧方向)/✅绿(新方向) | 有意反转 |

数据来源：Step 4e 的 `.fix_stats` 中的 `reversals_confirmed` 字段。
**每行必须含判定列（有意反转/意外回归），缺失或为空的报告视为不合格。判定为「意外回归」时，产品代码必须回滚，该行状态标红。**

#### 六、手动验证建议

所有优先级的手动验证项必须列出。按「强制→建议→可选」排序：

**验证方法列只能写具体设备操作**（如「在手机上打开游戏」「在电脑上点击XX按钮」「连接路由器WiFi后启动游戏」），**禁止写**「看日志」「查journalctl」「观察日志」等非手动操作。

| 验证点 | 验证方法 | 预期结果 | 优先级 |
|--------|---------|---------|-------|
| 4G 环境 push 带 name | 断开手机热点→手机开4G→启动游戏打一局 | 在手牌页面能看到自己名字 | 强制 |
| relay body account_id | 手机连路由器WiFi→开游戏打一局 | 管理员页面该用户显示正确的租户归属 | 强制 |

#### 七、AB 验证（红-绿-红）

列出每个变更源文件的 AB 验证结果：

| 变更文件 | 变更内容 | A 状态（改前） | B 状态（改后） | A 测试结果 | B 测试结果 | 代码已恢复 |
|---------|---------|--------------|--------------|-----------|-----------|----------|
| setup_mitm.py | 常量值 3600→604800 | 3600 | 604800 | ❌ test_constant FAIL | ✅ PASS | ✅ git diff/grep 确认 |
| ecs_proxy.py | 新增 IP 映射预查 | 无预查代码块 | 有预查代码块 | ❌ 代码块不存在 | ✅ 存在 | ✅ git diff/grep 确认 |
| app.py | 日志加 source=%s | 无 source=%s | 有 source=%s | ❌ 文本匹配 FAIL | ✅ PASS | ✅ git diff/grep 确认 |

数据来源：Step 4d 的 `.fix_stats` 中的 `destructive_validated_files` 字段。

**每个变更源文件都必须在列表中有对应的行。** 列表为空或缺少文件的，报告视为不合格。
**每行的「代码已恢复」列必须为「✅ git diff/grep 确认」**，不为空或为 ❌ 的报告视为不合格。

#### 八、自愈修复统计

| 指标 | 值 |
|------|-----|
| 初始失败数 | 3 |
| 修复轮次 | 2 |
| 总修复次数 | 2 |
| 最终结果 | ✅ 全部通过 |
| 耗时 | 45s |

数据来源：`.fix_stats` 文件。如果无失败（初始即全部通过），则写「首次运行即全部通过，无需修复」。

#### 九、Spec 合规审计

| Spec 文件 | 检查规则 | 结论 |
|----------|---------|------|
| xxx.md | 规则描述 | 通过/不通过 |

#### 十、降级记录（强制规则 27）

| Step | 降级点 | 验证证据（命令输出/退出码） | 兜底产物 | 是否影响完整性 |
|------|--------|--------------------------|---------|--------------|
| （如 Step 1b） | （如 gitnexus 不可用） | （如 `gitnexus analyze` 失败输出） | （如 纯 codegraph+grep） | （不影响 / 影响→说明） |

无降级则写「本轮无降级」。任何声称「不可用」却无证据、或兜底产物非 skill 定义路径 = 该调用无效需重跑。

### 5.3 报告生成方式

如果 `_step5_report.py` 脚本存在，先用它生成初版，然后 AI 补充缺失的中文部分。
如果脚本不存在，AI 直接按上述七部分模板生成完整中文报告。

**禁止只输出英文标题或内容。全文必须中文。**

报告文件写入 `_TASK_DIR/test_report.md`，**直接覆盖**已有文件（不追加、不重命名）。

## Step 6: 更新测试库 + 产物清理暂存

**入口**: 报告已生成
**出口**: `.trellis/tests/lib/` 下测试文件已更新，版本号已同步，中间产物已删除，有价值文件已 `git add`
**出口 Goal**: `/goal 测试库更新 + 产物清理完成 — lib/ 合并完成，临时文件已清理，有价值文件已 git add`

### 6.1 测试库目录结构

```
.trellis/tests/
  lib/                          ← 长期维护的测试库，跨轮次累积
    regression/                 ← 历史回归测试（按功能域分组）
    coverage/                   ← 爆炸范围覆盖测试（按符号分组）
  generated/                    ← 本轮新生成（运行后合并到 lib/ 然后删除）
  config.json
  .regression_index
```

### 6.2 合并 generated → lib

```bash
# 创建 lib 目录
mkdir -p .trellis/tests/lib/regression .trellis/tests/lib/coverage

# 回归测试 → lib/regression/
cp -n .trellis/tests/regression/test_regr_*.py .trellis/tests/lib/regression/ 2>/dev/null || true

# 覆盖测试 → lib/coverage/
cp -n .trellis/tests/generated/$(date +%Y/%m)/test_*.py .trellis/tests/lib/coverage/ 2>/dev/null || true

# 同步到 tests/ 目录（供 pytest 直接发现）
cp -n .trellis/tests/lib/regression/test_regr_*.py tests/ 2>/dev/null || true
cp -n .trellis/tests/lib/coverage/test_*.py tests/ 2>/dev/null || true
```

如果 `lib/` 中已有同名文件（同一功能域/符号），则**覆盖更新**（用新生成版替换旧版）。

### 6.3 版本号同步

对每个从 `generated/` 复制到 `lib/` 的文件，检查其 TestedSource 头部：
- 如果 `lib/` 中已有该文件且 TestedSource 版本号不同 → 用新版本覆盖
- 如果 `lib/` 中已有该文件但版本号相同 → 跳过（内容未变）
- 如果是新文件 → 直接复制

```bash
HEAD_HASH=$(git rev-parse HEAD 2>/dev/null || echo "novcs")
# 更新 lib/ 中每个文件的 TestedSource 版本号
for f in .trellis/tests/lib/regression/*.py .trellis/tests/lib/coverage/*.py; do
  [ -f "$f" ] || continue
  # 如果文件中 TestedSource 行不是当前 HEAD，更新
  if grep -q "TestedSource:.*@" "$f" 2>/dev/null; then
    sed -i "s/TestedSource:.*@.*/TestedSource: $(basename "$f" .py)@${HEAD_HASH}/" "$f"
  fi
done
```

### 6.4 git add 有价值文件（暂存区，待提交）

在删除中间产物前，先 `git add` 所有有保留价值的文件到暂存区：

```bash
# 优先级 P0 — 强制 git add（报告）
git add "${_TASK_DIR}test_report.md" 2>/dev/null || true

# 优先级 P0 — 测试库（长期维护，跨轮次累积）
git add .trellis/tests/lib/ 2>/dev/null || true
git add .trellis/tests/config.json 2>/dev/null || true
git add .trellis/tests/.regression_index 2>/dev/null || true

# 优先级 P1 — 建议 git add（spec 审计记录，有审核价值）
git add .trellis/tests/.spec_audit_report 2>/dev/null || true
git add .trellis/tests/.fix_stats 2>/dev/null || true

# 验证 add 结果
echo "✅ git add 完成 — 报告 + 测试库已暂存"
```

### 6.5 删除临时文件

```bash
# 删除本轮生成的临时测试文件（lib/ 已保留）
rm -f tests/test_regr_*.py tests/test_add_user_*.py tests/test_push_*.py
rm -f tests/test_set_*.py tests/test_build_*.py tests/test_proxy_*.py tests/test_update_*.py
# 删除中间产物
rm -rf .trellis/tests/generated/$(date +%Y/%m)/ .trellis/tests/regression/
rm -f .trellis/tests/.affected_* .trellis/tests/.search_files .trellis/tests/.blast_files
rm -f .trellis/tests/.history_fixes .trellis/tests/.coverage_gaps .trellis/tests/.coverage_gate
rm -f .trellis/tests/.fix_goal .trellis/tests/.manual_verify_items
rm -f .trellis/tests/.content_stale .trellis/tests/.dep_stale
rm -f .trellis/tests/.index_stale .trellis/tests/.parallel_plan
rm -f .trellis/tests/_4b_result.json .trellis/tests/_4c_results.jsonl

# 清理缓存（本次运行产生的字节码/测试缓存，不留中间无效数据）
rm -rf .pytest_cache 2>/dev/null || true
find tests .trellis/tests remote/noconfig -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
```

### 6.6 验证清理结果

确保删除后无中间产物残留，且保留文件都已 `git add`：

```bash
# 检查是否还有中间产物残留
REMAINING=$(find .trellis/tests/ -maxdepth 1 -name ".*" -not -name ".regression_index" -not -name ".gitkeep" 2>/dev/null | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo "⚠️ 有 $REMAINING 个中间文件残留："
    find .trellis/tests/ -maxdepth 1 -name ".*" -not -name ".regression_index" -not -name ".gitkeep" 2>/dev/null
    rm -f $(find .trellis/tests/ -maxdepth 1 -name ".*" -not -name ".regression_index" -not -name ".gitkeep" 2>/dev/null)
    echo "  → 已清理"
fi

# 确认保留文件已暂存
echo "📋 git 暂存状态（保留文件）："
git status --short .trellis/tests/lib/ .trellis/tests/config.json .trellis/tests/.regression_index "${_TASK_DIR}" 2>/dev/null | head -20 || true

echo "✅ 产物清理完成"
```

### 6.7 保留的文件

- `.trellis/tests/lib/` — 长期测试库，每次运行累积更新
- `.trellis/tests/config.json` — 测试配置，跨轮次复用
- `.trellis/tests/.regression_index` — 回归测试索引，跨轮次追加
- `tests/conftest.py` — 测试基础设施，跨轮次复用
- `_TASK_DIR/test_report.md` — 本次报告（保留到下一轮被覆盖）

### 6.8 运行时数据保护校验（数据安全门禁 — 强制规则 24）

比对 Step 0 基线快照，恢复被测试污染的运行时数据文件，然后删除快照：

```bash
# 对比基线快照，恢复被测试污染的运行时数据
POLLUTED=0
for f in accounts.json users.json online_sessions.json remote/noconfig/account_ip_map.json tenants/*/users.json; do
  [ -f "$f" ] || continue
  bak=".trellis/tests/.data_backup/$(echo "$f" | tr '/' '_')"
  if [ -f "$bak" ] && ! cmp -s "$f" "$bak"; then
    echo "⚠️ 测试污染运行时数据: $f → 从基线恢复"
    cp "$bak" "$f"
    POLLUTED=1
  fi
done
# 删除基线快照（不留中间数据）
rm -rf .trellis/tests/.data_backup 2>/dev/null || true
if [ "$POLLUTED" -eq 1 ]; then
  echo "数据安全门禁: ⚠️ 有运行时数据被测试污染，已恢复 — 记入报告"
else
  echo "数据安全门禁: ✅ 运行时数据干净（测试隔离合规）"
fi
```

**记入报告**: 若检测到污染，Step 5 报告新增「数据安全」章节：列出被污染的文件、恢复动作、根因（哪个测试没做隔离）→ 该测试标记需修复。

## 语言兼容性

Step 4c（运行）和 Step 3（生成）根据 config.json 的 `runner` 字段适配：

| runner | 语言 | 框架 | 命令 |
|--------|------|------|------|
| pytest | Python | pytest | `python -m pytest` |
| unittest | Python | unittest | `python -m unittest` |
| go | Go | testing | `go test -run` |
| cargo | Rust | test | `cargo test` |
| maven | Java | JUnit | `mvn test` |
| gradle | Java/Android | JUnit | `./gradlew test --tests` |
| jest | JS/TS | Jest | `npx jest` |
| vitest | JS/TS | Vitest | `npx vitest run` |
| phpunit | PHP | PHPUnit | `phpunit` |
| rspec | Ruby | RSpec | `bundle exec rspec` |
| mocha | JS | Mocha | `npx mocha` |
| kotlin | Kotlin | kotlin.test | `kotlin -cp` |
| swift | Swift | XCTest | `swift test` |
| dart | Dart | dart test | `dart test` |
| dotnet | C# | xUnit/NUnit | `dotnet test` |
| generic | 任意 | 自包含 | 按扩展名自动选择 |

## 边界条件

| 场景 | 处理 |
|------|------|
| 回归测试破坏性验证失败 | 测试不合格，标记 `[DESTRUCTIVE_FAILED]`，回退重新生成 |
| 测试库版本不一致（lib vs HEAD） | 更新 TestedSource 版本号，对比代码差异后决定是否更新测试内容 |
| 无变更 | `exit 0` |
| 无已有测试 | 自动 Step 3 生成直接层测试 |
| 已有测试过期 | TestedCommit ≠ HEAD → 删除后回到 Step 3 重新生成（最多 2 次循环） |
| 修复 5 轮无改善 | 自动终止，输出修复日志 |
| 多 Agent 审计冲突 | 多数决（超过半数为通过），平局标记需人工确认 |
| 多模块 | 每个模块独立运行 Step 4b-4c |
| 无历史 fix | Step 1e 跳过（git/svn/本地备份均无），报告注明「无版本控制历史，跳过历史回归测试」 |
| gitnexus 不可用 | 降级为纯 codegraph 分析 + `grep -r` 调用点展开（见 Step 1b），风险等级默认「中」，报告注明「gitnexus 不可用，爆炸半径精度受限」 |
| 测试运行器缺失（maven/gradle/pytest/jest 等） | 按强制规则 28 先自愈：winget/choco/scoop 安装或官方下载解压，或改用等效直接运行器（如 Java 无 maven 用 javac+JUnitCore 直编直跑）；仅安装失败且无等效运行时才降级并附证据 |
| git 不可用 | 自动降级到 svn；svn 不可用降级到本地备份对比 |
| 覆盖完整性有未覆盖符号 | Step 2 标记 ❌ 提示用户，Step 5 报告列出，覆盖率门禁标红 |
| 回归测试生成失败 | 记录失败原因到 `.fix_goal`，不阻塞主流程 |
| 手动验证建议无强制验证项 | 报告注明「无强制手动验证项，所有变更已通过自动化测试」 |
| 变更无改前行为（纯新增） | 报告只文字描述改后行为 |
| 索引重建失败 | 继续执行但降级为纯 codegraph + grep 方案（见 Step 1b），报告注明「索引过期，爆炸半径分析可能不完整」，Step 5 报告标记 ⚠️ |
| 空断言检测发现弱断言 | 记录到 `.fix_goal`，修复轮次中补充断言；若修复轮次耗尽则报告保留 ⚠️ |
| 检出行为反转但未确认判定 | 终止修复循环，输出「需人工确认行为反转：<函数>、<旧行为>、<新行为>」，不得静默更新测试 |
| 覆盖率门禁未通过 | Step 5 报告标红「覆盖率门禁: ❌ 未通过」，不阻塞报告生成 |
| 变更含模板内嵌 JS 但 node 不可用 | 降级为 `pyjsparser`/`esprima`；两者皆无则 JS 语法门禁测试 `pytest.skip` + 标记 `js_check_skipped`，Step 5 报告标注 ⚠️「JS 语法门禁未执行」 |
| 渲染产物 JS 语法非法 | 该变更点测试不合格，回到 Step 3 重新生成（强制规则 26）；报告列出具体 JS 语法错误位置 |
| agent 声称「某工具不可用」 | 必须附验证证据（命令输出+退出码，对照 `.env_availability` 预检）；无证据或预检显示可用 → 该 Step 无效需重跑（强制规则 27） |

---

## Packaged pack · auto-bootstrap（无需 trellis init）

这个技能由 `dsh-skill-trellis` 插件全局提供，不依赖项目里预先存在的 `.trellis/`。进入任何工作区时：

1. 先看 `<workspace>/.trellis/` 是否存在。
2. **不存在**时不要停下来让用户手动 `trellis init`，自己按顺序做：
   - `trellis --version` 确认 CLI（冻结版内置 0.6.17）；
   - 可用则在工作区根执行 `trellis init --platform dsh`；
   - 不可用则把插件内置骨架 `<assetRoot>/../_scaffold/` 复制成 `<workspace>/.trellis/`；
   - 读 `.trellis/spec/index.md` 后继续本技能流程。
3. **已存在**时只增量更新，绝不覆盖。