---
name: trellis-code
description: "结构化代码编写/修改技能，项目无关（任意语言/任意项目，无 .trellis/codegraph/gitnexus 生态也降级可用）：写新代码或改已有代码时，强制影响分析 + Spec 规范检查 + 一致性验证 + 质量门禁 + 中文报告。双模式：/trellis-code edit（改代码）/trellis-code new（写新代码）。融合 fix-it-once 原则：改前画全貌、改时查链路、改后验完整。性能/时序类 bug 强制先带时间戳测量再修（profile-first），原生/生命周期机制假设必须先可观测证据实证再修（机制实证），多症状归并根因集，L4 实机证据门禁未过禁止宣称『已修复』（用词门禁）。"
trigger: /trellis-code
---

# trellis-code — 结构化编码改码

融合 fix-it-once（一次性改对）的核心原则与 Trellis 工具链，让 AI 写代码改代码时**一次做对，不乱改**。

---

## 强制规则（不可违反 — 1141 PR 实测验证）

1. **必须按 Phase 1→2→3→4→5→6（edit）顺序执行**，任何理由不得跳步或重排
2. **改代码前必须先做全局把控（fix-it-once）** + **跑 codegraph/gitnexus 硬门禁**，不知道爆炸半径不动手。codegraph MCP 工具名为 `mcp__codegraph__codegraph_explore`，直接调用无需降级。**项目无关**：无 codegraph/gitnexus 的项目用项目可用代码检索（grep/rg/IDE 搜索/语言索引器）完成影响分析，**不因缺工具跳过此步**（强制规则 #13 精神）。
3. **Phase 2 方案评估（Q1/Q2/Q3/Q4）不可跳过** — 这是 69% 质量提升的核心驱动力
4. **改完后必须做一致性验证 + Spec 破坏验证**，多点检查所有定义/引用是否同步，确保不破坏项目规范
5. **改完后必须过质量门禁**（lint/type/test），不满意的代码不准提交
6. **严禁改与目标无关的代码**（scope creep），变更计划未涉及的文件不碰
7. **每个 Phase/Step 完成后必须执行出口 /goal** — 输出物验证后显式输出 `/goal` 命令。不执行 /goal 的 Phase 视为未完成，不得进入下一步
8. **报告全文必须中文**，不得出现英文标签或术语
9. **违反以上任何一条 = 本次调用无效**，需要重新 `/trellis-code`
10. **所有输出文件必须归入当前活跃任务的 code/ 子目录** — 所有中间产物（`.step_N_done`、`.change_goal`、`.affected_files`、`change_report.md` 等）必须写入 `.trellis/tasks/<活跃任务名>/code/`。无活跃任务时降级写入 `$CODE_DIR/`。违规放置 = 本次调用无效
11. **Phase 6 产物清理门禁不可跳过** — 流程结束后必须先 `git add` 有价值文件（报告、决策记录），再删除中间产物。不执行 Phase 6 直接退出 = 本次调用无效
12. **Phase 6 出口 `/goal` 必须验证 git 暂存状态** — 输出 `/goal 产物清理完成` 前必须确认 `git status --short $CODE_DIR/change_report.md` 显示已暂存
13. **上下文感知：已调用的工具/已有的产物直接使用，但流程必须完整走完不能跳过** — 例如用户已经 `git diff` 过了或 `gitnexus impact` 已经返回了结果，直接拿来用（不重新跑），但 Phase 不能跳过，每个 Phase 的入口/出口检查照常进行。
14. **索引强制刷新：Step 0 必须先刷新 codegraph+gitnexus 索引再验证**，不是仅检查新鲜度。先刷新再对比时间戳。刷新失败写 `.index_stale` 标记，Phase 5 报告必须标注索引过期警告。无 codegraph 时不刷新直接降级 grep，但仍需写 `.index_stale`。
15. **快速通道：变更 ≤3 个文件时自动跳过所有用户确认点**（Step 1e 边界确认、变更计划确认、执行确认），直接给出方案评估和变更计划后进入 Phase 3。用户没说"等等"就不停。
16. **主动排障：工具调用失败时自动尝试 2 种替代方案** — 例如 Edit 失败自动换 Python/sed，codegraph MCP 不可用时自动换 Bash+node 命令重试。尝试所有方案仍失败才报告。
17. **预期行为验证不可跳过：Phase 2 Q3 必须定义行为契约，Phase 4 必须执行语义验证** — 大改小改都要过。未定义行为契约 = Phase 2 未完成，未执行语义验证 = Phase 4 未完成。行为验证结果必须写入变更报告。
18. **质量门禁不跑完整套件，只跑本次改动相关验证** — 质量门禁只做：①编译检查（本次改动 `.py` 源文件 `python -m py_compile`）②本次改动相关测试（`.affected_files` 中 `tests/*.py`，无则跳过，由 Step 4e 行为契约兜底）。**禁止 `python -m pytest .` 全仓套件**（既慢又被存量坏账污染）。深度测试由 `/trellis-test` 负责，变更报告**不引用**完整套件结果。
19. **数据安全门禁（强制）** — 测试必须用临时目录 + 单例隔离（语言对应：Python `tempfile.TemporaryDirectory()`+`create_detached()`、其他语言用标准临时目录/隔离实例），**禁止测试读写真实运行时数据**（数据库、用户数据、凭证、线上配置）。Step 0 识别项目真实运行时数据文件并做基线快照——**项目无关，自动识别**：数据库文件（`*.db`/`*.sqlite`/`*.sqlite3`）、状态 JSON、`*.env`、`config.*` 等（Python 示例：`accounts.json`/`users.json`/`online_sessions.json`/`tenants/*/users.json`）。Phase 6 比对并恢复被测试污染的文件。运行后只留必要文件，删除中间产物与语言对应缓存目录（`__pycache__/`、`.pytest_cache/`、`node_modules/.cache/`、`target/` 等）。
20. **L4 实机证据门禁（强制）** — 改动触及「验证层级分类表」L4（窗口/原生/渲染、时序/竞态、生命周期/状态机、外部服务/网络、真实数据/语义、性能/体感、跨端/平台、配置/依赖组合）时，Q3 必须定义实机证据计划；本轮无法产出实机证据 → 验证确认表「实机验证」标 ⚠️、报告待办列阻塞项，**禁止在阻塞待办未清时宣称已完成**（V3 教训：报告写"需实测"仍宣称已修好）。**阻塞项清除权在用户**：⚠️→✅ 的转换必须由用户在实测后的显式确认（回复/验收），AI 不得自行把 ⚠️ 改 ✅、不得自行清除待办阻塞项。
21. **重复修复自检（强制）** — 同一症状在"宣称修复"后再次被用户报告 → 必须先做根因深挖（对照「验证层级分类表」重查宿主层级，用事件日志/原生源码/真实数据等证据确认，走 trellis-break-loop 范式），**禁止直接提新补丁**；上一轮 change_report 必须标注「实际未修复」（便签黑线 V1→V2→V3→V4 教训）。
22. **L4 性能/时序类先测量再修（profile-first，强制）** — 改动涉及「验证层级分类表」L4 的性能/时序/竞态/网络/生命周期症状时，必须先带时间戳/计数/事件日志（或等效测量手段）定位**真根因**，再选修复层；**禁止凭症状直接开补丁**（如"白屏就加透明度/改绘制层"——setOpacity 分层窗口回归教训）。测量证据（耗时分布/调用计数/时间戳日志）写入 `.change_goal` 根因段。无测量证据不得进入 Phase 2。
23. **多症状必须归并为根因集（强制）** — 用户一次报告多个症状（如"启动慢+跳转白屏+模块无反应"）时，禁止「一个症状一个补丁」。必须先归并为根因集（RC-A/B/C…编号），确认症状↔根因映射（允许多症状同根因），再一次性修。同时**不信任用户症状表述为根因**：用户说"联网卡"≠根因是网络，须用证据确认真实根因，防被症状框架锚定（便签五轮修复教训：症状成洋葱，每轮修一个又暴露下一个）。
24. **报告用词门禁（强制，把 #20 从"应然"升级为"可检测"）** — 改动触及 L4 且实机证据未产出时：变更报告摘要、Phase 5 报告、口头总结、commit message **禁止出现「已修复/已完成/搞定/修好了」等完成态措辞**，一律用「已编码落地 · 待实机验证」；验证确认表「实机验证」必须为 ⚠️ 并列为阻塞待办，直至用户实测通过才清除。出现完成态措辞 = 违反本规则（V3 教训：报告写"需实测"仍宣称已修好，前四轮反复违规收尾）。
25. **原生/生命周期机制实证（强制）** — 当根因假设依赖**运行时机制**（消息循环/引擎 teardown/线程生命周期/OS 行为/框架内部时序/API 语义）时，**禁止只读代码推断机制**——必须先给出**可观测机制证据**（进程存活态检查、时间戳事件日志、原生 trace、二选一判别项）写入 `.change_goal` 根因段再进 Phase 2；且修复方案必须让被假设机制**可判别**（仍失败时能判定是"修复没生效"还是"机制假设错了"，而非沿用同一机制假设换姿势重试）。无机制证据 = Phase 2 未完成（R1 两次翻车教训：`destroy`→PostQuitMessage→CRT teardown 在第二引擎线程挂起→事件循环死→exit(0) 永不执行，第一版把机制猜成"destroy Future 永不完成"，实机"进程存活"才逼出真机制）。
26. **环境自愈（强制，先自愈再降级）** — 质量门禁（共用 Step 6）所需的构建/测试运行器（maven/gradle/npm/jest/pytest 等）缺失时，**必须先自愈**，禁止把「环境不可用」当作合法的降级/跳过理由写进报告。自愈顺序：①按项目语言确定所需运行器（存在 `pom.xml`→maven、`build.gradle`→gradle、`package.json`→npm、`*.py`→pytest）；②缺失时依次尝试 `winget install` → `choco install` → `scoop install` → 官方/镜像下载 zip 解压（如华为云/清华镜像的 maven、Temurin/Zulu JDK），并用 `mvn -v`/`java -version`/`node --version` 验证；③Java 项目 maven 缺失时可改用 `javac`（本地 .m2 依赖 classpath）+ `junit`/`JUnitCore` 直编直跑作为等效验证路径；JDK 版本与项目不匹配（如 Java8 项目只有 JDK17）时下载对应 JDK 或加 `--add-opens`/`MAVEN_OPTS` 绕过。**只有「安装失败（附命令+输出+退出码）+ 无等效路径」才允许降级**，且报告「降级记录」必须给出可复现的替代执行路径。这条规则替代任何「环境不支持就记录局限」的行为。

