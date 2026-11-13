# OpenViking vs 存石蛊：调研与实测记录

日期：2026-11-13
范围：只读调研；未修改存石蛊生产数据。

## 1. 结论摘要

- OpenViking 更适合做「跨会话/跨 Agent 的语义记忆与上下文层」。
- 存石蛊更适合做「证据/事实层」：原文哈希、片段 locator、来源链、`answer_allowed`、冲突/失效重验。
- 不建议用 OpenViking 直接替换存石蛊；建议旁路接入 DSH，存石蛊保持证据层。
- 存石蛊「无变更仍扫描」的主因是 `CunguSourceSyncManager` 每 1–5 秒重建全部源 payload 并 SHA256，不是本地文件全树扫描。

## 2. 存石蛊实测

### 2.1 运行库

- 进程：`pm-backend.exe` PID 35284。
- 连接：`postgresql+psycopg://pm@127.0.0.1:55432/pm`。
- `backend/data/pm.db`：3.78MB、3 条 record，旧/备用库，不用于量化。

### 2.2 数据规模（PostgreSQL）

| 表 | 行数 |
|---|---:|
| `cungu_local_link_items` | 1784 |
| `cungu_local_links` | 1 |
| `cungu_local_link_syncs` | 3 |
| `cungu_records` | 0 |
| `cungu_fragments` | 0 |
| `cungu_memories` | 0 |
| `cungu_embeddings` | 0 |
| `projects` | 229 |
| `models` | 446 |
| `fields` | 2014 |
| `records` | 1869 |
| `assets` | 11116 |

### 2.3 本地关联扫描

| sync_id | trigger | 时间 | 耗时 | scanned | unchanged | skipped | changed | bytes |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `sync_9dc30e5d...` | watch | 2026-11-12 23:54:05→23:54:17 | 11.29s | 1320 | 1320 | 519 | 0 | 13,905,564 |
| `sync_cfa49628...` | reconcile | 2026-09-26 | 17.04s | 1596 | 1596 | 4341 | 0 | 237,734,419 |
| `sync_6d6064...` | — | 2026-10-30 | — | 34 | — | — | — | FAILED |

结论：近一天只有 1 次 watch 全量扫描，0 变更、11.3 秒；UI 的 1601/1784 是该类扫描的进度，不是每秒全树扫描。

### 2.4 源同步空转

只读 benchmark（调用 `_yunshougu_payload` 与 `cungu_app_sources` 的 `build_payload`，不写库）：

| 来源 | 平均耗时 | JSON 大小 |
|---|---:|---:|
| 运筹蛊 `_yunshougu_payload` | 0.3262s | 3,268,325 B (3.27MB) |
| 律令蛊 `lulinggu` | 0.4916s | 4,210,861 B (4.21MB) |
| 御人蛊 `yurengu` | 0.3551s | 34,967 B (35KB) |
| 合计 | ~1.17s | ~7.52MB |

- 空转退避：1→2→3→5 秒；稳态占空比约 19%–54%。
- 实测空闲 CPU：10 秒 5.38 CPU 秒（53.8%）；30 秒 15.05 CPU 秒（50.2%）；WorkingSet 210.9MB。
- 按 50.2% 单核估算：约 12.0 CPU 核·小时/天；按 1.17s/轮、7.52MB/轮反推，约 2–3.7 万轮/天、150–277GB/天瞬时 JSON 分配（仅为量级估算）。

### 2.5 其他轮询

- `LocalLinkManager._reconcile_loop`：每 1 秒查 `watch_enabled` 全表 + observer 健康。
- `_cungu_ingest_worker`：每 1.5 秒查导入队列。
- 前端 `CunguNotebookPage.tsx:1181-1201`：每 2 秒轮询 snapshots/sync runs。
- 这些是叠加成本，但小于源同步的 1.17s/pass。

## 3. OpenViking 调研

### 3.1 定位与架构

