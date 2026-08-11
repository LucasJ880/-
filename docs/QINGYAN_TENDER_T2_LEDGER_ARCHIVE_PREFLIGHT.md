# Qingyan Tender T2 Preflight — Legacy Event Store Decision Gate + Archive Contract Freeze

| 项 | 值 |
|---|---|
| 原审计基线 | `main @ 4f082cd`（含 PR #95 Tender/Project Security P0） |
| **Final Review 基线** | `main @ 8303145`（= PR #93 Workforce 2B-2 merge commit `83031455d73…`；其后 main 无新 commit） |
| 分支 | `design/tender-t2-ledger-archive-preflight`（docs-only，已 rebase 到 Final Review 基线） |
| 日期 | 2026-08-10 |
| 修订 | 2026-08-10 **Final Contract Micro-Fix Review**（§21）：①AgentRunEvent 结论对齐 #93（§4）；②ProjectEvent seq 分配契约冻结（§5.6）；③ProjectCost revision 审计（§6.3）；④Archive 证据不可变与访问治理分离 + 版本唯一约束（§9）；⑤Deleted Project retention/authorization 契约（§15.8）；⑥T2 Entry Gate 定审 PASS（§17） |
| 性质 | **ARCHITECTURE PREFLIGHT / READ-ONLY AUDIT**：本轮 `MIGRATION_CREATED = NO`、`WORKFORCE_RUNTIME_MODIFIED = NO`、`PRODUCTION_BEHAVIOR_CHANGE = NO`。所有模型均为 T2 提案，migration 需单独批准 |
| 上游 | `QINGYAN_TENDER_T0_MEMORY_INTELLIGENCE_ARCHITECTURE.md`（§3/§5/§6/§14）、`QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`（T2 Entry Gate） |
| 角色 | 本文档 = 路线图 **T2-PR0（Gate 材料）** 的定稿提批版：9+ 套存量存储判决、Source of Truth 边界、Schema/Migration/Backfill 提案、T2 Entry Gate 键值 |
| 方法 | 全部判决基于本基线代码逐点核查（写入点 / 读取点 / 可变性 / 作用域 / 留存），证据以 `file:line` 给出；与 T0 断言冲突处以本次代码核查为准并在 §19 登记修正 |

---

## 0. 执行摘要与最终决策键

**审计范围**：全库 232 个 Prisma 模型中，逐一核查 26 套「事件 / 审计 / 活动 / 历史 / 状态 / 通信 / 成本」形态的存储（判决矩阵 §2；远超 T0 §2 列举的 9 套），外加 6 组「就地覆盖、无历史」的业务状态存储（§1.4）。

**核心结论**：

1. **没有任何存量存储可以承担 Tender 业务账本**（§2、§4、§5.1）。最接近的四个候选被排除的一句话理由：`AuditLog` 是技术审计（orgId/projectId 可空、String payload、项目删除时被摘挂、无幂等）；`AgentRunEvent` 是运行时遥测（无 projectId、随 Run 级联删除、best-effort 追加语义——#93 后 sequence 冲突已有界重试，但外层失败仍 log + return null，见 §4）；`ProjectMessage(SYSTEM)` 是人类叙事流（无 orgId、无结构化词表、无幂等键）；域内 from/to 事件表（`OrderStatusLog`/`PublishJobStatusEvent`）形状正确但域作用域窄且**零读者**。
2. **今天多类 tender 业务事实正在被静默覆盖、无任何历史**（§1.4）：供应商选定只是一个 boolean（无人、无时间、无审计，`src/lib/inquiry/service.ts:346-359`）；报价改价就地覆盖旧价永久丢失（`service.ts:299`）；GO/NO_GO 决策理由超 200 字符改一次即永久丢失（`go-decision.ts:100-104`）；报价单确认无 confirmedAt/By/审计（`quotes/[quoteId]/route.ts:52`）；标记招标结果不写讨论流（唯一在 AuditLog 可见）。这是 ProjectEvent 的直接业务动机。
3. **Tender Archive 必须新建**（§8、§9）：`ProjectDocument` 无 orgId/mimeType/sourceUrl/版本链/软删，删除 = 硬删 + 删 blob + 级联抹掉页级文本与历史分析 Run 的证据链（`files/[fileId]/route.ts:10-33` + schema Cascade）；BidToGo 外链招标文件从不下载固化（blobUrl/contentHash 全空）；`contentHash` 有索引但全库零读路径；`MarketSnapshot` 名为快照实为 upsert 可变行。唯一可作模板的是 `ProductContentSnapshot`（全库唯一真 append-only 快照表）。
4. **成本体系对人工侧不存在**（§6）：全库无任何工时/费用/报销模型；tender AI 成本**实际完全未入账**（`tokenUsageJson` 是零写入死字段；cron worker 无 request context 时 usage bridge 静默丢弃）——比 T0 §2 的记载更严重。

**最终决策键（Final Contract Micro-Fix Review 后定稿，§21）**：

```
PROJECT_EVENT_DECISION            = OPTION D（新建 ProjectEvent + ProjectEventActor；
                                    另含独立 ProjectCost 成本记录表，见 §6/§14）
ARCHIVE_MODEL_DECISION            = NEW_SOURCE_SNAPSHOT_REQUIRED（新建 TenderArchiveItem，
                                    实现 Source Snapshot Contract v1，见 §9）
SCHEMA_CHANGE_REQUIRED_FOR_T2     = YES（4 张新表 + 少量 additive 列；仅提案，见 §15）
MIGRATION_CREATED                 = NO
WORKFORCE_RUNTIME_MODIFIED        = NO
PRODUCTION_BEHAVIOR_CHANGE        = NO
T2_ARCHITECTURE_FINAL_REVIEW      = PASS（8/8 Gate 键 PASS，见 §17）
T2_READY_FOR_IMPLEMENTATION       = YES
  （语义仅为：允许开启独立的 T2-M1 Schema Foundation migration PR，按 §17.2 冻结顺序推进；
   不代表自动开始实施。四个基础模型的正式批准 = 人工 Review 本 PR 后的下一条指令。）
```

---

## 1. Legacy Event Inventory（存量事件/历史存储全量清单）

判定维度：**(a)** 谁写 **(b)** 何时 **(c)** 可变性 **(d)** 谁读 **(e)** org/project 作用域 **(f)** 留存 **(g)** 业务事实 vs 技术数据。全部存量存储均无任何留存/清理任务（`vercel.json` 17 个 cron 中零清理，`src/app/api/cron/**` 无 retention/purge/cleanup）——(f) 不再逐行重复。

### 1.1 通用/项目层事件存储

| # | 存储 | (a) 写入 | (c) 可变性 | (d) 读取 | (e) 作用域 | (g) 性质 |
|---|---|---|---|---|---|---|
| 1 | `AuditLog`（schema:1283） | 3 入口共 **195 调用点 / 133 文件**：`logAudit()`（吞异常，186 点）、`writeAuditLog(tx,…)`（事务内抛错，8 点：org-access / handoff×3 / tender review / operations transition / sales actions×2）、`db.auditLog.create` 直写（仅 governance，`capabilities/governance/audit.ts:26`） | 接近 append-only；**例外**：项目删除时 `tx.auditLog.updateMany({projectId:null})` 摘挂（`projects/[id]/route.ts:294`）→ 该项目活动时间线整段消失 | 平台管理页（platform admin only）、`listProjectActivity`（项目详情页默认 `includeSystemEvents=true` **全量内存分页**，`activity/query.ts:65-91`）、Notification 派生（仅 6 类 action）、AI 上下文（`ai/memory.ts:74`）、仪表盘计数 | `orgId?`/`projectId?`/`workspaceId?` **全可空**，`userId` 必填；**`traceId` 列对 186 个主流写入点全部空置**（correlation 被折叠进 `afterData._runtimeCorrelation`，`audit/logger.ts:57-70`），`@@index([traceId])` 空转 | **混合**：业务事实（成员/阶段/结果）与技术噪声（runtime_run/runtime_tool/ai_generate）同表，仅靠 action 前缀区分；`beforeData/afterData` 是 `String?` 非 Json |
| 2 | `ProjectMessage(type=SYSTEM)`（schema:1911） | 仅 2 个 create 点，SYSTEM 侧全部经 13 个语义 helper（`project-discussion/system-events.ts:34`），外部 14 调用点（项目创建/成员/阶段/放弃/任务/日历/邮件发送/AI 备注等），多数传 `tx` 与业务写同事务 | **事实上 append-only**：全库零 `projectMessage.update/delete`；`editedAt/deletedAt` 是**死列**（UI 有渲染分支但永不触发，`project-discussion-message-item.tsx:65`；讨论 API 无 PATCH/DELETE） | 讨论流 UI + `listProjectActivity` 双读面（项目详情页默认开启） | `projectId` 非空冗余存储；**无 orgId**（靠 project 推导）；`senderId?` 可空 | **纯业务事实**，但形态是**中文叙事句 + 弱类型 metadata**，非结构化事件（fromStage/toStage 藏在 metadata Json） |
| 3 | `Notification`（schema:1576） | 双来源：AuditLog 懒派生（用户打开通知页/轮询未读数时才回溯 7 天，`notifications/service.ts:185,505`；幂等 `sourceKey="audit:{id}"`）+ 15 个直写点/9 文件 | **高度可变**（markRead/markDone/snooze/batchAction），是工作流状态不是账本 | 全局 header 铃铛 + 通知中心 + 秘书简报 + 推送——**消费最实的存储** | `userId` 必填 per-user 扇出；**审计派生路径 orgId 硬编码 null**（`service.ts:329,455`） | 审计事实的**可变投影**（sink 不是 source） |
| 4 | `ProjectProgressSummary`（schema:1777） | 单写点 `progress/summary-builder.ts:317`；manual/cron（每日）/agent 三触发 | 生成内容不可变 + **审核信封可变**（reportStatus/reviewedBy…，`summary-builder.ts:383`）；每次生成新行，历史全留 | 项目详情页专属组件；review PATCH 仅 `requireProjectReadAccess`（读权限即可改审核态） | `projectId` 非空 Cascade；**无 orgId** | AI 生成的**技术产物**（promptVersion/modelUsed/generationTimeMs）+ 人工审核工作流 |
| 5 | `TaskActivity`（schema:485） | 6 个 create 点无封装 service（tasks route ×2、comments、pending-actions executor、marketing ×2）；detail 是手工拼的中文 diff 串 | append-only；但随 Task **Cascade 硬删** | 唯一读者 `tasks/[id]/activities/route.ts:7`——**该 route 只有 withAuth，无任何 task/project/org 归属校验**（任意登录用户可读任意任务活动流） | **无 orgId 无 projectId**，仅 taskId+actorId | 混合（状态变更事实 + "更新了任务信息"噪声），action 无词表常量 |

### 1.2 域内 from/to 状态事件表（形状最接近账本纪律的三张）

| # | 存储 | 关键事实 |
|---|---|---|
| 6 | `OrderStatusLog`（schema:597） | 唯一写点 `blinds-orders/[id]/transition/route.ts:68`，**与订单 update 不同事务**（存在状态已改日志未写窗口）；fromStatus/toStatus/note/operatorId 结构干净；**全库零读者**；无 orgId（BlindsOrder 本身也无）；operatorId 裸 String 无 FK |
| 7 | `PublishJobStatusEvent`（schema:5598） | **本组模型最完整**：fromStatus?/toStatus/actorType(`user\|ai\|system\|worker\|webhook`)/actorId?/reasonCode/reason/metadata Json；状态流转写在 `$transaction` 内且有 `canTransition` 状态机闸门（`operations/publish-events.ts:28-52`）；扇出创建不在事务内；**全库零读者**；双写 AuditLog 仅在 actorId 存在时（system/worker 流转只在事件表有）；org 作用域完整 |
| 8 | `FabricStockLog`（schema:678） | 唯一写点 `inventory/[id]/route.ts:65`，**日志先写、库存后改且无事务**（失败方向是多记）；type 直接透传 body 未校验；**全库零读者**；无 orgId（FabricInventory SKU 全局唯一 = 单租户假设） |

> 判读：这三张表证明「结构化 from/to + actorType + reason」的事件纪律在本库已有先例（`PublishJobStatusEvent` 是 ProjectEvent 词表设计的直接参照），但也证明**只写不读的事件表会退化为死重**——ProjectEvent 必须与投影（Timeline/Cost/People）同批落地，避免成为第四张零读者表。

### 1.3 运行时执行存储（Workforce / Agent Runtime / 旧编排栈）

| # | 存储 | 关键事实 |
|---|---|---|
| 9 | `AgentRun`（schema:4631） | **无 projectId 列**——项目关联只存 `metadata` Json（`capabilities/trace-context.ts:54`），无法按 project 高效查询 run；runType 词表：conversation/workforce_job/runtime_v2/assistant_dispatch/supervisor/background_conversation（后者是 update 改写而非新建，`agent-runtime/queue.ts:65`）；完全可变（状态机 + 租约列）；统一入口 `createAgentRun()`（`run.ts:59`，禁止裸 create） |
| 10 | `AgentRunEvent`（schema:4738） | 专章见 §4 |
| 11 | `AgentRunStep`（schema:4681） | 高度可变状态机；**`outputJson` 每次 attempt 覆写，历史输出不保留**；业务产出事实上存在这里（`executor.ts:706-712` 把 result.data+handoff 写入；`run-status.ts:295-302` 直接从 step outputJson 抽业务清单给 UI）；无 projectId |
| 12 | `AgentRunVerification`（schema:4719） | append-only（`@@unique([runId,attempt])`，fence 保护写入）；内容是「目标是否达成」的验收结论——**业务语义的质量记录**而非纯遥测；无 projectId |
| 13 | `ToolCallTrace`（schema:1423） | append-only；**无 orgId**（projectId+environmentId，org 隔离靠运行时二次 JOIN，`execution-query.ts:186-195`）；一条写入链路不截断 payload（`runtime/agent-runtime.ts:184-185`），另一条 50KB 截断；诊断 API 原样返回 input/output 全文 |
| 14 | `SkillExecution`（schema:4374） | 执行结果 append-only + **反馈字段可变**（userRating/userFeedback/wasEdited）；**无 orgId 无 projectId**（靠 skill.orgId JOIN）；learner 反馈学习闭环消费 |
| 15 | `AgentTask` + `AgentTaskStep`（schema:2770/2800） | **修正 T0 断言：不在退役观察期，仍有 3 条活跃生产入口**——项目页手动创建、cron `/api/cron/inspect` 每日 08:00 自动巡检（`inspect/route.ts:67`）、`ai_bid_package` 一键投标方案；`AgentTaskStep` 无 updatedAt、outputJson 反复覆写无历史；`projectId` 非空有 FK（唯一 project-first 执行存储）但**无 orgId**；`/api/agent/tasks/recent` 按 createdById 查询**无 org 校验** |
| 16 | `ApprovalRequest`（schema:2831） | 绑死旧编排栈（taskId/stepId FK）；原地 update 状态机；决策历史只有当前行 3 字段（decidedAt/decidedBy/decisionNote）；**既无 orgId 也无 projectId**（org 过滤靠三级 JOIN）；`approverUserId: null` 的未指派审批对**所有登录用户可见**（`agent/approval.ts:126`） |
| 17 | `PendingAction` + `ApprovalDecisionIdempotency`（schema:1978/2086） | 主力审批机制；原地 update；`orgId?/projectId?` 可空——**orgId 为 null 时 `@@unique([orgId,idempotencyKey])` 幂等保护失效**；审批历史散在三处：AuditLog（`executor.ts:365,383`）+ AgentRunEvent（approval.\* 事件）+ 幂等表 resultJson；过期置 failed 不删行 |
| 18 | `TenderAnalysisRun` 家族（schema:2276） | 域内作用域最完整（orgId+projectId 均非空）；**完全可变原地 CAS**（`worker.ts:213-235` 认领、`persistStep` 状态守卫）；`workerStep` 是单值游标推进即覆盖；**重试时显式清空上次失败原因**（`worker.ts:229-231`）；AI 自动推进全程零审计，唯一审计点是人工 approve（`review.ts:142` 事务内）；跨 run 血缘 = `parentRunId`/`supersedesRunId` 新行链而非事件 |

