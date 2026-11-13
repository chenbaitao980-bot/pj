# OpenViking 与存石蛊架构对比及 DSH 记忆层接入

## Goal

判断 OpenViking 是否比存石蛊现有架构更适合作为「记忆层」，是否可以直接替换存石蛊，以及 DeepSeek Harness 接入 OpenViking 作为跨会话/跨项目记忆层的可行性、成本与收益；同时定位存石蛊「无变更仍持续扫描」的真实根因并给出可量化修复目标。

## What I already know

### 存石蛊

- 代码位置：`E:\claude\project3\projectManager-portable\pm-software`。
- 运行库不是 SQLite：便携版后端 `pm-backend.exe` 连接 `postgresql+psycopg://pm@127.0.0.1:55432/pm`；`backend/data/pm.db` 只有 3.78MB、3 条 record，是旧/备用库。
- 真实规模：`cungu_local_link_items=1784`、`cungu_local_links=1`（`E:\黑曜石\obsidian`，`watch_enabled=t`，`scan_interval_seconds=300`）、`cungu_local_link_syncs=3`、`cungu_records/fragments/memories/embeddings=0`；源表 `projects=229`、`models=446`、`fields=2014`、`records=1869`、`assets=11116`。
- 证据模型：`cungu_records`（原文 + `content_sha256`）、`cungu_fragments`（片段 + `locator`）、`cungu_memories`（claim + 证据链 + 验证状态 + 有效期 + supersedes）、`cungu_conflicts`；`memory_answer_allowed()` 动态重验证据存在、未软删、验证状态、冲突、来源 stale、有效期。
- 检索：`search_memories` 是关键词匹配；`search_evidence` 走 FTS/词法 + 哈希向量排序 + 精确 ID，返回 `answer_allowed`、`coverage`、`trace_id`、`snapshot_fingerprint`。设计目标是确定性、可解释、来源可定位、无假阴性。
- 本地关联同步：watchdog 增量监听，`scan_changed_source_paths` 只处理变更路径；初始/手动/ambiguous 事件回退全量 `os.walk`。最近一次 watch 同步扫描 1320 文件、13.9MB、11.29s、0 变更；更早 reconcile 扫描 1596 文件、237MB、17.04s、0 变更。它不是每秒全树扫描。
- 源同步循环：`CunguSourceSyncManager` 每 1–5 秒执行一次 `enqueue_current_source()` + `sync_application_sources_once()`；每轮都会重建运筹蛊/律令蛊/御人蛊完整 payload 并做 SHA256，digest 不变才跳过写入。测得单轮约 `0.3262s / 3.27MB`（运筹蛊）、`0.4916s / 4.21MB`（律令蛊）、`0.3551s / 35KB`（御人蛊），合计约 `1.17s + 7.52MB` 瞬时序列化。
- 实测空闲 CPU：`pm-backend.exe`（PID 35284）10 秒采样 5.38 CPU 秒（53.8%），30 秒采样 15.05 CPU 秒（**50.2%**），WorkingSet 210.9MB。说明「无时无刻不在扫描」的主因是源同步空转，不是本地文件全树扫描。
- 其他轮询：`LocalLinkManager._reconcile_loop` 每 1 秒查 `watch_enabled` 全表并检查 observer；`_cungu_ingest_worker` 每 1.5 秒查导入队列；前端每 2 秒轮询 snapshots/sync runs。这些是叠加成本，但远小于源同步 payload 重建。

### OpenViking