---

## Benchmark 驱动的质量目标

基于 1141 个真实 GitHub PR（40 个仓库，覆盖前端/后端/Android/移动端）的基准测试：

- **人类基线**: 4.98/10（严格评分）
- **使用 trellis-code**: 8.43/10（+69.2% 提升）
- **100% 的 PR 得到改善**，72% 的 PR 单项提升超 50%

| 维度 | 人类基线 | trellis-code 目标 | 实现方式 |
|------|---------|------------------|---------|
| 范围纪律 (Scope) | 4.5 | ≥ 9.0 | Phase 1 影响分析锁定范围，禁止 scope creep |
| 多点一致性 | 4.2 | ≥ 9.0 | Phase 4 一致性检查强制代码+配置+文档同步 |
| 行为验证 (Behavior) | 3.0 | ≥ 8.0 | Phase 2 Q3 行为契约 + Phase 4 Step 4e 语义验证 |
| 测试覆盖 | 3.8 | ≥ 8.0 | 质量门禁要求测试覆盖（或至少运行现有测试） |
| 文档同步 | 3.5 | ≥ 7.0 | Phase 2 Q2 连锁影响分析包含文档检查 |
| Diff 质量 | 5.5 | ≥ 8.0 | Phase 3 执行要求最小 diff |

| 可维护性 (Maintainability) | 3.5 | ≥ 8.0 | Phase 2 Q4 评估测试成本+注释，Phase 4 验证确认 |

**核心差异**: Phase 2 方案评估（Q1 替代方案/Q2 连锁影响/Q3 验证方式+行为契约/Q4 可维护性评估）是 trellis-code 与不用 skill 的根本区别。方案评估不可跳过，行为契约不可跳过。

## 通用自愈模式（所有 Step 共用）

每个 Step 执行完毕后必须执行以下四件事：

```
1. 验证输出物：
   □ 预期文件存在且非空 → 继续
   □ 不存在/空 → 重试当前 Step 一次 → 仍失败则走 fallback
2. Fallback：
   □ 有降级方案 → 执行降级方案，标记 ⚠️ 留报告
   □ 无降级方案 → 终止流程，输出「Step X 执行失败：原因」
3. 输出出口 /goal：
   验证通过后，立即输出该 Step 的出口 /goal 命令
4. 记录状态：
   写入 $CODE_DIR/.step_N_done
```

### Step 级别的自愈策略

| Step | 预期失败 | 自愈动作 | Fallback |
|------|---------|---------|----------|
| 0 环境检测 | codegraph/gitnexus 刷新失败 | 重试刷新一次 | 降级到 grep + 写入 `.index_stale` 标记，Phase 5 报告标注过期警告 |
| 1a 全局把控 | 部分子 Agent 搜索超时/失败 | 重试该子 Agent 一次 | 失败路标「⚠️ 搜索失败」，其他路结果正常合并 |
| 1c 硬门禁 | 部分 MCP 调用超时/失败 | 降级对应路到 grep 补查 | 报告标注「部分影响分析缺失」 |
| 1e 边界确认 | 用户未响应 / 边界问题分析不全 | 重试分析代码上下文，重新生成问题列表 | 输出「边界确认跳过，使用默认策略」 |
| 2 Spec 检查 | 无 .trellis/spec/ | 跳过 | 输出「无 spec」 |
| 3 变更计划 | 用户无响应 | 等待（不超时跳过） | N/A |
| 4 执行变更 | 子 Agent 超时/失败 | 重试子 Agent | 主 Agent 补改 |
| 4a 并行验证 | 某路子 Agent 验证失败/超时 | 主 Agent 补跑该路 | 报告标注「部分验证跳过」 |
| 4e 语义验证 | 行为契约运行失败 / 契约无法执行 | 重试一次（修正 import/调用方式） | 标记「⚠️ 契约 N 无法执行」不阻塞；全部失败需人工核实 |
| 5 一致性验证 | 多点检查有遗留 | 回到 Step 4 补修 | 记入报告待办 |
| 6 质量门禁 | lint/test 失败 | 串行修复重跑（最多 3 轮） | 输出未通过项 |
| — new 模式 — | — | — | — |
| n1 需求确认 | 用户描述不清晰 | 追问具体输入/输出 | 按最简实现 |
| n3 生成计划 | 接口设计有歧义 | 展示 2 种方案供用户选 | 按最简方案走 |
| n4 并行生成 | 子 Agent 生成不符合预期 | 重试子 Agent | 主 Agent 重写 |

---

## 双模式入口

| 命令 | 场景 |
|------|------|
| `/trellis-code edit` | 修改已有代码（参数/逻辑/结构/配置） |
| `/trellis-code new` | 写新代码（新功能/新文件/新模块） |
| `/trellis-code`（不带参数） | AI 根据上下文自动判断模式 |

---

## 验证层级分类表（证据门禁参考）

> **核心原则：验证证据必须和 bug 所在的层级匹配。** 编译/单测/行为契约（L1-L3）只覆盖"正确性"，覆盖不到 L4 真实环境的"行为/时序/环境"。改动触及 L4 某类且拿不出该类证据时，状态必须是「⚠️ 未验证 · 需实测」= 阻塞待办（强制规则 #20）。

| 层级 | 默认证据 | 盲区类别 | 典型症状（本项目实例） | 需要的证据 |
|------|---------|---------|----------------------|-----------|
| L1 编译/类型 | analyze / build | — | 语法、签名、引用错误 | 编译通过 |
| L2 逻辑 | 单元测试 | — | 纯函数、状态转换、规则错误 | 用例通过 |
| L3 行为契约 | 可执行断言 | — | 跨函数/接口语义错误 | 契约运行通过 |
| L4 真实环境 | 实机证据 | ①窗口/原生/渲染 ②时序/竞态 ③生命周期/状态机 ④外部服务/网络 ⑤真实数据/语义 ⑥性能/体感 ⑦跨端/平台 ⑧配置/依赖组合 | 黑线=OS 非客户区边框；崩溃=setSkipTaskbar 空指针；白屏=surface 不重绘；通道未注册先 invoke；陈旧进行中压过今天到期待办；点击恢复卡顿 | 实机截图 / 事件日志 / 原生源码比对 / 带时间戳日志 / 真实数据跑逻辑 / 性能计时 / 各平台 build+run |

**归因判定**：改 UI/窗口/时序前，先问「这个症状在 Flutter 绘制层能产生吗？」不能 → 宿主在窗口/原生/OS/网络/数据层。先用证据确认层级，再选修复方案。**无头门禁（analyze+单测+行为契约）全部通过 ≠ 已修复真实环境 bug。**
**测量先行（强制规则 #22）**：触及性能/时序类时，先带时间戳事件日志 / 耗时统计 / 调用计数定位真根因，写入 `.change_goal`，再选修复层。禁止凭症状直接改参数/绘制层（setOpacity 分层窗口回归教训）。

---

## Phase 0: 解析当前活跃任务（所有模式前置）

在所有 Phase/Step 执行之前，必须先检测当前活跃的 Trellis 任务，确定输出目录。

**入口**: 无（起始步骤）
**出口**: `CODE_DIR` 已确定，目录已创建
**出口 Goal**: `/goal 代码工作目录就绪 — $CODE_DIR 已创建`

```bash
# 检测活跃 Trellis 任务
TASK_DIR=$(python ./.trellis/scripts/task.py current --source 2>/dev/null | grep -oP 'tasks/\K[^/]+')
if [ -n "$TASK_DIR" ]; then
    CODE_DIR=".trellis/tasks/$TASK_DIR/code"
    echo "📁 活跃任务: $TASK_DIR -> $CODE_DIR"
else
    CODE_DIR=".trellis/code"
    echo "⚠️ 未检测到活跃任务，降级到 $CODE_DIR"
fi
mkdir -p "$CODE_DIR"
```

**后续所有 Phase/Step 中，`$CODE_DIR` 替代原本的 `.trellis/code/` 路径**。所有中间文件写入 `$CODE_DIR/`。

---

## 共享步骤（两种模式共用）

以下 Step 在 edit 和 new 模式中完全相同，引用即可。