### 1.4 业务状态「就地覆盖、无历史」组（ProjectEvent 的直接动机）

这一组不是事件存储，而是**本应产生业务事件却什么都没留下**的当前态行：

| # | 存储/动作 | 今天丢失什么 | 证据 |
|---|---|---|---|
| 19 | `InquiryItem` 供应商报价 | `recordQuote()` 就地覆盖 unitPrice/totalPrice，**显式允许 QUOTED→QUOTED 重复录入，旧价永久丢失** | `inquiry/service.ts:279-299` |
| 20 | `InquiryItem` 供应商**选定** | `selectItem()` = 事务内清掉其他行 isSelected 再置 true——**无 selectedAt、无 selectedById、无理由、无 AuditLog**（`src/lib/inquiry/` 全目录零审计调用）。谁在何时选了哪家供应商，今天完全无法回溯 | `inquiry/service.ts:346-359`（本轮抽查复核） |
| 21 | `ProjectQuote` 报价单 | PATCH 事务内 `quoteLineItem.deleteMany` 删光重建、version 不变；**确认动作只是 status 白名单字段**，无 confirmedAt/By、无状态机、无审计；且 create/patch/delete 全部只挂 `requireProjectReadAccess`（读权限可改写报价） | `quotes/[quoteId]/route.ts:72-96,52,114-128` |
| 22 | `BidIntelligenceRoom.goDecision` | 就地覆盖可无限反复；Module `commercial_judgment.dataJson` 只能回溯一步且整体覆盖；AuditLog 是唯一完整决策史但 **note 两侧截断 200 字符**（Room 存 2000）——超 200 字的决策理由改一次即永久丢失 | `go-decision.ts:60-89,100-104`（本轮抽查复核） |
| 23 | `Project` 状态/里程碑列 | `tenderStatus` 仅 2 写入点纪律良好（stage-transition/tender-result，PATCH 显式拒绝）；里程碑时间戳有"已有值 no-op"幂等；但 `awardDate` 可覆盖/清空（`tender-result.ts:58`）；**标记招标结果不写讨论流系统消息**（won/lost 这一最重要状态变更在项目讨论流不可见，仅 AuditLog）；结果备注追加进 `Project.description`（`tender-result.ts:59-68`，不可结构化回收）；`markProjectTenderResult` 自身不写审计（在 route 层），绕过 route 直调 service 会静默改终态 | agent 审计 + `tender-result.ts` |
| 24 | `ProjectSupplierLink` | 全字段就地改 + **硬 DELETE**；唯一历史是 AuditLog 且 beforeData 只截 3 字段 | `supplier-links/[linkId]/route.ts:89,126` |

### 1.5 通信 / 交接 / 快照 / 成本存储

| # | 存储 | 关键事实 |
|---|---|---|
| 25 | `ProjectEmail`（schema:2705） | **仅出站**，无 direction 字段；`provider` 是死字段（唯一发送路径 = 逐用户 Gmail OAuth；**无 SMTP/Resend**——修正 T0"三条并行"）；发送时用请求体**就地覆盖 AI 草稿原文**（无版本/无 diff/无审计，`email/send/route.ts:50-58`）；`orgId` 非空但两处写入可落空串（`question.orgId \|\| ""`）；`inquiryId/inquiryItemId/emailId` 全是裸 String 无 FK；唯一读者是 AI 上下文（take 10）；用户看到"发了邮件"来自 ProjectMessage 的 `onEmailSent` |
| 26 | `ProjectQuestion`（schema:2735） | RFI 流程行（draft→sent→replied），`emailId` 裸引用；回复靠人工标记 |
| 27 | `CustomerInteraction`（schema:3644） | 销售域通信历史（10 写点）；业务正文从不 update（仅分析元数据可变）；读者全是 AI/RAG 无 UI 时间线；**个人数据密度最高且无留存策略** |
| 28 | `TradeActivityLog`（schema:3395） | 唯一封装 `logActivity()`；org 隔离最规范；campaignId/prospectId 裸 String 可孤儿 |
| 29 | `ProjectHandoff`（schema:377） | 单一 owner service；**三重幂等**（idempotencyKey unique + org+source+type unique + target unique）+ completed 终态保护 + 冲突恢复（`handoff/execute.ts:247-269`）；`transferredSnapshot` 终态一次性写入并显式记录 notTransferred 白名单——**本库 append-onceの快照+幂等最佳实践** |
| 30 | `MarketSnapshot`（schema:3071） | **名为快照实为可变行**：写入是 upsert，update 分支原地覆盖 diffJson/snapshotJson/judgmentJson（`market-intelligence/service.ts:396-425`）；`capturedAt` 只吃 `@default(now())` = DB 写入时刻非采集时刻；`urlHash = sha256(url)` **无 URL 规范化**。→ 只能借形状（三元唯一键/diff-snapshot-judgment 分层），不能当不可变范本 |
| 31 | `ProductContentSnapshot`（schema:6493） | **全库唯一真正 append-only 快照表**：`@@unique([jobId,version])` + payloadJson 只 create 从不 update；配套 `computeSnapshotContentHash = sha256(stableStringify(payload))` 且排除 capturedAt/hash 自身（`product-content/jobs/snapshot.ts:60-64`）→ **TenderArchiveItem 的模板** |
| 32 | `AiUsageLedger`（schema:6531） | 成熟成本账本：`idempotencyKey @unique` + P2002 转 duplicate + 无 orgId 硬拒（`usage/record.ts:25-44`）；**但 tender 域零写入**：`tender-auto-analysis/` 全目录无 recordAiUsage 引用；`TenderAnalysisRun.tokenUsageJson` 是**零写入死字段**（仅 schema+migration+类型声明）；cron worker 无 request context ⇒ bridge `getRequestContext()?.orgId` 为空静默丢弃（`usage-ledger-bridge.ts:60-65`）⇒ **tender 自动分析的 AI 成本今天完全没有入账** |
| 33 | `ProductContentCostEntry`（schema:6508） | estimated/actual 双列成本行先例（cents Int，与 Ledger Decimal 量纲不一）；域内窄作用域 |
| 34 | `HumanFeedbackEvent` / `BusinessOutcome` / `UserMemory`（schema:6143/6184/4268） | employee-ai 反馈域 / 可验证业务结果 / 个人记忆（双时态+supersession 先例）；各自域内自洽，与 tender 账本无交集 |

---

## 2. Store Decision Matrix（逐套判决）

判决词表：`KEEP_AS_DOMAIN_SOURCE / KEEP_AS_TECHNICAL_AUDIT / KEEP_AS_RUNTIME_TELEMETRY / KEEP_AS_COMMUNICATION_HISTORY / DERIVED_ONLY / DUAL_WRITE_TEMPORARY / DEPRECATE / REMOVE_LATER`。

**核心原则（冻结）**：同一 Business Fact 最终只允许一个 authoritative source（= ProjectEvent，业务事件域）；其他系统只可 reference / derive / notify / audit / project。

| 存储 | 判决 | 理由（基于 §1 证据） |
|---|---|---|
| `AuditLog` | **KEEP_AS_TECHNICAL_AUDIT** | 技术/安全/合规取证面（195 写点、platform admin 读面、AI 上下文源）。**不是业务时间轴 SoT**：orgId/projectId 可空、String payload、无幂等、项目删除被摘挂、traceId 列空转。T2 顺手债（独立小 PR）：traceId 列启用、payload Json 化、`(projectId, createdAt)` 索引 |
| `ProjectMessage(SYSTEM)` | **DUAL_WRITE_TEMPORARY → DERIVED_ONLY** | 判决与 T0 一致，**理由修正**：不是因为"可编辑可软删"（那是死列，§1.1#2），而是因为它是无 orgId、无结构化词表、无幂等键的**人类叙事流**，且有两个活跃读面需要连续性。迁移期 Ledger 写入点与 system-events 同事务并写；终态由 Ledger 事件渲染叙事、13 个 helper 的状态类写入停写（真实人类讨论消息不受影响）。退出条件见 §15.6 |
| `Notification` | **DERIVED_ONLY** | 派生投递/注意力 sink（懒派生 + 高度可变 + orgId=null 债）；永不为事实源。T2 不改其派生源（仍从 AuditLog）；订阅 Ledger 是 T3+ 选项 |
| `ProjectProgressSummary` | **DERIVED_ONLY** | AI 生成投影 + 审核信封；输入是 AuditLog/Project 现状，未来输入换成 Ledger，自身永不为源 |
| `TaskActivity` | **KEEP_AS_DOMAIN_SOURCE**（task 域） | task 域活动史，不进 tender 账本；债登记：读 route 无归属校验（§18-R6） |
| `OrderStatusLog` | **KEEP_AS_DOMAIN_SOURCE**（order 域） | 域状态史；零读者与无事务是域内债，不影响判决 |
| `TradeActivityLog` | **KEEP_AS_DOMAIN_SOURCE**（trade 域） | 域活动史，org 隔离规范 |
| `FabricStockLog` | **KEEP_AS_DOMAIN_SOURCE**（inventory 域） | 域变动日志；单租户假设是域内债 |
| `PublishJobStatusEvent` | **KEEP_AS_DOMAIN_SOURCE**（publish 域） | 域状态事件表；其 actorType/reasonCode/事务内写入纪律是 ProjectEvent 的**参照实现** |
| `HumanFeedbackEvent` / `BusinessOutcome` | **KEEP_AS_DOMAIN_SOURCE**（employee-ai 域） | 反馈/结果学习语料，自洽 |
| `CustomerInteraction` | **KEEP_AS_COMMUNICATION_HISTORY**（sales 域） | 销售通信历史；tender 不复用（域语义不同） |
| `ProjectEmail`（+`ProjectQuestion`） | **KEEP_AS_COMMUNICATION_HISTORY**（tender 出站通信） | 邮件正文/收发状态留此表；Ledger 只记 `email.sent` 事件 + refs.emailId，不复制正文。债：发送覆盖 AI 草稿、orgId 空串、裸引用（§18-R7） |
| `AgentRun` / `AgentRunStep` | **KEEP_AS_RUNTIME_TELEMETRY** | 执行头/步骤状态机；业务产出的 durable 形态是 Handoff envelope + 未来 ProjectEvent，不是可覆写的 step.outputJson |
| `AgentRunEvent` | **KEEP_AS_RUNTIME_TELEMETRY** | 专章论证 §4；与 Ledger 经 `sourceRef="agentRun:{runId}"` 互链 |
| `AgentRunVerification` | **KEEP_AS_RUNTIME_TELEMETRY** | run 作用域验收记录；若验收结论构成业务事实（如 run approve），由业务层落 ProjectEvent 引用之 |
| `ToolCallTrace` | **KEEP_AS_RUNTIME_TELEMETRY** | 观测记录；org 作用域缺失是运行时债（§18-R8） |
| `SkillExecution` | **KEEP_AS_RUNTIME_TELEMETRY** | 技能执行遥测 + 反馈信号 |
| `AgentTask` + `AgentTaskStep` + `ApprovalRequest` | **DEPRECATE**（→ REMOVE_LATER，T5 收敛后执行） | 旧编排栈方向不变，但**修正现状认知：仍有 3 条活跃生产入口**（cron inspect / ai_bid_package / 项目页）。DEPRECATE 语义 = 不挂新能力、T5 CONVERGENCE DECISION 逐能力迁移（cron inspect 与 bid-package 需先有 Workforce 承接面）；届时 `ApprovalRequest` 随栈退役（PendingAction 是幸存审批机制）。**在收敛完成前不得删除任何数据** |
| `PendingAction` + `ApprovalDecisionIdempotency` | **KEEP_AS_DOMAIN_SOURCE**(approval workflow 域) | 可变工作流行（非事件存储）；审批**历史**由 AuditLog + AgentRunEvent + 幂等表承载，未来重要审批结果由业务服务落 `decision.run_approved` 类 ProjectEvent。orgId 可空幂等失效是域内债（§18-R9） |
| `TenderAnalysisRun` 家族 | **KEEP_AS_DOMAIN_SOURCE**（analysis/extraction 域） | 提取层事实源（run 血缘 supersede 链已完备）；不是业务账本；T5 队列语义收敛决策不变（`TENDER_SECOND_QUEUE_DEBT`） |
| `ProjectHandoff` | **KEEP_AS_DOMAIN_SOURCE**（handoff 域） | 快照+幂等最佳实践；Ledger 记 `tender.handoff_completed` + refs.handoffId |
| `MarketSnapshot` | **KEEP_AS_DOMAIN_SOURCE**（market-intel 域） | 域内网页监控快照；**不作为 tender archive 载体**（可变 upsert + capturedAt 语义错误 + 无 URL 规范化）——只借形状 |
| `AiUsageLedger` | **KEEP_AS_DOMAIN_SOURCE**（AI 成本唯一账本） | AI 成本权威源；ProjectCost **不复制** AI 行（§6.4）；T2 修债：tender worker FINALIZE 显式传 orgId 调 `recordAiUsage` |
| `ProductContentCostEntry` / `ProductContentSnapshot` | **KEEP_AS_DOMAIN_SOURCE**（product-content 域） | 域内自洽；后者是 archive 模板 |
| `UserMemory` | **KEEP_AS_DOMAIN_SOURCE**（个人记忆域） | 双时态+supersession 模式供 MemoryClaim（T3）借鉴 |
| `ProjectInsight` / `ProjectReview` | 不参与本判决词表（知识/解读/复盘层） | 与 T0 §3.5 一致；ProjectReview 的词表漂移与确认后扩散不可回收问题登记 §18-R10 |
| `ProjectEvent`（新） | **BUSINESS EVENT LEDGER**（第 10 套的唯一豁免） | §5；生产写入点在本 Gate 全过前 NOT YET APPROVED |