- 定位：面向 AI Agent 的 Context Database；`viking://` 虚拟文件系统统一 Resources / Memory / Skills；目录带 L0 abstract / L1 overview / L2 detail 三层内容，可对目录做语义检索。
- 架构：HTTP Server（REST + `/mcp`）→ Service Layer（FS / Search / Session / Resource / Pack / Debug）→ Retrieval、Sessions+Memory extraction、Resource/Skill import 三条管线 → VikingFS（RAGFS 内容 + Vector Index）。
- Session 生命周期：Create → Interact → Commit。`commit()` 同步归档消息，异步 LLM 生成摘要、抽取长期记忆（profile/preferences/entities/events/cases/trajectories/experiences）、写 `memory_diff.json` 审计。
- 检索：Query → Intent Analysis（可选 LLM）→ 全局/目录向量召回 → Rerank（可选）→ 结果；`find()` 单查询 QUICK，`search()` 支持多查询/THINKING+rerank。
- 部署：Python 3.10+、uv、embedding 模型 + VLM（Volcengine/OpenAI/Ollama 等）；`openviking-server init` 生成 `~/.openviking/ov.conf`；默认端口 1933；Docker 镜像 `ghcr.io/volcengine/openviking:latest`；本地向量后端对 workspace 加独占文件锁，不适合多进程共享。
- License：主项目 AGPLv3；`crates/ov_cli`/examples Apache-2.0。
- 官方 DSH 插件：`@openviking/dsh-memory-plugin` 0.5.34，Apache-2.0，45 files / 356071 bytes，peer `@deepseek-ai/dsh-llm/dsh-mcp-client/dsh-skill-filesystem >=0.1.0-rc.6 <1.0.0-0`，Node `^22.19.0 || >=24`。
- 当前 DSH：`@deepseek-ai/dsh-desktop-runtime 0.2.11-rc.19`，Node `v22.22.2`，**满足插件 peer 要求**。
- 插件工作方式：`agent/pre-step`（`prepend:true`）在 `next()` 后注入 profile block + recall block；`session/event` 捕获 user/assistant/可选 tool result；`turn/end` 或 `compaction/start` 达到 `commitTokenThreshold` 后 commit；失败写 pending queue，60 秒后台重放；每个 DSH session 映射 `dsh-<session-id>`。
- 插件配置：`recallMaxTokens`（默认 2000）、`scoreThreshold`（0.35）、`captureToolResults`（true）、`skipSubagentSessions`（true）、`commitTokenThreshold`（20000）、`mcpToolCallTimeoutMs`（60000）、`recallCompress`（client/auto/server/off）。

### 关键判断

- OpenViking 在「跨会话/跨 Agent 的语义记忆、目录化上下文、L0/L1/L2 分层、技能/资源统一」上明显强于存石蛊。
- 存石蛊在「证据可核验、来源哈希/片段定位、answer_allowed、冲突/失效重验」上是 OpenViking 默认模型没有的硬约束。OpenViking 的记忆抽取是 LLM 概率过程，不能替代证据闸门。
- 因此二者不是同层替代关系：
  - 存石蛊 = 证据/事实层（source of truth + 可审计证据）。
  - OpenViking = DSH 的会话记忆/上下文层（跨会话 recall + 语义检索）。
- 直接替换存石蛊会丢失证据链与 `answer_allowed` 语义，迁移/重写成本高，且 OpenViking 主项目 AGPLv3 会带来分发约束；不建议。

## Requirements

1. 给出 2–3 个可执行方案，明确「替换 / 双写融合 / 旁路接入」的边界、成本、风险和收益。
2. 推荐方案必须保留存石蛊现有证据模型与 `answer_allowed` 语义，不把 OpenViking 的 LLM 抽取结果直接当事实。
3. DSH 接入优先使用官方 `@openviking/dsh-memory-plugin`，不修改 DSH 冻结底座；如需冻结版内置，必须按 AGENTS.md 走 snapshot / payload / patch / verify / 升版流程。
4. 同步扫描修复必须先于或独立于 OpenViking 接入；用轻量版本号/指纹触发，避免每轮重建全量 payload。
5. 所有分析阶段只读，不修改存石蛊生产数据；修复实现阶段才允许改代码，并保留回滚。
6. 预期结果必须可核验（数字/命令/日志），不能只写「性能提升」。

## Options

### 方案 A（推荐）：旁路接入 + 源同步修复

**做法**

- 存石蛊保持现状，作为证据/事实层；不迁移 `cungu_records/fragments/memories`。
- 在 DSH desktop profile 安装 `@openviking/dsh-memory-plugin`，单独部署 OpenViking 服务；DSH 会话记忆写入 `viking://`，跨会话 recall 由插件 pre-step 注入。
- 存石蛊的 `cungu_source_sync.py` 改为「轻量指纹检查 → 变化才构建 payload」：
  - 用每张源表的 `max(updated_at)`、`count(*)`、`version` 或轻量 revision 表生成指纹；定时器只查指纹，不序列化全量。
  - 指纹变化时再调用现有 `_yunshougu_payload` / adapter `build_payload`，保留现有 SHA256 与推送逻辑。
  - 本地关联保持 watchdog 增量；对高频目录事件做 debounce/批量合并，避免重复入队。
