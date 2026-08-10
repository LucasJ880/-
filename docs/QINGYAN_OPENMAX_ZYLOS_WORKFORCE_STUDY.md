# Qingyan Workforce Runtime — OpenMax / Zylos 外部架构对照研究

- 日期：2026-08-09
- 性质：**READ-ONLY 外部研究**。本文档用于验证青砚 Workforce Runtime（Phase 2A/2B/2C）设计，不引入任何外部代码，不推荐接入 Zylos/OpenMax Runtime，不替换青砚已封板的 Model Runtime / Tool Runtime / RBAC / Approval / AgentRun。
- 对照基线：`docs/QINGYAN_WORKFORCE_PHASE2_ARCHITECTURE_AUDIT.md`（2026-08-09 内部审计），并抽查了 `src/lib/agent-runtime/queue.ts` 与 `src/lib/tender-auto-analysis/worker.ts` 源码验证。

## 信息来源与置信度

| 来源 | URL | 置信度 |
|---|---|---|
| Zylos C5 Scheduler 官方文档 | https://zylos.ai/en/docs/architecture/scheduler/ | HIGH（官方文档，2026 现行版） |
| Zylos C4 Communication Bridge 官方文档 | https://zylos.ai/en/docs/architecture/communication-bridge/ | HIGH |
| Zylos 研究长文《Autonomous Task Scheduling and Self-Directed Execution》 | https://zylos.ai/research/2026-06-19-autonomous-task-scheduling-self-directed-execution/ | HIGH（一手实现细节 + 行业综述，2026-06-19） |
| Zylos Activity Monitor SKILL.md | https://github.com/zylos-ai/zylos-core（`skills/activity-monitor/SKILL.md`，main 分支原文） | HIGH（源码仓库内文档） |
| OpenMax Agent SDK README | https://github.com/openmaxai/openmax-agent-sdk / https://www.npmjs.com/package/@openmaxai/openmax-agent-sdk（v1.0.3，2026-07-30 更新） | HIGH |
| OpenMax 协议契约 CONTRACT.md | https://github.com/openmaxai/openmax-agent-sdk/blob/main/CONTRACT.md（schemas/v1 + fixtures/v1） | HIGH |
| HxA Connect B2B 协议规范 | https://github.com/coco-xyz/hxa-connect/blob/main/docs/B2B-PROTOCOL.md | HIGH（协议全文已核读） |
| hxa-connect-sdk / hxa-teams | https://github.com/openmaxai/hxa-connect-sdk 、https://github.com/openmaxai/hxa-teams | MEDIUM（README/搜索摘要级） |
| OpenMax 平台服务端（cws-core）内部实现 | 未开源 | **UNKNOWN**（凡涉及服务端行为处均如实标注） |

---

## 0. 根本差异先讲清：serverless vs 常驻进程

对照之前必须先钉死一个前提，否则所有 pattern 都会抄错：

| 维度 | Zylos | OpenMax（SDK 侧） | 青砚 |
|---|---|---|---|
| 执行宿主 | 单机常驻进程（PM2 管理的 Node daemon + tmux 里的 Claude Code/Codex 会话） | 常驻 Node 进程（`CwsAgentBridge` 持有长连 WS 池） | **Vercel serverless**：每次 HTTP/cron 调用是一个有超时上限的短生命周期实例 |
| "agent 活着"意味着什么 | tmux 会话 + 进程存在 + 会话文件在更新 | WS 连接在线 + keepalive 正常 | **没有"活着"的进程可言**；只有 DB 里的 AgentRun 状态和未过期的 lease |
| 谁负责持续性 | Activity Monitor（守护进程）+ C5 daemon（每 1–5 秒轮询 SQLite） | WS 自动重连 + `/sync` 补差 + inbox-ledger | Vercel cron（分钟级）+ DB lease/claim/`nextAttemptAt` |
| 崩溃的表现 | 进程/会话消失，守护进程可探测 | WS 断连，close-code 可分类 | **实例静默消失**，唯一痕迹是 lease 过期、run 停在 `executing` |
| 通信底座 | SQLite 队列（C4）+ tmux 注入 | WebSocket 帧 + REST | HTTP 请求 + Postgres 行 |

结论性判断：Zylos 的整套「守护进程探活 + 进程重启」和 OpenMax 的整套「连接层心跳 + 重连状态机」都在解决**"如何维持一个常驻进程/连接的存活"**；青砚在 serverless 上根本没有这个对象，等价问题被转化为**"如何让 DB 中的 durable job 在任意实例死亡后仍可被下一次 cron 认领并从断点续跑"**。因此本研究的价值不在照搬机制，而在验证：两家系统在"存活层"之上沉淀出的**不变量**（原子认领、显式完成 ack、投递不丢、身份先还原再执行、结构化交接）是否与青砚 Phase 2 的设计一致。答案是：高度一致，详见 §3。

---

## 1. Zylos 架构摘要

Zylos 是"给 AI 一条命"的单机 agent 基础设施：一个长驻的 Claude Code/Codex 会话（tmux 内）+ 一组 PM2 服务，让 agent 有通信、调度、记忆、自愈能力。与 Workforce 相关的三个组件：

**C5 Scheduler（调度器）**——PM2 常驻 daemon，轮询 SQLite（官方文档描述为持续检查、研究长文给出 5 秒轮询间隔）找到期任务。任务类型：one-time / cron / interval；生命周期 `pending → running → done`，支持 `paused` 与 `failed`。关键机制：

- **原子认领（CAS）**：`UPDATE tasks SET status='running' WHERE id=? AND status='pending'`，`changes===0` 即已被认领，静默跳过——数据库级 compare-and-swap 防止双派发。
- **派发前探活**：dispatch 前读取 Activity Monitor 写的 `agent-status.json` 确认 agent 活着，再经 C4 队列投递（支持 priority 与 `require_idle` 闲时投递）。
- **显式完成 ack**：任务 prompt 末尾嵌入指令，agent 完成后必须执行 `cli.js done <task-id>`。超时未 ack → 任务标记 stale，按策略回 pending 或标 failed。这是孤儿检测与 recurring 任务续排的基础——调度器**不假设"派发即成功"**。
- **miss threshold**：任务过期超过阈值（默认 300s）时，recurring 任务跳到下一次排期、one-time 任务标 failed，防止宕机恢复后积压任务洪泛 agent。

