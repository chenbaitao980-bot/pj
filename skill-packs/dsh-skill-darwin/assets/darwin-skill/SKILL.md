---
name: darwin-skill
description: Autonomous skill optimizer inspired by Karpathy's autoresearch. Evaluates SKILL.md files using an 8-dimension rubric (structure + effectiveness), runs hill-climbing with git version control, and validates improvements through test prompts. Use when user mentions "优化skill", "skill评分", "自动优化", "auto optimize skills", "skill质量检查", "这个skill写得不好", "帮我改改skill", "skill怎么样", "提升skill质量", "skill review", "skill打分".
---

# 达尔文.skill

> 借鉴 Karpathy autoresearch 的自主实验循环，对 skills 进行持续优化。
> 核心理念：**评估 → 改进 → 实测验证 → 人类确认 → 保留或回滚**

---

## 设计哲学

autoresearch 的精髓：
1. **单一可编辑资产** — 每次只改一个 SKILL.md
2. **双重评估** — 结构评分（静态分析）+ 效果验证（跑测试看输出）
3. **棘轮机制** — 只保留改进，自动回滚退步
4. **独立评分** — 评分用子agent，避免「自己改自己评」的偏差
5. **自动继续** — 计划确认后自动执行全程，不被用户确认打断
6. **用户控制权** — 用户随时可以叫停检查中间结果，但流程不主动等待

与纯结构审查的区别：不只看 SKILL.md 写得规不规范，更看改完后**实际跑出来的效果是否更好**。

---

## 评估 Rubric（9维度，总分100）

### 结构维度（65分）— 静态分析

| # | 维度 | 权重 | 评分标准 |
|---|------|------|---------|
| 1 | **Frontmatter质量** | 8 | name规范、description包含做什么+何时用+触发词、≤1024字符 |
| 2 | **工作流清晰度** | 12 | 步骤明确可执行、有序号、每步有明确输入/输出 |
| 3 | **边界条件覆盖** | 8 | 处理异常情况、有fallback路径、错误恢复 |
| 4 | **检查点设计** | 7 | 关键决策前有用户确认、防止自主失控 |
| 5 | **指令具体性** | 13 | 不模糊、有具体参数/格式/示例、可直接执行 |
| 6 | **资源整合度** | 5 | references/scripts/assets引用正确、路径可达 |
| 7 | **自愈能力** | 12 | 流程中任意 Step 失败能自动恢复或明确终止，不静默产生错误结果 |

### 效果维度（35分）— 需要实测

| # | 维度 | 权重 | 评分标准 |
|---|------|------|---------|
| 8 | **整体架构** | 12 | 结构层次清晰、不冗余不遗漏、与花叔生态一致 |
| 9 | **实测表现** | 23 | 用测试prompt跑一遍，输出质量是否符合skill宣称的能力 |

### 评分规则
- 维度1-7：每个维度打 1-10 分，乘以权重得到该维度得分
- 维度8-9（实测表现）：跑2-3个测试prompt，按输出质量打1-10分
- **总分 = Σ(维度分 × 权重) / 10**，满分100
- 改进后总分必须 **严格高于** 改进前才保留

### 关于「实测表现」维度

这是与纯结构评分最大的区别。评分方式：

1. 为每个skill设计2-3个**典型用户prompt**（不是边缘case，是最常见的使用场景）
2. 用子agent执行：一个带skill跑，一个不带skill跑（baseline）
3. 对比输出质量，从以下角度打分：
   - 输出是否完成了用户意图？
   - 相比不带skill的baseline，质量提升明显吗？
   - 有没有skill引入的负面影响（过度冗余、跑偏、格式奇怪）？

如果无法跑子agent（时间/资源限制），可以退化为「干跑验证」：读完skill后模拟一个典型prompt的执行思路，判断流程是否合理。但要在results.tsv中标注 `dry_run`。

---

## 自主优化循环

### Phase 0: 初始化

**入口**: 用户已指定优化范围
**出口**: `$SKILL_DIR/` 已确定，`results.tsv` 已就绪
**出口 Goal**: `/goal Phase 0 完成 — 优化范围已确认，results.tsv 已就绪`