**REMOVE_LATER 单列说明**：本轮没有任何存储被判 REMOVE——所有含历史数据的表在收敛路径明确前一律保留。唯一预定走到 REMOVE_LATER 的是 `AgentTaskStep`/`ApprovalRequest`（随 T5 收敛），且前置 behavior parity + 历史数据归档方案。

---

## 3. Source of Truth Matrix（业务事实 → 唯一权威源）

| 业务事实 | 现状权威 | 现状影子/泄漏 | 目标态（T2+） |
|---|---|---|---|
| 阶段推进（过程） | 无（Project 时间戳列是里程碑态,过程散在 5 sink） | AuditLog + SYSTEM 消息×2 + webhook + Notification（`stage-transition.ts:240-315` 一动作七写） | **ProjectEvent `tender.stage_advanced`**；Project 日期列保留为里程碑派生源；其余 sink 变 reference/derive |
| 招标结果（won/lost/…） | `Project.tenderStatus`（唯一写入 `tender-result.ts`） | 结果备注追加 description；讨论流不可见；ProjectReview.outcome 词表漂移 | tenderStatus 保留字段权威；**ProjectEvent `tender.result_marked`** 记动作+备注 payload；description 停止追加 |
| 放弃 | `Project.status=abandoned` + abandon 字段组 | AuditLog + SYSTEM 消息 | 字段组保留；**ProjectEvent `tender.abandoned`** |
| GO/NO_GO 决策 | `BidIntelligenceRoom.goDecision`（就地覆盖） | Module dataJson（仅回溯一步）+ AuditLog（note 截断 200） | Room 保留当前态权威；**ProjectEvent `decision.go_no_go`** 记每次决策全文（append-only 解决理由丢失） |
| 供应商报价 | `InquiryItem` 当前行（旧价丢失） | 无任何历史 | InquiryItem 保留当前态；**ProjectEvent `supplier.quote_received`** 记每次报价值（payload 含价格快照——本表少数"复制值"豁免，因为域行会覆盖） |
| 供应商选定 | `InquiryItem.isSelected` boolean（无人/无时间/无审计） | 无 | InquiryItem 保留；**ProjectEvent `supplier.selected`**（actorId+occurredAt+reason） |
| 报价单确认 | `ProjectQuote.status`（无状态机/无审计） | 无 | Quote 保留域权威；**ProjectEvent `quote.confirmed`** + refs.quoteId（金额不复制，join 取） |
| 邮件发送 | `ProjectEmail`（正文/状态） | SYSTEM 消息叙事 | ProjectEmail 保留通信权威；**ProjectEvent `email.sent`** + refs.emailId |
| 文档增改 | `ProjectDocument` 可变行（删除即蒸发） | 生成 PDF 双行（ProjectGeneratedDocument 重复） | **TenderArchiveItem = 字节/来源不可变权威**；ProjectDocument 保留业务视图；**ProjectEvent `document.added/superseded`** |
| 人工/差旅/实物成本 | **不存在** | 无 | **ProjectCost（新）= 金额权威**；ProjectEvent cost.\* 记生命周期动作（§6） |
| AI 成本 | `AiUsageLedger`（tender 未接入） | TenderAnalysisRun.tokenUsageJson 死字段 | AiUsageLedger 唯一权威（T2 补 tender 写入）；ProjectCost 不复制；Cost View 双源聚合 |
| 交接 | `ProjectHandoff` | AuditLog×3 | Handoff 保留域权威；**ProjectEvent `tender.handoff_completed`** |
| 运行时执行过程 | `AgentRunEvent` 等 | 业务结论泄漏进 payload（§4） | Runtime 遥测保留；业务结论的 durable 形态 = Handoff outputs + ProjectEvent（sourceRef 互链） |
| 审批决定（AI 写动作） | `PendingAction` 行 + AuditLog | AgentRunEvent approval.\* | PendingAction 保留工作流权威；重要业务审批结果落 **ProjectEvent `decision.run_approved`** 类事件 |
| 技术变更审计 | `AuditLog` | — | 保留（KEEP_AS_TECHNICAL_AUDIT）；与 Ledger 双栏展示，不合并 |

**边界规则（PROJECTEVENT_SOURCE_OF_TRUTH_BOUNDARY，提批）**：

1. ProjectEvent 记录**业务动作与结论**（谁、何时、对项目做了什么、结果如何）；**不复制域表可 join 的数值**（金额/数量），唯二豁免：(a) 域行会被覆盖导致历史丢失的值（InquiryItem 报价快照）；(b) 事件本身即事实源的 payload（决策理由全文、结果备注）。
2. 域表（Project/Quote/InquiryItem/Room/Handoff/Email…）保留**当前状态权威**；Ledger 保留**过程历史权威**。两者经 refs 单向引用（Ledger→域），域表不反向依赖 Ledger。
3. Runtime（AgentRun\*）永不直接写 ProjectEvent；只有**领域服务**在业务事务内追加（写入纪律见 §5.6）。

---

## 4. AgentRunEvent Boundary（专章：为什么技术执行事件不能兼任业务账本）

**结论：不能共用。四条结构性失格 + 一条语义性反证。**（2026-08-10 Final Review 按 #93 / 2B-2 合并后的 main 重新核验：S3 表述更新，**总体判决不变**。）

### 4.1 结构性失格（schema/代码层面，Final Review 基线 `8303145` 复核）

| # | 失格点 | 证据 |
|---|---|---|
| S1 | **无 projectId 直接业务归属**。事件只挂 runId+orgId；项目关联藏在 `AgentRun.metadata` Json（无索引、可空），read-model 靠 `projectBusinessRefs()` 从 metadata 派生（`read-model/projection.ts:536-556`）。业务账本的第一查询维度（by project）在此表不可索引 | schema:4738-4752；`trace-context.ts:54` |
| S2 | **生命周期属于 AgentRun/Runtime**：`onDelete: Cascade`（schema:4742）随 Run 级联删除；且遥测表天然是未来 TTL/清理的第一候选。业务事实必须比执行容器长寿 | schema:4742 |
| S3 | **追加语义是 best-effort，不是"业务事务必须原子成功"**。#93（2B-2）已修复首层缺陷：sequence 冲突（`@@unique([runId,sequence])` P2002）现在走**有界重试**——重读 max sequence 再 create，`MAX_SEQUENCE_RETRIES = 8`（`agent-runtime/run.ts:479-513`，本轮复核 origin/main）。**不再是"首次 collision 即静默丢事件"**。但外层 try/catch 仍然 `console.error` + **return null**（`run.ts:514-522`）——重试耗尽或任何其他失败时调用方无感知、无事务回滚。对 telemetry 这是合理取舍；对 authoritative business ledger 是失格 | `run.ts:475-523`（#93 后） |
| S4 | **语义是 execution telemetry，不是 authoritative business fact**：visibleToUser 过滤、trace 脱敏投影、read-model 白名单——整条读写链按"观测数据"设计，无幂等键、无业务词表治理 | §4.2；`projection.ts:461-516` |

### 4.2 语义现状：业务事实已在泄漏（且读侧在打补丁）

审计发现 payload 中已存在业务内容——这不是"可以共用"的证据，恰是**边界失守的现症**：

| 泄漏 | 证据 |
|---|---|
| 客户实体名：`payload:{customerName}` | `assistant/dispatch.ts:835-841` |
| 业务结论摘要：`response.completed` 带 resultSummary（且与 AgentRun.metadata 双写） | `dispatch.ts:391-401` |
| 最终业务报告全文：`job.failed` 带 `payload.report`（含优先跟进客户清单+综合结论；本轮抽查复核） | `workforce-runtime/processor.ts:424-431` |
| 验收结论/修复指令：verification.passed/repair_required 带 summary/instructions | `agent-runtime-v2/verifier.ts:330-369` |
| 面向用户的澄清问题原文：`job.waiting_human` 带 clarification 全文 | `processor.ts:294-306` |
| read-model 已规划 deliverable = `job.completed` 的 payload.summary（尚无写入方实装）——架构方向正把业务交付物推向遥测表 | `read-model/projection.ts:493-511` |

同时 read-model 被迫结构性排除 `job.failed` 的 report（"永不透出用户面"，`projection.ts:499-500`）——**读侧过滤补丁正是共表方案的长期成本**。

**反证（金额/阶段不在其中）**：全部 payload 中未发现报价金额、成交额、阶段推进——这些走 `PendingAction.payload` 与各业务表。即：当下的泄漏是"结论文本"级，尚未到"财务事实"级，现在切边界还来得及。

### 4.3 冻结边界规则

```
AgentRunEvent = 「这次执行是怎么跑的」（HOW it ran）    — run 作用域，可清理，Cascade
ProjectEvent  = 「业务上发生了什么、成立了什么」（WHAT became true） — project 作用域，永久，append-only
互链：ProjectEvent.sourceRef = "agentRun:{runId}"；Handoff businessRefs = "tender:{projectId}"
     （词表 "{entity}:{id}" 已在 handoff.ts:279-306 实装，read-model "tender" 类型已就绪）
业务结论的 durable 通道：Worker → Handoff envelope（≤4KB/值，合同校验）→ 领域服务 → ProjectEvent + 域表
禁止：runtime 直写 ProjectEvent；业务服务直写 AgentRunEvent；事件 payload 携带完整业务报告文本
```

**登记（不修，runtime 冻结）**：S3 的 sequence 并发安全已由 #93 有界重试解决；残余项——外层 best-effort（log + return null）语义评估、业务文本泄漏收敛（report/clarification 改为引用）——移交 Workforce Runtime Owner，Phase 2 correctness 范畴（§18-R11）。

```
AGENT_RUN_EVENT_FINDING_ALIGNED_WITH_2B2 = PASS
（判决不因 #93 改变：AgentRunEvent = KEEP_AS_RUNTIME_TELEMETRY。
 #93 修复的是遥测自身的并行正确性，不改变其 best-effort / run 作用域 / 遥测语义三重定位。）
```

---

## 5. Project Ledger Recommendation（ProjectEvent 契约）

### 5.1 复用性逐项排除（回答"是否真的需要新模型"）

对 §1 全部 26 套存储问同一个问题——"能否直接当 tender 业务账本"：

- **形状最近的三张**（OrderStatusLog/PublishJobStatusEvent/FabricStockLog）：域作用域焊死（orderId/publishJobId/fabricId 为根），且两张零读者一张无 org——扩展它们 = 重定义其域含义，成本大于新表。
- **AuditLog**：§2 判决理由；再加一条——把业务账本语义压进 195 个既有写入点的表，会同时破坏技术审计（噪声混入业务查询）与业务账本（无法保证幂等/作用域/append-only）。
- **AgentRunEvent**：§4 四条结构性失格。
- **ProjectMessage(SYSTEM)**：叙事流；结构化词表/幂等/org 作用域全缺。
- **TenderAnalysisRun 家族**：run 作用域提取层。
- **其余**：域窄或性质不符（工作流行/通信历史/成本账本/快照）。

**结论：OPTION C 成立（需要新表）；进一步因多人员需求升级为 OPTION D（§7）。** 复用的是**模式**而非表：`AgentRunEvent` 的 `@@unique([根,序号])`、`Task`/`AiUsageLedger` 的幂等键、`PublishJobStatusEvent` 的 actorType/reason 词表、`ProjectHandoff` 的事务内写入纪律。

### 5.2 最小模型（T2 提案；对 T0 §3.2 的三处修订以粗体标注）

```prisma
/// T2 提案 — append-only：无 update/delete API；修正 = 追加 correction 事件（§5.7）
model ProjectEvent {
  id            String   @id @default(cuid())
  orgId         String                     // 强制非空（吸取 AuditLog.orgId 可空教训）
  projectId     String                     // 非空；**不设 Prisma relation/FK**：账本行必须在
                                           // 项目硬删后存活（AuditLog 被摘挂 projectId 的教训，
                                           // projects/[id]/route.ts:294）
  seq           Int                        // 项目内单调序号；分配策略见 §5.6
  eventKey      String                     // 幂等键，构造规范见 §5.5
  occurredAt    DateTime                   // 业务时间（显式传入，禁止 default(now) 兜底）
  recordedAt    DateTime @default(now())   // 记账时间
  actorType     String                     // user | ai | system | external（对齐 PublishJobStatusEvent 词表）
  actorId       String?                    // User.id / worker key / 源系统名
  eventType     String                     // 词表 §5.4
  stage         String?                    // 事发阶段快照（lib/tender/stage 派生值）
  title         String
  summary       String?  @db.Text          // 人类可读摘要（讨论流叙事由此渲染）
  result        String?                    // go / no_go / approved / won / lost / failed …
  payload       Json?                      // 各 eventType 独立 zod schema 校验
  refs          Json?                      // { requirementId?, supplierId?, inquiryItemId?, quoteId?,
                                           //   emailId?, taskId?, runId?, handoffId?, pendingActionId?,
                                           //   snapshotId?, claimId? } — 只存 id 不复制业务数据
  relatedDocumentId String?                // **一等索引列**（文档时间线视图的读路径）
  relatedCostId     String?                // **一等索引列**（成本视图读路径，§6）
  sourceRef     String?                    // "manual" | "agentRun:{id}" | "analysisRun:{id}" |
                                           //   "audit:{id}" | "handoff:{id}" | "backfill:{job}"
  traceId       String?
  correctionOfEventId String?              // **修正链：新→旧单向指针**（§5.7；替代 T0 无修正字段）
  createdAt     DateTime @default(now())

  actors ProjectEventActor[]               // §7

  @@unique([projectId, seq])
  @@unique([projectId, eventKey])
  @@index([orgId, projectId, occurredAt])
  @@index([projectId, eventType, occurredAt])
  @@index([projectId, relatedDocumentId])
  @@index([projectId, relatedCostId])
  @@index([orgId, actorType, actorId, occurredAt])   // People Contribution
  @@index([traceId])
  @@index([correctionOfEventId])
}
```

**对 T0 §3.2 的修订（3 处，需 Gate 一并批准）**：