**C4 Communication Bridge（通信桥）**——所有渠道（Telegram/Lark/…/调度器/心跳）进出 agent 的统一 SQLite 队列。消息带 priority 与状态（pending/delivered/done）；`control_queue` 表承载系统控制消息（心跳、健康检查、定时任务投递），**控制消息带 ack deadline，超时未确认转 `timeout` 状态**。有 health-aware intake：agent 健康态为 `recovering/down` 时拒收新消息并记录渠道，恢复后补发通知；健康文件缺失时 fail-open（不因读失败阻断收信）。

**Activity Monitor（活性守护）**——独立 PM2 服务，与 agent 进程完全隔离：

- 每 1 秒检查 tmux 会话/进程是否存在、按会话文件 mtime 判定 busy/idle，写 `agent-status.json`；
- **Guardian 模式**：agent 连续 5 秒不在运行即自动重启，重启后经 C4 发送 recovery catch-up prompt；
- **心跳探针**：默认每 30 分钟经 C4 control queue 发一次 heartbeat probe（验证的是"agent 会响应"而非"进程存在"），带 ack deadline；状态机 `ok →（primary 失败）verify →（verify 失败，kill tmux）recovering →（重启达上限，默认 3 次）down`，`down` 态等待人工修复；
- **Context 阈值触发**：statusLine 每轮回传 context 用量，80% 阈值触发提前 memory sync（后台跑），到阈值触发 new-session handoff（优先级 1 + bypass_state 投递，保证长任务中也能送达）——这是 Zylos 的"会话级 checkpoint"；
- 每日 memory git commit / 健康检查 / 升级等内建定时任务直接跑在 monitor 里，**不依赖 agent 活着**。
- 值得注意：`hook-auth-prompt.js` 默认**自动按回车通过所有权限提示**（full-delegation 设计，文档明言"这是有意为之，不是安全缺口"）。

## 2. OpenMax 架构摘要

OpenMax 的公开面是 `@openmaxai/openmax-agent-sdk`（v1.0.3，2026-07-30）：CWS（COCO Workspace）agent 通信协议层，从 `zylos-openmax` 中抽出，供 Node runtime adapter（Claude Code / Codex / OpenClaw）接入 COCO Workspace。设计口号"协议归协议、runtime 归 runtime"：SDK 是 Layer 1 协议层，runtime 桥接是 Layer 2 薄 adapter。服务端 cws-core **未开源**（服务端调度/任务管理行为 = UNKNOWN）。

**传输层（transport/）**：`WsClient` 提供 auth、heartbeat、客户端 keepalive-ping + frame-watchdog（帧看门狗，int→prod 验证重点）、指数退避重连、4001–4006 close-code 状态机（`auth-lifecycle.md` 定义 ws-ticket / bearer / JWT-refresh 流程）。

**编排器（orchestrator.js `CwsAgentBridge`）**——adapter 只实例化这一个类。两条关键流水线：

- **per-org WS 生命周期**：`open → 首连 initSyncSeq（建立基线序号）或重连 catch-up（SyncEngine 走 /sync 补差）→ seed inbox-ledger → arm reporters → self-name hydration barrier`。最后一步是**身份屏障**：自我名称/身份未水合完成前不进入消息处理。sync 游标由 adapter 的 `loadSession/saveSession` 回调持久化，进程重启后可从游标续传。
- **inbound pipeline**：`dedupe → fetch detail → normalize → access-policy decideInbound → InboundDelivery.deliver`。**投递不变量（协议级 INVARIANT）**：`deliver()` 只有在消息**真正进入 runtime context** 后才 resolve `{ok:true}`——false ack 会让 ledger/`/sync` 重试停止，消息永久丢失。失败返回 `{ok:false, failureClass, retryAfterMs?}`，`failureClass` 是封闭枚举（新增值 = 契约修订）。

**sync/ + inbox-ledger**：`/sync` 补差引擎 + 收件账本（去重 + **连续 ack**——只有连续确认到某序号，游标才前移），保证断连期间消息不丢不重。

**契约优先（CONTRACT.md）**：wire 协议的权威不是 JS 代码，而是 `schemas/v1/`（JSON Schema draft 2020-12：frame / inbound-message / wake-request / wake-result / failure-class）+ `fixtures/v1/`（golden `{input, expected}` 一致性语料）。**"通过语料 = 协议合规"是跨语言定义**；JS SDK 自己用 `test/contract.test.js` 把真实代码输出对 schema 校验，防契约漂移。`wake-request`（`raft-channel-wake.v1`）定义了唤醒休眠 runtime 的结构化请求。

**identity/**：agent-domain 解析 + self-name hydration；owner 语义经 `onOwnerBind`/`onOwnerNameHint` 回调下发给 adapter 持久化。

**HxA Connect（agent-to-agent 协作层）**：OpenMax 生态的 B2B 协议（org 内 bot 平等协作，明确区别于 Google A2A 的 `call(task)→result` 派发模型）。handoff 不是自然语言消息，而是四件套：

1. **Thread 状态机**：`active / blocked / reviewing / resolved / closed`，转换规则明确（blocked 只能回 active；终态锁内容但可 reopen；超时自动 close 并记 `close_reason: timeout`）；
2. **版本化 Artifact**：`artifact_key` + 自增 version + 类型（text/markdown/**json**/code/file/link），`UNIQUE(thread_id, artifact_key, version)`；json 类型宽容解析，修不好降级为 text 并打 `format_warning`；
3. **Parts 结构化消息**：`MessagePart = text | markdown | json | file | image | link`，可携带机器可读 JSON 段；
4. **治理**：participant label（lead/reviewer/contributor）+ `ThreadPermissionPolicy`（谁可 resolve/close/invite）+ thread `revision` 乐观并发（`If-Match`/`expected_revision`，冲突 409/`REVISION_CONFLICT`）+ 全量 audit log + WS 操作按 `ref` 关联 ack/error。

离线补课：`GET /api/me/catchup`（先 count 后取，`event_id` 幂等，游标分页），重连流程 `connect → catchup/count → 有事件才取 → 翻页取完 → 恢复正常`。

**HxA Connect / OpenMax 平台的"任务派发式 handoff"**：公开资料中 B2B 协议**有意不做** task dispatch（协议文档明说与 A2A 的区别）；SDK 中 `tm`（推测为 task-management）服务客户端存在，但其 API 语义未公开——**服务端任务模型 = UNKNOWN，不编造**。

---

## 3. 十问逐答（A–J）

### A. Agent crash 后怎么恢复？