- `viking://` 虚拟文件系统统一 Resources / Memory / Skills。
- 目录内容分层：L0 abstract、L1 overview、L2 detail。
- HTTP Server（REST + `/mcp`）→ Service Layer → Retrieval / Session+Memory extraction / Resource+Skill import → VikingFS + Vector Index。
- Session：Create → Interact → Commit；commit 归档消息，异步摘要 + 长期记忆抽取 + `memory_diff.json`。
- 记忆类型：profile / preferences / entities / events / cases / trajectories / experiences。
- 检索：Intent Analysis（可选 LLM）→ 向量召回 → Rerank（可选）。

### 3.2 部署与许可

- Python 3.10+、uv、embedding 模型 + VLM；`openviking-server init` 生成 `~/.openviking/ov.conf`；默认端口 1933。
- Docker：`ghcr.io/volcengine/openviking:latest`。
- 主项目 AGPLv3；CLI/examples Apache-2.0。
- 本地向量后端对 workspace 加独占文件锁，不适合多进程共享。

### 3.3 DSH 官方插件

- `@openviking/dsh-memory-plugin` 0.5.34，Apache-2.0，45 files / 356,071 bytes。
- peer：`@deepseek-ai/dsh-llm`、`dsh-mcp-client`、`dsh-skill-filesystem >=0.1.0-rc.6 <1.0.0-0`；Node `^22.19.0 || >=24`。
- 当前 DSH 0.2.11-rc.19 / Node 22.22.2，版本满足。
- 安装：Desktop 插件页输入包名，或 Desktop 自带 dsh `plugin --profile desktop add`；配置 `%USERPROFILE%\.openviking\ovcli.conf`。
- 注入：`agent/pre-step` 在 `next()` 后追加 `source.kind='plugin:openviking-memory'` 的 user 消息，含 profile block + recall block。
- 捕获：`session/event` 捕获 user/assistant/可选 tool result；`turn/end`/`compaction/start` 达 20k tokens 后 commit；失败进 pending queue，60 秒重放。
- 配置：`recallMaxTokens=2000`、`scoreThreshold=0.35`、`captureToolResults=true`、`skipSubagentSessions=true`、`commitTokenThreshold=20000`。
- 每个 DSH session 映射 `dsh-<session-id>`；subagent 默认独立 session。

### 3.4 厂商 benchmark（未独立复现）

- LoCoMo 80–83% vs 原生 24–57%。
- 输入 token 降 34.3–91.0%，查询延迟降 58.45–66.10%。
- tau2-bench 成功率 +6.87pp（retail）/+11.87pp（airline）。

仅作参考，不作为本项目收益承诺。

## 4. 方案与边界

| 维度 | 存石蛊 | OpenViking |
|---|---|---|
| 主职责 | 证据/事实层 | 会话记忆/上下文层 |
| 存储 | PostgreSQL + fragments + hashes | `viking://` FS + vector index |
| 检索 | FTS/词法 + 哈希向量；确定性 | 语义向量 + rerank；概率性 |
| 治理 | `answer_allowed`、冲突、stale 重验 | `memory_diff.json` 审计；无证据闸门 |
| 记忆 | 显式卡片、验证状态 | LLM 抽取 profile/events 等 |
| 范围 | 项目/本地来源 | 跨会话/跨 Agent |
| License | 本项目自有 | 主项目 AGPLv3；插件 Apache-2.0 |
| 运维 | SQLite/PostgreSQL | Python/uv + embedding/VLM + 服务 |

- 方案 A（推荐）：存石蛊保持证据层；DSH 旁路安装 OpenViking 插件；先修源同步。
- 方案 B：直接替换存石蛊；不推荐，丢失证据链，迁移成本 3–6 周。
- 方案 C：双写融合；OpenViking 只做 candidate generation，查询回存石蛊校验；2–4 周，适合二期。

## 5. 参考

- https://github.com/volcengine/OpenViking
- https://openviking.ai
- https://docs.openviking.ai
- `.trellis/tasks/11-13-openviking-memory-layer/research/dsh-plugin/package/`