> **路径发现规则**: 所有 `.trellis/scripts/` 和 `.trellis/spec/` 路径均为项目相对路径，以当前工作目录为基准。执行前用 `test -f` 或 `test -d` 验证存在性，不存在则走 fallback。

### 共用 Step 0: 环境检测 + 索引强制刷新

**入口**: 无（起始步骤）
**出口**: codegraph/gitnexus 索引已刷新（或已写入过期标记），`$CODE_DIR/` 目录存在
**出口 Goal**: `/goal 环境就绪 — git 状态已确认，索引已刷新，$CODE_DIR/ 已创建`

```bash
mkdir -p "$CODE_DIR"
git status

# 运行时数据基线快照（数据安全门禁 — 强制规则 19）
# 测试前记录真实数据文件快照，Phase 6 比对并恢复被污染的文件
mkdir -p .trellis/tests/.data_backup
for f in accounts.json users.json online_sessions.json remote/noconfig/account_ip_map.json tenants/*/users.json; do
  if [ -f "$f" ]; then cp "$f" ".trellis/tests/.data_backup/$(echo "$f" | tr '/' '_')" 2>/dev/null; fi
done
echo "✅ 运行时数据基线快照完成 → .trellis/tests/.data_backup/"

# === 索引强制刷新（强制规则 14 — 不可跳过） ===
# 先刷新再验证，不是仅检查新鲜度

LAST_COMMIT_TS=$(git log -1 --format=%ct 2>/dev/null || echo 0)
echo "最后 commit: $(date -d @$LAST_COMMIT_TS 2>/dev/null || echo $LAST_COMMIT_TS)"

# 1. 强制刷新 codegraph 索引（通过 CLI 触发 watcher）
echo "--- 刷新 codegraph 索引 ---"
python -c "
import os, sys
try:
    # touch 所有索引文件触发文件 watcher
    cg_dir = '.codegraph'
    if os.path.isdir(cg_dir):
        for root, _, files in os.walk(cg_dir):
            for f in files:
                p = os.path.join(root, f)
                try: os.utime(p, None)
                except: pass
        latest = max((os.path.getmtime(os.path.join(root, f)) for root, _, files in os.walk(cg_dir) for f in files), default=0)
        print(f'codegraph 索引时间: {int(latest)}')
        if latest >= $LAST_COMMIT_TS:
            print('codegraph: 就绪')
            sys.exit(0)
        else:
            print('codegraph: 文件 watcher 可能延迟，继续流程')
            sys.exit(0)
    else:
        print('codegraph: 无 .codegraph 目录')
        sys.exit(1)
except Exception as e:
    print(f'codegraph 刷新失败: {e}')
    sys.exit(1)
" 2>&1 || echo "⚠️ codegraph 刷新失败（降级 gitnexus+grep）"

# 2. 强制刷新 gitnexus 索引
echo "--- 刷新 gitnexus 索引 ---"
(node .gitnexus/run.cjs analyze 2>/dev/null || npx gitnexus analyze 2>/dev/null) && \
echo "gitnexus: 刷新成功" || echo "⚠️ gitnexus 刷新失败（影响分析可能不完整）"

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

REBUILD_FAILED=0
if [ "$CODEGRAPH_TS" -lt "$LAST_COMMIT_TS" ] 2>/dev/null; then
    echo "❌ codegraph 索引仍过期: $CODEGRAPH_TS < $LAST_COMMIT_TS"
    REBUILD_FAILED=1
fi
if [ "$REBUILD_FAILED" -eq 1 ]; then
    echo "⚠️ 索引刷新失败，影响分析可能不完整"
    echo "索引刷新失败" > "$CODE_DIR/.index_stale"
else
    echo "✅ 索引刷新成功: codegraph=$CODEGRAPH_TS"
    rm -f "$CODE_DIR/.index_stale"
fi
```

### 共用 Step 2: Spec 规范检查

**入口**: `$CODE_DIR/.affected_files`（edit）或 `$CODE_DIR/.new_goal`（new）
**出口**: `$CODE_DIR/.spec_rules` 存在，列出必须遵守的规范规则
**出口 Goal**: `/goal Spec 规范检查完成 — .spec_rules 已提取`

```bash
# 2a 检查项目是否有 Trellis spec，缓存包列表供后续使用
if [ -f .trellis/scripts/get_context.py ]; then
    python .trellis/scripts/get_context.py --mode packages 2>/dev/null | tee $CODE_DIR/.packages
else
    echo "# 无 get_context.py，尝试直接读取 spec 目录" > $CODE_DIR/.packages
    ls -d .trellis/spec/*/ 2>/dev/null | sed 's|/.trellis/spec/||;s|/$||' > $CODE_DIR/.packages
fi

# 2b 读相关 spec — 只读与修改目标相关的包/层
cat .trellis/spec/guides/index.md 2>/dev/null
if [ -s $CODE_DIR/.packages ]; then
    for pkg in $(cat $CODE_DIR/.packages 2>/dev/null | grep -v '^#'); do
        cat .trellis/spec/$pkg/*/index.md 2>/dev/null
    done
fi
```

提取规则写入 `$CODE_DIR/.spec_rules`：
```text
# 规则来源: spec/guides/conventions.md:12
## 规则: 所有配置参数必须在 config.yaml 定义，ARGV 只做覆盖
影响文件: src/config.py, config.yaml
强制程度: 强制
```
无 spec 时写入 `# 本项目无 trellis spec，跳过规范检查` 并继续。

### 共用 Step 6: 质量门禁

**入口**: 一致性验证（edit）或代码生成（new）已通过
**出口**: lint/type/test 全部通过，最多 3 轮修复
**出口 Goal**: `/goal 质量门禁通过 — lint/type/test 全部绿色`

**首轮并行运行（3 个命令同时发出，互不依赖）：**

> **语言自适应（项目无关）**：按项目技术栈选质量门禁，**优先用项目已有的 lint/type/test 配置**（`package.json` scripts、`pyproject.toml`、`pom.xml`、`Makefile`、CI 配置等）：
> **⚠️ 运行器缺失必须自愈（强制规则 #26）**：所需构建/测试运行器（mvn/gradle/npm/pytest 等）不存在时，先安装/定位（`winget install` / `choco install` / `scoop install` / 官方或镜像下载 zip 解压，并 `mvn -v`/`node --version` 验证），或改用等效直接运行器（Java 无 maven 用 `javac` + `JUnitCore` 直编直跑）；JDK 版本与项目不匹配时下载对应 JDK（如 Temurin/Zulu 8）或加 `--add-opens`/`MAVEN_OPTS` 绕过。**禁止因「没装工具」跳过编译/测试或把局限写进报告**；只有安装失败且无等效路径才降级并附证据。
> - **Python**：ruff/flake8 → mypy → `python -m py_compile <本次改动 .py>` + `python -m pytest <本次改动 tests/*.py>`
> - **Dart/Flutter**：`flutter analyze`（改动文件）→ `flutter test <相关测试>`
> - **JS/TS**：eslint → `tsc --noEmit` → jest/vitest `<相关测试>`
> - **Java**：`mvn/gradle compile` → `mvn/gradle test -Dtest=<相关测试>`（无 maven 时 javac+JUnitCore 直跑）
> - **Go**：`go vet` → `go build` → `go test ./<相关包>`
> - **其他/未知**：用项目现有 CI/lint 命令；无则至少编译/语法检查本次改动源文件（先自愈再降级）。
> 原则不变（强制规则 #18）：**只跑本次改动相关验证，禁止全仓套件**。以下为 Python 示例。

```bash
# 并行启动 lint / type-check / 编译+本次相关测试（互不依赖，以下为 Python 示例）
PID_LIST=""
if command -v ruff &>/dev/null; then ruff check --fix . & PID_LIST="$PID_LIST $!"
elif command -v flake8 &>/dev/null; then flake8 . & PID_LIST="$PID_LIST $!"
elif command -v eslint &>/dev/null; then eslint . & PID_LIST="$PID_LIST $!"; fi

if command -v mypy &>/dev/null; then mypy . & PID_LIST="$PID_LIST $!"
elif command -v tsc &>/dev/null; then tsc --noEmit & PID_LIST="$PID_LIST $!"; fi

# 编译检查：只对本次改动源文件 py_compile（不跑完整套件）
# 归一化 .affected_files：去掉 "./" 前缀（git-bash grep 已产出正斜杠路径）
AF=$(cut -d'|' -f1 "$CODE_DIR/.affected_files" 2>/dev/null | sed 's|^\./||')
SRC_FILES=$(echo "$AF" | grep -E '\.py$' | grep -vE '^tests/' | sort -u | tr '\n' ' ')
if [ -n "$SRC_FILES" ]; then python -m py_compile $SRC_FILES & PID_LIST="$PID_LIST $!"; fi

# 本次改动相关测试：只跑 .affected_files 中 tests/*.py（禁止 pytest . 完整套件；
# 深度测试交给 /trellis-test；无相关测试则由 Step 4e 行为契约兜底）
TEST_FILES=$(echo "$AF" | grep -E '^tests/.*\.py$' | sort -u | tr '\n' ' ')
if [ -n "$TEST_FILES" ]; then
  python -m pytest $TEST_FILES -q & PID_LIST="$PID_LIST $!"
else
  echo "⚠️ 无显式相关测试文件 → 编译 + Step 4e 行为契约兜底（深度测试交 /trellis-test）"
fi

# 等待全部完成
FAILED=0
for pid in $PID_LIST; do wait $pid 2>/dev/null || FAILED=1; done
```