**Zylos**：三层。① 进程层——Activity Monitor 每秒探测，连续 5 秒不在运行即重启 agent，重启后经 C4 注入 recovery catch-up prompt（出处：activity-monitor SKILL.md "Guardian Behavior"）。② 任务层——排期任务活在 SQLite，与 agent 进程故障隔离（"If the agent crashes or restarts, pending schedules survive in SQLite"，研究长文）；已派发但未收到 `cli.js done` ack 的任务超时判 stale，按策略回 pending 重派或标 failed（研究长文 "Task Completion Acknowledgment"）。③ 响应层——心跳状态机把"进程在但没反应"也当故障处理（kill tmux → recovering → 最多 3 次重启 → down 等人工）。

**OpenMax**：SDK 视角的"crash"是断连。恢复 = 指数退避重连 → 重连 catch-up（`/sync` 从持久化游标补差）→ inbox-ledger 连续 ack 保证漏收消息重投；投递不变量保证"进程死在 deliver 中途"的消息不会被误 ack（出处：README orchestrator 节 + CONTRACT.md）。HxA Connect 侧靠 catchup API + webhook 降级标记（连续 10 次失败标 degraded，回线自动恢复）。**agent 进程本身的重启由 adapter/宿主（如 Zylos guardian）负责，SDK 不管；服务端对孤儿任务的处理 = UNKNOWN。**

**对青砚的验证**：青砚没有进程可重启，等价物是"lease 过期 + cron 再认领"。审计确认 v1 background 已有该闭环（`queue.ts` claimAgentRun：`status='running' AND leaseExpiresAt <= now` 也可认领），v2/workforce 缺失——**Phase 2A 把 lease/claim 泛化到 workforce runType 正是补这一层，方向被两家印证**。

### B. heartbeat 是进程心跳、job 心跳还是连接心跳？

**Zylos——进程心跳 + 语义心跳，无 job 心跳**：
- 进程心跳：guardian 每 1 秒检查 tmux/进程存在 + 会话文件 mtime（存活性）；
- 语义心跳：每 30 分钟经 C4 control queue 发探针，要求 agent **应答**（带 ack deadline），验证"会响应"而非"进程在"——这是比进程心跳更强的活性定义；
- **没有 per-task 心跳/续租**：任务级活性靠 done-ack 超时判 stale，粒度是"整个任务"。

**OpenMax——连接心跳 + 存在心跳，无 job 心跳**：
- 连接心跳：WS heartbeat + 客户端 keepalive-ping + frame-watchdog（收不到帧就判连接死）；HxA Connect 服务端在每次 60s 心跳时校验 session，失效即 `4002` 关连接；
- 存在/状态心跳：reporters 周期上报 online-report + runtime metrics（+ cgroup 资源、计费状态）；
- job 级心跳：公开资料无，UNKNOWN。

**对青砚的验证**：两家都没有 job 心跳，因为它们的"执行者"是常驻的，进程/连接心跳可以代理 job 活性。青砚 serverless 下进程/连接心跳无对象可测，**job 心跳（lease 续租）是唯一正确形态**——Tender worker 的 `renewLease(runId, leaseOwner)`（每步循环前续租，续不上即返回 `lease_lost` 弃权）已经是这个形态，审计建议将其泛化（2A/2C），本研究支持该判断。

### C. 长任务如何 checkpoint？

**Zylos**：任务内**没有步骤级 checkpoint**（任务 = 一段 prompt，粒度粗）。它的 checkpoint 在两个更高层：① **会话级**——context 用量到 80% 阈值触发提前 memory sync、到阈值触发 new-session handoff（旧会话知识落盘 → 新会话冷启动时经 session-init hook + 分层记忆恢复），实质是"用记忆系统给整个 agent 生命做 checkpoint"；② **通信级**——C4 `checkpoints` 表记录 memory sync 已处理到的 conversation ID 边界，防重复处理。（出处：activity-monitor SKILL.md "Context Monitoring"、C4 文档 "checkpoints"）

**OpenMax**：SDK 管的是**通信 checkpoint**：sync 游标（`loadSession/saveSession` 持久化）+ inbox-ledger 连续 ack——重启后从游标续传，一条不丢。任务执行内部的 checkpoint 属 adapter/runtime 职责，公开资料无，UNKNOWN。

**对青砚的验证**：青砚在这一项**强于两家公开形态**：Tender worker 的 `workerStep` 游标（CLAIMED → ENSURE_PAGES → … → FINALIZE，每步完成即持久化 + 续租，`TIME_BUDGET_MS=50s` 用完就交还队列等下次 cron 续推）是真正的**任务内断点续跑**，AgentRunStep DAG 是步骤级持久化。外部研究没有发现更好的 serverless checkpoint 模式；Zylos 研究长文列举的业界对标（Temporal.io durable execution、LangGraph checkpointing）与 Tender 模式同构。**2C "长任务借用 TIME_BUDGET + renewLease + workerStep 游标"被印证为正确方向。**

### D. Scheduler 如何重新唤醒任务？

**Zylos**：C5 daemon 持续轮询 SQLite（1–5 秒级）按 `priority ASC, next_run_at ASC` 取到期任务 → 读 status 文件确认 agent 活着 → **CAS 原子认领**（`UPDATE ... WHERE status='pending'`，失败即已被认领）→ 经 C4 按优先级投递（可 `require_idle` 等 agent 闲时）→ prompt 内嵌 `cli.js done` 完成指令。宕机恢复时用 miss threshold 决定补跑还是跳过。recurring 任务在收到 done ack 后自动排下一次。

**OpenMax**：无公开的时间调度器。唤醒是**消息驱动**：休眠 runtime 由 adapter 经 `POST /wake` 唤起，请求体是结构化的 `raft-channel-wake.v1` schema（`{schema, messageId, conversationId, senderId?, contentPreview}`），响应必须符合 wake-result 契约。时间触发调度 = UNKNOWN（可能在 cws-core 服务端，未公开）。

**对青砚的验证**：青砚的等价物 = Vercel cron（分钟级）扫 `nextAttemptAt <= now` 的 queued run + lease 过期的 running run，CAS `updateMany` 认领——与 Zylos 的轮询 + CAS 完全同构，只是轮询周期从秒级降到分钟级（serverless 约束，可接受）。审计指出的缺口"cron 不处理 `awaiting_approval`、过期 PendingAction 不 reconcile 关联 run"（2C 范围）在 Zylos 有直接对应物：**done-ack 超时 → stale 判定 → 回 pending 或 failed**。青砚应把"审批过期/长期 awaiting"也纳入 cron 的收敛扫描，方向被印证。