```
1. 确认优化范围：
   - 全部skills → 扫描 .claude/skills/*/SKILL.md
   - 指定skills → 用户指定列表
2. 初始化 results.tsv（如不存在）
3. 读取现有 results.tsv 了解历史优化记录
4. 输出 /goal Phase 0 完成
```

### Phase 0.5: 测试Prompt设计

**入口**: Phase 0 已完成，优化范围已确认
**出口**: 所有 skill 的 `test-prompts.json` 已生成
**出口 Goal**: `/goal Phase 0.5 完成 — 测试 prompt 已设计并展示给用户`

在评估之前，为每个skill设计测试prompt。这步很关键——没有测试prompt，「实测表现」维度就打不了分。

```
for each skill:
  1. 读取 SKILL.md，理解它做什么
  2. 设计2-3个测试prompt，覆盖：
     - 最典型的使用场景（happy path）
     - 一个稍复杂或有歧义的场景
  3. 保存到 skill目录/test-prompts.json：
     [
       {"id": 1, "prompt": "用户会说的话", "expected": "期望输出的简短描述"},
       {"id": 2, "prompt": "...", "expected": "..."}
     ]
```

展示所有测试prompt给用户。展示后直接进入 Phase 1**（不等待用户确认，计划阶段已确认过了）**，除非用户明确要求修改测试prompt。

### Phase 1: 基线评估（Baseline）

**入口**: `test-prompts.json` 已存在
**出口**: `results.tsv` 已写入基线行
**出口 Goal**: `/goal Phase 1 完成 — 基线评分卡已展示，直接进入 Phase 2 优化循环`

```
for each skill in 优化范围:

  # 结构评分（主agent可以做）
  1. 读取 SKILL.md 全文
  2. 按维度1-7逐项打分（附简短理由）

  # 效果评分（用子agent做，独立于主agent）
  3. 对每个测试prompt，spawn子agent：
     - with_skill: 带着SKILL.md执行测试prompt
     - baseline: 不带skill执行同一prompt
  4. 对比两组输出，打维度8的分

  # 汇总
  5. 计算加权总分
  6. 记录到 results.tsv
```

**如果子agent不可用**（超时、环境限制），维度8用干跑验证打分，标注 `dry_run`。不要因为跑不了测试就跳过这个维度——哪怕是模拟推演也比完全不看效果好。

基线评估完成后，展示评分卡：

```
┌──────────────────────────┬───────┬──────────────┬──────────────┐
│ Skill                    │ Score │ 结构短板      │ 效果短板      │
├──────────────────────────┼───────┼──────────────┼──────────────┤
│ huashu-proofreading      │ 78    │ 边界条件      │ 测试prompt2  │
│ huashu-slides            │ 72    │ 指令具体性    │ baseline持平  │
├──────────────────────────┼───────┼──────────────┼──────────────┤
│ 平均                     │ 75    │              │              │
└──────────────────────────┴───────┴──────────────┴──────────────┘
```

展示评分卡后**直接进入 Phase 2 优化循环**，无需等待用户确认（优化方案已在计划阶段确认）。

### Phase 2: 优化循环

**入口**: Phase 1 基线评分已完成
**出口**: 所有 skill 优化完毕，`results.tsv` 已更新
**出口 Goal**: `/goal Phase 2 完成 — 所有 skill 优化完毕，棘轮机制已执行`

按基线分数从低到高排序，先优化最弱的。