**修复循环**（有失败时改为串行）：
- 修复后**串行**重跑（因为修复一个可能影响另一个的结果）
- 最多 3 轮修复，超限则终止并输出未通过项

```bash
# 修复循环（串行，每轮确定各检查结果独立）
if [ "$FAILED" -eq 1 ]; then
  for round in 1 2 3; do
    # lint
    if command -v ruff &>/dev/null; then ruff check --fix . || true
    elif command -v flake8 &>/dev/null; then flake8 . || true; fi
    # type-check
    if command -v mypy &>/dev/null; then mypy . || true
    elif command -v tsc &>/dev/null; then tsc --noEmit || true; fi
    # test（本次改动相关测试，不跑完整套件）
    AF=$(cut -d'|' -f1 "$CODE_DIR/.affected_files" 2>/dev/null | sed 's|^\./||')
    TEST_FILES=$(echo "$AF" | grep -E '^tests/.*\.py$' | sort -u | tr '\n' ' ')
    if [ -n "$TEST_FILES" ]; then python -m pytest $TEST_FILES -q && echo "第 $round 轮相关测试通过" && break; fi
  done
fi
```

---

## edit 模式流程（5 阶段 → + Phase 6 清理）

A/B 实测显示 7 步流程过重，改为 5 阶段，聚焦质量结果：

```
Phase 1: 分析 (Analyze)      全局把控[fix-it-once] + 影响分析[codegraph/gitnexus 硬门禁] + 爆炸半径
Phase 2: 规划 (Plan)         Spec 检查 + 方案评估[Q1/Q2/Q3/Q4] + 变更计划
Phase 3: 执行 (Execute)      改代码 + 同步文档/配置 + 编译检查
Phase 4: 验证 (Verify)       一致性检查 + Spec 破坏验证 + 质量门禁 + 语义验证[强制]
Phase 5: 报告 (Report)       变更报告
→ Phase 6: 产物清理与暂存     删除中间产物，git add 有价值文件
```

### Phase 1: 分析

**入口**: 无（起始步骤）

#### Step 1a — 全局把控（fix-it-once，6 路并行搜索）
改代码前必须先画全貌，找出所有相关点，再动手。这是不可跳过的门禁。

**并行搜索（6 路子 Agent 同时发出，全部返回后合并结果）：**

```
并行：
  ├─ 子 Agent A（代码定义）: grep "<目标>" src/ --include="*.py" *.js *.ts *.kt *.dart *.go *.rs *.java *.swift *.c *.cpp *.h *.m *.mm
  ├─ 子 Agent B（配置文件）: grep "<目标>" *.yaml *.json *.toml *.env *.xml *.gradle* *.properties
  ├─ 子 Agent C（启动参数）: grep "<目标>" Dockerfile* *.service docker-compose.yml
  ├─ 子 Agent D（环境变量）: grep "<目标>" .env *.sh
  ├─ 子 Agent E（文档引用）: grep "<目标>" *.md *.rst *.html
  └─ 子 Agent F（测试引用）: grep "<目标>" tests/ --include="*"
```

**合并规则**：
- 所有 Agent 返回后，将输出写入 `$CODE_DIR/.all_references`
- 任一 Agent 失败不影响其他（失败的路标 "⚠️ 搜索失败"）
- 全部超时（>30s）后强终止，已返回的结果合并
- 小改动快速通道：≤2 文件且 ≤20 行 diff 时，跳过子 Agent 新建成本直接主 Agent 串行 grep

#### Step 1b — 明确修改目标
写入 `$CODE_DIR/.change_goal`:
```text
目标: <要修改的内容>
改动: <具体改动描述>
排除: <明确不改的范围>
症状宿主层级: <对照「验证层级分类表」判定症状住在哪一层 L1-L4。改 UI/窗口/时序前必须先用证据确认层级归属，禁止猜测归因层级>
根因测量: <性能/时序/L4 症状：带时间戳/计数的测量证据，证明真根因。多症状先归并为根因集 RC-A/B/C…，确认症状↔根因映射。无测量证据不得进入 Phase 2（强制规则 #22/#23）。原生/生命周期机制假设（消息循环/teardown/线程/OS）：必须附可观测机制证据（进程态检查/时间戳日志/原生 trace/判别项），禁止读代码推断机制（强制规则 #25）>
```

#### Step 1c — Codegraph/GitNexus 硬门禁（不可跳过，3 路并行）
必须先做范围验证，选出影响面最小的改法。没有跑影响分析之前，禁止进入 Phase 2。

> ⚠️ 以下所有 `<目标>`、`<目标符号>` 等占位符**必须替换为 `.change_goal` 中的实际值**再执行。直接运行含 `< >` 的命令将失败。

**并行影响分析（3 个 MCP 调用同时发出）：**

```
并行：
  ├─ mcp__codegraph__codegraph_explore(query="<目标符号>", projectPath=".")
  ├─ gitnexus impact(target="<目标符号>", direction="upstream")
  └─ gitnexus impact(target="<目标符号>", direction="downstream")
```

**合并规则**：
- 3 个调用全部返回后，合并结果写入 `$CODE_DIR/.blast_radius`
- 任一调用失败/超时 → 降级 grep 补查该路，报告标注「部分影响分析缺失」
- 全部降级 → 串行 grep 兜底搜索
- **项目无关**：无 codegraph/gitnexus 的项目，用项目可用代码检索（`rg`/`grep`/IDE 全局搜索/语言服务）完成同一影响分析；`$CODE_DIR/.blast_radius` 照写，报告标注「无索引，爆炸半径为文本级别」

#### Step 1d — 爆炸半径汇总
写入所有受影响位置，判断是否接受这个影响面。如果影响面过大（20+文件），回 Step 1b 重新评估方案。**先画全貌再动手**：在理解整个链路之前，不写一行代码。

```bash
grep -rn "<目标>" --include="*.py" --include="*.yaml" --include="*.json" . 2>/dev/null | while IFS=: read -r file line content; do
    echo "$file|引用|$content"
done > $CODE_DIR/.affected_files
sort -u $CODE_DIR/.affected_files > $CODE_DIR/.blast_radius
```

#### Step 1e — 功能边界确认（快速通道跳过）

**入口**: `$CODE_DIR/.change_goal` + `$CODE_DIR/.affected_files` 存在
**出口**: `$CODE_DIR/.boundary_decisions` 已写入
**出口 Goal**: `/goal 边界确认完成 — 用户已确认功能边界和影响范围`

**核心理念**: AI 已知爆炸半径，但在动手前必须与用户确认**功能层面的边界行为和副作用**，避免因未沟通的假设导致 bug。

**快速通道（≤3 个文件）**：跳过此 Step，不等待用户确认边界条件。AI 自行评估边界风险并记录到 `.boundary_decisions`。

**普通通道（>3 个文件）**：AI 读取 `.change_goal` 和 `.affected_files`，根据修改目标的参数、条件分支、数据流，**一次性列出所有问题**等待用户确认：

**1️⃣ 功能边界条件**
遍历修改涉及的所有输入和分支：
- 参数为空/null/0 时怎么处理？
- 集合为空/越界/特殊值时的行为？
- 枚举/状态值未覆盖的分支走哪个路径？

**2️⃣ 影响范围确认（基于爆炸半径）**
遍历 `.affected_files` 中的受影响模块：
- 这个修改会影响 X 功能，是否接受？需要同步调整吗？
- 接口签名变更后，所有调用方是否已覆盖？

AI 按实际代码上下文生成具体问题表格，用户一次性作答后写入 `$CODE_DIR/.boundary_decisions`：

```text
# 边界决策记录
## 功能边界
1. name 为空 → 提示"姓名不能为空"
2. age 为负数 → 抛参数校验异常
## 影响范围
1. UserService.login() 不受影响 → 接受
## 失败策略
1. 数据库失败 → 返回错误给调用方
## 默认行为
1. timeout 未传 → 默认 30 秒
```

### Phase 2: 规划

**入口**: `$CODE_DIR/.affected_files` 存在
**出口**: 用户已确认变更计划（含方案评估）
**出口 Goal**: `/goal 规划完成 — Q1/Q2/Q3/Q4 已评估，变更计划已确认，.spec_rules 已对照`

#### Spec 检查
```bash
if [ -f .trellis/scripts/get_context.py ]; then python .trellis/scripts/get_context.py --mode packages; fi
cat .trellis/spec/guides/index.md 2>/dev/null
```
提取相关规则到 `$CODE_DIR/.spec_rules`。

#### 方案评估（A/B 实测核心差异——不可跳过）

**这是 trellis-code 与不用 skill 的根本区别。不执行方案评估 = 没用 skill。**