- 先修同步，再接 OpenViking；两部分可独立回滚。

**优点**

- 保留证据链和 `answer_allowed`，不牺牲可审计性。
- DSH 获得跨会话/跨项目语义记忆，官方插件即插即用。
- 同步修复收益立刻可见，风险低，不动数据模型。
- 两部分解耦，哪部分出问题都可单独停用。

**缺点/成本**

- 需要额外运行 OpenViking 服务（Python/uv 或 Docker + embedding/VLM），有内存/模型成本。
- 需要维护两套记忆语义：存石蛊的「证据记忆」与 OpenViking 的「会话记忆」，要明确边界。
- OpenViking 服务端 AGPLv3；若对外分发集成版，需要法务确认。

**估算**

- 源同步修复：1–2 人日（指纹查询 + 单测 + 观察 24h）。
- OpenViking 本地部署 + 插件接入：0.5–1 人日（Docker/uv、模型配置、`ovcli.conf`、插件安装）。
- 联调 + 验收：1–2 人日。
- 合计约 3–5 人日；风险低。

### 方案 B：直接用 OpenViking 替换存石蛊

**做法**

- 把 records/fragments/memories/evidence 迁移到 OpenViking 的 `viking://` 资源与记忆 schema；存石蛊只保留 UI 或下线。
- 重写 `search_evidence`、`memory_answer_allowed`、冲突/失效重验为 OpenViking 查询 + 自定义策略。

**优点**

- 架构统一，少一套存储/检索。
- 直接获得语义检索、目录化上下文、跨 Agent 共享。

**缺点/成本**

- OpenViking 默认没有 `content_sha256` 片段定位、`answer_allowed`、冲突表、stale 重验；这些需要自建，等于在 OpenViking 上重写存石蛊的核心价值。
- LLM 抽取记忆是概率过程，不能保证「无假阴性/来源可定位」；对证据型问答是倒退。
- 迁移 229 projects / 446 models / 2014 fields / 1869 records / 11116 assets 及未来增量，需双写/回滚方案。
- 主项目 AGPLv3，分发/闭源集成有约束。
- 估算 3–6 周，风险高；不建议。

### 方案 C：双写融合（存石蛊内嵌 OpenViking 作为语义索引）

**做法**

- 存石蛊写入 evidence 后，同步把规范化文本/记忆写入 OpenViking；查询时先走向量 recall，再回存石蛊做证据校验与 `answer_allowed`。
- OpenViking 只做 candidate generation，不直接返回最终答案。

**优点**

- 保留证据闸门，同时获得语义召回。
- 可逐步替换存石蛊现有 FTS/哈希向量排序。

**缺点/成本**

- 两套存储一致性、删除/更新/失效传播复杂；需要 outbox/重试/对账。
- OpenViking 服务不可用时要有降级路径。
- 估算 2–4 周，风险中高；适合作为二期，而不是当前 MVP。

## Expected Results（方案 A，待用户确认）

> 基线均来自本机只读测量；实现后用同一命令/同一采样窗口复测。

- [ ] **空闲 CPU**：`pm-backend.exe` 30 秒采样从 `15.05 CPU 秒 / 50.2%` 降到 `≤1.5 CPU 秒 / ≤5%`（同一 PID 重启后、无用户操作、无同步任务时测）。
- [ ] **空转 payload 构建**：10 分钟空闲窗口内，`_yunshougu_payload` / `lulinggu` / `yurengu` 的 `build_payload` 调用次数从当前每轮 3 次降到 **0 次**；指纹查询次数约每 5 秒 1 次，单次 p95 ≤50ms。
- [ ] **变更捕获**：在 `projects` 表新增/修改 1 条记录后，源同步在 **≤2 秒**内检测到并完成一次 payload 构建；100 次连续变更测试捕获率 100%，无重复入队。
- [ ] **本地关联扫描**：对 `E:\黑曜石\obsidian` 做 10 个文件的变更，触发扫描的 `scanned_count ≤10`（不是 1784）；10 分钟内无变更时新增全量扫描次数 **0**；单次小变更 p95 ≤2 秒。
- [ ] **OpenViking 注入**：在 DSH 新会话中询问上一会话已确认的事实，recall block 非空且 ≤2000 tokens；`source.kind='plugin:openviking-memory'` 消息出现在 pre-step 结果中，但不出现在用户聊天正文。
- [ ] **隔离性**：项目 A 的记忆不出现在项目 B 的 recall；subagent session 默认不写入（`skipSubagentSessions=true`）。
- [ ] **失败降级**：OpenViking 服务停止时，DSH 会话仍可正常回答；插件进入 pending queue，服务恢复后 60 秒内重放，不阻塞主流程。
- [ ] **成本**：OpenViking 本地服务空闲内存/常驻进程有实测记录；若使用远程 embedding/VLM，记录每 1000 次 recall/commit 的调用次数与费用估算。