### E. reconnect 后怎样恢复身份和状态？

**OpenMax（本题主角）**：`CwsAgentBridge` 的 per-org 生命周期是一个**严格有序的恢复序列**：

1. 首连：`initSyncSeq` 建立同步基线序号；重连：SyncEngine 走 `/sync` 从持久化游标（`loadSession/saveSession`）补差；
2. seed inbox-ledger：用补到的消息初始化账本（去重 + 连续 ack 起点）；
3. arm reporters：恢复在线/指标上报；
4. **self-name hydration barrier**：自我身份（名称/域）水合完成前不处理消息——**身份先于执行**是显式屏障，不是尽力而为。

认证层有独立状态机：ws-ticket 一次性换票 + 4001–4006 close-code 各自对应的恢复路径（`auth-lifecycle.md`）。HxA Connect 侧：`connect → catchup/count → 有事件才分页拉取（event_id 幂等）→ 恢复正常`。

**Zylos**：重启后 guardian 发 recovery catch-up prompt；session-init hook 注入近期对话 + 检查未汇总对话数触发 memory sync；分层记忆（identity/state/references 常载，其余按需）解决冷启动身份问题。

**对青砚的验证**：这是对 Phase 2A 最直接的印证。审计发现"resume 时上下文是重建而非从 metadata 还原（只恢复 rootRunId/traceId/parentRunId），owner 丢失"——这正是 OpenMax 用 hydration barrier 杜绝的病：**身份/上下文没还原完不许执行**。2A 的 `runtimeFromRunMetadata` 还原 helper + resume 路径接入，等价于青砚版的"self-name hydration barrier"；建议实现时保持同样的强序：**先还原 runtime（owner/jobId/taskId），失败即拒绝执行该 run（fail-closed），而不是带着空 owner 继续跑**。

### F. Handoff 如何避免只有自然语言消息？

**HxA Connect（最完整答案）**：交接的"事实"不放在聊天文本里，而是放在四个结构化载体：

- **Thread status** 是机器可读的协作状态机（active/blocked/reviewing/resolved/closed + close_reason），"我卡住了/可以验收了/完成了"都是状态转换而非一句话；
- **Artifact** 是版本化工作产物（`artifact_key` + version 自增 + 类型系统，json 类型有宽容解析与降级标记），下游消费的是 artifact 不是转述；
- **MessagePart** 的 `json` part 允许消息内携带结构化数据段；
- **ack result matrix + revision**：每个写操作有结构化 ack（含 resource_id/version/revision），thread 更新有乐观并发控制——交接的每一步都有可校验回执。

**OpenMax SDK**：更进一步是**契约优先**——inbound-message / wake-request / wake-result 全部有版本化 JSON Schema + golden fixtures，"跨语言合规 = 通过同一套语料"；`failureClass` 是封闭枚举，新增值必须走契约修订。

**Zylos**：反例。任务 prompt 就是自然语言（结构化仅到 SQLite 任务行级别：id/priority/schedule/status），任务间无结构化交接协议——这也解释了为什么 Zylos 生态要在上面叠 HxA Connect。

**对青砚的验证**：审计 §7 的 HandoffPayload 提案（from/to/jobId/taskId/objective/inputs/outputs/evidence/constraints/status，承载于 `AgentRunStep.outputJson`）与 HxA 的 artifact + status 模型同构且更贴合青砚的 run 树。两点可借鉴的增强：① 给 HandoffPayload 加 `schema` 版本字段（学 `raft-channel-wake.v1` 的自描述版本）；② 用 golden fixtures 式契约测试钉死它（青砚已有 golden-flow 契约测试基建，成本低）。HxA 的 `status: blocked` 与青砚提案的 `status: "blocked"` 语义一致，印证提案完备。

### G. Agent failure 如何被上层 owner 感知？

**Zylos**：故障沿三条路上浮：① 心跳状态机把健康态写进 status 文件（ok/recovering/down），C4 据此**拒收新消息并记录来源渠道**，恢复后向这些渠道补发通知——用户不会对着死 agent 说话；② `down` 态明确定义为"等待人工修复"（自动恢复放弃）；③ 调度任务失败/stale 落 SQLite 状态与 history，agent 恢复后可自查。owner 是单一人类主人（单租户单 agent 模型），感知通道就是 IM。

**OpenMax**：① 传输层——reporters 周期上报 online/metrics/billing，服务端可见 agent 掉线（服务端如何通知 org owner = UNKNOWN）；② 投递层——`deliver()` 失败返回结构化 `{ok:false, failureClass, retryAfterMs}`，上游 ledger 不前移游标、按类重试，故障不被吞掉；③ 协作层——HxA thread 转 `blocked`（要求说明阻塞原因）对所有参与者可见，webhook 连续失败标 degraded；④ owner 语义——SDK 有 `onOwnerBind`/`onOwnerNameHint` 回调（owner 绑定提示下发 adapter 持久化），org 有 admin 角色可查全量 thread/audit。

**对青砚的验证**：青砚的感知底座（AgentRunEvent、通知、audit log）齐全，缺的是审计 §8 指出的**owner 落库与关联**（生产入口不注 owner、`recordAiCall`/`writeAuditLog` 无 ownerType/ownerId）——没有 owner 字段，"谁该被通知"就查不出来。2A 补 owner 接线 + 2D Job 完成/失败汇报给 Owner 的规划被印证。另借鉴 Zylos 的一条：**故障期不要静默**——run 转 `needs_human`/`failed` 时应主动通知 owner（青砚已有 urgent 通知 + UI 横幅基建，接上即可），而非等用户来查。

### H. 是否有 lease fencing / execution ownership 概念？

**Zylos**：有 ownership 获取，无 fencing。CAS 认领（`status='pending' → 'running'`）解决"同一任务只派发一次"，但认领后**没有 owner token、没有续租**——因为执行者永远是同一个单机 agent，不存在两个 worker 抢同一任务的场景；任务级失控靠 done-ack 超时兜底。研究长文明确建议多 worker 场景需要更强手段（幂等键 `SHA-256(task_id + scheduled_time + args)`、分布式锁、`PENDING→IN_PROGRESS→COMPLETED` 状态机加锁转移）。