```
Q1 — 替代方案对比: 列出至少 2 种方案，比较优劣，选最简单的
   方案A: <怎么做>   优势: <简洁/安全>  劣势: <复杂度>
   方案B: <怎么做>   优势: <简洁/安全>  劣势: <复杂度>
   结论: 选择 <方案>，因为 <理由>（必须写出理由）
   固有缺陷检查: 所选方案是否自带「本层修不掉」的固有缺陷？
       （如缩小主窗方案自带黑线/白屏/卡顿）→ 是则提示升级为架构变更，而非继续打补丁

Q2 — 连锁影响分析: 改完还有哪些文件需同步更新？
   代码: <文件列表>  测试: <文件列表>
   配置: <有/无>     文档: <有/无>
   类型定义: <有/无>

Q3 — 验证策略: 不改现有测试，怎么证明改对了？
   现有测试: <跑什么命令>
   新增场景: <列出 2-3 个测试点>
   边界条件: <至少 1 个>
   层级匹配: 对照「验证层级分类表」，本变更触及 L1-L4 哪层
   L4 证据计划: 触及 L4 时，列出所需实机证据 + 可执行实测步骤（交付用户）；
       若本轮无法产出证据 → 必须标记「⚠️ 未验证 · 需实测」并列入阻塞待办

   **行为契约（强制，不可跳过）**：
   必须列出至少 2 组「输入→预期输出」的可执行断言，写入 `$CODE_DIR/.behavior_contract`。格式示例：
   ┌───────┬────────────────────────┬──────────────────────────┐
   │ 契约  │ 输入                   │ 预期输出                  │
   ├───────┼────────────────────────┼──────────────────────────┤
   │ 契约1 │ {"name":"","age":25}   │ 抛异常"姓名不能为空"       │
   │ 契约2 │ {"name":"张三","age":25}│ {"success":true}          │
   │ 契约3 │ {"name":"张三","age":-1}│ 抛异常"年龄不能为负"       │
   └───────┴────────────────────────┴──────────────────────────┘
   行为契约覆盖原则：
   - 正常路径至少 1 条
   - 边界/异常路径至少 1 条
   - 如果改动涉及多个函数/接口，每个至少 1 条
   无行为契约 = Q3 未完成，不得进入变更计划展示。

Q4 — 可维护性/可测试性评估: 对比各方案对长期维护和测试成本的影响
   方案A: 对现有测试的影响  方案B: 新逻辑的可测试性
   测试成本: <不改测试 / 改签名 / 需重写测试>
   可测试性: <纯函数 / 依赖注入 / 耦合全局状态 / 并发锁安全>
   注释质量: <是否符合 Phase 3 注释标准：说"为什么"而非"是什么">
   结论: 选择 <方案>，因为 <维护收益>（必须写出理由）
```

#### 安全检查（关键词触发）
遍历 `.change_goal` 匹配关键词（auth/token/password/encrypt/injection/xss/cert/secret/permission/安全）：
- 未命中 → 跳过
- 命中 → spawn 子 Agent：
  ```
  输入: .change_goal + .affected_files
  输出: .security_concerns（风险点+建议）
  ```
  结果注入变更计划「安全注意事项」行。

#### 展示计划
```
## 变更计划
### 修改目标
<从 .change_goal 读取>
### 受影响文件
| 文件 | 操作 | 说明 |
### 方案评估
| 方案 | 复杂度 | 风险 | 选型 |
### 规范约束
<来自 .spec_rules>
### 安全注意事项
<来自 .security_concerns（无可略过）>
### 不改的范围
```
快速通道（≤3 个文件）：展示计划后直接进入 Phase 3 执行，不等用户确认。
普通通道（>3 个文件）：展示计划后等待用户确认再执行。

### Phase 3: 执行

**入口**: 计划已确认
**出口**: 代码已修改，编译/语法正确
**出口 Goal**: `/goal 执行完成 — 修改文件已写入，编译/语法正确，注释已添加`

原则：
1. **最小 diff** — 只改必要行，不重构无关代码，不加额外空行
2. **同步更新** — 改代码同时更新配置/文档（Phase 2 Q2 已列出）
3. **编译检查** — 改完后确认代码语法正确
4. **独立文件** → 子 Agent 并行；**单文件** → 主 Agent 直接改
5. **注释清晰** — 复杂逻辑必须写注释说明"为什么"，不写"是什么"
   - 一行注释应该解释：为什么这么做 / 边界条件 / 设计权衡
   - 不要写：注释重复代码行为（读代码就能知道的事）
   - 每个 public 函数/方法必须有目的性注释，好/坏示例：
     ```python
     # 好：说明目的和设计权衡
     def wait(self, timeout: float | None = None) -> bool:
         """阻塞等待令牌。轮询而非条件变量，因为补充基于时间非事件。"""
     
     # 坏：只重复签名信息
     def wait(self, timeout):
         """等待令牌，最多等 timeout 秒。"""
     ```
   - 好注释示例：
     ```python
     # 好：说明设计决策
     # 用 time.monotonic 而非 time.time，因为系统时间调整不影响单调时钟
     # 坏：重复代码行为
     # 获取当前时间
     now = time.monotonic()
     
     # 好：说明边界条件
     # 补充到 max_rps 为止，防止长时间积累导致突发流量
     # 坏：解释显而易见的代码
     # 取最小值和 max_rps
     self._tokens = min(self._tokens + new_tokens, self._max_rps)
     ```
6. **新增 vs 修改决策** — 按以下优先级：
   - 优先新增（新函数/新文件）：当逻辑与原模块职责无关，或在原模块加新功能但不改已有签名
   - 可修改：当修复 bug，或改动不可避免（如改配置参数名）
   - 禁止：为新增功能修改已有公共接口签名（除非 Q4 评估后确认收益大于成本）

子 Agent Prompt：
```
修改 <文件路径> 适配以下变更：
变更目标：<从 .change_goal>
spec 规则：<从 .spec_rules>
要求：只改相关行，保持代码风格，输出 diff
```

fix-it-once 心法：
1. 先确认你要改的是哪一行
2. 不要假设只有一处
3. 改接口签名时确保所有引用处统一更新
4. 配置/参数/环境变量都要查

自愈执行（Edit 失败的兜底方案）：
- 如果 Edit 工具因空白符/特殊字符匹配失败，自动切换方案：
  - 方案1：用更多上下文行确保唯一匹配
  - 方案2：用 Bash+Python 读取文件→content.replace()→写出
  - 方案3：用 Bash+sed（注意转义字符）
- 所有方案尝试过后仍失败才报告错误

执行确认（仅普通通道，快速通道跳过）：
```
修改的文件：<清单>
1. ✅ 正确，进入验证
2. 🔄 需要补充
```

### Phase 4: 验证（3 路并行）

**入口**: 变更已执行
**出口**: 一致性检查 + Spec 破坏验证 + 质量门禁 + 语义验证全部通过
**出口 Goal**: `/goal 验证通过 — 多点一致 ✅ Spec 合规 ✅ 门禁全部绿色 ✅ 行为验证 ✅`

**并行架构（3 路子 Agent 并行 + Step 4e 语义验证串行执行）：**

```
并行：
  ├─ 子 Agent A: 一致性检查 ─────────────────
  │    ├─ 残留定义扫描：遍历 .affected_files 中的符号，
  │    │   检查 src/ config/ 中是否仍有未同步的旧定义
  │    ├─ 数据流检查：[输入]→[节点A]→[节点B]→[输出]，
  │    │   各节点参数类型匹配
  │    └─ 输出: $CODE_DIR/.consistency_report
  │
  ├─ 子 Agent B: Spec 破坏验证 ─────────────
  │    ├─ 逐条对照 .spec_rules，判断本次变更是否破坏规则
  │    ├─ 无 .trellis/spec/ 时自动检测项目自有规范
  │    │   （CONTRIBUTING.md / STYLE_GUIDE.md / .editorconfig 等）
  │    └─ 输出: $CODE_DIR/.spec_audit_result
  │
  └─ 子 Agent C: 质量门禁 ──────────────────
       ├─ 并行运行 lint / type-check / test（见下方并行命令）
       ├─ 首轮通过则出口；有失败进入修复循环（最多 3 轮）
       └─ 输出: $CODE_DIR/.quality_gate_result

  └─ [可选] 子 Agent D: 安全检查 ──────────
       ├─ 仅在 .security_concerns 存在时启动
       ├─ 审查变更代码是否存在注入/权限/密码等风险
       └─ 输出: $CODE_DIR/.security_scan_result
```

**合并规则**：
- 全部返回后汇总到验证确认表（安全检查仅在有 .security_concerns 时纳入）
- 任一失败/超时 → 主 Agent 补跑该路，报告标注「部分验证跳过」
- 全部通过 → 出 "/goal 验证通过"
- 任一不合格 → 回到 Phase 3 补修，最多 2 轮循环

#### 质量门禁内部并行（3 个命令同时发出）

首轮运行时 lint / type-check / test 互不依赖，并行启动：

```bash
# 并行启动（& + wait），首轮允许同时跑
PID_LIST=""
ruff check --fix . &
RUFF_PID=$!
mypy . &
MYPY_PID=$!
# 编译 + 本次改动相关测试（不跑完整套件；深度测试交 /trellis-test）
AF=$(cut -d'|' -f1 "$CODE_DIR/.affected_files" 2>/dev/null | sed 's|^\./||')
SRC_FILES=$(echo "$AF" | grep -E '\.py$' | grep -vE '^tests/' | sort -u | tr '\n' ' ')
TEST_FILES=$(echo "$AF" | grep -E '^tests/.*\.py$' | sort -u | tr '\n' ' ')
if [ -n "$SRC_FILES" ]; then python -m py_compile $SRC_FILES & PID_LIST="$PID_LIST $!"; fi
if [ -n "$TEST_FILES" ]; then python -m pytest $TEST_FILES -q & PID_LIST="$PID_LIST $!"
else echo "⚠️ 无显式相关测试文件 → 由 Step 4e 行为契约兜底（深度测试交 /trellis-test）"; fi
wait $RUFF_PID $MYPY_PID $PID_LIST

# 检查各门禁结果
if [ $? -eq 0 ]; then echo "质量门禁: ✅ 全部通过"
else echo "质量门禁: ❌ 有失败，进入修复循环"
fi
```