```
for each skill:
  round = 0
  while round < MAX_ROUNDS (默认3):
    round += 1

    # Step 1: 诊断
    找出得分最低的维度（结构或效果都算）
    → Step 1 出口: /goal 已诊断，最低维度: <维度名>

    # Step 2: 提出改进方案
    针对最低维度，生成1个具体改进方案：
      - 改什么（具体段落/行）
      - 为什么改（对应rubric哪条）
      - 预期提升多少分
    → Step 2 出口: /goal 改进方案已设计: <方案摘要>

    # Step 3: 执行改进
    编辑 SKILL.md
    git add + commit（message: "optimize {skill}: {改进摘要}"）
    → Step 3 出口: /goal 变更已提交 <commit hash>

    # Step 4: 重新评估
    - 结构维度：主agent重新打分
    - 效果维度：spawn独立子agent重跑测试prompt（关键！不能自己评自己）
    → Step 4 出口: /goal 重新评估完成 — 新总分 <分数>

    # Step 5: 决策
    if 新总分 > 旧总分:
      status = "keep"，更新旧总分
    else:
      status = "revert"
      git revert HEAD（创建新commit回滚，不用reset --hard）
      记录失败尝试到 results.tsv
      break  # 该skill到瓶颈，跳到下一个
    → Step 5 出口: /goal 决策完成 — status=<keep|revert>

    # Step 6: 日志
    results.tsv 追加行
    → Step 6 出口: /goal 日志已记录

  # === 每个skill优化后的摘要展示（不等待确认） ===
  展示该skill的改动摘要：
    - git diff（改前 vs 改后）
    - 分数变化（哪些维度提升/下降）
    - 测试prompt输出对比（如果跑过的话）
  
  展示后直接继续下一个skill**（不等待用户确认，除非用户明确叫停）**。
  摘要信息会留在对话记录中供用户随时查阅。
```

### Phase 2.5: 探索性重写（可选）

**入口**: 连续 2 个 skill 在 round 1 break（hill-climbing 瓶颈）
**出口**: 重写版已评估并决策（保留或恢复）
**出口 Goal**: `/goal Phase 2.5 完成 — 探索性重写已决策`

当 hill-climbing 连续2个skill都在 round 1 就 break（涨不动）时，提议一次「探索性重写」：

```
1. 选一个瓶颈skill
2. git stash 保存当前最优版本
3. 从头重写SKILL.md（不是微调，是重新组织结构和表达方式）
4. 重新评估
5. if 重写版 > stash版: 采用重写版
   else: git stash pop 恢复
```

这解决了 hill-climbing 的局部最优问题——有时候需要「先拆后建」才能突破瓶颈。
向用户说明后自动执行**（无需等待确认，用户可在结果不如意时叫停）**。

### Phase 3: 汇总报告

**入口**: 所有 skill 优化完毕（Phase 2 或 2.5 已完成）
**出口**: 优化报告已展示
**出口 Goal**: `/goal Phase 3 完成 — 优化报告已展示，整个优化流程结束`

```
## 优化报告

### 总览
- 优化skills数：N
- 总实验次数：M
- 保留改进：X（Y%）
- 回滚次数：Z
- 实测验证：A次完整测试 / B次干跑

### 分数变化
┌──────────────────────────┬────────┬────────┬────────┐
│ Skill                    │ Before │ After  │ Δ      │
├──────────────────────────┼────────┼────────┼────────┤
│ huashu-proofreading      │ 78     │ 87     │ +9     │
│ huashu-slides            │ 72     │ 83     │ +11    │
├──────────────────────────┼────────┼────────┼────────┤
│ 平均                     │ 75     │ 85     │ +10    │
└──────────────────────────┴────────┴────────┴────────┘

### 主要改进
1. [skill-A] 补充了边界条件处理，测试输出质量提升明显
2. [skill-B] 重组了workflow结构，baseline对比优势增大
```

---

## results.tsv 格式

```tsv
timestamp	commit	skill	old_score	new_score	status	dimension	note	eval_mode
2026-03-31T10:00	baseline	huashu-proofreading	-	78	baseline	-	初始评估	full_test
2026-03-31T10:05	a1b2c3d	huashu-proofreading	78	84	keep	边界条件	补充fallback	full_test
2026-03-31T10:10	b2c3d4e	huashu-proofreading	84	82	revert	指令具体性	过度细化	dry_run
```

新增 `eval_mode` 列：`full_test`（跑了子agent测试）或 `dry_run`（模拟推演）。
文件位置：`.claude/skills/auto-optimize-results.tsv`

---

## 优化策略库

按优先级排序，每轮只做最高优先级的一个：

### P0: 效果问题（实测发现的）
- 测试输出偏离用户意图 → 检查skill是否有误导性指令
- 带skill比不带还差 → skill可能过度约束，考虑精简
- 输出格式不符合预期 → 补充明确的输出模板
- **目标技能缺少强制规则** → 补充强制规则区块和入口/出口检查（这是每轮优化的第一优先级！）
- **目标技能缺少自愈能力** → 补充自愈规则、Step 输出验证、编码安全保护（第二优先级！）