**OpenMax**：无 job lease 概念（SDK 不管任务执行）。execution ownership 表达为**每个 agent 一个 bridge 实例 + per-org 连接 + ledger 连续 ack**（隐式单写者假设）；数据层面用 thread `revision` 乐观并发（CAS）防并发写覆盖。fencing token = 无，UNKNOWN（服务端）。

**对青砚的验证**：青砚的需求比两家都强（serverless 下同一 run 可能被并发 cron tick 双认领），而且**仓库里已有最强实现**：Tender worker 的 `leaseOwner = "tender-worker:" + randomUUID()`，之后每次写回都带 `WHERE leaseOwner = ?` 条件（`renewLease`/`persistStep`/finalize 全部如此），续租失败即返回 `lease_lost` 主动弃权——这就是 fencing token 的实战形态，比 Zylos 的裸 CAS 更强。相比之下 `queue.ts` 的 v1 lease 只有时间戳无 owner token（3 分钟后可被二次认领且旧实例还能写回）。**结论：2A 泛化 lease 时应采用 Tender 的 leaseOwner 形态而非 v1 的裸 lease——这是本研究对 2A 设计唯一的"调整级"建议（审计已倾向此方向，此处升格为明确要求）。**

### I. Human Intervention 如何暂停与继续？

**Zylos**：反面教材（对青砚而言）。默认 `auto_approve_permission=true`——权限提示由 hook 自动按回车通过，文档明言 full-delegation 是有意设计。人工介入只剩三处：任务级 `pause/resume` CLI、`down` 态等人工修复、可选关掉 auto-approve。**没有审批载荷校验、没有审批幂等、没有执行时重授权。**

**OpenMax/HxA**：协作层有像样的暂停语义：thread `blocked`（"需要外部信息或决策才能继续"，要求说明阻塞原因）→ 人（bot_owner/org_admin 经 session 登录，与 bot 走同一套 thread API）介入 → 回 `active` 继续；`reviewing` 是"等验收"暂停；`ThreadPermissionPolicy` 可把 resolve/close 权限收敛到指定 label 或 initiator（治理钩子）。但这是**协作状态语义**，不是审批安全机制——没有 payload hash、没有决定幂等表、没有 fail-closed 授权。

**对青砚的验证**：青砚的 PendingAction 体系（payloadHash + 执行时重授权 + fail-closed + ApprovalDecisionIdempotency）**强于两家公开形态，保持不动**（与 Phase 1.1 封板结论一致）。可借鉴的只有状态语义一条：HxA 区分 `blocked`（等信息/决策）与 `reviewing`（等验收）两种"等人"，印证审计 §6/§9 的判断——青砚把四种"等待人"表述收敛为 `awaiting_approval`（等审批）/`needs_human`（等非审批输入）两值（2C）是同一思路，且两值恰好对应 HxA 的 reviewing/blocked 语义分野。

### J. 哪些设计青砚已经具备？

| 外部 pattern | 青砚现状 |
|---|---|
| CAS 原子认领（Zylos dispatchTask） | ✅ `queue.ts` claimAgentRun / Tender claimRun / MarketResearchRun，同构且已在产 |
| fencing token + 续租 | ✅ Tender `leaseOwner` + `renewLease`（强于 Zylos）；❌ 未泛化到 AgentRun（2A 补） |
| 任务内断点 checkpoint | ✅ Tender `workerStep` 游标 + `TIME_BUDGET_MS`；✅ AgentRunStep 步骤持久化；❌ v2 stuck run 无人认领（2A 补） |
| stale/孤儿检测 | ✅ Tender `STALE_RUN_MS=30min` 判 stale；❌ awaiting_approval 无 cron 收敛（2C 补） |
| 显式完成 ack | ✅ step 终态写入即 ack（比 Zylos 的 prompt 内嵌指令更可靠——不依赖 LLM 记得执行） |
| 投递/决定幂等 | ✅ PendingAction.idempotencyKey + ApprovalDecisionIdempotency；△ step idempotencyKey 只写不读（2B 补短路） |
| 审批暂停/恢复 | ✅ V2/Supervisor 审批 resume 闭环，安全机制强于两家 |
| owner/identity 契约 | ✅ AIRuntimeContext（actor/agent/owner/jobId/taskId）契约完备；❌ 生产未接线、resume 不还原（2A 核心） |
| 结构化交接 | △ V2 priorEvidence（单域步骤接力）；❌ 通用 HandoffPayload（2B，唯一"真正新建"项） |
| 状态机词汇 | ✅ v2 状态词汇表覆盖全部逻辑 Job 状态（HxA 五态是其子集语义） |
| 配额/失控防护 | ✅ quota governance（MAX_CONCURRENT_RUNS/DAILY_AGENT_RUNS + 熔断告警），对应 Zylos 研究长文的"三条外部护栏"共识 |

---

## 4. 对照矩阵（核心交付）

状态定义：READY = 已在产可复用；PARTIAL = 有存量但覆盖不全/未接线；MISSING = 无等价物。建议定义：REUSE = 复用青砚既有实现；ADAPT = 借其不变量、按 serverless 改造落地；IGNORE = 明确不抄。