1. **移除 cost 内嵌载荷**（costAmount/costCurrency/costCategory/laborHours 四列删除）：T0 的"唯一例外"在任务书新增的 PLANNED/COMMITTED/ACTUAL 生命周期要求下不成立——append-only 事件无法承载会推进的成本状态。成本移至独立 `ProjectCost`（§6），事件经 relatedCostId 引用。
2. **新增 `correctionOfEventId`**：T0 模型无修正语义；append-only 账本必须有显式修正通道（§5.7）。
3. **refs 保留 Json + 两个一等引用列**：任务书建议的全套 related\* 具体列（relatedRequirementId/SupplierId/EmailId/TaskId）**不采纳**为独立列——只有 document 与 cost 两个维度有已确认的读路径（文档时间线、成本视图）；其余维度经 refs Json 承载，避免 8+ 列的宽表与未来词表锁死。**所有引用一律无 FK**：被引对象（文档/邮件/报价）今天就是可硬删的，账本行必须存活并保持历史引用原值。

### 5.3 任务书建议字段逐项对照

| 任务书字段 | 处置 | 落点/理由 |
|---|---|---|
| id/orgId/projectId/occurredAt | 采纳 | 同名 |
| tenderId? | **不设**——本库 tender 即 Project（workDomain=tender），无独立 Tender 实体；refs 无需冗余 | schema:249-250 |
| actorType/actorId | 采纳 | 同名；多人员见 §7 |
| eventType/stage/title/summary/result | 采纳 | summary 即任务书 summary；description 用 summary 承载 |
| sourceType/sourceRefId | 合并为 `sourceRef` 单列（"{type}:{id}" 词表，对齐 handoff businessRefs 实装形状） | `handoff.ts:279-306` |
| relatedDocumentId | 采纳为一等列 | 文档时间线读路径 |
| relatedRequirementId/SupplierId/EmailId/TaskId | 收进 refs Json | 无已确认的独立索引读路径 |
| costStatus/costCategory/quantity/unitRate/amount/currency | **移至 ProjectCost**（§6） | append-only 与成本生命周期冲突 |
| metadata | = payload | — |
| correctionOf | 采纳为 correctionOfEventId | §5.7 |
| createdAt | = recordedAt/createdAt 双列（业务时间与记账时间分离，对齐 AiUsageLedger occurredAt 先例） | schema:6564 |

### 5.4 eventType 首批词表（T2 起用；扩词表走评审）

沿用 T0 §3.3 全表，仅两处调整：

```
lifecycle:    tender.created | tender.source_captured | tender.dispatched | tender.stage_advanced
              | tender.submitted | tender.result_marked | tender.abandoned | tender.handoff_completed | project.closed
documents:    document.added | document.updated | document.superseded | addendum.detected
requirements: requirement.extracted | requirement.confirmed | requirement.rejected
              | clarification.sent | clarification.answered
decisions:    decision.go_no_go | decision.run_approved | decision.review_confirmed | decision.strategic
commercial:   inquiry.sent | supplier.quote_received | supplier.selected(新增，§1.4#20 动机)
              | quote.drafted | quote.confirmed
comms:        email.sent | email.received(T5 前置：邮件入站未实现，inbound-org.ts:96)
cost:         cost.recorded | cost.revised(Final Review 新增，§6.3 计划修订审计) | cost.committed
              | cost.actualized | cost.voided(词表扩展，§6 生命周期)
              | cost.ai_usage_rollup(可选周期快照，非事实源)
site:         site_visit.completed
event-admin:  event.corrected(修正事件的统一类型，payload 指明修正内容)
memory(T3+):  award.found | outcome.analyzed | memory.consolidated | claim.confirmed | claim.superseded
```

### 5.5 eventKey 幂等契约（IDEMPOTENCY_CONTRACT，提批）

规则：eventKey 是**同一业务动作实例**的自然键（重试/重放去重），不是业务唯一性约束（同类动作多次发生 = 多个 key）。构造规范按写入点冻结：

| 写入点（首批） | eventKey 构造 | 天然幂等来源 |
|---|---|---|
| 阶段推进 | `stage:{targetStage}` | 时间戳列"已有值 no-op"守卫（`stage-transition.ts:216-225`）保证每阶段至多一次 |
| 结果标记 | `result:{value}:{markedAtDate}` | 同值同日重放去重；改判（won→cancelled）是新动作新事件 |
| 放弃 | `abandoned` | route 层"已放弃 400"守卫 |
| GO/NO_GO | `go_decision:{seq 内部计数}` 或 `go_decision:{decidedAt ISO}` | 每次决策都是新事实（可反复），key 含时间戳 |
| 文档加入 | `document:{documentId}` | documentId 唯一 |
| 询价发出 | `inquiry_sent:{inquiryItemId}` | item 级 sentAt 守卫 |
| 报价收到 | `quote_received:{inquiryItemId}:{n}` （n = 该 item 第几次报价，事务内计数） | QUOTED→QUOTED 允许重报，每次是新事实 |
| 供应商选定 | `supplier_selected:{inquiryItemId}:{selectedAt ISO}` | 可反复选定/取消 |
| 报价单确认 | `quote_confirmed:{quoteId}` | 状态守卫（T2 顺带补） |
| 邮件发送 | `email_sent:{emailId}` | status=sent 幂等挡板已存在 |
| 交接完成 | `handoff:{handoffId}` | Handoff 三重幂等 |
| 成本状态推进 | `cost:{costId}:{costStatus}` | 每状态至多一次（§6 状态机） |
| 成本计划修订 | `cost:{costId}:revision:{revisionNo}` | revisionNo = ProjectCost.revisionCount 事务内自增值（domain counter，retry-stable；**禁止** `cost:{costId}:revised` 单键——第二次修订即冲突；禁止随机数/wall-clock 作幂等源） |
| 人工录入（site visit 等） | `manual:{客户端生成 entryId}` | 表单一次性 cuid |
| Backfill | `backfill:{类别}:{确定性后缀}` | §16 |

重放语义：命中 `@@unique([projectId, eventKey])` → 捕获 P2002 返回既有行（对齐 `usage/record.ts:88-101` 的 duplicate:true 模式），**不抛错不重写**。

### 5.6 写入纪律与 seq 分配

- **只允许领域服务在既有业务事务内追加**（与 `writeAuditLog(tx,…)` 8 个事务内调用点同模式）；禁止 UI/route 直写；禁止 runtime 直写（§4.3）。
- **无 update/delete API**：代码层不导出任何修改函数；评审时以此为红线。
- **seq 分配契约（Final Review 冻结，单一方案）**——ProjectEvent 是 AUTHORITATIVE BUSINESS LEDGER 而非 telemetry，因此契约与 `appendAgentRunEvent` 的 best-effort（#93 后仍 log + return null）**刻意相反**：

  ```
  在既有业务 transaction 内：
  1. （幂等短路）按 [projectId, eventKey] 查既有事件；命中 → 返回既有行，不追加、不占号
  2. 读取该 projectId 当前 max(seq)（普通读；不依赖 FOR UPDATE，正确性由唯一约束保证）
  3. 以 seq = max + 1 尝试 create
  4. P2002 处理（必须按 error.meta.target 区分是哪个唯一约束）：
     - 命中 [projectId, eventKey] → 并发同业务动作 → 重查后返回既有行（幂等，非错误）
     - 命中 [projectId, seq]      → 并发占号 → 重读 max(seq) 后重试
  5. bounded retry：PROJECT_EVENT_SEQUENCE_MAX_RETRIES = 8
     （借鉴 #93 的有界重试思路；人频业务事件下 8 远超合理并发上限，且确定性有界）
  6. 重试耗尽 → THROW → 整个业务 transaction ROLLBACK
  禁止：catch → log → continue；catch → return null；任何 best-effort Ledger。
  不变式：业务提交成功 ⇔ 对应 Ledger 事件已落库（BOUNDED / DETERMINISTIC /
          FAIL TRANSACTION / NO SILENT LOSS）。
  ```

  两个唯一约束职责分离（冻结）：`@@unique([projectId, seq])` 只负责**顺序唯一性**（全序号不重不漏）；`@@unique([projectId, eventKey])` 只负责**业务幂等**（同一动作实例至多一条）。前者冲突是并发现象（重试解决），后者冲突是重复提交（返回既有行）——二者不得混用同一处理路径。不引入 Postgres SEQUENCE per project（跳号破坏"seq 连续可审计"且运维不值）。

  ```
  PROJECT_EVENT_SEQUENCE_CONTRACT = PASS
  ```
- **写入失败策略**：事件写入与业务写同事务——业务成功则事件必然成功（原子）；这与今天 `logAudit` 事务外 best-effort（`stage-transition.ts:271` 在事务外）是**刻意的差别**：账本不允许"业务改了、账没记"。

### 5.7 Append-only 与修正语义（任务书 §9 的回答）

- **禁止**：`supersededBy` / `voidedAt` 列——两者都要求 UPDATE 旧行，违反 append-only。本库先例佐证：`UserMemory.supersededById` 靠改旧行（它是状态存储可以）；`TenderAnalysisRun.supersedesRunId` 是**新→旧**方向（新行携带指针，旧行不动）——账本采用后者。
- **修正协议**：错误事件 → 追加 `event.corrected`（或同类型新事件）携带 `correctionOfEventId` 指向旧事件；payload 说明修正字段与原因；读侧（Timeline/Cost/People 投影）折叠：存在指向自己的 correction 即视为被修正，显示以最新修正为准、原事件保留可查。
- **作废**：修正事件 `result="voided"` + payload.reason；无独立 voided 列。
- **审计保证**：任何修正自身就是一条带 actor/时间/理由的事件——修正历史与业务历史同构，天然可审计。

---

## 6. Cost Architecture（任务书 §11 的回答）

### 6.1 现状（审计结论）

- **人工侧成本模型全库不存在**：labor/timesheet/mileage/reimburs/expense 在 schema 零命中；唯一成本表是 AI 域的 `ProductContentCostEntry` 与 `AiUsageLedger`。
- **tender AI 成本今天完全未入账**（§1.5#32）：`tokenUsageJson` 零写入死字段；`tender-auto-analysis/` 零 ledger 引用；cron 无 request context ⇒ bridge 静默丢弃。
- 先例可借：`ProductContentCostEntry.estimatedCents/actualCents` 证明"同一成本多状态金额并存于一行"已是本库模式；`AiUsageLedger` 的幂等/Decimal/occurredAt 是记账纪律模板。

### 6.2 两方案六维对比

| 维度 | A：成本直接存 ProjectEvent（T0 §3.2 形态） | B：独立 ProjectCost + Event 引用（**推荐**） |
|---|---|---|
| 查询性能 | 成本聚合 = 扫事件表 + 按 eventType 过滤 + 折叠 correction 链（PLANNED→ACTUAL 要 3 事件叠加求净值） | `SUM(coalesce(amountActual, amountCommitted, amountPlanned))` 单表索引聚合 |
| 财务准确性 | 金额分散在事件 payload；修正链折叠逻辑一旦有 bug，财务数字错 | 单行单成本项；三金额列并存留痕（先例 §6.1）；Decimal(18,2) |
| 修改频率 | 成本是**最高频被修正的业务对象**（估→定→实、报销核对）——append-only 表承载高频修正 = correction 链爆炸 | 受控状态推进（列填充非覆盖）；仅 ACTUAL 后的错误走 void+新行 |
| 审计性 | 天然全审计 | 每次状态转换强制落 ProjectEvent（cost.recorded/committed/actualized/voided）——审计在账本，金额在成本表，各司其职 |
| 多货币 | payload 里 currency 自由字符串 | currency 列 + 未来 fxRate/orgCurrencyAmount 列可加（accounting 需求） |
| Accounting 集成 | 从事件流重建成本台账——集成方噩梦 | 导出 = `SELECT * WHERE costStatus=ACTUAL`；事件流作凭证链 |

**结论：B。成本是有生命周期的领域对象（domain record），不是事件；事件记录它的生命周期动作。** T0 §3.2 的"cost 载荷唯一例外"在任务书新增 PLANNED/COMMITTED/ACTUAL 要求后不再成立，本文档正式修订（§19-C3）。

### 6.3 ProjectCost 模型（T2 提案）

```prisma
/// T2 提案 — 成本领域记录；受控可变（状态只进不退，金额列只填不改）
model ProjectCost {
  id           String  @id @default(cuid())
  orgId        String
  projectId    String                      // 无 FK，同 ProjectEvent 理由
  costStatus   String                      // PLANNED | COMMITTED | ACTUAL | VOIDED
  category     String                      // 词表 §6.5
  description  String?
  quantity     Decimal? @db.Decimal(12, 3) // 2.5 (hour) / 120 (km)
  unit         String?                     // hour | km | item | trip | pct …
  unitRate     Decimal? @db.Decimal(18, 4)
  amountPlanned   Decimal? @db.Decimal(18, 2)   // 三列并存留痕（ProductContentCostEntry 先例）
  amountCommitted Decimal? @db.Decimal(18, 2)
  amountActual    Decimal? @db.Decimal(18, 2)
  currency     String                      // org 默认 CAD；不做换算（报表层处理）
  incurredById String?                     // 费用发生人（≠录入人；多人各一行，§7 联动）
  incurredAt   DateTime                    // 业务发生时间
  supplierId   String?
  refs         Json?                       // { inquiryItemId?, quoteId?, documentId?, taskId? }
  sourceType   String  @default("manual")  // manual | import | rollup
  revisionCount Int    @default(0)         // 计划修订计数器：实质字段每次修改事务内自增，
                                           // 为 cost.revised 事件提供 retry-stable 幂等号（§5.5）
  correctionOfCostId String?               // void 后的替代行指回被修正行
  voidedAt     DateTime?
  voidReason   String?
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([orgId, projectId, costStatus])
  @@index([projectId, category])
  @@index([orgId, incurredById, incurredAt])
  @@index([correctionOfCostId])
}
```

**可变性契约（Final Review 收口：PLANNED 可编辑 ≠ 无历史更新）**：

- **计划修订必须留痕**：PLANNED 行允许编辑，但对实质商业字段——`amountPlanned / quantity / unitRate / currency / description / supplierId / incurredAt`——的任何修改必须在**同一事务**内：`revisionCount` 自增 + 追加一条 `cost.revised` 事件（payload 记 `{field, from, to}` 集合；eventKey `cost:{costId}:revision:{revisionCount}`，§5.5）。禁止裸 UPDATE 静默覆盖（否则 $10k→$12k→$15k 的中间史丢失——正是 §1.4 InquiryItem 改价覆盖的教训在成本域重演）。**不为此新增 ProjectCostRevision 表**：ProjectCost 仍是当前权威成本域记录，ProjectEvent 承担 revision audit trail。
- **状态推进**：PLANNED→COMMITTED→ACTUAL 各自**填充**对应金额列（先前列不改——留痕），每次推进同事务落 `cost.committed`/`cost.actualized` 事件（eventKey `cost:{costId}:{costStatus}`）。
- **ACTUAL 后不可改**：错误 = `voidedAt` 置位 + 新行 `correctionOfCostId` 指回（`cost.voided` + 新行 `cost.recorded` 事件），现有设计不变。
- 有效金额 = `coalesce(amountActual, amountCommitted, amountPlanned)`。"记一笔"快捷录入 = 直接创建 costStatus=ACTUAL 行 + `cost.recorded` 事件一个事务（T0 §4.2 的 ≤10 秒目标不受影响）。

