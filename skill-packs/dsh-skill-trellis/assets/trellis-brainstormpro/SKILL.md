---
name: trellis-brainstormpro
description: "Guides collaborative requirements discovery before implementation, WITH a mandatory Expected Results Gate. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, converges on MVP scope, then REQUIRES computing a verifiable expected-results checklist (numbers/evidence, read-only — may query servers/DBs but never modify prod data) and getting user sign-off before any implementation. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task. Trigger words: 需求梳理, brainstorm, 需求不确定, 方案怎么定."
---

# Brainstorm PRO - Requirements Discovery (AI Coding Enhanced)

**CoreRule**: Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

---

## 强制规则（不可违反）

1. **必须按 Step 0→1→2→3→4→5→6→7→7.5→8 顺序执行**，任何理由不得跳步或重排。
2. **Step 7.5 预期结果计算是硬性门禁，不可跳过**：方案收敛后必须先算出「可核验的预期结果清单」并呈给用户确认，才能进入 Step 8 最终确认。算预期 ≠ 可选项。
3. **算预期必须只读**：允许查服务器、查库、查日志（SELECT / 只读视图 / LIMIT 样本 / 只读连接），**严禁修改生产数据**（禁止 UPDATE / DELETE / INSERT / DDL，禁止重启/停服务/写生产文件/改生产配置）。违反 = 本次调用无效。
4. **自愈而非降级**：环境不允许算预期（无法连库/无权限/无工具）时，必须先自愈（修连接/换只读账号/用历史快照/导出文件/本地等价测量），**禁止以「环境不可用」为由跳过预期计算**。全部自愈失败 → 明示「⚠️ 预期结果未计算（原因 + 已尝试的自愈）」，标记为阻塞项，禁止进入实现。
5. **预期结果必须是数字/可复现证据，不是文字承诺**：数据类给「基线 X → 目标 Y」，性能类给「P99 从 X → ≤Y」，功能类给「输入 X → 输出 Y」。
6. **每个 Step 必须验证输出物**：入口检查前置产物存在，出口检查本步产物已写入 PRD；验证失败先自愈重试一次，仍失败则明确终止并说明原因。
7. **用户确认是硬性检查点**：Step 7.5 预期清单确认、Step 8 最终确认，AI 不得自行跳过等待用户回复，用户不确认不能进入下一步。
8. **Windows 环境编码安全**：读写 PRD/日志/脚本显式指定 encoding（UTF-8），防中文乱码污染产物。
9. **违反以上任何一条 = 本次调用无效**，需要重新 `/trellis-brainstormpro`。

---

Guide AI through collaborative requirements discovery **before implementation**, optimized for AI coding workflows:

* **Task-first** (capture ideas immediately)
* **Action-before-asking** (reduce low-value questions)
* **Research-first** for technical choices (avoid asking users to invent options)
* **Diverge → Converge** (expand thinking, then lock MVP)
* **Expected-results-first** (before any implementation, compute and confirm a verifiable expected-results checklist)

---

## When to Use

Triggered from /trellis:start when the user describes a development task, especially when:

* requirements are unclear or evolving
* there are multiple valid implementation paths
* trade-offs matter (UX, reliability, maintainability, cost, performance)
* the user might not know the best options up front

Use `/trellis-brainstormpro` (instead of `/trellis-brainstorm`) whenever the task touches **data, performance, migration, batch jobs, or any change whose outcome can be quantified** — the expected-results gate is mandatory there.

---

## Core Principles (Non-negotiable)

1. **Task-first (capture early)**
   Always ensure a task exists at the start so the user's ideas are recorded immediately.

2. **Action before asking**
   If you can derive the answer from repo code, docs, configs, conventions, or quick research — do that first.

3. **One question per message**
   Never overwhelm the user with a list of questions. Ask one, update PRD, repeat.

4. **Prefer concrete options**
   For preference/decision questions, present 2–3 feasible, specific approaches with trade-offs.

5. **Research-first for technical choices**
   If the decision depends on industry conventions / similar tools / established patterns, do research first, then propose options.