| # | Pattern 描述 | 出处 | Qingyan equivalent（模型/文件） | Status | Recommendation |
|---|---|---|---|---|---|
| 1 | **Scheduler 常驻轮询**：PM2 daemon 秒级轮询 SQLite 到期任务，按 priority+due 排序派发 | Zylos C5 文档；研究长文 §Hybrid | Vercel cron `/api/cron/agent-runs` + `AgentRun.nextAttemptAt`（`src/lib/agent-runtime/queue.ts`） | PARTIAL（仅 background_conversation） | **ADAPT**：不做常驻进程，把 cron+CAS 扫描泛化到 workforce runType（2A）；轮询降到分钟级是 serverless 的合理代价 |
| 2 | **Heartbeat 探活**：30min 语义心跳探针（带 ack deadline）+ 1s 进程检查，验证"会响应"而非"进程在" | zylos-core `skills/activity-monitor/SKILL.md` §Heartbeat | 无进程可探；等价物 = lease 续租（`tender-auto-analysis/worker.ts` `renewLease`） | PARTIAL（仅 Tender） | **ADAPT**：job 心跳 = 分段执行内定期 `renewLease`，续不上即弃权；进程/连接心跳本身 IGNORE（无对象） |
| 3 | **Activity monitor 崩溃恢复**：独立守护进程 5s 判死自动重启 + recovery prompt 补课 | 同上 §Guardian Behavior | 等价物 = lease 过期后 cron 再认领 + resume 时上下文还原（`queue.ts` claim 条件含 `leaseExpiresAt <= now`） | PARTIAL（v2/workforce 无认领） | **ADAPT**：2A lease 泛化即是青砚版 guardian；"recovery prompt"对应 `runtimeFromRunMetadata` 还原后续跑 |
| 4 | **显式完成 ack**：任务完成必须 `cli.js done`，超时未 ack 判 stale → 回 pending/failed；recurring 靠 ack 续排 | Zylos C5 文档；研究长文 §Task Completion Acknowledgment | step/run 终态写入（executor/persist）+ Tender `STALE_RUN_MS` stale 判定 | PARTIAL（awaiting/过期 run 无收敛） | **ADAPT**：2C cron 对超时 awaiting_approval/无进展 run 做 stale 收敛（reconcile → needs_human/failed）；青砚终态由代码写入而非 LLM 自觉，天然强于 Zylos |
| 5 | **Miss threshold**：过期超阈值的任务跳过/标失败，防宕机恢复后任务洪泛 | Zylos C5 文档 §Task Lifecycle；研究长文 §Missed Schedules | Tender `STALE_RUN_MS`；AgentRun 无对应策略 | PARTIAL | **ADAPT**：workforce lease 泛化时带上"长期无进展即 stale-failed"上限（抄 Tender），防僵尸 run 无限续跑 |
| 6 | **Checkpoint**：context 阈值触发 memory sync + new-session handoff（会话级）；C4 checkpoints 表（通信级） | activity-monitor SKILL.md §Context Monitoring；C4 文档 | Tender `workerStep` 游标 + `TIME_BUDGET_MS`（任务级，更强）；AgentRunStep DAG 持久化 | READY（Tender 模式）/ PARTIAL（v2 未用） | **REUSE**：青砚任务级 checkpoint 优于两家公开形态；2C 按计划把 TIME_BUDGET+renewLease+游标泛化即可，无需引入外部模式 |
| 7 | **Reconnect 状态同步**：initSyncSeq / `/sync` catch-up / saveSession 游标 / self-name hydration barrier（身份先于执行） | openmax-agent-sdk README §Orchestrator；CONTRACT.md | `runtimeFromRunMetadata`（2A 计划新增，`src/lib/ai/runtime-context.ts`）+ resume 路径（`agent-runtime/process.ts`） | MISSING（当前 resume 重建上下文、丢 owner） | **ADAPT**：2A 核心项。落地时保持 OpenMax 的强序语义：还原失败 = 拒绝执行（fail-closed），不带空身份续跑 |
| 8 | **Inbox-ledger 去重投递**：dedupe + 连续 ack，游标只在连续确认后前移，断连不丢不重 | openmax-agent-sdk README §sync | `PendingAction.idempotencyKey` + `ApprovalDecisionIdempotency`（审批线 READY）；`AgentRunStep.idempotencyKey` 只写不读（`agent-runtime-v2/executor.ts`） | PARTIAL | **ADAPT**：2B step 执行前幂等短路（读后跳过）补齐"消费侧去重"；不建消息账本表——AgentRunStep 行即是账本 |
| 9 | **投递 ack 不变量**："只有消息真正进入 runtime context 才 resolve {ok:true}，false ack 丢消息" | openmax-agent-sdk README（INVARIANT 原文）；wake-result.schema.json | step 状态/handoff 写入的事务边界（executor persist 与业务副作用同事务/同序） | PARTIAL（无明文不变量） | **ADAPT**：把它写成青砚 handoff 的设计不变量——"HandoffPayload 只有持久化到 outputJson 且下游 step 转 ready 后才算交接完成"；反向同样成立：先落库再 ack 上游 |
| 10 | **Agent identity 解析**：identity/ 域解析 + self-name hydration；owner 经 onOwnerBind 下发持久化 | openmax-agent-sdk README §identity | `AIRuntimeContext`（actor/agent/owner 三元组，`src/lib/ai/runtime-context.ts`）+ `AgentRun.metadata` 投影 | PARTIAL（契约 READY、生产未接线） | **ADAPT**：2A 全入口注入 runtime + owner 落库 + audit 补 ownerType/ownerId。青砚契约本身不弱于 OpenMax，缺的只是接线 |
| 11 | **结构化 handoff**：Thread 状态机 + 版本化 Artifact（key+version+类型系统）+ json MessagePart + 结构化 ack + revision 乐观锁 | hxa-connect `docs/B2B-PROTOCOL.md` §3/§5/§6 | HandoffPayload 提案（审计 §7，承载 `AgentRunStep.outputJson`，零迁移） | MISSING（V2 priorEvidence 仅单域接力） | **ADAPT**：2B 落地 HandoffPayload；借鉴两点——payload 带 `schema` 版本字段（学 `raft-channel-wake.v1`）、用 golden fixtures 契约测试钉死（学 schemas/v1+fixtures/v1）。不建 Thread/Artifact 表——run 树 + outputJson 已够 |
| 12 | **Human intervention**：HxA `blocked`（等信息）/`reviewing`（等验收）状态 + PermissionPolicy 收敛 resolve 权限；Zylos 默认 auto-approve（full-delegation） | B2B-PROTOCOL §1/§3；activity-monitor SKILL.md §Permission Auto-Approve | PendingAction + payloadHash + 执行时重授权 + fail-closed + `resumeRuntimeV2AfterApproval`（`src/lib/approval/port.ts`） | READY（安全机制强于两家） | **REUSE** 青砚自己的；Zylos auto-approve **IGNORE**（与封板 Approval 直接冲突）。HxA 的 blocked/reviewing 二分印证 2C 的 `needs_human`/`awaiting_approval` 两值收敛 |
| 13 | **Lease / ownership**：Zylos CAS 认领（无 fencing、无续租）；HxA thread `revision` 乐观并发；OpenMax 单 bridge 隐式单写者 | 研究长文 §Idempotency and Concurrency；B2B-PROTOCOL §7 | Tender `leaseOwner`（fencing token）+ `renewLease` + 条件写回（`WHERE leaseOwner=?`）；`queue.ts` 裸 lease（无 owner token） | PARTIAL（最佳实现未泛化） | **REUSE**（Tender 形态）：2A 泛化时采用 leaseOwner token 形态而非 v1 裸 lease——青砚多实例并发风险高于 Zylos 单机模型，裸 CAS 不够 |
| 14 | **契约优先协议**：schemas/v1 版本化 JSON Schema + fixtures/v1 golden 语料，"通过语料 = 合规"，封闭 failureClass 枚举 | CONTRACT.md 全文 | golden-flow 契约测试（V2 审批 resume 已覆盖）；`src/lib/agent-runtime/__tests__/`（2A 计划） | PARTIAL | **ADAPT**：给 HandoffPayload 和 workforce 生命周期写 fixtures 式契约测试（输入→期望状态序列），防多人并行开发中的契约漂移 |
| 15 | **健康感知的入口 + 故障主动通知**：C4 在 agent recovering/down 时拒收并记录渠道，恢复后补发通知 | Zylos C4 文档 §Health-Aware Intake | 配额熔断告警（urgent 通知 + UI 横幅，Governance Gate）；run 失败通知未统一到 owner | PARTIAL | **ADAPT**：2D Job 汇报给 Owner 时覆盖失败/needs_human 场景（主动通知而非等查询）；"拒收新工作"对应 Job 创建时预检配额（已有 evaluateQuota） |
| 16 | **Idle-gating / require_idle 投递**：等 agent 空闲再注入任务，防打断交互 | Zylos C5/C4 文档 | 无对应问题（serverless 无共享会话可打断；每个 run 独立实例） | — | **IGNORE**：这是"多来源共享单一 tmux 会话"的专属问题，青砚架构天然免疫（同 Claude Code Routines 的隔离会话思路） |