```
PROJECT_COST_REVISION_AUDIT = PASS
```

账本示例（任务书场景）：`cost.recorded $10,000` → `cost.revised $10,000→$12,000`（revision:1）→ `cost.revised $12,000→$15,000`（revision:2）→ `cost.committed` → `cost.actualized`；ProjectCost 当前行 `amountPlanned = $15,000`，全部中间史在 Ledger。

### 6.4 AI 成本边界

- `AiUsageLedger` 是 AI/DATA_API 成本**唯一权威**；ProjectCost **不建 AI 行**（避免双事实源）。
- Cost View = ProjectCost 聚合 ∪ `AiUsageLedger where projectId` 聚合，三分项 Labor/External/AI 由 category 映射。
- 词表中保留 `AI`/`DATA_API` 类别值仅供**未来 import/rollup 场景**（如第三方数据 API 人工报销）；默认写入路径不产生。
- T2 修债（独立小 PR）：tender worker FINALIZE 步骤显式携带 orgId 调 `recordAiUsage`（绕过 request-context 缺失；`usage/record.ts:52` 单次调用），idempotencyKey = `tender_analysis:{runId}:finalize`。

### 6.5 类别词表（冻结，任务书 §11 全集）

```
INTERNAL_LABOR | SITE_VISIT | MILEAGE | PARKING | SAMPLE | COURIER | BOND_INSURANCE
| CONSULTANT | SUPPLIER | SUBCONTRACTOR | AI | DATA_API | OTHER
```

（T0 §4.1 小写词表映射：bond+insurance 合并为 BOND_INSURANCE、external_consultant→CONSULTANT、supplier_charge→SUPPLIER、ai_cost→AI、data_api_cost→DATA_API；internal_labor 的工时经 quantity/unit/unitRate 结构化。）

---

## 7. Multi-Actor Model（任务书 §10 的回答）

### 7.1 现状证据

- 全库事件形存储**全部单 actor**（TaskActivity.actorId、AuditLog.userId 必填、PublishJobStatusEvent.actorId、HumanFeedbackEvent.userId）；无任何 event-actor junction。
- 但业务已多角色：`Project.ownerId + purchaserId` 双角色（schema:306-310）、`ProjectMember` 多对多、审批"创建人≠决定人"（PendingAction.createdById/decidedById）。
- 任务书场景（Tony + 同事踏勘 2.5h）今天无处落。

### 7.2 三方案对比

| 方案 | 优点 | 缺陷 |
|---|---|---|
| metadata participants 列表（Json） | 写入零成本 | **无法 group by**（People Contribution 视图要 jsonb 展开，Prisma 不支持）；无引用完整性（离职/改名后 dangling）；无法索引 |
| 每参与人一条事件 | 查询简单 | **违反 NO DUPLICATE BUSINESS FACT**——一次踏勘是一个业务事实，拆 N 条 = N 个权威记录 |
| **ProjectEventActor junction（推荐）** | group by/索引/User 关联全通；事件保持唯一 | 多一张表 + 写入点多一步 |

### 7.3 规范化建议（OPTION D 的第二张表）

```prisma
/// T2 提案 — 事件参与人（仅当参与人 ≠ 记账人或人数 > 1 时写入）
model ProjectEventActor {
  id        String       @id @default(cuid())
  orgId     String
  eventId   String
  event     ProjectEvent @relation(fields: [eventId], references: [id], onDelete: Restrict)
                         // Restrict（Final Review 明确）：ProjectEvent 原则上不允许删除，
                         // 若合规通道未来删除事件，必须先显式处理 actor 行——禁止 Cascade 静默连带
  actorKey  String                      // "user:{userId}" | "external:{规范化名}"（对齐 businessRefs 词表形状）
  userId    String?                     // actorKey 为 user 时冗余提取，便于 join User
  role      String  @default("participant")   // performer | participant | approver
  createdAt DateTime @default(now())

  @@unique([eventId, actorKey])
  @@index([orgId, userId])
  @@index([orgId, actorKey])
}
```

职责分离（冻结）：

- `ProjectEvent.actorType/actorId` = **记账人/触发者**（谁让这条事件成立）；
- `ProjectEventActor` = **参与人集合**（谁完成了这个动作）；单人自记事件不写 junction（95% 场景零开销）；
- **每参与人的工时/费用归 ProjectCost 行**（incurredById 各一行，category=INTERNAL_LABOR，quantity=hours）——junction 不带 laborHours，避免与成本表双记；
- People Contribution 视图 = `UNION(事件 actorId, junction 行)` group by + ProjectCost(INTERNAL_LABOR) 聚合。

任务书例落法：一条 `site_visit.completed`（actorId=录入人，actors=[Tony, 同事]，refs 含 documentId）+ 每人一条 ProjectCost(SITE_VISIT/INTERNAL_LABOR) + 里程/停车各一条 ProjectCost(MILEAGE/PARKING)，全部 relatedCostId/refs.costId 互链。

---

## 8. Archive Reuse Audit（任务书 §12 的回答）

### 8.1 可直接复用（REUSE）

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 私有 Blob + 代理鉴权 | `blob-access.ts`（putPrivateBlob/readBlobStream 三级回退）+ `files/[...path]/route.ts` 7 前缀分派 | 新增 `archive/{orgId}/` 前缀 = 纯增量 |
| 内容指纹 | `hash.ts:8-51`（sha256Content/fingerprintOrderedHashes/computePackageFingerprintFromPairs） | 原样复用 |
| 稳定 JSON hash | `product-content/jobs/snapshot.ts:60-64`（sha256(stableStringify)，排除 capturedAt/hash 自身） | 元数据快照 hash |
| **append-only 快照模板** | `ProductContentSnapshot`（@@unique([jobId,version]) 只 create 从不 update） | TenderArchiveItem 的纪律模板 |
| 幂等写入骨架 | `usage/record.ts:22-114`（idempotencyKey unique + P2002→duplicate + 无 orgId 硬拒） | 捕获幂等 |
| 页级解析 + OCR 标记 | `page-parse.ts`（unpdf、80 页/200k 上限、OCR_REQUIRED、事务化重写、全 catch） | 解析层不动 |
| Firecrawl 客户端 + webhook 形状 | `firecrawl-monitor.ts`（HMAC+token 双鉴权、changeTracking、retentionDays）——注意仅市场/外贸线，**无 tender 采集**；Apify 全库不存在（再次确认） | T5 采集实现的参考；本轮不动 |
| 溯源引用 | `TenderAnalysisSourceRef`（documentId+page+snippet+confidence，6 类衍生实体 FK） | 快照→结论证据链现成 |
| 外部来源锚点 | `ExternalReference`（@@unique([system,externalId]) + url）——**唯一持久化的 tender 源 URL** | 快照行 metadata 回指 |
| 对外脱敏 | `china-supplier-brief`（全库唯一 egress 分级器） | 档案外发必经此层（不新建） |

### 8.2 缺失（必须新建/修债）

| 缺口 | 证据 | 后果 |
|---|---|---|
| **存储层不可变性** | ProjectDocument 全可变 + 硬删 + `deleteBlob` + Page/RunDocument Cascade（`files/[fileId]/route.ts:10-33`） | 删一个文档 = 历史分析 Run 的证据链蒸发 |
| **源文件从不固化** | BidToGo 文档只存外链（blobUrl/contentHash=null，`v1/projects/route.ts:212-220`）；无 fetchedAt/httpStatus/etag | 链接失效即证据消失——任务书 §13 的核心痛点现状为真 |
| **内容寻址不成立** | contentHash 全库零 `where` 读路径；两条解析管线一条不写 hash 且互不感知（parse-content 抢先置 done）；"无当前有效版本模型"（`package.ts:129-131` 自认） | 无去重、无版本链、重复上传全量重存 |
| 模型字段缺口 | ProjectDocument 无 orgId/mimeType/sourceUrl/软删/版本链 | 租户边界靠 join 推导；无法承载快照契约 |
| 抓取物零留存 | 外贸 Firecrawl markdown 用后即弃（仅 slice 4500 喂 AI）；MarketSnapshot 可变 upsert + capturedAt 语义错误 + urlHash 无规范化 | 无可靠先例可直接搬 |
| 生成文档双写 | ProjectGeneratedDocument 与 ProjectDocument 重复存同一 PDF（`generate-docs.ts:308-336`） | 权威不明（T2 顺手债收敛） |
| 采集成本无处记 | tender 域零 ledger 写入（§6.1） | Archive 抓取/解析成本不可见 |

**判定：REUSE_EXISTING_DOCUMENT_MODEL 不成立（缺不可变性与来源字段）；EXTEND_EXISTING_DOCUMENT_MODEL 不足（把 immutable 语义压进 21 个 update 调用点的可变表 = 重蹈 MarketSnapshot）；→ NEW_SOURCE_SNAPSHOT_REQUIRED。** ProjectDocument 保留为业务视图层（additive 补列，§15.3），字节与来源的不可变权威归新表。

---

## 9. Source Snapshot Contract v1（任务书 §13 的回答）

### 9.1 契约字段 ↔ 模型映射（任务书全集逐项）

| 任务书字段 | 模型字段 | 说明 |
|---|---|---|
| snapshotId | `id` | cuid |
| orgId | `orgId`（非空） | 租户硬边界 |
| projectId / tenderId | `projectId`（非空） | tender 即 Project |
| sourceType | `kind` | 词表见模型注释（沿 T0） |
| sourceUrl | `sourceUrl?` | 原始 URL 逐字保留（允许失效） |
| canonicalUrl | `canonicalUrl?` | 规范化后 URL（§10.1）；upload 无 |
| capturedAt | `capturedAt`（**显式必填，无 default**） | MarketSnapshot 的 default(now) 语义错误教训 |
| publishedAt | `publishedAt?` | 源声明的发布时间（addendum 版本判定辅助） |
| mimeType | `mimeType` | 必填（ProjectDocument 缺失的教训） |
| storageKey | `storageKey` | `archive/{orgId}/{sha256[0:2]}/{sha256}` 内容寻址，天然字节去重 |
| contentHash | `contentHash` | sha256（`hash.ts` 复用） |
| snapshotVersion | `snapshotVersion` | 同 captureKey 分组内第 N 次有意义捕获 |
| metadata | `metadata Json?` | 抓取头/原文件名/页数/alternate URLs |
| supersedes / supersededBy | `supersedesSnapshotId?`（**仅新→旧**） | supersededBy 是读侧派生（§9.3） |
| accessClass | `accessClass` | §11 词表 |
| parserVersion | `parserVersion?` | 解析器版本（page-parse parseVersion 对齐） |

### 9.2 模型提案（T2；沿用 T0 模型名 `TenderArchiveItem` 避免命名漂移，字段为 T0 ∪ 任务书并集）

```prisma
/// T2 提案 — Source Snapshot Contract v1
/// 证据字段 IMMUTABLE（只 create，无 update/delete API）；
/// 唯一例外 accessClass = 治理元数据，经专用受权 service 受控可变（§9.3）
model TenderArchiveItem {
  id             String   @id @default(cuid())
  orgId          String
  projectId      String                       // 无 FK（账本同理：项目删除后证据存活）
  kind           String   // source_html | source_pdf | source_screenshot | tender_document |
                          // addendum | drawing | pricing_form | award_notice | email | photo | other
  sourceUrl      String?  @db.Text
  canonicalUrl   String?  @db.Text
  captureKey     String   // 来源身份键：sha256(canonicalUrl) | "upload:" + sha256(fileName+":"+contentHash)
  capturedAt     DateTime                     // 显式传入
  publishedAt    DateTime?
  captureMethod  String   // upload | url_capture | email_ingest | api_push | backfill_upload
  mimeType       String
  fileSize       Int
  contentHash    String   // sha256(bytes)
  storageKey     String   // archive/{orgId}/{hash[0:2]}/{hash} — 同 hash 不重存字节
  snapshotVersion Int     @default(1)         // 同 (projectId, captureKey) 组内递增
  parserVersion  String?
  accessClass    String   @default("INTERNAL_COMPANY")   // §11；治理元数据，受控可变（§9.3，
                                                         // 非证据字段——分级变更不产生新快照）
  metadata       Json?
  supersedesSnapshotId String?                // 新→旧；IMMUTABLE 下唯一合法的链方向
  projectDocumentId String?                   // 与业务视图互链（可空：纯源快照可无文档行）
  createdById    String?
  createdAt      DateTime @default(now())

  @@unique([orgId, projectId, captureKey, contentHash])       // 同观察幂等（§10.2）
  @@unique([orgId, projectId, captureKey, snapshotVersion])   // 版本序完整性（Final Review 新增，§10.4）
  @@index([orgId, contentHash])               // 跨项目同件识别
  @@index([projectId, kind, capturedAt])
  @@index([supersedesSnapshotId])
}
```

**对 T0 §5.2 的修订（2 处）**：

1. `supersededByArchiveItemId`（旧行回写）→ `supersedesSnapshotId`（新行携带）：旧行回写 = UPDATE = 违反 IMMUTABLE；改为与 `TenderAnalysisRun.supersedesRunId` 同向。supersededBy 视图 = `WHERE supersedesSnapshotId = :id` 读侧派生。
2. 唯一键从 `(orgId, projectId, contentHash, kind)` 改为 `(orgId, projectId, captureKey, contentHash)`：T0 键无法表达"同内容出现在不同来源"这一观察事实，也无法给上传场景稳定身份（§10.2 场景表推演）。

### 9.3 不可变规则（任务书 §15 的回答；Final Review 修订：证据不可变 ≠ 治理不可变）