6. **Diverge → Converge**
   After initial understanding, proactively consider future evolution, related scenarios, and failure/edge cases — then converge to an MVP with explicit out-of-scope.

7. **No meta questions**
   Do not ask "should I search?" or "can you paste the code so I can continue?"
   If you need information: search/inspect. If blocked: ask the minimal blocking question.

8. **Spec-conflict alert (mandatory)**
   During Auto-Context (Step 1), scan `.trellis/spec/**/*.md` for rules that conflict with the incoming requirement. If any conflict is found, **stop and surface it immediately** before asking any other question. The user must explicitly decide how to resolve it before brainstorming continues. Never silently proceed past a known spec conflict.

9. **Expected results first（预期结果先行，硬性）**
   Once the approach converges (Step 7), you MUST compute a verifiable expected-results checklist (numbers/evidence, not prose promises) and present it for user sign-off (Step 7.5) before the final confirmation (Step 8). Computing expected results is READ-ONLY: you may query databases / servers / logs, but must never modify production data. If the environment blocks the computation, self-heal (fix connection / read-only account / snapshot / export / local equivalent measurement) — never skip it. See 强制规则 #2/#3/#4.

---

## Step 0: Ensure Task Exists (ALWAYS)

Before any Q&A, ensure a task exists. If none exists, create one immediately.

* Use a **temporary working title** derived from the user's message.
* It's OK if the title is imperfect — refine later in PRD.

```bash
TASK_DIR=$(python ./.trellis/scripts/task.py create "brainstorm: <short goal>" --slug <auto>)
```

Use a slug without a date prefix. `task.py create` adds the `MM-DD-`
directory prefix automatically.

Create/seed `prd.md` immediately with what you know:

```markdown
# brainstorm: <short goal>

## Goal

<one paragraph: what + why>

## What I already know

* <facts from user message>
* <facts discovered from repo/docs>

## Assumptions (temporary)

* <assumptions to validate>

## Open Questions

* <ONLY Blocking / Preference questions; keep list short>

## Requirements (evolving)

* <start with what is known>

## Acceptance Criteria (evolving)

* [ ] <testable criterion>

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* <what we will not do in this task>

## Spec Conflicts

* <conflict description> → **Resolution**: <option + rationale>

## Technical Notes

* <files inspected, constraints, links, references>
* <research notes summary if applicable>
```

---

## Step 1: Auto-Context (DO THIS BEFORE ASKING QUESTIONS)

Before asking questions like "what does the code look like?", gather context yourself:

### Repo inspection checklist

* Identify likely modules/files impacted
* Locate existing patterns (similar features, conventions, error handling style)
* Check configs, scripts, existing command definitions
* Note any constraints (runtime, dependency policy, build tooling)

### Documentation checklist

* Look for existing PRDs/specs/templates
* Look for command usage examples, README, ADRs if any
* **Scan `.trellis/spec/**/*.md` for rules that apply to this task** — check for conflicts with the stated requirement

### Data-landscape checklist (NEW — run before locking scope/keys)

For any task that reads/writes/repairs/syncs **data** (batch jobs, field-fill, migration, dedup, sync, refresh), you MUST inspect the real data landscape BEFORE settling scope and join keys. This is what prevents the classic "wrong object" rework:

* Enumerate all scopes/categories the table holds, with row counts
* For each scope, identify the REAL join key (test it against sample rows — don't assume from one visible scope)
* Compute null/empty baselines (e.g. `field1 IS NULL` counts per scope)
* Determine which scope holds the primary target data (often NOT the one the old code processed)

### Spec Conflict Detection (MANDATORY — run every brainstorm)

After reading the relevant spec files, check each requirement/assumption against existing spec rules:

| Conflict severity | Criteria | Action |
|---|---|---|
| **Hard conflict** | Requirement directly violates a spec rule | Stop, surface conflict, ask user to resolve before continuing |
| **Tension** | Requirement bends or stretches a spec guideline | Surface as a warning, continue after noting it |
| **No conflict** | Requirement is consistent with or unaddressed by specs | Continue normally |

**Conflict notification format** (use when a conflict is found):

```markdown
⚠️ **Spec Conflict Detected** — must resolve before continuing

**Requirement**: <what the user wants>
**Conflicting spec**: [`spec/<path>.md`](spec/<path>.md) — "<exact rule quoted>"

**Options**:
1. **Adjust requirement** — modify scope to comply with the existing spec
2. **Update the spec** — this requirement represents a deliberate evolution of the rule
3. **Accept exception** — proceed despite conflict, with explicit justification recorded in PRD

Which option do you prefer?
```

Record the resolution in PRD under a `## Spec Conflicts` section.

Write findings into PRD:

* Add to `What I already know`
* Add constraints/links to `Technical Notes`
* Add any conflicts to `## Spec Conflicts` (resolved or pending)

---

## Step 2: Classify Complexity (still useful, not gating task creation)

| Complexity   | Criteria                                               | Action                                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------- |
| **Trivial**  | Single-line fix, typo, obvious change                  | Skip brainstorm, implement directly         |
| **Simple**   | Clear goal, 1–2 files, scope well-defined              | Ask 1 confirm question, then implement      |
| **Moderate** | Multiple files, some ambiguity                         | Light brainstorm (2–3 high-value questions) |
| **Complex**  | Vague goal, architectural choices, multiple approaches | Full brainstorm                             |

> Note: Task already exists from Step 0. Classification only affects depth of brainstorming.
> **Expected-results gate still applies for any task whose outcome can be quantified** (data/performance/migration), regardless of complexity class.

---

## Step 3: Question Gate (Ask ONLY high-value questions)

Before asking ANY question, run the following gate:

### Gate A — Can I derive this without the user?

If answer is available via:

* repo inspection (code/config)
* docs/specs/conventions
* quick market/OSS research

→ **Do not ask.** Fetch it, summarize, update PRD.

### Gate B — Is this a meta/lazy question?

Examples:

* "Should I search?"
* "Can you paste the code so I can proceed?"
* "What does the code look like?" (when repo is available)

→ **Do not ask.** Take action.

### Gate C — What type of question is it?

* **Blocking**: cannot proceed without user input
* **Preference**: multiple valid choices, depends on product/UX/risk preference
* **Derivable**: should be answered by inspection/research

→ Only ask **Blocking** or **Preference**.

---

## Step 4: Research-first Mode (Mandatory for technical choices)

### Trigger conditions (any → research-first)

* The task involves selecting an approach, library, protocol, framework, template system, plugin mechanism, or CLI UX convention
* The user asks for "best practice", "how others do it", "recommendation"
* The user can't reasonably enumerate options

### Delegate to `trellis-research` sub-agent (don't research inline)

For each research topic, **spawn a `trellis-research` sub-agent via the Task tool** — don't do WebFetch / WebSearch / `gh api` inline in the main conversation.

Why:
- The sub-agent has its own context window → doesn't pollute brainstorm context with raw tool output
- It persists findings to `{TASK_DIR}/research/<topic>.md` (the contract — see `workflow.md` Phase 1.2)
- It returns only `{file path, one-line summary}` to the main agent
- Independent topics can be **parallelized** — spawn multiple sub-agents in one tool call

> **Codex exception**: on Codex CLI, do NOT dispatch `trellis-research` for research-first mode — do the research inline (WebFetch / WebSearch in the main session) and write findings to `{TASK_DIR}/research/<topic>.md` yourself. Reason: Codex `spawn_agent` runs sub-agents with `fork_turns="none"` (isolated context, no parent session inheritance), so the research sub-agent cannot resolve the active task path via `task.py current` and silently aborts without producing files. Inline research on Codex avoids this failure mode. The 3+ inline research calls limit (B rule in `workflow.md`) is relaxed for Codex specifically.

Agent type: `trellis-research`
Task description template: "Research <specific question>; persist findings to `{TASK_DIR}/research/<topic-slug>.md`."

❌ Bad (what you must NOT do):
```
Main agent: WebFetch(url-A) → WebFetch(url-B) → Bash(gh api ...)
          → WebSearch(q1) → WebSearch(q2) → ... (10+ inline calls)
          → Write(research/topic.md)
```
→ Pollutes main context with raw HTML/JSON, burns tokens.

✅ Good:
```
Main agent: Task(subagent_type="trellis-research",
                 prompt="Research topic A; persist to research/topic-a.md")
          + Task(subagent_type="trellis-research",
                 prompt="Research topic B; persist to research/topic-b.md")
          + Task(subagent_type="trellis-research",
                 prompt="Research topic C; persist to research/topic-c.md")
→ Reads research/topic-{a,b,c}.md after they finish.
```

### Research steps (to pass into each sub-agent prompt)

Each `trellis-research` sub-agent should:

1. Identify 2–4 comparable tools/patterns for its topic
2. Summarize common conventions and why they exist
3. Map conventions onto our repo constraints
4. Write findings to `{TASK_DIR}/research/<topic>.md`

Main agent then reads the persisted files and produces **2–3 feasible approaches** in PRD.

### Research output format (PRD)

The PRD itself should only reference the persisted research files, not duplicate their content. Add a `## Research References` section pointing at `research/*.md`.

Optionally, add a convergence section with feasible approaches derived from the research:

```markdown
## Research References

* [`research/<topic-a>.md`](research/<topic-a>.md) — <one-line takeaway>
* [`research/<topic-b>.md`](research/<topic-b>.md) — <one-line takeaway>

## Research Notes

### What similar tools do

* ...
* ...

### Constraints from our repo/project

* ...

### Feasible approaches here

**Approach A: <name>** (Recommended)

* How it works:
* Pros:
* Cons:

**Approach B: <name>**

* How it works:
* Pros:
* Cons:

**Approach C: <name>** (optional)

* ...
```

Then ask **one** preference question:

* "Which approach do you prefer: A / B / C (or other)?"

---

## Step 5: Expansion Sweep (DIVERGE) — Required after initial understanding

After you can summarize the goal, proactively broaden thinking before converging.

### Expansion categories (keep to 1–2 bullets each)

1. **Future evolution**

   * What might this feature become in 1–3 months?
   * What extension points are worth preserving now?

2. **Related scenarios**

   * What adjacent commands/flows should remain consistent with this?
   * Are there parity expectations (create vs update, import vs export, etc.)?

3. **Failure & edge cases**

   * Conflicts, offline/network failure, retries, idempotency, compatibility, rollback
   * Input validation, security boundaries, permission checks

### Expansion message template (to user)

```markdown
I understand you want to implement: <current goal>.

Before diving into design, let me quickly diverge to consider three categories (to avoid rework later):

1. Future evolution: <1–2 bullets>
2. Related scenarios: <1–2 bullets>
3. Failure/edge cases: <1–2 bullets>

For this MVP, which would you like to include (or none)?

1. Current requirement only (minimal viable)
2. Add <X> (reserve for future extension)
3. Add <Y> (improve robustness/consistency)
4. Other: describe your preference
```

Then update PRD:

* What's in MVP → `Requirements`
* What's excluded → `Out of Scope`

---

## Step 6: Q&A Loop (CONVERGE)

### Rules

* One question per message
* Prefer multiple-choice when possible
* After each user answer:

  * Update PRD immediately
  * Move answered items from `Open Questions` → `Requirements`
  * Update `Acceptance Criteria` with testable checkboxes
  * Clarify `Out of Scope`

### Question priority (recommended)

1. **MVP scope boundary** (what is included/excluded)
2. **Preference decisions** (after presenting concrete options)
3. **Failure/edge behavior** (only for MVP-critical paths)
4. **Success metrics & Acceptance Criteria** (what proves it works)

### Preferred question format (multiple choice)

```markdown
For <topic>, which approach do you prefer?

1. **Option A** — <what it means + trade-off>
2. **Option B** — <what it means + trade-off>
3. **Option C** — <what it means + trade-off>
4. **Other** — describe your preference
```

---

## Step 7: Propose Approaches + Record Decisions (Complex tasks)

After requirements are clear enough, propose 2–3 approaches (if not already done via research-first):

```markdown
Based on current information, here are 2–3 feasible approaches:

**Approach A: <name>** (Recommended)

* How:
* Pros:
* Cons:

**Approach B: <name>**

* How:
* Pros:
* Cons:

Which direction do you prefer?
```

Record the outcome in PRD as an ADR-lite section:

```markdown
## Decision (ADR-lite)

**Context**: Why this decision was needed
**Decision**: Which approach was chosen
**Consequences**: Trade-offs, risks, potential future improvements
```

---

## Step 7.5: Expected Results Computation (HARD GATE — 硬性门禁，不可跳过)

Once the approach converges (Step 7 / research-first), you MUST compute and present a **verifiable expected-results checklist** for user sign-off BEFORE Step 8 final confirmation. This is the anti-rework gate.

**出口 /goal**: PRD 已含 `## Expected Results` 段落（数字/证据，非文字承诺），且已呈给用户逐项确认。

### Why this gate exists (案例锚点)

First-rework lesson (CusFielddataRankFixCronJob): the plan locked the WRONG scope + join key, and the acceptance criteria were prose promises ("execution succeeds + has logs") instead of quantified outcomes ("empty rows 10289 → 1337"). Had a read-only Q-survey been run at plan time, the wrong object would have been caught instantly.

### Expected-results three principles (通用，不止数据项目)

1. **能算的必须算出来**（数字 / 可复现证据）：

| Task type | How to compute | Expected-writeup pattern |
|---|---|---|
| Data sync / refresh / repair | Read-only Q-survey on real data (per-scope row counts, join-key hit rate, null baseline, target value) | 「field1 空行从 10289 → ~1337，补 8952，覆盖 3 类」 |
| Performance | profile-first current baseline (timing / counts / timestamps) | 「P99 从 850ms → ≤300ms」 |
| Refactor / behavior-preserving | golden baseline / regression comparison | 「现有行为零变化，X 条回归用例全绿」 |
| New feature | example contract | 「输入 X → 预期输出 Y」 |
| Interaction / UI | testable walkthrough | 「用户到第 3 步看到 …，点击后 …」 |

2. **算不了的给可判别方式**，不给模糊承诺（"改善体验" → "P95 白屏 < 1s"）。
3. **实施前必须呈给用户逐项确认**——预期清单本身就是验收清单，用户点头才开始写代码。

### Read-only safety (算预期的底线，强制)

* **允许**：SELECT / SHOW / 只读视图 / LIMIT 样本 / 查日志 / 查服务器只读
* **禁止**：UPDATE / DELETE / INSERT / DDL / 重启服务 / 停服务 / 写生产文件 / 改生产配置
* 连接优先用只读账号；无只读账号时严格只发 SELECT 并声明只读意图
* 需要全量时用 COUNT / LIMIT，不用 SELECT * 拉全表

### Self-heal order (环境不允许算预期时，先自愈再处理)

1. 数据类：只读连真实库（SELECT 只读）→ 连接失败尝试配置/网络/换只读账号重试 → 仍失败用历史快照/导出文件 → 仍失败 → 阻塞标记
2. 性能类：本地 benchmark / 压测脚本替代
3. 全部自愈失败 → PRD 写明「⚠️ 预期结果未计算（原因 + 已尝试自愈）」，列为阻塞待办，**禁止进入实现**

---

## Step 8: Final Confirmation + Implementation Plan

When open questions are resolved, confirm complete requirements with a structured summary:

### Final confirmation format

```markdown
Here's my understanding of the complete requirements:

**Goal**: <one sentence>

**Requirements**:

* ...
* ...

**Expected Results（预期结果清单，Step 7.5 产出）**:

* [ ] <数据类> 基线 X → 目标 Y（附只读查询证据）
* [ ] <性能类> P99 从 X → ≤Y（附测量证据）
* [ ] <功能类> 输入 X → 输出 Y（示例契约）

**Acceptance Criteria**:

* [ ] ...
* [ ] ...

**Definition of Done**:

* ...

**Out of Scope**:

* ...

**Technical Approach**:
<brief summary + key decisions>

**Implementation Plan (small PRs)**:

* PR1: <scaffolding + tests + minimal plumbing>
* PR2: <core behavior>
* PR3: <edge cases + docs + cleanup>

Does this look correct? If yes, I'll proceed with implementation.
```

### Subtask Decomposition (Complex Tasks)

For complex tasks with multiple independent work items, create subtasks:

```bash
# Create child tasks
CHILD1=$(python ./.trellis/scripts/task.py create "Child task 1" --slug child1 --parent "$TASK_DIR")
CHILD2=$(python ./.trellis/scripts/task.py create "Child task 2" --slug child2 --parent "$TASK_DIR")

# Or link existing tasks
python ./.trellis/scripts/task.py add-subtask "$TASK_DIR" "$CHILD_DIR"
```

---

## PRD Target Structure (final)

`prd.md` should converge to:

```markdown
# <Task Title>

## Goal

<why + what>

## Requirements

* ...

## Expected Results（预期结果清单）  ← 硬性段落，Step 7.5 产出

* [ ] 数据类：基线 X → 目标 Y（附只读查询证据）
* [ ] 性能类：P99 从 X → ≤Y（附测量证据）
* [ ] 功能类：输入 X → 输出 Y（示例契约）

## Acceptance Criteria

* [ ] ...

## Definition of Done

* ...

## Technical Approach

<key design + decisions>

## Decision (ADR-lite)

Context / Decision / Consequences

## Spec Conflicts

* <conflict> → Resolution: <option + rationale>  *(omit section if none)*

## Out of Scope

* ...

## Technical Notes

<constraints, references, files, research notes>
```

---

## Anti-Patterns (Hard Avoid)

* Asking user for code/context that can be derived from repo
* Asking user to choose an approach before presenting concrete options
* Meta questions about whether to research
* Staying narrowly on the initial request without considering evolution/edges
* Letting brainstorming drift without updating PRD
* **Skipping the expected-results computation (Step 7.5)** and jumping straight to implementation — this is a hard gate, violating it invalidates the run
* Writing expected results as prose promises ("improve UX / run faster") instead of numbers/evidence ("P95 < 1s")
* Modifying production data while computing expected results (UPDATE/DELETE/writes/restarts) — read-only is the floor
* Self-healing failures that block expected-results computation by silently skipping it instead of fixing the environment

---

## Integration with Start Workflow

After brainstorm completes (Step 8 confirmation approved), the flow continues to the Task Workflow's **Phase 2: Prepare for Implementation**:

```text
Brainstorm
  Step 0: Create task directory + seed PRD
  Step 1–7: Discover requirements, research, converge
  Step 7.5: Expected Results computation (HARD GATE — read-only, user sign-off)
  Step 8: Final confirmation → user approves
  ↓
Task Workflow Phase 2 (Prepare for Implementation)
  Code-Spec Depth Check (if applicable)
  → Research codebase (based on confirmed PRD)
  → Configure code-spec context (jsonl files)
  → Activate task
  ↓
Task Workflow Phase 3 (Execute)
  Implement → Check → Complete
```

The task directory and PRD already exist from brainstorm, so Phase 1 of the Task Workflow is skipped entirely.

---

## Related Commands

| Command | When to Use |
|---------|-------------|
| `/trellis:start` | Entry point that triggers brainstorm |
| `/trellis:finish-work` | After implementation is complete |
| `/trellis:update-spec` | If new patterns emerge during work |
| `/trellis-brainstorm` | 原版（无预期结果门禁） |
| `/trellis-brainstormpro` | 增强版（含 Step 7.5 预期结果硬门禁，推荐用于数据/性能/迁移类任务） |

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