---

## 5. TOP_5_PATTERNS_WORTH_ADOPTING

1. **leaseOwner fencing token + 续租式 job 心跳**（Zylos CAS 认领印证方向，青砚 Tender 已有更强实现）
   → 落点：**2A** `src/lib/agent-runtime/queue.ts` lease/claim 泛化时，采用 Tender 的 `leaseOwner = "workforce-worker:" + randomUUID()` + 所有写回带 `WHERE leaseOwner=?` + 分段执行内 `renewLease`，而非复制 v1 的裸时间戳 lease。
   → 为什么值得：这是审计风险表第一条"duplicate execution"（3 分钟后二次认领 + 旧实例仍可写回）的根治方案；外部研究确认两家都没有比这更强的公开机制，青砚自己的 Tender 模式就是最佳答案，泛化成本最低。

2. **显式完成 ack + stale 孤儿收敛**（Zylos `cli.js done` + done-ack 超时判 stale + miss threshold）
   → 落点：**2C** `/api/cron/agent-runs` + `/api/cron/approval-timeout`：把"超时 awaiting_approval"、"长期无进展的 executing run"纳入 cron 收敛扫描（reconcile → needs_human / stale-failed），并给 workforce run 加 `STALE_RUN_MS` 式无进展上限（抄 Tender）。
   → 为什么值得：Zylos 证明了"调度器绝不假设派发即成功"是孤儿检测的根基；青砚当前 orphan PendingAction → run 永久 awaiting 的缺口正是缺这层收敛，且青砚的 ack 由代码写入（step 终态）而非依赖 LLM 自觉执行 CLI，可靠性天然更高。

3. **投递 ack 不变量**（OpenMax "只有真正进入 runtime context 才 resolve {ok:true}，false ack 丢消息"）
   → 落点：**2B** HandoffPayload 写入语义（`src/lib/workforce/handoff-contract.ts` + `agent-runtime-v2/executor.ts`）：交接只在 payload 持久化到 `outputJson` 且下游 step 状态转 `ready` 之后才算完成；上游 step 转终态与 handoff 落库必须同事务（或先落库后转态），杜绝"上游标完成、下游没拿到"的丢交接窗口。
   → 为什么值得：这是一条可以直接写进代码评审 checklist 的单句不变量，成本为零；它把审计 §6 的"assistant-reconcile 先标 completed 再被 resume 改回"这类顺序依赖竞态，上升为明确的设计原则（2C 单一 resume 入口的理论依据）。

4. **契约优先：版本化 schema + golden fixtures**（OpenMax schemas/v1 + fixtures/v1，"通过语料 = 协议合规"）
   → 落点：**2B** HandoffPayload 带 `schema: "qingyan-handoff.v1"` 自描述版本字段；`src/lib/agent-runtime/__tests__/workforce-*.test.ts` 用 `{input, expected}` golden 语料钉死 handoff 契约与 Job 生命周期状态序列（青砚 golden-flow 测试基建已在，V2 审批 resume 已有先例）。
   → 为什么值得：Phase 2A 与其他切片将并行开发，OpenMax 用一套语料防止 JS/Python 两个实现漂移的做法，同样能防止青砚三条执行栈（v1/v2/supervisor）对 handoff 的理解漂移；封闭枚举（failureClass 思路）也适用于 HandoffPayload.status。

5. **"身份先于执行"的还原屏障**（OpenMax self-name hydration barrier + initSyncSeq/catch-up 强序恢复）
   → 落点：**2A** `runtimeFromRunMetadata`（`src/lib/ai/runtime-context.ts`）+ resume 路径（`agent-runtime/process.ts`、`approval/port.ts`）：恢复序列固定为"还原 owner/jobId/taskId → 校验完整 → 才允许执行"；metadata 缺失/损坏时 fail-closed（拒跑并标 needs_human），绝不带空 owner 续跑。
   → 为什么值得：审计发现的"resume 丢 owner"正是 OpenMax 用 barrier 从架构上杜绝的病；把还原做成硬性屏障而非尽力而为，让 2A 的验收标准（"断电→cron 认领→owner/上下文完整还原"）有了明确的失败语义。

## 6. TOP_5_PATTERNS_NOT_TO_COPY

1. **PM2 常驻 daemon 调度器 + Activity Monitor 守护进程**（Zylos C5/C2 整套进程模型）
   → 为什么不抄：与 Vercel serverless 根本冲突——没有可长驻的进程、没有 tmux 会话、没有本地 SQLite。青砚的等价物（cron + DB lease + CAS）已经覆盖其全部不变量；引入常驻 worker 等于换基础设施，违反"优先保持当前项目稳定"的 MVP 决策原则。秒级轮询降为分钟级 cron 是已知且可接受的代价。