```
RAW EVIDENCE（证据字段 + blob 字节） = IMMUTABLE
  永久不可变字段清单（冻结）：
    sourceUrl / canonicalUrl / captureKey / capturedAt / publishedAt / captureMethod /
    mimeType / fileSize / contentHash / storageKey / snapshotVersion /
    parserVersion(capture 时点值) / supersedesSnapshotId / metadata(描述捕获本身的部分) /
    kind / orgId / projectId / createdById / createdAt
  — 只 create；无 update/delete API；修订=新行+supersedes 指针；
    删除仅合规豁免走专用管理通道（逻辑标记表外置，本轮不设计）
ACCESS POLICY（accessClass） = GOVERNED-MUTABLE（Final Review 修订）
  — accessClass 是 governance policy，不是 source evidence 的历史事实。
    允许经专用受权 service 修改，且必须：记录 changedBy / changedAt / reason + 落 AuditLog；
    未来可产生 archive.access_changed 治理事件（本轮不实现）。
  — Changing access policy DOES NOT create a new evidence snapshot：
    INTERNAL_COMPANY → RESTRICTED 只改分级，不复制证据行（否则与
    @@unique([orgId,projectId,captureKey,contentHash]) 冲突——同观察无法二次入库）。
    只有 source / content / evidence observation 变化才创建新 TenderArchiveItem。
AI Extracted Fact（TenderAnalysisFact/Section/Requirement） = VERSIONED
  — 现状已满足：run 作用域 + supersedesRunId 血缘链，重跑=新 run 新行
AI Claim（T3 MemoryClaim） = SUPERSEDEABLE
  — supersededById + 双时态（UserMemory 模式）

AI 可以写：新快照行（经采集 Job）、新 fact/claim 行、解析产物（Page/parse 状态）
AI 绝对不能写：已存在快照行的任何证据字段、blob 字节、supersedes 指针以外的历史关联、
              ProjectDocument 对已归档文档的 contentHash（hash 一经写入不改）、
              accessClass（分级变更是人工治理动作，AI 无权）
人可以改的唯一字段：accessClass（经上述治理通道）；证据字段对人与 AI 一视同仁 IMMUTABLE
```

> 修订说明：初稿"accessClass 错误 = 新行 supersedes 旧行"与同观察幂等唯一键逻辑冲突，且把治理策略误当捕获事实——Final Review 废弃该规则，改为上述证据/治理分离契约。`ARCHIVE_IMMUTABILITY_CONTRACT = PASS`；`ARCHIVE_ACCESS_POLICY_CONTRACT = PASS`。

---

## 10. Archive 去重与版本规则（任务书 §14 的回答）

### 10.1 Canonical URL 规范化（现状 `hashUrl=sha256(裸url)` 的修正）

`canonicalUrl` 生成规则（capture 服务内纯函数，T2 冻结）：lowercase scheme/host、去默认端口、去 fragment、去 tracking 参数（utm\_\*/fbclid/gclid 白名单外保留——招标门户的 docId 类参数是身份的一部分）、路径尾斜杠规范化、query 参数字典序排序。`captureKey = sha256(canonicalUrl)`。

### 10.2 场景推演（唯一键 `(orgId, projectId, captureKey, contentHash)` 的行为）

| 场景 | 行为 |
|---|---|
| 同 URL 重复抓取、内容未变 | 命中唯一键 → no-op（P2002→duplicate），幂等 |
| **同 URL 内容更新**（网站改版/addendum 覆盖发布） | 新 contentHash → 新行 snapshotVersion+1 + `supersedesSnapshotId`→旧行 + Ledger `document.updated`/`addendum.detected` |
| **不同 URL 相同文件**（镜像/重发布） | 新 captureKey → 新行（记录"该内容也出现于此来源"的观察事实）；`storageKey` 相同 → **字节零重存**（内容寻址）；跨行同件经 `@@index([orgId, contentHash])` 识别 |
| Addendum 新版本 | 新文件新 hash → 新行；与既有 run 血缘经 `TenderAnalysisRunDocument(role=ADDENDUM)` 不变；diff 走现有 `addendum-diff.ts` 管线 |
| 文件重命名后再上传（同内容） | captureKey 含 fileName → 新行（两次观察，字节共享）；同名同内容重传 → 命中唯一键 no-op |
| 网站整页消失 | 快照行与字节永存；sourceUrl 失效不影响证据（契约目标达成） |
| **访问分级变更**（如 INTERNAL_COMPANY→RESTRICTED） | **不产生新快照**——accessClass 是治理元数据，经受权 service 修改 + AuditLog（§9.3）；证据行不复制 |

**禁止（冻结）**：仅以 URL 唯一（`@@unique([...sourceUrl])` 类设计一票否决——同 URL 多版本是常态）；仅以 contentHash 唯一（丢失"何时从何处见过"的观察语义）。

### 10.3 与 ProjectDocument 的去重读路径（T2 补债）

上传/采集入口先算 hash → `WHERE orgId+contentHash` 查快照 → 命中则复用 storageKey 与既有解析产物（Page 级文本经 hash 关联）——补上"索引已建、读路径为零"的缺口（§8.2）。

### 10.4 Snapshot Version 分配契约（Final Review 新增）

两条唯一约束职责分离（冻结）：

```
@@unique([orgId, projectId, captureKey, contentHash])      = same observation idempotency
  （同来源同内容重复捕获 → no-op）
@@unique([orgId, projectId, captureKey, snapshotVersion])  = version sequence integrity
  （防两个并发不同内容 capture 同读 latestVersion=2 后同写 version=3）
```

分配流程：事务内读该 `(projectId, captureKey)` 当前 max(snapshotVersion) → +1 尝试 create → P2002 按 `error.meta.target` 分流：命中 contentHash 键 → 同观察，返回既有行（幂等 no-op）；命中 snapshotVersion 键 → 并发占号，重读 max 后重试，**bounded retry**（上限 8，与 `PROJECT_EVENT_SEQUENCE_MAX_RETRIES` 同款，同为人频写入）。重试耗尽 → THROW（捕获失败由采集 Job 的既有重试语义兜底）。**Snapshot 写失败在任何路径下都不允许触碰既有证据行**——本表只有 create，失败即无副作用。

```
ARCHIVE_VERSION_CONTRACT = PASS
```

---

## 11. Access Classification（任务书 §16 的回答）

### 11.1 词表与默认值

| accessClass | 语义 | 默认赋值规则 |
|---|---|---|
| `PUBLIC_SOURCE` | 公开来源（招标门户/公告/公开网页） | captureMethod=url_capture/api_push 且来源为公开门户 |
| `INTERNAL_COMPANY` | 我方内部产物（报价工作稿/内部分析/踏勘照片） | captureMethod=upload 默认值 |
| `CLIENT_CONFIDENTIAL` | 客户/业主提供的非公开材料 | 上传时人工选择 |
| `VENDOR_CONFIDENTIAL` | 供应商报价/图纸 | email_ingest（T5）与供应商域动作默认 |
| `RESTRICTED` | 高敏（保证金/银行/法务） | 仅人工显式设置 |

### 11.2 执行面 = 现有 RBAC 复用（NO NEW RBAC，冻结）

| 层 | 现有能力 | Archive 接入方式 |
|---|---|---|
| 租户硬边界 | `orgId` 非空 + 全查询 org-scope（Security-1 纪律） | 快照行 orgId 必填；跨 org 读一票否决 |
| 项目访问 | `requireProjectReadAccess` / `authorize("project.read")`（PRINCIPAL/ORG scope，`authorization/types.ts:15-41`） | PUBLIC_SOURCE/INTERNAL_COMPANY/CLIENT_CONFIDENTIAL/VENDOR_CONFIDENTIAL 读 = project.read |
| 高敏升级 | 既有 `project.update` / canManage 语义（PR #95 已修 execute/cancel 类口子） | RESTRICTED 读 = project.update 级（不新建 permission key；若评审认为需要独立 `project.archive.restricted.read` key，走 permissions.ts 词表增补——**仍是现有 RBAC 机制内的新 key，不是新机制**） |
| 字节访问 | blob 代理 `files/[...path]` 前缀分派 | 新前缀 `archive/{orgId}/...`：代理层查快照行（storageKey 反查）→ 按 accessClass 施加上述判定；**禁止直接暴露 blob URL** |
| 对外输出 | `china-supplier-brief` egress 分级器（全库唯一） | 任何档案内容外发必经此层；RESTRICTED/CLIENT_CONFIDENTIAL 默认 deny |
| 保留 Scope | RESERVED_DATA_SCOPES fail-closed（WORKSPACE/TEAM…） | accessClass 不复用 DataScope 枚举（语义不同：数据分级 ≠ 授权范围），避免污染授权词表 |

---

## 12. Future Auto-Event Producer Map（任务书 §17；只定义映射，不实现）

| SOURCE_EVENT（触发动作/现有代码位置） | → PROJECT_EVENT | actorType | 备注 |
|---|---|---|---|
| BidToGo intake 建项（`v1/projects/route.ts`） | tender.created | external | sourceRef="externalRef:{id}" |
| 源捕获 Job 完成（T5） | tender.source_captured | ai | refs.snapshotId |
| 分发（`project-intake/service.ts:35`） | tender.dispatched | user | |
| 阶段推进（`stage-transition.ts:238-268` 事务内） | tender.stage_advanced | user/ai | 首批第一写入点 |
| 文档上传（`files/route.ts:156-168`） | document.added | user | refs.snapshotId+relatedDocumentId |
| Addendum diff（`addendum-diff.ts:29-95`） | addendum.detected | ai | |
| 要求确认/拒绝（analysis review 流） | requirement.confirmed/rejected | user | |
| RFI 发送（`questions/[questionId]/send`） | clarification.sent | user | refs.emailId |
| 询价发送（`inquiries/.../email/send`） | inquiry.sent | user | |
| 报价录入（`inquiry/service.ts:299`） | supplier.quote_received | user | payload 含价格快照（§3 豁免 a） |
| 供应商选定（`inquiry/service.ts:346`） | supplier.selected | user | 补上今天完全缺失的记录 |
| 报价确认（quotes PATCH status） | quote.confirmed | user | T2 顺带补状态守卫 |
| 邮件发送成功（email send route） | email.sent | user | |
| 邮件收到 | email.received | external | **T5 外部前置**：入站未实现（`inbound-org.ts:96`） |
| 踏勘录入（新 UI，T2） | site_visit.completed | user | + ProjectCost 行 |
| 成本动作（§6） | cost.recorded/revised/committed/actualized/voided | user | 计划修订经 revisionCount 幂等（§6.3） |
| GO/NO_GO（`go-decision.ts:60`） | decision.go_no_go | user | payload 存理由全文（解决 200 字符截断丢失） |
| Run 批准（`review.ts:89`） | decision.run_approved | user | |
| 提交（stage=submission） | tender.submitted | user | |
| 结果标记（`tender-result.ts:16`） | tender.result_marked | user | payload 承接备注（停止追加 description） |
| 放弃（abandon route） | tender.abandoned | user | |
| 交接完成（`handoff/execute.ts:442`） | tender.handoff_completed | user | refs.handoffId |
| Award Watch 命中（T5） | award.found | ai | 人批后入库 |
| 复盘确认（`review.ts:166`） | decision.review_confirmed | user | |
| 项目关闭 | project.closed | user | → consolidate_memory 触发源 |

**首批生产写入点（Gate 通过后 T2-PR 序列）**：stage_advanced、result_marked、abandoned、go_no_go、document.added、supplier.quote_received、supplier.selected、quote.confirmed、inquiry.sent、email.sent、handoff_completed、cost.\*、site_visit.completed —— 全部为**领域服务事务内追加**，零 runtime 改动。

---

## 13. Workforce Task Map（任务书 §18；只定义职责，禁止实现）

沿 T0 §13.2 十任务合同不变，本文档仅按判决结果补两条职责边界：

| Task | 职责（与本文档判决的关系） |
|---|---|
| `archive_tender` | 产出 TenderArchiveItem 行 + blob（IMMUTABLE 写入者）；handoff outputs 只带 itemIds/hash 摘要；**不写 ProjectEvent**（由触发它的领域服务记 tender.source_captured） |
| `extract_document` / `extract_tender` | 写 analysis 域（VERSIONED 层）；沿现有 run 血缘 |
| `capture_source_snapshot` | archive_tender 的单源子任务（URL→HTML/PDF/screenshot 三件套） |
| `build_project_event_projection` | **只读 Ledger** 重算 Timeline/Cost/People 投影缓存（若 T3 引入缓存）；永不写事件 |
| `refresh_fingerprint` | T3 Design Gate 后按其形态实施 |
| `consolidate_project_memory` | 读 Ledger+域表 → derived memory view + claims（T0 §11.1 不变） |
| 其余（search_memory/research_historical_awards/analyze_competitors/analyze_procurement_cycle/watch_award/assemble_intelligence） | 沿 T0 §13.2 原样 |

**边界重申（冻结）**：全部任务 = Workforce Job/Task 合同（workforce-task/v1 + workforce-handoff/v1）；不建第二 runtime；`DETERMINISTIC_PLAN_INJECTION = T5 HARD DEPENDENCY` 与 Runtime Owner Design Gate 不受本文档影响；T2 阶段这些任务**一个都不实现**（T2 的事件写入全部是领域服务同步追加，无新 Job 类型）。

---

## 14. Schema Decision（任务书 §19 的回答）

```
PROJECT_EVENT_DECISION = OPTION D
  ProjectEvent + ProjectEventActor（§5/§7）
  否决 OPTION A（26 套存量无一可承担，§5.1）
  否决 OPTION B（扩展 AuditLog/AgentRunEvent/域事件表 = 破坏其既有用途或重定义域语义）
  否决 OPTION C 单表（多人员贡献是冻结需求，metadata 方案无法支撑 People 视图，§7.2）
  附加：ProjectCost 独立成本表（§6——任务书 §11 明确要求给出成本存放推荐，结论是独立表）

ARCHIVE_MODEL_DECISION = NEW_SOURCE_SNAPSHOT_REQUIRED
  TenderArchiveItem 实现 Source Snapshot Contract v1（§9）
  否决 REUSE_EXISTING_DOCUMENT_MODEL（无不可变性/无来源字段/无租户列，§8.2）
  否决 EXTEND_EXISTING_DOCUMENT_MODEL（21 个 update 调用点的可变表压不进 IMMUTABLE 语义；
    MarketSnapshot 的"名快照实可变"是前车之鉴）
  ProjectDocument 保留业务视图层 + additive 补列（§15.3）
```

---

## 15. Migration Proposal（仅提案；禁止生成真实 migration 文件）

### 15.1 表与顺序（全部 additive，零既有表破坏）

| 批次 | 内容 | 风险 |
|---|---|---|
| **M1**（一次 migration） | 新表 ×4：`ProjectEvent`、`ProjectEventActor`、`ProjectCost`、`TenderArchiveItem` | 纯新增；建表时零写入者，部署后表空置直至写入点 PR 各自批准合入 |
| **M2**（独立小 migration；**不与 M1 同批实施**——Final Review 冻结：T2-M1 仅四张新表，M2 排在 T2-M1 Validation 之后独立评审，§17.2） | `ProjectDocument` additive 列：`orgId String?`（回填后收紧）、`mimeType String?`、`sourceUrl String?`、`supersededByDocumentId String?`、`deletedAt DateTime?`；`AuditLog`：payload Json 化不做（读侧兼容成本高，仅补 `@@index([projectId, createdAt])` + traceId 列启用是代码改动非 schema） | additive 可空列，零锁风险 |