**修复循环**（有失败时）：
- 修复后**串行**重跑（修复顺序可能互相影响，不能并行）
- 最多 3 轮，超限则终止并输出未通过项

#### Step 4d — 运行时验证（前端桥接）

_此步骤仅在检测到前端项目时执行，不影响其他类型项目_

检测条件（满足任一即视为前端项目）：
```bash
IS_FRONTEND=false
test -f package.json && grep -qiE '"react"|"vue"|"next"|"vite"|"angular"|"nuxt"|"svelte"' package.json 2>/dev/null && IS_FRONTEND=true
ls vite.config.* next.config.* vue.config.* nuxt.config.* 2>/dev/null | grep -q . && IS_FRONTEND=true
find src/ -name '*.jsx' -o -name '*.tsx' -o -name '*.vue' 2>/dev/null | grep -q . && IS_FRONTEND=true
```

如果是前端项目，调用 `Skill(trellis-frontend)` 做运行时验证。验证目标从 `.change_goal` 和当前变更的 `git diff` 自动推断。

trellis-frontend 返回后判断：

- **✅ 运行时验证通过**（无问题）→ 继续到验证确认，记入变更报告
- **❌ 有修复**（trellis-frontend 改了代码）→ **回到 Phase 4 开头**（一致性检查 → Spec 破坏验证 → 质量门禁 → Step 4d 重新桥接），确保修复不引入新问题。最多允许 **2 轮**完整循环，超限则终止并输出「运行时验证超限，需人工介入」

#### Step 4e — 语义验证（强制）

_此步骤不可跳过。快速通道（≤3 个文件）也必须执行。_

**入口**: 质量门禁已通过
**出口**: `$CODE_DIR/.behavior_verification` 已写入
**出口 Goal**: `/goal 语义验证完成 — 行为契约 N/N 通过`

先在 `$CODE_DIR/.behavior_contract` 中确认存在行为契约记录。然后对**每条契约**生成可执行验证脚本并运行：

```text
for each 契约 in $CODE_DIR/.behavior_contract:
  1. 根据契约中的"输入→预期输出"，生成验证脚本
     示例（Python）：
     # 契约1: name="" → 抛异常
     # try:
     #     result = your_function(name="", age=25)
     #     print("❌ 契约1 失败：期望异常但未抛出")
     # except ValueError as e:
     #     assert "姓名不能为空" in str(e)
     #     print("✅ 契约1 通过")
     #
     # 契约2: 正常输入 → 成功
     # result = your_function(name="张三", age=25)
     # assert result == {"success": True}
     # print("✅ 契约2 通过")
  2. 运行验证脚本
  3. 记录通过/失败：
     通过 → 记入 $CODE_DIR/.behavior_verification
     失败 → 回到 Phase 3 修复，最多 2 轮
```

**自愈**：
- 如果因函数未导入/签名不匹配导致脚本运行失败，重试一次（修正 import/调用方式）
- 仍失败 → 标记「⚠️ 语义验证: 契约 N 无法执行（原因）」，继续不阻塞
- 全部无法执行 → 写入 `⚠️ 语义验证: 全部契约无法执行，需人工核实`

**实机契约（L4 层契约，强制规则 #20/#24）**：
- Q3 标记「触及 L4」的变更，行为契约须包含「实机契约」：给出用户可逐条执行的实测步骤（如"关闭主窗→截图确认便签渲染→点便签→确认主窗定位"）
- 实机契约**无法在无头环境执行**。Step 4e 不产出实机证据时，验证确认表必须记「实机验证: ⚠️ 未验证 · 需实测（阻塞待办）」，**不得标 ✅**
- 报告「待办」必须保留该阻塞项，直至用户实测通过才可清除
- **用词闭环（#24）**：实机 ⚠️ 时该轮不得以「完成」收尾——报告/总结只写「已编码落地 · 待实机验证」；实测通过后才清除阻塞项并允许转完成态
- **清除权在用户（#20）**：⚠️→✅ 的转换必须由用户在实测后的显式确认，AI 不得自行清除阻塞项或自行转 ✅

**合并规则**（与并行 3 路验证一同汇总）：
- Step 4e 的执行独立于 3 路子 Agent 并行验证（先等并行完成，再执行 4e）
- 4e 的结果加入验证确认表的「行为验证」行

#### 验证确认
```
| 检查项 | 状态 |
|--------|------|
| 多点一致性 | ✅/❌ |
| 数据流完整性 | ✅/❌ |
| Spec 合规 | ✅/❌ |
| 可维护性 (Q4: 测试成本/注释) | ✅/❌ |
| 行为验证（Step 4e 语义验证） | ✅/⚠️/❌ |
| 实机验证（L4 证据，触及 L4 时必填） | ✅ 已实测 / ⚠️ 未验证·需实测（阻塞） |
| lint | ✅/❌ |
| type-check | ✅/❌ |
| test | ✅/❌ |
| 安全检查 | ✅/❌/—（无可略过） |
1. ✅ 全部通过
2. 🔄 修复
```

#### 质量自评（输出前必须执行）

对照 5 维度给本次变更自评打分（每个 1-10）：

| 维度 | 分值 | 说明 |
|------|------|------|
| 范围纪律 (Scope) | /10 | 只改必要文件，无 scope creep |
| 多点一致性 (Consistency) | /10 | 代码+测试+文档+配置同步更新 |
| 方案评估 (Alternatives) | /10 | Q1 比较了多种方案，选了最简单的 |
| 行为验证 (Behavior) | /10 | Q3 定义了行为契约，Step 4e 语义验证全部通过；**触及 L4 且实机验证为 ⚠️ 时封顶 ≤6**（总分必 <8.0，阻断宣称完成） |
| 可维护性 (Maintainability) | /10 | Q4 评估了测试成本，代码有清晰注释 |
| 测试覆盖 (Test) | /10 | 有测试场景 / 回归验证 |
| 文档同步 (Doc) | /10 | 更新了变更日志 / 文档 |

**目标：总分 ≥ 8.0，每项 ≥ 7.0。未达标则回到对应 Phase 补充。**

### Phase 5: 报告（中文）

**入口**: 质量门禁已通过
**出口**: `$CODE_DIR/change_report.md` 已写入且非空
**出口 Goal**: `/goal 报告已生成 — change_report.md 已写入，变更摘要+质量门禁+行为验证+待办齐全`

写入 `$CODE_DIR/change_report.md`：

```markdown
## 变更报告
### 一、变更摘要
- **任务**: <修改目标>  **文件**: N 个  **影响符号**: N 个
- **索引状态**: ✅ 索引已刷新 / ⚠️ 索引刷新失败（影响分析可能不完整）
### 二、Spec 合规 | 三、质量门禁 | 四、反模式检查 | 五、行为验证 | 六、待办
| 规则 | 状态 | | 检查项 | 结果 | | 散落定义 | 配置覆盖 | 链路断裂 | | 契约 | 结果 |
|------|------| |--------|------| |---------|---------|---------| |------|------|
|      |      | | 行为验证 | ✅/⚠️/❌ | |         |         |         | | 契约1 | ✅ |
|      |      | |          |      | |         |         |         | | 契约2 | ✅ |
|      |      | | 实机验证(L4) | ✅/⚠️ | |         |         |         | | 实机契约 | ⚠️ 待实测 |
```

> **测试范围**: 质量门禁只跑**编译 + 本次改动相关测试**（`.affected_files` 中 `tests/*.py`），**不跑完整套件**（强制规则 #18）。深度测试由 `/trellis-test` 负责，本报告不引用完整套件结果。

> **实机验证门禁（强制规则 #20）**：改动触及「验证层级分类表」L4 且本轮未产出实机证据 → 报告待办必须列「⚠️ 需实测」阻塞项，禁止在待办未清时宣称已完成。

> **报告用词门禁（强制规则 #24）**：触及 L4 且实机 ⚠️ 时，本报告摘要与任何总结/commit **禁止使用「已修复/已完成/搞定」**，只能写「已编码落地 · 待实机验证」。这是把 #20 从"应然"升级为"可检测"的硬约束——前四轮反复写"需实测"仍宣称已修好，是本次经验的核心教训。

### Phase 6: 产物清理与暂存（所有模式最终步骤）

**入口**: 所有 Phase/Step 已完成
**出口**: 中间产物已删除，有价值文件已 `git add` 待提交
**出口 Goal**: `/goal 产物清理完成 — 中间文件已删除，有价值文件已 git add`

在 Phase 5（报告）完成后，**最后一步**执行以下操作：