2. **权限提示自动通过（auto_approve_permission，full-delegation 模型）**（Zylos hook-auth-prompt.js 默认对所有权限提示自动按回车）
   → 为什么不抄：与青砚 Phase 1.1 封板的 Approval 体系（payloadHash + 执行时重授权 + fail-closed + 决定幂等）正面冲突。Zylos 是单人自用、机器全权委托的场景；青砚是多租户、面向企业的产品，外发/承诺永远过 PendingAction 是已锁定的红线（审计 §11 non-scope）。Zylos 研究长文自己引用的三起事故（Replit 删库、OpenClaw 删邮件、Copilot 审批绕过 CVE-2025-53773）恰恰论证了青砚现有设计的正确性。

3. **进程/连接心跳体系**（Zylos 30min 语义探针 + 1s 进程检查；OpenMax WsClient keepalive-ping + frame-watchdog + 4001–4006 重连状态机）
   → 为什么不抄：心跳的被测对象（常驻进程/长连 WS）在青砚不存在。serverless 下"活性"唯一可靠的表达是 lease 未过期 + 有进展写回；建 WS 长连或心跳服务既无宿主也无必要。job 级活性用 renewLease（见 TOP5-1）表达即可。

4. **独立的 agent 消息总线 / 收件账本基础设施**（Zylos C4 SQLite 队列 + priority + idle-gating；OpenMax inbox-ledger + SyncEngine）
   → 为什么不抄：这些解决的是"多渠道消息汇入一个共享会话"和"不可靠长连上的不丢不重"，青砚的 worker 间通信走 DB 行（AgentRunStep/outputJson）+ 同库事务，天然有序且不丢。审计 §7 已定调"Handoff 只是数据契约，路由/授权仍走 Supervisor/planner + scopeGuard + approval gate，不新建通信总线"——本研究印证：抄不变量（去重、连续确认、真投递才 ack），不抄账本表和队列进程。idle-gating 同理（矩阵 #16）。

5. **平等对等的 Thread 协作平面作为任务编排层**（HxA Connect B2B："所有参与者平等、无 client/server 之分"、任何参与者默认可改状态、bot 花名册/profile 目录）
   → 为什么不抄：三重不适配。① 职责模型冲突：青砚 Workforce 是 **owner 问责制**（Human Owner → Job → Supervisor → Worker 的树状问责链），HxA 的平等对等模型没有 owner 语义，审计 §8 的三元组会被稀释；② 与已封板 RBAC/Approval 重复：HxA 的 ThreadPermissionPolicy/label 是一套独立授权维度，引入即第二套授权路径（审计风险表 "stale authorization" 明确要求只走已加固的 executor 线）；③ 与 non-scope 冲突：bot 花名册 ≈ "70 agents 名册"、开放 thread ≈ "agent group chat"，均在 §11 明确排除。HxA 值得拿的只有状态语义与 artifact 版本化思想，已在 TOP5-3/4 以数据契约形式吸收。

---

## 7. 结论：对 Phase 2A/2B 设计的验证

### 被外部研究印证的青砚决策

1. **"Job = root AgentRun，不建新表"（审计 §3）**——Zylos 任务就是 SQLite 一行、OpenMax 协议层根本不建任务模型，两家都证明 durable job 的本质是"一行带状态机的持久化记录 + 原子认领"，青砚 AgentRun 列已超配（attempts/lease/nextAttemptAt/planJson/metadata）。开新表的理由不存在。
2. **"cron + lease/claim 泛化，而非新建调度器"（2A）**——Zylos C5 的全部调度不变量（轮询、CAS 认领、优先级、miss threshold、孤儿检测）在青砚都有 DB 等价物；差的只是覆盖面（v2/workforce runType），不是能力。
3. **"resume 必须从 metadata 还原 runtime"（2A `runtimeFromRunMetadata`）**——OpenMax 的 initSyncSeq/catch-up/self-name hydration barrier 是同一问题的成熟答案：恢复 = 严格有序的"先身份后执行"。青砚现状（resume 重建上下文、丢 owner）正是该屏障要杜绝的反模式。
4. **"HandoffPayload 数据契约，不建通信总线"（2B / 审计 §7）**——HxA Connect 证明结构化交接的核心是**状态机 + 版本化产物 + 可校验回执**，与传输层无关；青砚承载于 outputJson 的方案保留了全部语义、砍掉了全部基础设施。
5. **"审批体系保持不动"（Phase 1.1 封板）**——两家的人工介入机制都弱于青砚（Zylos 直接自动通过权限、HxA 只有协作状态无审批安全）；Zylos 研究长文引用的三起真实事故反向论证了 payloadHash + fail-closed + 幂等的必要性。
6. **"等待语义收敛为 awaiting_approval / needs_human 两值"（2C）**——HxA 的 reviewing（等验收）/blocked（等信息）二分与之一一对应，独立演化出相同分类，强印证。
7. **"配额/熔断护栏在 LLM 外部"（Governance Gate）**——Zylos 研究长文的行业共识（硬迭代上限、重复调用探测、预算熔断，"kill switch 必须在 agent 控制面之外"）与青砚 quota governance 完全一致。

### 需要调整/升格的点（共 2 处，均为收紧而非返工）

1. **2A lease 泛化必须采用 leaseOwner fencing token 形态**（矩阵 #13、TOP5-1）：审计原文允许"复制既有 CAS 模板"，v1 `queue.ts` 的裸 lease（无 owner token、写回不带条件）在并发 cron 下有旧实例写回窗口。本研究升格为明确要求：泛化时抄 Tender 的 `leaseOwner` + 条件写回 + `renewLease`，一次到位，避免 2C 再迁移。
2. **HandoffPayload 增加 `schema` 版本字段 + golden fixtures 契约测试**（矩阵 #11/#14、TOP5-4）：审计提案缺自描述版本；OpenMax 的经验是"契约没有版本和语料，并行实现必然漂移"。2B 落地时补上，成本一行字段 + 一组测试文件。

### 一句话总结

外部研究没有发现任何需要推翻 Phase 2A/2B 设计的证据：Zylos/OpenMax 在常驻进程/长连世界里沉淀的全部可迁移不变量（原子认领、显式 ack、孤儿收敛、身份先于执行、结构化交接、真投递才确认），青砚要么已有更强实现（fencing lease、审批安全、任务内 checkpoint），要么恰好是 2A/2B/2C 已排期的接线项。**PHASE_2_IMPLEMENTATION_READY = YES 的审计结论经外部对照后维持不变，且获得两处可执行的收紧建议。**

---

*本文档为只读研究产物，未修改任何代码/Prisma/UI，未 commit。所有 UNKNOWN 标注处均为公开资料不足，未做推测。*