### P1: 结构性问题
- Frontmatter缺少触发词 → 补充中英文触发词
- 缺少Phase/Step结构 → 重组为线性流程
- 缺少用户确认检查点 → 在关键决策处插入

### P2: 具体性问题
- 步骤模糊（"处理图片"）→ 改为具体操作和参数
- 缺少输入/输出规格 → 补充格式、路径、示例
- 缺少异常处理 → 补充 "如果X失败，则Y"

### P3: 可读性问题
- 段落过长 → 拆分+用表格
- 重复描述 → 合并去重
- 缺少速查 → 添加TL;DR或决策树

---

## 约束规则

1. **不改变skill的核心功能和用途** — 只优化"怎么写"和"怎么执行"，不改"做什么"
2. **不引入新依赖** — 不添加skill原本没有的scripts或references文件
3. **每轮只改一个维度** — 避免多个变更导致无法归因
4. **保持文件大小合理** — 优化后SKILL.md不应超过原始大小的150%
5. **尊重花叔风格** — 中文为主、简洁为上
6. **可回滚** — 所有改动在git分支上，用git revert而非reset --hard
7. **评分独立性** — 效果维度必须用子agent或至少干跑验证，不能在同一上下文里「改完直接评」

### 核心规则：优化时必须给目标技能加「强制规则」

这是达尔文优化其他技能时的**必须操作**，不是可选项：

```
每次优化一个技能时，必须在该技能的 SKILL.md 中添加以下内容：

1. 顶部「强制规则」区块（参考 trellis-test 的格式）：
   - 必须按 Step/Phase 顺序执行，不允许跳过
   - 每个 Step/Phase 的入口/出口检查条件
   - AI 不得以任何理由跳过流程
   - 违反后果

2. 必须在每个关键 Step/Phase 加入口/出口检查：
   - 入口：前置条件（上一步的输出必须存在）
   - 出口：本步的产出物必须存在（文件/用户确认等）

3. 必须在「用户确认」点加硬性规则：
   - AI 不能自行决定跳过等待用户回复
   - 用户不确认不能进入下一步

4. 如果被优化的技能原本有流程描述但缺少强制规则，
   达尔文必须在第一轮优化时补上强制规则。

5. **自愈能力是强制规则的一部分**：补充强制规则时，必须同时包含：
   - 每个 Step 完成后验证输出物的要求（文件存在、内容非空等）
   - 验证失败时的自愈尝试（重试、fallback、明确终止）
   - 编码安全保护（Windows 环境必须显式指定 encoding）
   - 在优化评估中考核自愈维度（维度7）
```

这条规则与「不改变skill的核心功能和用途」不冲突——加强制规则是优化"可执行性"，不是改变功能。

---

## 使用方式

### 全量优化（推荐首次使用）
```
用户："优化所有skills"
→ Phase 0-3 完整流程
→ 建议：先基线评估，选择分数最低的5-10个重点优化
```

### 单个优化
```
用户："优化 huashu-slides 这个skill"
→ 只对指定skill执行 Phase 0.5-2
```

### 仅评估不改
```
用户："评估所有skills的质量"
→ 只执行 Phase 0.5-1（设计测试prompt + 基线评估），不进入优化循环
```

### 查看历史
```
用户："看看skill优化历史"
→ 读取并展示 results.tsv
```

---

## 设计灵感

> "You write the goals and constraints in program.md; let an agent generate and test code deltas indefinitely; keep only what measurably improves the objective."
> — Karpathy, autoresearch

本skill的对应关系：
- **program.md** → 本文件（评估rubric和约束规则）
- **train.py** → 每个SKILL.md
- **val_bpb** → 8维加权总分（含实测表现）
- **git ratchet** → 只保留有改进的commit
- **test set** → 每个skill的test-prompts.json

区别：增加了人在回路（autoresearch是全自主的，skill优化需要人的判断力），以及双重评估机制（结构+效果），因为skill的「好坏」比loss数值更微妙。