```bash
# 1. git add 有价值文件（保留到任务目录，放入暂存区）
#    优先级 P0 — 必须 git add
git add "$CODE_DIR/change_report.md" 2>/dev/null
#    优先级 P1 — 建议 git add（决策记录+行为契约，有审核价值）
git add "$CODE_DIR/.change_goal" 2>/dev/null
git add "$CODE_DIR/.boundary_decisions" 2>/dev/null
git add "$CODE_DIR/.behavior_contract" 2>/dev/null
git add "$CODE_DIR/.new_goal" 2>/dev/null

# 2. 删除中间产物（流程结束后不再需要）
#    Step 完成标记
rm -f "$CODE_DIR"/.step_*_done
#    分析产物（爆炸半径/影响分析缓存）
rm -f "$CODE_DIR"/.affected_*
rm -f "$CODE_DIR"/.blast_*
#    Spec 缓存
rm -f "$CODE_DIR"/.spec_rules
rm -f "$CODE_DIR"/.packages
#    变更跟踪
rm -f "$CODE_DIR"/.changed_files
rm -f "$CODE_DIR"/.consistency_report
rm -f "$CODE_DIR"/.behavior_verification
#    索引标记
rm -f "$CODE_DIR"/.index_stale

# 3. 验证清理结果
#    确保 $CODE_DIR 不为空（报告和决策文件应保留）
RETAINED=$(find "$CODE_DIR" -type f 2>/dev/null | wc -l)
if [ "$RETAINED" -gt 0 ]; then
    echo "✅ 保留文件数: $RETAINED（change_report.md + 决策记录）"
else
    echo "⚠️ 注意: $CODE_DIR 为空，请确认报告未丢失"
fi

# 数据污染检查（数据安全门禁 — 强制规则 19）：恢复被测试污染的运行时数据
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
rm -rf .trellis/tests/.data_backup 2>/dev/null || true
[ "$POLLUTED" -eq 1 ] && echo "数据安全门禁: ⚠️ 有污染已恢复（记入报告）" || echo "数据安全门禁: ✅ 运行时数据干净"

# 清理缓存（不留中间无效数据）
rm -rf .pytest_cache 2>/dev/null || true
find . -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
```

**清理后保留的文件结构**：
```
$CODE_DIR/
├── change_report.md          ← git add（P0）
├── .change_goal              ← git add（P1，变更目标记录）
├── .boundary_decisions       ← git add（P1，边界决策记录）
├── .behavior_contract        ← git add（P1，行为契约记录）
└── .new_goal                 ← git add（P1，仅 new 模式）
```

**出口 Goal**: `/goal 产物清理完成 — 中间文件已删除，有价值文件已 git add`

> **规则**：Phase 6 不可跳过。所有 edit 和 new 模式执行完后，最后必须执行 Phase 6。

---

## new 模式流程（7 步）

```
Step 0: 环境检测           git status + 索引强制刷新（刷新失败 → .index_stale）
Step 1: 需求确认           明确输入/输出/行为
Step 2: Spec 规范检查       读 .trellis/spec/ 约定
Step 3: 生成计划 + 行为契约  文件结构 + 接口签名 + 行为契约 → 用户确认
Step 4: 并行生成代码        子 Agent 按文件并行生成
Step 5: 质量门禁 + 语义验证  lint/type/test + 一致性检查 + 运行行为契约
Step 6: 生成报告（中文）
→ Phase 6: 产物清理与暂存   删除中间产物，git add 有价值文件（见上文 Phase 6）
```

### Step 0: 环境检测

见共用 Step 0：环境检测。

### Step 1: 需求确认

**入口**: 环境就绪
**出口**: `$CODE_DIR/.new_goal` 写入需求
**出口 Goal**: `/goal 需求已确认 — .new_goal 已写入，含输入/输出/行为/不做范围`

从用户输入提取：

```text
## 新代码目标
<一句话描述>

## 输入
<输入参数/格式/来源>

## 输出
<输出内容/格式/去向>

## 行为
<核心逻辑描述>

## 不做的范围
<明确排除>
```

写入 `$CODE_DIR/.new_goal`。

### Step 2: Spec 规范检查

见共用 Step 2：Spec 规范检查。重点读命名规范、项目结构、错误处理规范。

### Step 3: 生成计划

**入口**: `$CODE_DIR/.new_goal` + `.spec_rules` 存在
**出口**: 用户已确认生成计划（含行为契约）
**出口 Goal**: `/goal 生成计划已确认 — 文件结构+接口签名+行为契约已确认，.spec_rules 已对照`

展示（具体示例）：
```text
## 生成计划

### 文件结构
| 文件 | 用途 |
|-----|------|
| src/utils/chunk.py | 主函数 chunk_list(items, size) → list[list[T]] |
| tests/test_chunk.py | 单元测试（正常/边界/异常） |

### 接口签名
def chunk_list[T](items: list[T], size: int) -> list[list[T]]:
    ...

### 必须遵守的规范
- 规则1: 函数必须加类型注解
- 规则2: 文件名用小写+下划线

### 行为契约
- 契约1: chunk_list([1,2,3,4,5], 2) → [[1,2],[3,4],[5]]
- 契约2: chunk_list([], 3) → []
- 契约3: chunk_list([1,2], 0) → []

✅ 确认 → 进入生成 / 🔄 修改 / ❌ 取消
```

### Step 4: 并行生成代码

**入口**: 用户已确认生成计划
**出口**: 所有文件已生成
**出口 Goal**: `/goal 代码生成完成 — 所有文件已生成，编译/语法正确，无 TODO 残留`

按文件分组，每个独立文件启动子 Agent 生成：

```
子 Agent Prompt 模板：
---
你的任务：生成 <文件路径>

需求：
<从 .new_goal 读取>

遵守以下规范：
<从 .spec_rules 读取>

要求：
1. 遵循项目现有代码风格
2. 完整实现，不留 TODO
3. 包含类型注解/类型签名
4. 处理错误和边界情况
5. 生成完成后输出文件摘要
---

子 Agent 输出示例：
```python
# src/utils/chunk.py
from typing import TypeVar

T = TypeVar("T")

def chunk_list(items: list[T], size: int) -> list[list[T]]:
    """将列表按指定大小分块。"""
    if size <= 0:
        return []
    return [items[i:i+size] for i in range(0, len(items), size)]
```

#### 4d 用户确认点

```text
## 生成结果

已生成的文件：
- src/utils/chunk.py (15 行)
- tests/test_chunk.py (30 行)

1. ✅ 正确，进入质量门禁（Step 5）
2. 🔄 需要修改
3. ❌ 取消
```
```

### Step 5: 质量门禁

**入口**: 代码已生成
**出口**: lint/type/test 全部通过，行为契约语义验证通过，额外检查全部通过
**出口 Goal**: `/goal 质量门禁通过 — lint/type/test 全部绿色 + 行为契约全部通过，新代码风格一致无死代码`

见共用 Step 6：质量门禁。

语义验证（new 模式专属）：运行 `$CODE_DIR/.behavior_contract` 中的行为契约，验证新代码输出是否符合预期。遵循 Phase 4 Step 4e 的验证规则。

额外检查（new 模式专属）：
- [ ] 新代码与项目现有风格一致
- [ ] 没有死代码/未使用导入
- [ ] 命名符合项目规范
- [ ] 文件放到了正确的目录

### Step 6: 生成报告（中文）

**入口**: 质量门禁已通过
**出口**: `$CODE_DIR/change_report.md` 已写入且非空
**出口 Goal**: `/goal 报告已生成 — change_report.md 含生成摘要+文件清单+spec合规+质量门禁+行为验证`

写入 `$CODE_DIR/change_report.md`：

```markdown
## 代码生成报告

### 一、生成摘要
- **任务**: <需求描述>
- **分支**: <当前分支>
- **Commit**: <HEAD hash>

### 二、生成的文件
| 文件 | 行数 | 说明 |
|-----|------|------|
| src/new_module.py | 120 | 主逻辑 |
| tests/test_new_module.py | 45 | 单元测试 |

### 三、Spec 合规
| 规则 | 状态 |
|------|------|
| 命名规范 | ✅ 通过 |

### 四、质量门禁
| 检查项 | 结果 |
|--------|------|
| lint | ✅ 通过 |
| type-check | ✅ 通过 |
| test | ✅ 通过 |

### 五、行为验证
| 契约 | 输入 | 预期输出 | 实际结果 | 状态 |
|------|------|---------|---------|------|
| 契约1 | {"name":"","age":25} | 异常"姓名不能为空" | 抛异常 ✅ | ✅ |
| 契约2 | {"name":"张三","age":25} | {"success":true} | {"success":true} | ✅ |

### 六、未完成事项
<无则写「无」>
```

### → Phase 6: 产物清理与暂存