## Acceptance Criteria

- [ ] 方案对比表包含「能力、数据模型、检索语义、证据治理、部署、License、迁移成本」七个维度。
- [ ] 明确回答：OpenViking 是否更优（分场景）、能否直接替换（结论 + 理由）、DSH 能否作为总记忆层（边界 + 前置条件）。
- [ ] 同步扫描根因有代码位置、实测数字和可复现命令，不是猜测。
- [ ] 推荐方案有分阶段实施计划、回滚方案、预期结果清单。
- [ ] 用户确认方案后才进入实现；实现阶段遵守 AGENTS.md 的 snapshot / payload / verify / 升版规则。

## Out of Scope

- 本阶段不修改存石蛊生产数据、不迁移 records/fragments/memories。
- 本阶段不直接把 OpenViking 作为存石蛊的唯一存储。
- 不评估 OpenViking 厂商 benchmark 的独立复现（仅作为参考）。
- 不处理 DSH 冻结版与官方上游对齐（人工闸门，需另行确认）。

## Technical Notes

- 存石蛊关键文件：
  - `backend/app/services/cungu_source_sync.py`：`CunguSourceSyncManager`、`enqueue_current_source`、`sync_application_sources_once`、`_run`。
  - `backend/app/services/local_links.py`：`LocalLinkManager`、`_reconcile_loop`、`sync_local_link`、`scan_source_files`、`scan_changed_source_paths`。
  - `backend/app/services/cungu_memory.py`：`memory_answer_allowed`、`search_memories`。
  - `backend/app/services/cungu_evidence.py`：`search_evidence`、FTS/向量/证据预算。
  - `backend/app/main.py`：`_cungu_ingest_worker`、lifespan 启动的常驻任务。
  - `frontend/src/components/cungu/CunguNotebookPage.tsx`：2 秒状态轮询。
- DSH 插件研究材料：`.trellis/tasks/11-13-openviking-memory-layer/research/dsh-plugin/package/`。
- OpenViking 文档：`https://openviking.ai`、`https://docs.openviking.ai`、`https://github.com/volcengine/OpenViking`。
- 当前 DSH：`0.2.11-rc.19`，Node `v22.22.2`；插件 peer 兼容。
- 源同步空转测量脚本为只读 benchmark，未写入生产库；测量后临时脚本可删除。

## Open Questions

1. 选哪个方案：A 旁路接入 + 修同步（已确认）/ B 直接替换 / C 双写融合。
2. 若选 A：OpenViking 服务部署在本机 Docker，还是复用已有远程服务？embedding/VLM 用本地 Ollama 还是云 API？
3. OpenViking 的记忆范围：只覆盖 DSH 会话，还是也要覆盖存石蛊的项目/笔记（需要额外同步设计）？

## Decision (ADR-lite)

**Context**：OpenViking 的语义记忆能力强，但存石蛊的证据治理不可替代；当前最大即时痛点是源同步空转造成约 50% 单核 CPU。

**Decision（用户已确认 A）**：方案 A——先修源同步，再把 OpenViking 作为 DSH 的会话记忆层旁路接入；存石蛊保留为证据/事实层。

**Consequences**：保留可审计性；增加一个 OpenViking 服务运维面；两套记忆边界需要在文档和 UI 上说清。Direct replacement（方案 B）不推荐；双写融合（方案 C）留作二期。