### 15.2 索引与外键策略

- 索引全集已写进各模型提案（§5.2/§6.3/§7.3/§9.2）；People 视图的 `[orgId, actorType, actorId, occurredAt]` 与成本聚合的 `[orgId, projectId, costStatus]` 为投影读路径预置。
- **四张新表零 Prisma FK 到 Project/Document/User**（Final Review 再确认：ProjectEvent / ProjectCost / TenderArchiveItem 均维持无 FK；唯一例外是 ProjectEventActor→ProjectEvent 内部 FK，`onDelete: Restrict`）。理由：账本/档案行必须在被引对象硬删后存活（AuditLog 摘挂与 Document Cascade 蒸发的双重教训）；引用完整性由领域服务层保证，孤儿引用是**合法的历史事实**。**明确禁止**为解决授权锚点问题（§15.8）而回头加 `ON DELETE CASCADE`——业务对象删除 ≠ 证据自动消失，授权问题由 §15.8 的保留契约解决而非级联删除。

### 15.3 租户隔离（TENANT_BOUNDARY_VALIDATED 材料）

- 四表 orgId 一律非空（对比：AuditLog/ProjectReview/ProjectInsight/PendingAction 的 orgId 可空是本次审计反复命中的债根）。
- 全部读写路径 org-scope 前置（Security-1 `authorize` + `requireProjectReadAccess` 既有纪律）；快照字节经代理前缀 + 行级 accessClass 双闸（§11.2）。
- projectId 无 FK ⇒ 跨租户引用风险由「写入仅领域服务 + 服务层 org 校验」封堵；评审时以此为红线检查项。

### 15.4 Migration 流程纪律

- 走 `scripts/safe-migrate-deploy.ts`（`db:migrate:deploy`,历史事故文档 `INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md` 在案）；Neon 分支演练先行（`bid-workflow-isolated-migrate-verify.ts` / `phase-c-isolated-migrate.ts` 模式;test-all 全绿需临时隔离分支——DB 平面 fail-closed）。
- 与 PR #52（schema +53/−2）状态对表后再排 M1（T0 冲突矩阵 §0.2 要求）。

### 15.5 Rollback

- 写入点合入前：`DROP TABLE` ×4 即完全回滚（无数据）。
- 写入点合入后：**停写入点（revert 应用层 PR）→ 表保留**；不做破坏性回滚（append-only 账本的回滚语义 = 停止追加，历史数据无害）。M2 可空列同理（停读即隐形）。

### 15.6 Dual-write Plan（DUAL_WRITE_PLAN 材料）

| 项 | 冻结口径 |
|---|---|
| 范围 | **仅 ProjectMessage(SYSTEM) 状态叙事**一处双写（Ledger 事件 + system-events helper 同事务）。AuditLog 不是双写（用途不同,长期共存）；Notification 派生源不变 |
| TEMPORARY | 退出条件 = T1-PR3 的 5-tab 时间线换源 Ledger 渲染 + 一个观察期（建议 30 天）后,13 个 helper 中的状态类写入停写;真实人类讨论消息永不受影响 |
| EXPLICIT | 双写点逐一登记于写入点 PR 描述（首批 ≤13 个,§12） |
| IDEMPOTENT | Ledger 侧 eventKey（§5.5）;SYSTEM 侧沿 emitProjectPatchEvents 的 diff-only 既有幂等 |
| RECONCILED | 对账脚本:按 projectId 抽样比对「状态类 SYSTEM 消息 ↔ 同事务 Ledger 事件」数量与 metadata/eventKey 对应;零差异为退出前提 |

### 15.7 兼容性

- `listProjectActivity` 读面在 T2 期间不变（AuditLog+SYSTEM 双源照旧）——Ledger 投影是**新增**读面,老读面在 T1-PR3 换源时才切换,任何时刻用户可见时间线不出现空窗。
- Workforce read-model / runtime 零改动（§13 边界）;tender-auto-analysis 队列不动（T5 收敛）。

### 15.8 Deleted Project Retention / Authorization Contract（Final Review 新增冻结）

**现状核查（Final Review 基线）**：Project **真实支持 hard delete**——`DELETE /api/projects/[id]`（`projects/[id]/route.ts:273-321`）仅需 `requireProjectWriteAccess`，事务内：`Task.projectId→null`、`BlindsOrder.projectId→null`、`AuditLog.projectId→null`（摘挂）、`agentTask.deleteMany`（连带 Step/ApprovalRequest Cascade），随后 `project.delete` 触发 Prisma Cascade 扇出——ProjectDocument（→Page→TenderAnalysisRunDocument）、ProjectConversation→Message、TenderAnalysisRun 家族、BidIntelligenceRoom 家族、Inquiry/Quote/Review/Insight/Similarity/GeneratedDocs/ProgressSummary/SupplierLink 等全部物理消失。即：**普通业务写权限今天就能抹掉一个项目的全部历史**。

**问题**：四张新表无 FK（§15.2），项目硬删后 Ledger/Archive 行存活——但读取授权主锚 `requireProjectReadAccess(projectId)` 随 Project 行消失，形成 orphaned but unreadable historical evidence。

**冻结推荐 = OPTION A（主契约）+ org 级特权读作为残余路径（兜底，非并列选项）**：

1. **OPTION A（主契约）**：Tender/Project 一旦进入"有历史价值"状态（存在任一 ProjectEvent / TenderArchiveItem / ProjectCost 行，或 workDomain=tender 且已过 initiation），**普通业务路径不再允许 hard delete**——DELETE 语义收敛为 soft-delete：复用既有生命周期词表 `status="archived"`（`projectLifecycleLabel("archived")="已归档"`、`buildProjectLifecycleWhere` 已存在）或引入 `deletedAt` 标记，**保留 Project 行的 id / orgId / 成员关系作为永久授权锚**。Ledger/Archive 读取继续走 `requireProjectReadAccess`（含 soft-deleted 项目的历史读模式）。物理删除只保留给**合规/行政 purge 专用流程**（platform-admin 级、独立审计、显式确认），不是普通业务操作。
2. **残余路径（覆盖两种不可避免场景）**：(a) OPTION A 落地前已被硬删的历史项目；(b) 合规 purge 之后的孤儿行。此时 Ledger/Archive 行仅凭自身 `orgId` 存在——只允许经 **org-scoped privileged historical archive access**（org admin/manage 级权限 + 专用读面）访问；普通 `requireProjectReadAccess` 路径对孤儿行 fail-closed，**不得**为绕过授权锚缺失而放宽。
3. **实施排期**：删除路径收口是**生产行为变更**，本轮不做——列为 `DELETION_GATING_PRECONDITION_FOR_T2_WRITERS`：**T2-P1 首批 producer 合入前**，必须先合入"tender 项目删除收敛为 soft-delete"的独立小 PR（否则账本上线即暴露"记了账、项目被删、账变孤儿"窗口）。T2-M1（建表）不受此阻塞。
4. **原则重申**：删除项目 ≠ 删除企业记忆；只有 legal/compliance purge 可以触碰证据，且走专用流程。

```
DELETED_PROJECT_RETENTION_CONTRACT = PASS
```

---

## 16. Backfill Proposal

### 16.1 ProjectEvent 回填（确定性合成,幂等可重放）

| 源 | 合成事件 | eventKey | occurredAt |
|---|---|---|---|
| Project 里程碑列（distributedAt/interpretedAt/supplierInquiredAt/supplierQuotedAt/submittedAt） | tender.stage_advanced ×N | `backfill:stage:{stage}` | 列值 |
| tenderStatus ∈ 终态 + awardDate | tender.result_marked | `backfill:result:{value}` | awardDate ?? updatedAt |
| abandon 字段组 | tender.abandoned | `backfill:abandoned` | abandonedAt |
| ProjectHandoff(completed) | tender.handoff_completed | `backfill:handoff:{id}` | completedAt |
| ProjectDocument（现存行） | document.added | `backfill:document:{id}` | doc.createdAt |
| BidIntelligenceRoom.goDecision 当前值 | decision.go_no_go（仅当前值一条;历史已不可恢复——AuditLog 里的历史决策**不回填**,见下） | `backfill:go_decision` | goDecidedAt |

统一标记:`actorType=system`、`actorId=backfill`、`sourceRef="backfill:project-milestones"`;actor 尽力从列（abandonedById/goDecisionById/dispatchedById）还原填 refs。

**明确不回填（NOT_BACKFILLED,冻结）**:AuditLog 反解（beforeData/afterData 是自由 String,195 写入点无 schema 保证,解析出错会污染账本;AuditLog 本身永久保留可查,历史不丢失只是不换载体）;InquiryItem 历史报价（已被覆盖,无从恢复）;SYSTEM 消息反解（叙事文本非结构化）。**账本的历史起点 = T2 上线时刻,之前的过程史以"里程碑级"精度回填,过程级历史归 AuditLog 查证。**

### 16.2 Archive 回填

- 范围:`ProjectDocument WHERE blobUrl IS NOT NULL`——读 blob → sha256（与既有 contentHash 比对,缺失则补写 doc.contentHash）→ 建 TenderArchiveItem（captureMethod=backfill_upload、capturedAt=doc.createdAt、accessClass 按 source 判:generated→INTERNAL_COMPANY,upload→INTERNAL_COMPANY,external_link 不适用）→ 回写 projectDocumentId 互链。幂等:唯一键天然去重,可分批可重放。
- **外链文档（blobUrl IS NULL,BidToGo 全部历史文档）**:无字节可归档——登记 `UNARCHIVABLE_LEGACY` 清单（数量在实施时统计）,**不伪造回填**;若 URL 尚活,T5 采集 Job 可事后补捕（captureMethod=url_capture,capturedAt=实际抓取时刻——不冒充历史时间）。
- 成本:回填批处理不产生 AI 调用,零 ledger 影响。

### 16.3 对账（RECONCILED 材料）

parity 脚本三项:①每项目 stage 事件数 = 非空里程碑列数;②document.added 事件数 = 文档行数;③archive 行数 = blobUrl 非空文档数 −（去重命中数）。零差异 + UNARCHIVABLE_LEGACY 清单人工确认 = 回填验收。

---

## 17. T2 Entry Gate（Final Contract Review 定审;任务书 §21 与 T0 路线图键合并）

### 17.1 Gate 判定（本轮为 Final Contract Review,只允许 PASS / BLOCKED）

| Gate 键 | 材料 | **Final Review 判定** | 判定依据 |
|---|---|---|---|
| `LEGACY_STORE_DECISION`（=T0 LEGACY_EVENT_STORE_DECISION_GATE） | §1–§2 判决矩阵（26 套） | **PASS** | 判决矩阵完备;#93 对 AgentRunEvent 的修复不改变任何判决（§4） |
| `SOURCE_OF_TRUTH_DEFINED`（=T0 PROJECTEVENT_SOURCE_OF_TRUTH_BOUNDARY） | §3 矩阵 + 边界规则 | **PASS** | 唯一权威边界含双豁免规则明确;cost 修订史归属澄清（§6.3） |
| `SCHEMA_PROPOSAL_REVIEWED` | §5/§6/§7/§9 四模型 + §14 决策 | **PASS** | Micro-Fix 后契约无歧义:seq 契约冻结、revisionCount、版本双唯一、accessClass 治理分离、Actor FK Restrict |
| `TENANT_BOUNDARY_VALIDATED` | §15.3 + §15.8（设计级;运行级=Neon 分支演练在 M1 实施时执行） | **PASS** | 四表 orgId 非空;孤儿行 org 级特权读契约冻结（§15.8） |
| `BACKFILL_PLAN_DEFINED` | §16 | **PASS** | 确定性/幂等/可重放;NOT_BACKFILLED 边界显式 |
| `DUAL_WRITE_PLAN` | §15.6 | **PASS** | 单点双写、TEMPORARY 退出条件、对账方案保持 |
| `IDEMPOTENCY_CONTRACT` | §5.5 + §5.6 | **PASS** | eventKey 词表 + seq/eventKey 双唯一职责分离 + revision 幂等号 |
| `MIGRATION_PLAN` | §15 | **PASS** | 纯 additive;M1/M2 分批冻结;rollback 语义明确;零 runtime 依赖 |

```
T2_ARCHITECTURE_FINAL_REVIEW = PASS（8/8）
T2_READY_FOR_IMPLEMENTATION  = YES
  语义:允许开启独立的 T2-M1 Schema Foundation migration PR。
  不是:自动开始实施。ProjectEvent / ProjectEventActor / ProjectCost / TenderArchiveItem
  四个基础模型的正式批准仍 = 人工 Review 本 PR + 下一条指令;本 PR 保持 Draft。
```

### 17.2 T2 实施顺序（Final Review 冻结;禁止 M1 合并后一次铺 13+ producer）

```
T2-M1  Schema Foundation
       仅 4 张新表:ProjectEvent / ProjectEventActor / ProjectCost / TenderArchiveItem
       （不含 M2;不含任何写入点）
  ↓
T2-M1 Validation
       Neon 隔离 migration 演练 · 租户隔离测试 · 索引/约束验证 · rollback 演练
  ↓
T2-P1  首批 4 个最高价值 producer（前置:DELETION_GATING_PRECONDITION,§15.8;
       各写入点逐 PR 评审）
       stage transition · result marked · abandon · go/no-go
  ↓
T2-P1 Real Validation
       至少一个真实 Tender 走查:Timeline 投影 · eventKey 幂等重放 · correction 链 ·
       授权（含 org 边界）· 事务原子性（业务失败 ⇒ 零事件残留）
  ↓
T2-P2  扩展 producer（前置:R5 报价授权修复 = SECURITY_PRECONDITION,§18）
       supplier.selected · supplier.quote_received · quote confirmed（含 cost.revised 链路）·
       document.added · site_visit.completed · cost.*
  ↓
Archive Capture Implementation —— 另立独立 PR（不并入 producer 序列）
M2（ProjectDocument additive 列 + AuditLog 小修）—— T2-M1 Validation 之后独立评审排期
```

---

## 18. Risks / Blockers（本轮新发现全部登记,不修）