执行上文的 **[Phase 6: 产物清理与暂存](#phase-6-产物清理与暂存所有模式最终步骤)**，删除中间产物、`git add` 有价值文件。

---

## 反模式速查（继承 fix-it-once）

| 反模式 | 表现 | 在本技能中的防护 |
|--------|------|----------------|
| **散落定义** | 同一参数多处定义 | Step 1d 多点检测 + Step 5a 一致性验证 |
| **配置覆盖** | 代码改了，被 systemd 参数覆盖 | Step 1d 扫描启动参数 |
| **多副本** | 本地改了，别处没同步 | Step 1d 扫描所有同类文件 |
| **缓存干扰** | 改了但返回旧值 | Step 5 验证实际生效值 |
| **静默失败** | 中间节点失败不报错 | Step 5b 数据流检查 |
| **链路断裂** | 上游改了下游不兼容 | Step 5b 上下游参数匹配 |
| **Scope Creep** | 改目标外代码 | 强制规则 #6 |
| **Spec 违规** | 不遵守项目规范 | Step 2 规范检查 + Step 5c 合规验证 |
| **语义错误** | AI 自认为改对了，但实际逻辑与预期不符 | Phase 2 Q3 行为契约 + Phase 4 Step 4e 语义验证 |
| **层级归因错** | 症状在窗口/原生/OS 层，却当 Flutter 绘制层修 | Step 1b 症状宿主层级 + 验证层级分类表 |
| **无头验证冒充通过** | 编译+单测全绿就宣称已修好真实环境 bug | L4 实机证据门禁（强制规则 #20） |
| **症状锚定/补丁式修复** | 被用户症状表述带偏（"联网卡"=网络）、一个症状一个补丁 | 强制规则 #23：多症状归并根因集 + 不信任症状=根因，用证据确认 |
| **无测量硬修性能** | 性能/时序 bug 不 profile 直接改绘制/参数层 | 强制规则 #22：profile-first 测量先行 |
| **完成态冒充** | 实机 ⚠️ 却说"已修复/已完成/搞定" | 强制规则 #24 报告用词门禁：只能「已编码落地 · 待实机验证」 |
| **机制推断当实证** | 根因假设依赖原生/生命周期机制时，靠读代码推断"为什么会这样"而不给可观测证据 | 强制规则 #25：机制假设必须带可观测证据 + 二选一判别项 |

---

## 调试心法（继承 fix-it-once）

1. **不要急着改代码** → 先跑 Step 1 画全貌
2. **不要假设只有一处** → 搜索整个项目
3. **不要相信改了就生效** → 跑 Step 5 验证 + Step 4e 语义验证
4. **不要只改代码** → 配置/参数/环境变量都要查
5. **不要只看终点** → 链路每个节点都验证
6. **不要相信 lint 通过就对了** → lint 不抓逻辑错误，行为契约才是语义正确的保险
7. **不要相信编译+单测全绿就对了** → 窗口/原生/时序/网络/性能类 bug 只暴露在真实环境，触及这些层必须实测或标「⚠️ 未验证」
8. **不要凭症状直接修性能** → 先带时间戳 profile 测量定位真根因（强制规则 #22）
9. **不要一个症状一个补丁** → 多症状归并为根因集一次修，不信任用户症状表述=根因（强制规则 #23）
10. **不要实机未测就说"修好了"** → 报告用词门禁：只能「已编码落地 · 待实机验证」（强制规则 #24）
11. **不要推断运行时机制** → 根因假设涉及原生/生命周期/消息循环/teardown 时，先给可观测机制证据（进程态/时间戳日志/判别项）再修（强制规则 #25）

---

## 边界条件

| 场景 | 处理 |
|------|------|
| 无 Trellis spec | Step 2 跳过 spec 检查，仅做影响分析和一致性验证 |
| 无 codegraph 索引 | 跳过刷新直接降级 grep + 写入 `.index_stale`，报告说明「无 codegraph，影响分析基于文本搜索」 |
| 无 gitnexus 索引 | 跳过刷新直接降级 codegraph + grep + 写入 `.index_stale`，报告说明「无 gitnexus，爆炸半径为文本级别」 |
| 索引刷新失败 | 写入 `.index_stale`，降级到 grep，Step 1c 硬门禁标注「索引可能过期，爆炸半径不完整」 |
| 构建/测试运行器缺失（mvn/gradle/npm/pytest 等） | 按强制规则 #26 先自愈：winget/choco/scoop 安装或官方/镜像下载 zip，或改用等效直接运行器（Java 无 maven 用 javac+JUnitCore 直跑）；JDK 版本不匹配时下载对应 JDK 或加 --add-opens/MAVEN_OPTS；仅安装失败且无等效路径才降级并附证据 |
| 无受影响文件 | 提示用户「未找到相关文件，请确认修改目标」 |
| 单个文件修改 | 跳过子 Agent 并行，主 Agent 直接修改 |
| 并行子 Agent 部分失败 | 失败路标记「⚠️」合并已返回结果，不阻塞其他路 |
| 并行子 Agent 全部超时 | 终止并行，降级为串行执行，报告标注「并行超时降级串行」 |
| 质量门禁 3 轮修复不过 | 终止并输出未通过项，请求用户人工介入 |
| 并行验证结果不一致 | 以主 Agent 补跑结果为准，不一致记入报告待办 |
| 质量门禁 3 轮修复不过 | 终止并输出未通过项，请求用户人工介入 |
| .trellis/ 不存在 | 降级为纯 fix-it-once 模式（grep+手动检查） |
| 非 Trellis 项目（无 .trellis/ 无 codegraph/gitnexus） | 流程不变，工具降级：输出目录用项目下 `./.code_changes/`；影响分析用项目可用检索（rg/grep/IDE）；质量门禁按语言自适应（见共用 Step 6）；数据安全自动识别项目运行时数据（见强制规则 #19）。**不因缺 Trellis 生态而跳过 Phase** |
| 用户取消变更计划 | 终止，不清除分析产物供后续参考 |
| 一致性验证发现遗漏 | 回到 Step 4 补充修改，最多 2 轮循环 |
| 行为契约无法生成（纯 UI 改动/无输入输出函数） | 放宽要求，至少描述页面状态变化作为契约 | 报告标注「行为契约：基于 UI 状态变更描述」 |
| 语义验证失败（契约运行不通过） | 回到 Phase 3 修复，最多 2 轮 | 2 轮仍失败则终止，输出未通过契约清单 |
| 修改目标不明确 | Step 1a 时追问用户，不猜测 |
| 大范围修改（20+文件） | 分批提交，每批跑一次完整流程 |
| Windows 环境编码问题 | 所有 Python 操作显式指定 encoding="utf-8" |
| 用户想回滚变更 | git checkout -- 恢复，报告标注「已回滚」 |
| 改动触及 L4 且无法无头实测 | 验证确认表标「⚠️ 未验证 · 需实测」为阻塞待办，交用户实测；实测通过前禁止宣称已完成 |

---

## 完整示例（edit 模式）

以「把硬编码超时改为环境变量可配」为例走一遍完整流程：

```
用户输入: "把项目中所有硬编码的 API 超时 30 秒改为可配置参数"

Step 1 影响分析:
  1a. 修改目标: TIMEOUT=30 → os.getenv("TIMEOUT_SECONDS", 30)
  1b. mcp__codegraph__codegraph_explore(query="TIMEOUT", projectPath=".")
      → src/config.py:10 定义、init_app():15 调用、load_config():22 调用
  1c. gitnexus impact(TIMEOUT, upstream) → main→init_app
      gitnexus impact(TIMEOUT, downstream) → load_config→_request
  1d. grep -rn "TIMEOUT\|timeout=30" .env config.yaml src/
      → .env: TIMEOUT=30, config.yaml: timeout: 30
      → .affected_files: [src/config.py, .env, config.yaml]

Step 2 Spec 检查:
  cat .trellis/spec/guides/index.md → 「配置参数必须在 .env 定义」
  .spec_rules: 1 条强制

Step 3 变更计划 + 行为契约:
  Q3 — 行为契约:
    契约1: 设置 TIMEOUT_SECONDS=60 → os.getenv("TIMEOUT_SECONDS")
           返回 "60"  ✓
    契约2: 不设置 TIMEOUT_SECONDS → os.getenv("TIMEOUT_SECONDS",30)
           返回 "30"  ✓
  → 用户确认 ✓

Step 4 执行:
  子Agent1→src/config.py: `TIMEOUT=int(os.getenv("TIMEOUT_SECONDS",30))`
  子Agent2→.env: `TIMEOUT_SECONDS=30`
  Step4d 确认 ✓

Step 5 验证:
  5a: grep -rn "TIMEOUT=30" src/ → 无残留 ✓
  5b: config.py int → init_app int → load_config int → 类型链一致 ✓
  5c: .env 已添加 → spec 合规 ✓
  4e: 运行契约 → 契约1: TIME=60 → get 60 ✅ 契约2: unset → get 30 ✅
  Step5d 确认 ✓

Step 6: ruff check → mypy → py_compile + 本次相关测试 → 通过 ✓
Step 7: 变更报告 → 3文件修改、1条spec、门禁✅、行为验证 2/2 ✅
```
```

### 完整示例（new 模式）

```
用户输入: "帮我把列表按指定大小分块，放在 utils/ 下，要类型注解和测试"

Step 1 需求确认:
  输入: list[T], int → 输出: list[list[T]]
  边界: size<=0 返回空、空列表返回空

Step 2 Spec: Google Python 风格、文件放 src/utils/、函数名前缀 _

Step 3 计划 + 行为契约:
  契约1: chunk_list([1,2,3,4,5], 2) → [[1,2],[3,4],[5]]
  契约2: chunk_list([], 3) → []
  契约3: chunk_list([1,2], 0) → []
  → 用户确认 ✓

Step 4 生成: 子 Agent 并行生成 chunk.py + test_chunk.py
Step 5 门禁: ruff + mypy + py_compile + 本次相关测试 → 通过 ✓
  4e: 运行契约 → 3/3 全部通过 ✓
Step 6 报告: 2 文件 85 行、spec 合规 ✅、行为验证 3/3 ✅
```

---

## 口诀（继承 fix-it-once）

> **改之前画全貌，改之时查链路，改之后验完整。**
> **一处定义多处引，配置覆盖要查清。**
> **规范先读再动手，质量门禁把最后。**
> **行为契约不可少，预期验证堵漏洞。**

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