| # | 项 | 级别 | 去向 |
|---|---|---|---|
| R1 | 事件表零读者风险:OrderStatusLog/PublishJobStatusEvent/FabricStockLog 三张结构良好的事件表全部零消费——ProjectEvent 若无同批投影将重蹈覆辙 | 设计约束 | T2 验收标准:Ledger 与 Timeline/Cost 投影同批交付 |
| R2 | seq 分配并发（§5.6）:单项目并发写入的 P2002 重试路径必须有测试 | T2 实施 | 写入点 PR 单测红线 |
| R3 | 双写期 SYSTEM 消息与 Ledger 叙事重复渲染（项目详情页 activity 默认含 SYSTEM） | T2 实施 | 投影换源前 Ledger 不进 activity 读面（§15.7） |
| R4 | `includeSystemEvents=true` 全量内存分页（`activity/query.ts:65-91`,B6 已登记）在双写期数据量翻倍 | P1 | T1-PR3 换源时一并解决（T0 B6 不变） |
| R5 | 报价单 create/patch/delete 仅 `requireProjectReadAccess`（读权限可改写报价,`quotes/[quoteId]/route.ts:30,114`） | **P0-adjacent 安全债**（PR #95 同族口子）;**SECURITY_PRECONDITION_FOR_T2_WRITERS**（见下） | 独立 **SECURITY-P0.x** 小 PR,不在本 PR 修代码,不并入 T2 |
| R6 | TaskActivity 读 route 无归属校验（任意登录用户可读任意任务活动,`tasks/[id]/activities/route.ts:7`） | 安全债（同族;非 tender producer 直接前置） | 独立 **SECURITY-P0.x** 小 PR |
| R7 | ProjectEmail:发送就地覆盖 AI 草稿原文、orgId 可落空串、裸引用无 FK | P1 | email.sent 写入点 PR 顺带修 orgId 空串;草稿版本化留 T5 邮件能力 |
| R8 | ToolCallTrace 无 orgId、SkillExecution/ApprovalRequest/AgentTask 无 org 列 | 运行时债 | 移交 Runtime Owner（Phase 2 范畴,tender 侧不动） |
| R9 | PendingAction orgId 为 null 时幂等键失效 | 运行时债 | 同上 |
| R10 | ProjectReview.outcome 确认侧无词表校验（任意字符串入索引列）+ 确认后扩散不可回收 | P1 | T2 词表收敛（T0 B14）时一并 |
| R11 | AgentRunEvent:~~sequence 竞态~~（**#93 已修**:P2002 有界重试,`run.ts:479-513`）;残余 = 外层 best-effort（log+return null）语义评估 + 业务文本泄漏收敛（§4.2） | 运行时债（范围缩小） | Workforce Runtime Owner,Phase 2 correctness |
| R12 | tender AI 成本零入账（§6.1,较 T0 B5 加重:连 tokenUsageJson 都没写） | P1 | T2 修债 PR（§6.4） |
| R13 | 文档硬删级联抹证据链 + 生成文档双行 | P1 | M2 软删列 + 归档化后删除改为 supersede;双行收敛入 T2 文档债 |
| R14 | PR #52（schema +53/−2）与 M1 的冲突窗口 | 流程 | §15.4 对表后排期 |
| R15 | 回填期间历史项目的 goDecision 仅能回填当前值,历史决策史永久缺失（AuditLog 截断 200 字符） | 已接受的损失 | §16.1 NOT_BACKFILLED 记录在案 |

**SECURITY_PRECONDITION_FOR_T2_WRITERS（Final Review 冻结）**：

```
R5（Quote mutation authorization）必须在 Quote / supplier 相关 Ledger producer
（T2-P2:quote.confirmed / supplier.quote_received / supplier.selected 及 cost.revised 链路）
合入之前修复（独立 SECURITY-P0.x PR;本 PR 不修代码）。

原因:Ledger 不能成为"忠实记录未授权修改"的替代品。正确顺序是:
  authorization correct → business mutation → Ledger record
而不是:
  unauthorized mutation → Ledger faithfully records it

配套前置:DELETION_GATING_PRECONDITION（§15.8,T2-P1 前）。
T2-M1（纯建表）不受这两项阻塞。

SECURITY_PRECONDITION_DEFINED = PASS
```

---

## 19. T0 断言修正登记（本次代码核查推翻/细化的 T0 记载）

| # | T0 断言 | 实际（本次证据） | 影响 |
|---|---|---|---|
| C1 | "AuditLog…payload 是 String 非 Json"（§2） | 无 payload 列;实为 `beforeData/afterData String?` 两列 | 表述修正,判决不变 |
| C2 | "ProjectMessage(SYSTEM) 可编辑、可软删（editedAt/deletedAt）"（§3.1/§3.5 判决理由） | **死列**:全库零 update/delete 路径,UI 分支永不触发——事实上 append-only | 判决不变（DUAL_WRITE_TEMPORARY→DERIVED_ONLY）,理由改为:无 orgId/无词表/无幂等/叙事形态（§2） |
| C3 | ProjectEvent 含 cost 内嵌载荷（"唯一例外",§3.2） | 任务书新增 PLANNED/COMMITTED/ACTUAL 生命周期要求 ⇒ 内嵌不可行 | **修订为独立 ProjectCost 表**（§6）,T0 §3.2 模型的 4 个 cost 列移除 |
| C4 | TenderArchiveItem.`supersededByArchiveItemId`（§5.2,旧行回写） | 旧行回写 = UPDATE,违反自身 IMMUTABLE 契约 | **改为 `supersedesSnapshotId` 新→旧**（§9.2） |
| C5 | "tender 分析不写入（AiUsageLedger）,只存 TenderAnalysisRun.tokenUsageJson"（§2） | tokenUsageJson 是**零写入死字段**;tender AI 成本完全未入账 | B5 债加重（R12）,修债方案不变 |
| C6 | "旧 AgentTask 流水…进入退役观察期,不再挂新能力"（§12.2） | 仍有 3 条活跃生产入口（cron inspect 每日/ai_bid_package/项目页手动） | DEPRECATE 判决不变,但 T5 收敛工作量上修:两条自动入口需 Workforce 承接面先行 |
| C7 | "邮件:仅出站（Gmail/SMTP/Resend 三条并行）"（§2） | 唯一发送路径 = 逐用户 Gmail OAuth;provider 是死字段,无 SMTP/Resend | email.received 仍为 T5 外部前置,前置面比 T0 记载更窄 |
| C8 | "9 套历史/活动存储"（§2） | 事件形存储实为 **12+ 套**（新计入 FabricStockLog/PublishJobStatusEvent/HumanFeedbackEvent 等）,另有 6 组就地覆盖无历史的业务状态存储 | 判决矩阵扩为 26 套存量 + 1 新表（§2）,原则不变 |

---

## 20. 最终输出（Final Contract Micro-Fix Review 后定稿）

```
ORIGINAL_AUDIT_BASE                        = main @ 4f082cd
FINAL_REVIEW_BASE                          = main @ 8303145（= #93 merge）
#93_INCLUDED                               = YES

AGENT_RUN_EVENT_FINDING_ALIGNED_WITH_2B2   = PASS（§4;判决不变 KEEP_AS_RUNTIME_TELEMETRY）
PROJECT_EVENT_DECISION                     = OPTION D（ProjectEvent + ProjectEventActor;附 ProjectCost）
PROJECT_EVENT_SEQUENCE_CONTRACT            = PASS（§5.6;bounded retry=8 + THROW + 事务 fail-closed）
PROJECT_COST_REVISION_AUDIT                = PASS（§6.3;cost.revised + revisionCount 幂等号）
ARCHIVE_MODEL_DECISION                     = NEW_SOURCE_SNAPSHOT_REQUIRED（TenderArchiveItem = SSC v1）
ARCHIVE_IMMUTABILITY_CONTRACT              = PASS（§9.3;证据字段清单冻结）
ARCHIVE_ACCESS_POLICY_CONTRACT             = PASS（§9.3;accessClass 治理可变,不复制快照）
ARCHIVE_VERSION_CONTRACT                   = PASS（§10.4;双唯一约束职责分离）
DELETED_PROJECT_RETENTION_CONTRACT         = PASS（§15.8;OPTION A 主契约 + org 级特权残余路径）
SECURITY_PRECONDITION_DEFINED              = PASS（§18;R5 前置于 T2-P2 quote/supplier producer）

LEGACY_STORE_DECISION                      = PASS
SOURCE_OF_TRUTH_DEFINED                    = PASS
SCHEMA_PROPOSAL_REVIEWED                   = PASS
TENANT_BOUNDARY_VALIDATED                  = PASS
BACKFILL_PLAN_DEFINED                      = PASS
DUAL_WRITE_PLAN                            = PASS
IDEMPOTENCY_CONTRACT                       = PASS
MIGRATION_PLAN                             = PASS

SCHEMA_CHANGE_REQUIRED_FOR_T2              = YES（M1 四新表 + M2 additive 列;仅提案）
MIGRATION_CREATED                          = NO
WORKFORCE_RUNTIME_MODIFIED                 = NO
PRODUCTION_BEHAVIOR_CHANGE                 = NO

T2_ARCHITECTURE_FINAL_REVIEW               = PASS（8/8）
T2_READY_FOR_IMPLEMENTATION                = YES
  语义:允许开启独立 T2-M1 Schema Foundation migration PR（§17.2 冻结顺序）。
  不代表自动开始实施;四个基础模型的正式批准 = 人工 Review 本 PR 后的下一条指令。
NEXT_ACTION_IF_APPROVED                    = T2-M1_SCHEMA_FOUNDATION
NEXT_PHASE_AUTOSTART                       = NO（本 PR 保持 Draft,不 merge,STOP）
```

---

## 21. FINAL CONTRACT MICRO-FIX REVIEW（2026-08-10）

| 项 | 记录 |
|---|---|
| Previous audit base | `main @ 4f082cd`（PR #95 之后） |
| Current review base | `main @ 8303145` = PR #93（Workforce 2B-2 Controlled Parallel）merge commit `83031455d73…`;其后 main 无新 commit;本分支已 rebase 到该基线 |
| **#93 影响面** | 16 文件:agent-runtime-v2（executor/schemas/tool-catalog）、`agent-runtime/run.ts`（appendAgentRunEvent 有界重试）+ types.ts（新增 `task.claimed`/`parallel.batch_*` 内部事件类型）、workforce-runtime（parallel.ts 新增/processor/task-contract/index）、4 个新测试套 + probe、test-all.sh、2B-2 文档。**不触及** Project / ProjectDocument / RBAC / Cost / Archive / AuditLog / Tender 域——本文档 §1–§3/§6–§16 的审计结论无需重开;受影响的仅 §4（AgentRunEvent）与 §5.6（seq 契约借鉴），已 targeted revalidation |
| AgentRunEvent correction | §4.1-S3 改写:sequence 冲突已由 #93 修复为 P2002 有界重试（`MAX_SEQUENCE_RETRIES=8`,重读 max 再 create,`run.ts:479-513`）,"首次 collision 即静默丢事件"不再成立;但外层 catch 仍 log + return null（`run.ts:514-522`）= best-effort 遥测语义。五条失格理由重述（无 projectId 归属/生命周期属 Runtime/Cascade 耦合/telemetry 语义/best-effort 追加）。**判决不变:KEEP_AS_RUNTIME_TELEMETRY**;R11 范围缩小 |
| ProjectEvent sequence contract | §5.6 收敛为单一方案:业务事务内 eventKey 幂等短路 → 读 max(seq) → create → P2002 按 `error.meta.target` 分流（eventKey 命中=幂等返回;seq 命中=重读重试）→ `PROJECT_EVENT_SEQUENCE_MAX_RETRIES = 8` → 耗尽 THROW → 业务事务整体 ROLLBACK。禁止 catch-log-continue / return null / best-effort。双唯一约束职责分离:seq=顺序唯一性,eventKey=业务幂等 |
| ProjectCost revision contract | §6.3 收口"PLANNED 可编辑 ≠ 无历史更新":实质字段（amountPlanned/quantity/unitRate/currency/description/supplierId/incurredAt）修改必须同事务 `revisionCount` 自增 + `cost.revised` 事件（eventKey `cost:{costId}:revision:{revisionNo}`,拒绝单键 `cost:{costId}:revised` 与 wall-clock 幂等源）;不新增 ProjectCostRevision 表;ACTUAL 后 void+correction 不变 |
| Archive governance contract | §9.3 修订:证据字段清单永久 IMMUTABLE;`accessClass` 单列为 governance metadata——经专用受权 service 修改,强制 changedBy/changedAt/reason + AuditLog,未来 `archive.access_changed` 事件（本轮不实现）;**分级变更不产生新快照**（废弃初稿"accessClass 错误=新行 supersede"——与同观察幂等唯一键冲突） |
| Archive version contract | §10.4 新增:`@@unique([orgId,projectId,captureKey,snapshotVersion])`（版本序完整性）与既有 `[…,contentHash]`（同观察幂等）并立;版本分配 bounded retry(8)+THROW;写失败零副作用,永不触碰既有证据行 |
| Deleted project retention contract | §15.8 冻结:现状 hard delete 真实存在（写权限即可,Cascade 扇出抹历史,`projects/[id]/route.ts:273-321`）。推荐 **OPTION A 为主契约**（有历史价值项目 soft-delete/`status="archived"`,保留 id/orgId 授权锚;物理删除=合规专用流程）+ org 级特权读作为孤儿行残余路径;`DELETION_GATING_PRECONDITION` 前置于 T2-P1。四表无 FK 决策再确认;ProjectEventActor→ProjectEvent 定为 `onDelete: Restrict` |
| Security prerequisite | §18 冻结 `SECURITY_PRECONDITION_FOR_T2_WRITERS`:R5（报价读权限可改写）必须以独立 SECURITY-P0.x PR 在 T2-P2 quote/supplier producer 前修复;原则=authorization correct → business mutation → Ledger record;Ledger 不为未授权修改背书。T2-M1 不受阻塞 |
| 实施顺序冻结 | §17.2:T2-M1（仅四表）→ M1 Validation（Neon 演练/租户/索引/rollback）→ T2-P1（4 producer）→ P1 真实 Tender 验证 → T2-P2（扩展 producer）→ Archive Capture 独立 PR;M2 在 M1 Validation 后独立排期;禁止 M1 后一次铺 13+ producer |
| Final 8 Gate decisions | LEGACY_STORE_DECISION / SOURCE_OF_TRUTH_DEFINED / SCHEMA_PROPOSAL_REVIEWED / TENANT_BOUNDARY_VALIDATED / BACKFILL_PLAN_DEFINED / DUAL_WRITE_PLAN / IDEMPOTENCY_CONTRACT / MIGRATION_PLAN = **全部 PASS**（§17.1 判定依据逐键在案）;`T2_ARCHITECTURE_FINAL_REVIEW = PASS`,`T2_READY_FOR_IMPLEMENTATION = YES`（仅解锁 T2-M1 PR 的开启;NEXT_PHASE_AUTOSTART = NO） |

*Final Contract Micro-Fix Review 至此完成。本 PR 保持 Draft,不 merge;等待人工确认四个基础数据模型的正式批准后,方可开启独立的 T2-M1 Schema Foundation PR。*
