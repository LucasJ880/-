# Qingyan Tender T0 — Project Ledger / Archive / Corporate Memory / Intelligence 架构设计

| 项 | 值 |
|---|---|
| 基线 | `main @ abac67e`（含 PR #85 / Workforce 2B-1） |
| 分支 | `design/tender-t0-memory-intelligence`（docs-only） |
| 日期 | 2026-08-10 |
| 性质 | **纯设计文档**：本轮 `SCHEMA_CHANGE = NONE`、`PRODUCTION_MUTATION = NO`；所有新模型均为 T2+ 提案，需单独批准 migration |
| 修订 | 2026-08-10 Final Architecture Micro-Fix：①记忆模型三级冻结（LEVEL 1 必需基础 / LEVEL 2 域表 / LEVEL 3 物化 Design Gate，§6.4）；②Legacy Event Store Gate（ProjectEvent 生产写入点前置硬闸，§3.1/§3.5）；③Deterministic Plan Injection 升级为 T5 HARD DEPENDENCY + Runtime Owner Design Gate（§12.3） |
| 姊妹文档 | `QINGYAN_TENDER_T0_UX_CONSOLIDATION_AUDIT.md`（UX）、`QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`（T1–T5 与冲突矩阵） |

---

## 1. 设计原则

1. **单一事实源，多重投影**：每类事实只落一张表；Timeline/Cost/People/Audit/Review 全部是读侧投影，禁止五份拷贝。
2. **AI 结论 ≠ 事实**：一切 AI 产出以 Claim 形态存在（CONFIRMED/SUPPORTED/INFERRED/UNKNOWN + 证据链 + 可被 supersede），不得直接落成永久事实。现有 `TenderAnalysisFact.statementKind`（CONFIRMED_FACT/DOCUMENT_INTERPRETATION/AI_INFERENCE/RECOMMENDATION，`schema.prisma:2394`）与 `BidIntelligenceFact.confidence`（CONFIRMED/HIGH_CONFIDENCE/INFERRED/UNKNOWN，`schema.prisma:2260`）证明这个纪律已在两处半成品存在——目标是统一而非新造第三套。
3. **原始档案 IMMUTABLE**：Raw Archive 只增不改；AI 与人都不得改写原件。修正以新版本/新事件表达。
4. **员工正常工作，记忆自动形成**：事件驱动，不设"点击保存到记忆库"。
5. **复用优先**：先用已验证的存量模式——`ProjectHandoff` 的快照+幂等（`schema.prisma:377-418`）、`AgentRunEvent` 的 `@@unique([runId, sequence])` 有序追加日志（`:4738`）、`UserMemory` 的双时态+supersession（`:4268-4318`）、`Task.sourceType/sourceId + @@unique` 幂等投影（`:441,461`）、`MarketSnapshot` 的 `urlHash+diffJson+capturedAt` 网页快照（`:3071`）、`hash.ts` 内容指纹、`AiUsageLedger` 幂等成本账本（`:6531`）。
6. **不建第二套任务运行时**：未来自动化全部落 Workforce Job/Task（§12–13）。已存在的 `tender-auto-analysis` 独立队列作为既有债登记，收敛决策放 T5。

---

## 2. 现状事实层盘点（审计要点）

完整证据见审计过程记录；此处只列对设计有决定性影响的事实：

| 现状 | 证据 |
|---|---|
| Prisma schema 共 ~210 模型 / 6813 行；`pgvector` 扩展已启用 | `schema.prisma:8-13` |
| Project 上并存 **5 个状态字段**（status/tenderStatus/bidPhaseStatus/intakeStatus/aiAdviceStatus）+ 10 个里程碑日期列 | `schema.prisma:246-350` |
| **9 套历史/活动存储**：AuditLog（195 个调用点）、ProjectMessage(SYSTEM)、TaskActivity、AgentTaskStep、AgentRunEvent、ToolCallTrace、TradeActivityLog、OrderStatusLog、Notification（派生） | 各 schema 行 + `src/lib/audit/logger.ts` |
| AuditLog 有 `traceId` 列却把 correlation 塞进 `afterData._runtimeCorrelation`；payload 是 `String` 非 `Json` | `logger.ts:17-20,58-72` |
| **3 张事实表 3 套置信度词表**：TenderAnalysisFact / BidIntelligenceFact / ProjectInsight，互不引用 | `schema.prisma:2387,2244,1693` |
| Evidence 实质已存在：`TenderAnalysisSourceRef`（多态 5 父表、页码+原文片段+confidence），但 `documentId` 无 FK、可孤儿化 | `schema.prisma:2411-2443` |
| `TenderExtractedRequirement` 模块外**零读者**；`projectionStatus/projectedRequirementId` 是死字段；`normalizeRequirementFingerprint` 算了不存 | `hash.ts:56`、`extract.ts:163` |
| Outcome 分散 5 处、3 套词表（tenderStatus 终态 / ProjectReview.outcome / abandon 字段组 / goDecision / 备注追加进 description） | `tender-result.ts:38-68`、`review.ts` |
| **无中标方名称字段**；buyer 只是自由文本 `clientOrganization` | `schema.prisma:266` |
| AI 成本账本 `AiUsageLedger` 成熟（幂等、org/project/trace 维度、Decimal(18,6)），但 **tender 分析不写入**（只存 `TenderAnalysisRun.tokenUsageJson`）；**全库无任何人工工时/费用模型** | `schema.prisma:6531`、`usage/record.ts:22` |
| 文档：Vercel Blob 私有店 + 代理鉴权（`blob-access.ts`）；页级解析 + contentHash（`page-parse.ts`）；**hash 有索引但无去重读路径**；无 HTML 快照、无 PDF 栅格化、无 OCR、无版本链、硬删除 |
| 向量：销售/组织知识域有真 `vector(1536)` + 原生 SQL 检索（`sales/vector-search.ts:172-183`），但**零 ANN 索引**（全表扫）；tender 内容零向量化；`ProjectSimilarity` = 80 候选上限的 Jaccard（`similarity.ts:58-66,94-105`） |
| 邮件：仅出站（Gmail/SMTP/Resend 三条并行）；`ProjectEmail` 无 direction/threading/收件；入站明确未实现（`trade/inbound-org.ts:96`） |
| Obsidian：**单向导入**（md/zip → 组织知识/项目 KB，`markdown-vault-import.ts:3-5` 自述"不双向同步"），无导出/回写 |
| 审批：PendingAction + ApprovalRequest 双表、`approval/port.ts` 与 `capabilities/approvals/*` 双统一层；tender-analysis 的 confirm 全部绕开（直连 `db.update`+AuditLog） |

---

## 3. Project Ledger / 项目事件账本

### 3.1 核心决策：需要一张新的事实源表（问题 H 的回答）

**结论：是，需要新增一张 append-only `ProjectEvent` 表。** 现有 9 套存储都无法承担业务账本职责：

| 候选 | 为什么不能承担 |
|---|---|
| `AuditLog` | 定位是**技术变更审计**：195 个写入点混杂全域噪声；`beforeData/afterData` 是 String；无业务语义字段（stage/result/cost/laborHours/actorType）；无稳定排序键；correlation 靠 JSON 走私；includeSystemEvents 读路径全量扫描。把业务账本语义压上去会同时毁掉两个用途 |
| `AgentRunEvent` | 运行时作用域（runId 为根），形状正确但只属于 Job 生命周期 |
| `ProjectMessage(SYSTEM)` | 可编辑、可软删（`editedAt/deletedAt`），是人可读的讨论流，不是不可变账本 |
| `TaskActivity` / `AgentTaskStep` / `ToolCallTrace` / `OrderStatusLog` / `TradeActivityLog` | 各自窄作用域（task/step/tool/order/trade） |
| `Notification` | AuditLog 的派生投影（`notifications/service.ts:185`），是 sink 不是 source |

同时立规两条（Final Review 冻结口径）：

1. **ProjectEvent 是第 10 套存储的唯一豁免**——它进场的前提是把其余 9 套显式分类并通过判决（§3.5），否则就是任务书警告的"第二套事实源"。
2. **硬闸 `LEGACY_EVENT_STORE_DECISION_GATE`**：`ProjectEvent` 的**方向 = APPROVED，但在该 Gate 通过前不得创建任何生产写入点**（NO PROJECTEVENT PRODUCTION WRITER UNTIL LEGACY_EVENT_STORE_DECISION_GATE = APPROVED）。T2 不允许一上来铺设几十个写入点——先批准 §3.5 的存量判决，再按判决结果接线。Gate 的完整键值见路线图「T2 Entry Gate」。

### 3.2 事件模型（T2 提案，非本轮实现）

```prisma
/// T2 提案 — append-only，无 update 路径；修正 = 追加 correction 事件
model ProjectEvent {
  id            String   @id @default(cuid())
  orgId         String                     // 强制非空（吸取 AuditLog.orgId 可空的教训）
  projectId     String
  seq           Int                        // 项目内单调序号，@@unique([projectId, seq])（复刻 AgentRunEvent 模式）
  eventKey      String                     // 幂等键 @@unique([projectId, eventKey])：来源域自然键，如 "stage:interpretation:2026-08-10"
  occurredAt    DateTime                   // 业务时间
  recordedAt    DateTime @default(now())   // 记账时间
  actorType     String                     // user | ai | system | external
  actorId       String?                    // User.id / worker key / sourceSystem
  eventType     String                     // 词表见 §3.3
  stage         String?                    // 事发阶段（lib/tender/stage 派生值快照）
  title         String
  description   String?  @db.Text
  result        String?                    // 事件结果（如 go / no_go / approved / failed）
  payload       Json?                      // 结构化明细（各 eventType 各自 schema，zod 校验）
  // 关联引用（一律存 id 引用，不复制业务数据）
  refs          Json?                      // { requirementId?, documentId?, supplierId?, inquiryId?, quoteId?, emailId?, taskId?, runId?, pendingActionId?, claimId? }
  sourceRef     String?                    // 溯源："audit:{id}" | "agentRun:{id}" | "analysisRun:{id}" | "manual"
  traceId       String?
  // 成本载荷（仅 cost 类事件填写，见 §5）
  costAmount    Decimal? @db.Decimal(18,2)
  costCurrency  String?
  costCategory  String?                    // 词表见 §5.1
  laborHours    Decimal? @db.Decimal(6,2)
  createdAt     DateTime @default(now())
  @@unique([projectId, seq])
  @@unique([projectId, eventKey])
  @@index([orgId, projectId, occurredAt])
  @@index([projectId, eventType])
}
```

要点：

- **写入纪律**：只允许领域服务在既有业务事务内追加（与 `writeAuditLog(tx, …)` 同模式）；禁止 UI 直写；无 update/delete API。
- **幂等**：`eventKey` 由来源域构造（复刻 `Task @@unique([sourceId, sourceTemplateKey])` 与 `AiUsageLedger.idempotencyKey` 的成熟做法）。
- **不复制事实**：refs 只存 id。例：报价确认事件不抄金额，Cost View 需要金额时 join `ProjectQuote`；**唯一例外是 cost 载荷**（费用本身就是该事件的事实，别处不存在）。

### 3.3 eventType 词表（首批，T2 起用）

```
lifecycle:   tender.created | tender.source_captured | tender.dispatched | tender.stage_advanced
             | tender.submitted | tender.result_marked | tender.abandoned | tender.handoff_completed | project.closed
documents:   document.added | document.updated | document.superseded | addendum.detected
requirements:requirement.extracted | requirement.confirmed | requirement.rejected | clarification.sent | clarification.answered
decisions:   decision.go_no_go | decision.run_approved | decision.review_confirmed | decision.strategic (自由决策记录)
commercial:  inquiry.sent | supplier.quote_received | quote.drafted | quote.confirmed
comms:       email.sent | email.received (T2 仅出站；入站待邮件能力补齐)
cost:        cost.recorded (人工/差旅/样品/保证金等) | cost.ai_usage_rollup (从 AiUsageLedger 汇总快照)
memory:      award.found | outcome.analyzed | memory.consolidated | claim.confirmed | claim.superseded
site:        site_visit.completed
```

任务书例子的落法：`Tony / Site Visit / 2.5h / Mileage / Parking / Result / Related Tender / Related Document` = 一条 `site_visit.completed` 事件（laborHours=2.5，payload 含结论，refs 含 documentId）+ 两条 `cost.recorded`（mileage、parking）。

### 3.4 投影（同一账本 → 多视图）

| 视图 | 取数 |
|---|---|
| Timeline View | 全类型按 `occurredAt`，与 `lib/tender/timeline.ts` 的里程碑投影合流（后者保留：Project 日期列是里程碑事实源，事件流是过程事实源） |
| Cost View | `eventType LIKE 'cost.%'` 聚合 + `AiUsageLedger where projectId` |
| People Contribution View | group by actorId（事件计数 + laborHours 求和） |
| Audit View | Ledger（业务） + AuditLog（技术）双栏 |
| Project Review View | decisions + outcome 类事件 → 复盘草稿的自动素材（喂 `maybeCreateReviewDraft`） |

### 3.5 存量事件/历史存储判决（= LEGACY_EVENT_STORE_DECISION_GATE 的输入材料）

判决词表（Gate 批准时逐套定档）：`KEEP_AS_DOMAIN_SOURCE / KEEP_AS_TECHNICAL_AUDIT / KEEP_AS_RUNTIME_TELEMETRY / DERIVED_ONLY / DUAL_WRITE_TEMPORARY / DEPRECATE / REMOVE`。

下表为基于 T0 审计证据的**判决提案**——Gate 未批准前不生效、不接线：

| 存储 | 判决提案 | 依据/边界 |
|---|---|---|
| `ProjectEvent`（新） | **business event ledger**（唯一业务事件事实源） | §3.1–3.4 |
| `AuditLog` | **KEEP_AS_TECHNICAL_AUDIT** | 技术/安全/管理审计，**不是业务时间轴 SoT**。T2 顺手债：改用 `traceId` 列、payload 转 Json、补 `(projectId, createdAt)` 索引（单独小 migration，与 Ledger 解耦） |
| `ProjectMessage(SYSTEM)` | **DUAL_WRITE_TEMPORARY → DERIVED_ONLY** | 人/系统讨论流，可编辑可软删（`editedAt/deletedAt`），不可为不可变事实源；迁移期双写，终态由 Ledger 事件渲染，`system-events.ts` 停写 |
| `TaskActivity` | **KEEP_AS_DOMAIN_SOURCE**（task 域） | 不进 tender 业务账本 |
| `OrderStatusLog` / `TradeActivityLog` | **KEEP_AS_DOMAIN_SOURCE**（order/trade 域） | 同上 |
| `AgentRunEvent` | **KEEP_AS_RUNTIME_TELEMETRY** | Runtime 执行事件，**不是项目业务事件 SoT**；`sourceRef="agentRun:{id}"` 把两本账关联 |
| `AgentTaskStep` | **DEPRECATE** | 随旧 AgentTask 运行时退役（T5 决策执行） |
| `ToolCallTrace` | **KEEP_AS_RUNTIME_TELEMETRY** | 观测记录（无 token/cost 字段，非账本） |
| `Notification` | **DERIVED_ONLY** | AuditLog 派生投递/注意力 sink（`notifications/service.ts:185`），**永不为事实源**；未来订阅 Ledger |
| `ProjectInsight` / `ProjectReview` | 知识/解读/复盘层（**不参与本判决词表**） | 是 L3 记忆原料与解释层，不是 raw event source |

**唯一权威业务事件原则（NO DUPLICATE BUSINESS FACT）**：同一业务事实——如 Site Visit Completed / Tender Submitted / Supplier Quote Confirmed / GO Decision / Project Abandoned / Award Found / Cost Recorded——最终只允许**一条 AUTHORITATIVE BUSINESS EVENT**（= ProjectEvent）；其他系统只可 reference / derive / notify / audit / project，不得各自成为独立业务事实源。

**Dual-write 纪律**：迁移期双写必须 **TEMPORARY**（定义退出条件/日期）、**EXPLICIT**（逐写入点登记）、**IDEMPOTENT**（eventKey 幂等）、**RECONCILED**（对账/parity 校验）；禁止无限期双写。

---

## 4. Tender Cost / 项目投入（问题"花了多少钱"的数据底座）

### 4.1 成本类别词表

`internal_labor | site_visit | mileage | parking | sample | courier | bond | insurance | external_consultant | supplier_charge | ai_cost | data_api_cost | other`

### 4.2 三条来源，一个视图

| 来源 | 机制 |
|---|---|
| 人工/差旅/实物费用 | 人工快捷录入（工作台"记一笔"MODAL）→ `cost.recorded` 事件；**重要金额走确认**（§13 人工节点 2：如"识别 Site Visit Cost = $418，是否确认？"） |
| AI 成本 | ① T2 修债：`tender-auto-analysis` FINALIZE 步骤把 `tokenUsageJson` 桥接进 `recordAiUsage`（一次调用，`usage/record.ts:52`）；② Workforce tender Job 天然进账本（runId 维度）；③ 已知缺口：无 request-context orgId 的 cron 调用会被 bridge 静默丢弃（`usage-ledger-bridge.ts:62-66`）——tender worker 需显式传 orgId |
| 供应商/外部收费 | 从 `InquiryItem`/`ProjectQuote.internalCost` 引用（不复制），确认类动作落事件 |

### 4.3 工作台成本卡（目标展示）

`Estimated Contract Value`（Project.estimatedValue）· `Our Bid`（ProjectQuote 确认版，替代手填 `ourBidPrice`，见 §10）· `Current Tender Cost`（Ledger 聚合）· `Tender Cost %`（cost/bid）· `Labor / External / AI+Data` 三分项。

本轮仅设计；不做财务系统、不做报销流。

---

## 5. Tender Archive / 自动归档

### 5.1 不可变契约（Archive Contract v1）

1. **一切外源资料在首见时刻固化**：Source URL、Capture Time、HTML Snapshot、PDF Snapshot、Page Screenshot、附件原件、Metadata、Content Hash、SourceRef。
2. **内容寻址**：blob 路径含 sha256；同 hash 不重存（补上 `ProjectDocument.contentHash` 的去重读路径——索引已在 `schema.prisma:1843-1844`，缺的只是查询）。
3. **只增不改**：无 update；替代 = 新档案项 + `supersededByArchiveItemId`；删除仅逻辑标记（合规豁免除外）。
4. **AI 不得触碰原件**：AI 只能产出 Claim/衍生物，衍生物存独立层并回指 archive item。
5. **读侧校验**：读取时可选 hash 校验（复刻 handoff 信封 fail-closed 精神）。

### 5.2 模型提案（T2）

```prisma
/// T2 提案 — 每个被捕获的原始工件一行；IMMUTABLE
model TenderArchiveItem {
  id            String   @id @default(cuid())
  orgId         String
  projectId     String
  kind          String   // source_html | source_pdf | source_screenshot | tender_document |
                         // addendum | drawing | pricing_form | award_notice | email | photo | other
  sourceUrl     String?  // 允许失效——失效后档案仍完整（问题 J 的核心）
  capturedAt    DateTime
  captureMethod String   // upload | url_capture | email_ingest | api_push
  contentHash   String   // sha256（复用 hash.ts:8）
  blobPath      String   // archive/{orgId}/{sha256[0:2]}/{sha256}
  mimeType      String
  fileSize      Int
  metadata      Json?    // 抓取头、原始文件名、页数等
  projectDocumentId String?  // 与现有 ProjectDocument 互链（业务视图仍走 ProjectDocument）
  supersededByArchiveItemId String?
  createdAt     DateTime @default(now())
  @@unique([orgId, projectId, contentHash, kind])
  @@index([orgId, contentHash])   // 跨项目同件识别（同一 addendum 出现在两个项目）
}
```

设计根据：`MarketSnapshot` 已实现同构原语（url+urlHash+snapshotJson+capturedAt+`@@unique([monitorId,providerCheckId,urlHash])`，`schema.prisma:3071`——只是对准了竞品站而非招标源）；`ProjectHandoff` 证明"快照+幂等+状态机"的档案形状可行。

### 5.3 采集管线（T2 定契约，T5 才接自动抓取）

```
发现 Tender（BidToGo push / 手动 / 未来 URL 导入）
  → capture_source Job：fetch HTML（存原件）+ PDF print + screenshot + 附件下载
  → hash → TenderArchiveItem（幂等）→ 关联/创建 ProjectDocument
  → 触发 extract（现有 page-parse/tender-auto-analysis 路径不变）
  → Ledger: tender.source_captured / document.added
```

复用与缺口（全部已核实）：

| 能力 | 现状 | 处置 |
|---|---|---|
| Blob 私有存储 + 代理鉴权 | `blob-access.ts`（私有店+旧店回退+本地回退） | REUSE |
| 页级解析 + contentHash + OCR_REQUIRED 标记 | `page-parse.ts`（unpdf，80 页/200k 上限） | REUSE |
| 指纹算法 | `hash.ts`（sha256 / package fingerprint / requirement fingerprint） | REUSE |
| 网页抓取 | Firecrawl 仅市场情报/外贸（`firecrawl-monitor.ts`、`research-fetch-provider.ts`），**无 tender 采集**；无 Apify | T5 复用 Firecrawl 客户端与 webhook 形状，**不本轮实现** |
| HTML 快照 / PDF 栅格化 / OCR / 邮件归档 | **缺失** | T2 契约预留，T5 实现 |
| 文档去重 / 版本链 / 软删 | hash 有索引无读路径；无 supersede；硬删除 | T2 |
| 对外脱敏 | `china-supplier-brief.ts` 是全库唯一 egress 分级器（denylist+金额闸） | 任何档案外发必经此层 |

---

## 6. Corporate Memory / 企业记忆库

### 6.1 四层落位（与存量对齐）

| 层 | 内容 | 载体 |
|---|---|---|
| **L1 Raw Archive** | 原始 PDF/HTML/图片/邮件/报价单/我方提交物/踏勘照片 | Blob + `TenderArchiveItem` + `ProjectDocument/Page`（IMMUTABLE） |
| **L2 Structured Facts** | Buyer、编号、品类、数量、日期、面料/电机/质保/保证金、Award 结果等 | `Project` 字段 + `TenderAnalysis*` 家族 + **新增 `Buyer`（T3 LEVEL 1）/ `AwardRecord`（T4 LEVEL 2）**（§8–9、§6.4）；一切经确认的字段级事实 |
| **L3 Internal Project Memory** | 我方报价、成本、参与人、关键决策、技术问题、Win/Loss、教训 | `ProjectReview`（confirmed）+ `ProjectInsight`（confirmed，schema 注释自称"企业记忆原料"，`schema.prisma:1692`）+ Ledger 汇总 + 项目终局记忆（derived memory view；snapshot 物化按 §6.4 LEVEL 3 Gate，§11） |
| **L4 AI Intelligence** | 相似项目、Buyer 模式、历史中标、价格、竞争对手、采购周期、策略 | **`MemoryClaim`**（§6.2）+ Fingerprint 检索（§7） |

**分层红线**：L4 永远不能写 L1/L2；L4 → L2 的唯一通道是人工确认（claim.confirmed 事件 + 字段回填）。

### 6.2 Memory Claim（本设计的核心新模型，T3）

```prisma
/// T3 提案 — AI/情报结论的唯一形态；借鉴 UserMemory 的双时态+supersession（schema.prisma:4268）
model MemoryClaim {
  id            String   @id @default(cuid())
  orgId         String
  subjectType   String   // project | buyer | competitor | product_category | market
  subjectId     String?  // Project.id / Buyer.id / …
  claimKind     String   // award_fact | price_range | procurement_cycle | competitor_pattern |
                         // buyer_pattern | supply_chain_hint | similar_project | lesson | strategy
  claim         String   @db.Text          // 单条结论文本（结构化补充进 payload）
  payload       Json?
  status        String   // CONFIRMED | SUPPORTED | INFERRED | UNKNOWN（词表统一自现有两套，§1-2）
  confidence    Float?
  evidenceRefs  Json     // [{kind: archiveItem|sourceRef|url|event|award, id/url, note}] ≥1 条；INFERRED 亦须给推理依据
  sourceDate    DateTime?   // 证据本身的时点
  capturedAt    DateTime    // 结论生成时点
  model         String?     // 生成模型/promptVersion（复刻 ProjectIntelligence._meta 约定）
  supersededById String?
  effectiveFrom DateTime @default(now())
  effectiveTo   DateTime?
  confirmedById String?
  confirmedAt   DateTime?
  embedding     Unsupported("vector(1536)")?   // 检索（附 HNSW 索引；踩掉 ProjectInsight.embedding Json 死字段的坑）
  createdAt     DateTime @default(now())
  @@index([orgId, subjectType, subjectId])
  @@index([orgId, claimKind, status])
}
```

纪律：

- 未来证据推翻旧结论 → 新 claim + 旧 claim `supersededById` + `claim.superseded` 事件；**不改旧行**。
- `status` 升级到 CONFIRMED 只能由人（§13 人工节点 1）或"字段级事实回填"触发。
- 三张存量事实表的归宿：`TenderAnalysisFact`（run 作用域，保留为提取层）→ 确认后可晋升为 claim；`BidIntelligenceFact` 手工录入路径改写 claim（T3 起双写、T4 收口）；`ProjectInsight` 保留为 L3 项目内结论，org 级检索经 claim 化。

### 6.3 存储分工（任务书 §18 的确认与修正）

| 层 | 职责 | 现状核实 |
|---|---|---|
| Object Storage (Vercel Blob) | 原始 PDF/HTML/图片 | 已有，私有+代理 |
| PostgreSQL | Structured Facts / Ledger / Award / Cost / Claims | 已有（Neon+pgvector） |
| Search / Vector | 语义检索 / Similar Tender | pgvector 已启用；缺 ANN 索引与 tender 内容向量化（T3 补） |
| Obsidian | 人工知识 / SOP / Lessons（**非事实源**） | 现状即单向导入（`markdown-vault-import.ts` 自述"青砚仍是组织知识真相源"）——与任务书定位一致，无需改造；T3 可选增加"记忆快照导出 .md"作为便利，不做双向同步 |
| Qingyan Agent | 统一读取/推理 | 经 agent 工具层（`org-knowledge` 工具已存在） |

### 6.4 Corporate Memory 数据模型三级冻结（问题 I 的回答；Final Review 口径）

**LEVEL 1 — APPROVED REQUIRED FOUNDATION（T3 初始核心持久化能力）**

1. `MemoryClaim`（§6.2）——L4 唯一载体：claim / status / confidence / evidence / sourceDate / capturedAt / supersession / business references，词表 CONFIRMED/SUPPORTED/INFERRED/UNKNOWN；
2. `Buyer`（§8）——采购方实体化：Buyer identity、别名/normalization、历史项目关联；低置信实体合并必须人工确认（§13 节点 1）。

注意：此处为**架构批准**，不等于 SCHEMA IMPLEMENTATION APPROVED——建表 migration 仍按阶段单独批准。

**LEVEL 2 — LATER DOMAIN TABLE**

- `AwardRecord`（§9）归 **T4 Tender Intelligence 域表**，是 Historical Award / Buyer Procurement Pattern / Procurement Cycle / Competitor Win History / Pricing Intelligence 的主要结构化数据源；**不是 T3 Corporate Memory MVP 必建表**。

**LEVEL 3 — DESIGN-GATED MATERIALIZATION（概念已批准，物化未批准）**

- `TenderFingerprint`：**concept = APPROVED；table = NOT YET APPROVED**。T3 开始前必须过持久化 Design Gate，二选一：**Option A** derived projection（由 Project + TenderAnalysis + Requirements + Buyer + ProjectInsight/embedding + structured facts 实时/缓存生成）；**Option B** materialized table（当检索性能、versioning、reproducibility、快照对比、历史评分等需求被证实时才持久化）。详见 §7.2。
- `ProjectMemorySnapshot`：**Project Memory concept = APPROVED；persisted table = NOT YET APPROVED**。默认优先 **derived memory view**（由 Project + ProjectEvent + TenderAnalysis + ProjectInsight + ProjectReview + MemoryClaim + AwardRecord + Outcome 动态组合）；仅当出现 historical snapshot reproducibility / memory version pinning / audit replay / 模型训练集冻结 / 关闭项目不可变快照等真实需求时才物化。详见 §11.1。**避免再造第 10/11 套历史存储。**

**向量能力：REUSE EXISTING VECTOR CAPABILITY FIRST**——优先审计并激活既有 `ProjectInsight.embedding` 死字段与 pgvector 存量能力（`sales/vector-search.ts` 模板）；除非未来设计证明必要，**不默认新建** `MemoryEmbedding` / `TenderEmbedding` 等第二套重复向量存储。

其余全部复用（ProjectReview / ProjectInsight / Archive / Ledger）。

---

## 7. Tender Fingerprint

### 7.1 与现有指纹的关系

`hash.ts` 的 `sourceHashFingerprint` 是**同一性指纹**（这套文件包是否变化，服务 run 幂等）；本节设计的是**相似性指纹**（这个标像不像历史上的哪个标）。两者并存，不互相替代。注意现有包指纹掺入 `documentId`，天然不能跨项目识别同标——这正是要新建相似性指纹的原因之一。

### 7.2 Fingerprint 内容口径与持久化 Design Gate

**冻结口径：TenderFingerprint concept = APPROVED；table = NOT YET APPROVED（§6.4 LEVEL 3）。** T3 开始前必须过持久化 Design Gate：Option A derived projection（实时/缓存）vs Option B materialized table（检索性能 / versioning / reproducibility / 快照对比 / 历史评分需求被证实时）。下述字段集是两个选项**共用的内容口径**；prisma 形状仅作 Option B 被批准时的参考，不构成建表批准：

```prisma
/// Option B 参考形状（NOT YET APPROVED）— 若物化则每项目一行，由 fingerprint job 幂等重算
model TenderFingerprint {
  projectId     String  @id
  orgId         String
  buyerId       String?          // → Buyer（规范化后）
  buyerType     String?          // municipal | provincial | federal | crown | private …
  industry      String?
  productCategory String?        // 主品类（如 window_coverings）
  subCategory   String?
  unspsc        String?
  location      Json?            // {country, province, city}
  quantity      Json?            // {value, unit}
  attributes    Json?            // {motorized, fabricType, warrantyYears, bondRequired, installRequired, deliveryTerms, projectSize}
  estimatedValueBand String?     // <50k | 50-250k | 250k-1m | >1m
  keywords      String[]
  specSignals   Json?            // 规格信号（从确认后的 requirement 提取）
  contentEmbedding Unsupported("vector(1536)")?  // 招标内容语义向量（HNSW）
  computedAt    DateTime
  version       Int
  @@index([orgId, buyerId])
  @@index([orgId, productCategory])
}
```

字段来源：Project 字段（clientOrganization→Buyer、location、estimatedValue、projectTypes）+ 确认后的 `TenderAnalysisFact`/`TenderExtractedRequirement`（电机/面料/质保/保证金等规格信号）+ `normalizeRequirementFingerprint`（终于持久化，服务条款级"我们答过这一条"检索）。

### 7.3 混合匹配（问题 K 的回答）

**不单靠 embedding**。相似度 = 加权融合，每一项都输出 reason + evidence：

```
score = w1·semantic(contentEmbedding, pgvector HNSW)        // 语义
      + w2·buyerMatch(buyerId 同一 / buyerType 同类)          // 采购方
      + w3·productMatch(category/subCategory/UNSPSC)          // 产品
      + w4·specSimilarity(specSignals ∩ + requirementFingerprint 命中数)  // 规格
      + w5·locationProximity                                  // 地域
      + w6·sizeProximity(estimatedValueBand)                  // 规模
      + w7·historicalParticipantOverlap(共同供应商/团队，来自 Ledger)
      + w8·historicalCompetitorOverlap(AwardRecord 竞标人交集)
输出: { similarProjectId, score, matchReasons[], evidence[] }
```

落地方式：**替换** `similarity.ts` 的 Jaccard 写入器（80 候选上限、硬编码建议字符串），**保留** `ProjectSimilarity` 表作为结果载体（追加 matchReasons 明细列或入 reasonsJson）。检索路径复用 `sales/vector-search.ts` 的原生 SQL 模板；必须补 HNSW 索引（现状六个 vector 列全无 ANN 索引）。

---

## 8. Buyer 实体（Fingerprint 与 Intelligence 的公共前置）

```prisma
/// T3 提案 — 采购方规范化实体（org 级）
model Buyer {
  id          String @id @default(cuid())
  orgId       String
  name        String            // 规范名
  aliases     String[]          // "City of Richmond" / "Richmond (City)" / 中文名 …
  buyerType   String?
  region      Json?
  website     String?
  metadata    Json?
  createdAt   DateTime @default(now())
  @@unique([orgId, name])
}
```

- `Project.clientOrganization` 保留（原始录入值），新增可空 `buyerId` 引用；历史项目由 normalize job 提议映射，**低置信度合并必须人批**（§13 节点 1："是否确认这是同一个 Buyer？"）。
- 明确不复用 `MarketCompetitor`/`TradeProspect`：均为 org 级但域语义（品牌竞品监控/外贸线索）与采购方无关，且零 Project 关联（审计已证）。

---

## 9. Tender Intelligence（情报域设计）

### 9.1 七个 Domain 与数据层分工（问题 L 的回答）

| Domain | 事实层（PostgreSQL） | 证据层 | 推断层 | 现状可复用 |
|---|---|---|---|---|
| 1 Historical Awards | **`AwardRecord`（新，T4）**：buyerId、tenderRef、title、productCategory、awardDate、winnerName/winnerId、awardAmount、currency、contractTerm、sourceKind | `TenderArchiveItem(kind=award_notice)` + sourceUrl+capturedAt | `MemoryClaim(claimKind=award_fact, status=SUPPORTED/INFERRED)` | 我方历史：`Project.tenderStatus/winningBidPrice/awardDate` 直接回灌 AwardRecord（我方参与的每个标都是一条 award 事实） |
| 2 Comparable Tenders | `TenderFingerprint` + `ProjectSimilarity`（升级版） | matchReasons + evidence | claim(similar_project) | §7 |
| 3 Buyer Procurement Pattern | 派生分析（AwardRecord group by buyerId：频率/季节/金额带/常见要求/常见中标者） | 聚合明细可回指 AwardRecord | claim(buyer_pattern) | — |
| 4 Procurement Cycle | 派生分析（同 buyer×category 的 award 时间序列 → 周期估计+下次窗口+置信度） | 时间序列本身 | claim(procurement_cycle)，必为 INFERRED 起步 | — |
| 5 Competitor Intelligence | `AwardRecord.winnerId` 聚合（中标次数/份额/涉及 buyer/品类） | AwardRecord | claim(competitor_pattern) | 不复用 `MarketCompetitor`（域不同；可在 UI 提供只读互链） |
| 6 Supply Chain Intelligence | **不建事实表**（数据源未定） | Trade 域 `customs_hint` 类证据**只读引用**（8/3 审计已确认存在且未接投标） | claim(supply_chain_hint)，公开证据与 AI inference 分离由 status 字段强制 | Trade intelligence 资产 |
| 7 Pricing Intelligence | 派生分析（AwardRecord 金额 + 我方 ourBid/winning 历史 + comparable 集合 + 规模/时间调整） | 逐条回指 award/quote | claim(price_range)：Estimated Market Range / Suggested Bid Range **必带来源与置信度** | `computePriceGap`（`similarity` 价差逻辑）可作种子 |

### 9.2 「情报」tab 的回答能力对照

任务书列的十问（值不值得投/谁是对手/以前谁中标/价格/Buyer 习惯/周期/相似标/我方历史/对手供应链/报价区间）全部映射到上表 7 域 + §7 相似检索；每个答案卡必须渲染 status 徽标（CONFIRMED/SUPPORTED/INFERRED/UNKNOWN）与证据链——UI 规范继承 `statement-kind-badge.tsx` 的现有做法。

### 9.3 数据获取边界

T4 的 AwardRecord 摄入只允许合规来源（公开公告、既有档案、人工录入、BidToGo 元数据）；**任何爬取执行都在 T5 经 Workforce Job + 人工授权**，本轮与 T1–T4 不实现爬虫（与任务书 §20 NON-SCOPE 一致）。

---

## 10. Outcome / Win-Loss

### 10.1 生命周期扩展（T2 语义、T5 自动化）

现状：`submittedAt` 之后直接等人工 `markProjectTenderResult(won|lost|no_bid|cancelled)`（`tender-result.ts:9`）；无"等待开标"态。目标：

```
SUBMITTED → AWAITING_AWARD → AWARDED | LOST | CANCELLED | NO_AWARD_FOUND
```

落法：**不加第 6 个状态字段**。复用 `tenderStatus` 词表扩展（`awaiting_award`、`no_award_found`），由 `stage-transition`/`tender-result` 统一写入；`ProjectReview.outcome` 词表同步对齐（消灭 3 套词表漂移）。

### 10.2 Award 回填与 Win/Loss 分析

- `award.found`（人工录入或 T5 Award Watch）→ 回填：Winner（→AwardRecord + Buyer 关联）、Winning Amount、`Our Bid`（**改从确认版 ProjectQuote 派生**，替代手填 `ourBidPrice`；保留字段作缓存）、Difference/%、Result。
- 自动生成 Win/Loss 分析草稿：`reasonTags ∈ {PRICE, TECHNICAL, SCHEDULE, COMPLIANCE, RELATIONSHIP, UNKNOWN}`（落 `ProjectReview.reasonTagsJson`，字段已存在）；**结论必须人批**（§13 节点 3："系统判断本次 Loss 主要因为 PRICE，是否确认？"）。
- 结果备注不再追加进 `Project.description`（现状反模式，`tender-result.ts:60-68`）→ 落 `tender.result_marked` 事件 payload。
- 本轮不实现 Award Watch（任务书 §10 明确）。

---

## 11. Memory Consolidation + Learning Loop

### 11.1 项目关闭 → 自动记忆（T5 自动，T3 先手动触发）

`project.closed` 事件 → `consolidate_memory` Job 产出**项目终局记忆（Project Memory）**：Buyer、结果、Our Bid、Winner/Winning Bid、Tender Cost（Ledger 聚合）、Participants（Ledger 聚合）、关键规格（确认 facts）、重要决策（decision 事件）、问题与教训（Insight/Review）——同时生成对应 MemoryClaim 与（可选）Obsidian .md 导出。**呈现默认走 derived memory view**（§6.4 LEVEL 3：由既有事实源动态组合，不新增存储）；`ProjectMemorySnapshot` 物化表仅在 reproducibility / version pinning / audit replay / 训练集冻结等需求被证实并通过 Design Gate 后才引入（若引入，复用 ProjectHandoff 的 snapshot 形状）。用户**不写复盘报告**；`ProjectReview` 确认流成为人批环节而非写作环节。

### 11.2 Learning Loop（新标进场）

```
Current Tender → build_fingerprint → Corporate Memory Search（claims+snapshots+similar）
→ Historical Comparison（award/price/competitor）→ Tender Intelligence（情报 tab 装配）
→ Bid Strategy（建议 = claim 形态，人批后进入决策）
```

每结一个项目，claims/AwardRecord/snapshot 增量沉淀 → 下一个标的情报装配自动更聪明。

---

## 12. Automation Architecture（事件驱动）

### 12.1 事件 → Job 链（任务书 14 事件全覆盖）

| 触发事件（Ledger） | 触发 Job 链（全部 Workforce Job/Task） |
|---|---|
| tender.created | archive_tender → extract_tender → build_fingerprint → search_memory → assemble_intelligence |
| tender.source_captured | （archive 完成的产物事件） |
| document.added / document.updated | archive_tender（增量）→ extract（增量）→ requirement update → fingerprint update |
| addendum.detected | addendum diff（现有 `addendum-diff.ts` 能力任务化）→ 变更确认（人） |
| requirement.extracted / clarification.* / email.* / supplier.quote_received / site_visit.completed / cost.recorded | 仅记账 + 视规则通知（无自动 Job） |
| tender.submitted | watch_award（T5；定期查询 + 到期提醒） |
| award.found | outcome_analysis（回填 + Win/Loss 草稿 → 人批） |
| project.closed | consolidate_memory |

### 12.2 与现有执行管线的关系（关键现状）

审计确认全库现有 **7 条 AI 执行管线**；与本设计相关的三条：

1. **Workforce Runtime**（目标载体）：Job=`AgentRun(runType="workforce_job")`、Task=`AgentRunStep`、人工介入=`PendingAction`、检查点=`AgentRunVerification`；cron `/api/cron/agent-runs` 每 2 分钟驱动（`vercel.json`），lease/fence/重试/park 语义完整（2B-1 已并）。
2. **tender-auto-analysis**（既有"第二套队列"）：自有 lease 列（`schema.prisma:2322-2326`）、自有 cron、自有幂等、硬编码步骤机（`worker.ts:3-8`）——与 Workforce **零代码共享**。**本轮与 T1–T4 完全不动它**；T5 必须做 **CONVERGENCE DECISION**——目标不是立即删除，而是逐能力回答：哪些迁移为 Workforce Task、哪些保留为 deterministic domain service（不带队列语义）、哪些 queue 语义退役、哪些包成 Workforce Task adapter；任何迁移前置 **behavior parity + rollback + 历史数据兼容**。前置条件见 §12.3。
3. **旧 AgentTask 流水**（`flow-runner` + ApprovalRequest）：随 UX 层 HIDE 进入退役观察期，不再挂新能力。

### 12.3 两个必须先解决的运行时缺口（设计发现，直接影响 T5 可行性）

1. **Workforce 无生产入口**：`createWorkforceJob`（`job.ts:55`）目前只有测试/脚本调用，无任何 API/UI 触发；且 flag 要求 master switch + 非空 allowlist（`flags.ts:53-60`）。T5 需要新建触发面（API route / 领域服务调用）。
2. **计划只能由 LLM 生成**（现状证据：`planJson` 唯一写入方是处理器内的 `planAgentRuntimeV2`，`processor.ts:265-342`）。`Tender Created → Archive → Extract → Fingerprint → Memory Search → Intelligence → Human Review` 这类确定性业务流程不应每次让 LLM 重新决定 DAG，需要 **Server-authored Workforce Plan（Deterministic Plan Injection）**。Final Review 冻结口径：

   - **T5 HARD DEPENDENCY**：T5 开始前必须满足 `DETERMINISTIC_PLAN_INJECTION = AVAILABLE / APPROVED DESIGN`；否则 T5 不允许启动 Tender 自动化，**更不允许以第二套 runtime 变通实现**。
   - **WORKFORCE RUNTIME OWNER DESIGN GATE**：具体 Runtime API、函数名、executor 修改、plan persistence 实现、并行/恢复语义**均不在本 T0 文档决定**——由 Workforce Runtime 负责人在 Phase 2 correctness 基础稳定后、T5 之前完成专项设计（runtime core 本轮及 T1–T4 全程禁改，见路线图冲突矩阵）。
   - **Deterministic Plan ≠ 绕过**：不绕过 Planner Policy / Tool Policy / Approval / Scope / Worker Registry；不直接调 executor；不写死副作用。它只改变 **Task DAG 的来源**——由可信 server business workflow 而非 LLM Planner 产生；执行安全语义完全复用统一 runtime primitives（Business Event → Server-authored Plan → 既有 Workforce Job → Task Contract → Worker Registry → Structured Handoff → Scope/Policy/Approval → Execution → Job Timeline）。
   - **禁止清单（永久）**：不得因此创建 `TenderQueue` / `TenderWorkerRuntime` / `TenderJobEngine` / `TenderPipelineExecutor` / 第二套 Scheduler / 第二套 Background Runtime。

---

## 13. Tender Capability → Future Workforce Task 映射（问题 M 的回答）

### 13.1 合同要素（来自 2B-1 已合并代码，逐项核实）

- Task spec：`workforce-task/v1`（`task-contract.ts:36-55`）——`worker{workerKey,role}`、`taskKind: work|synthesis`、`objective ≤1000`、`expectedOutput ≤1000`；workerKey 只能出自服务端注册表（`tender_worker` 已存在，`workers.ts:51-57`，注明"registry 项存在不代表有可用工具"）。
- Handoff：`workforce-handoff/v1`（`handoff.ts:104-132`）——summary ≤2000 字符、outputs 单值 ≤4KB/总 ≤16KB/信封 ≤32KB（UTF-8 字节）、evidenceRefs/businessRefs ≤20、fail-closed 错误码族；**`tenderId → "tender:{id}"` businessRef 与 2D-1 读模型 `"tender"` 类型已就绪**（`handoff.ts:293`、`read-model/types.ts:136`）——tender Job 天然能在 Job Center 正确显示。
- 真正缺的注册点是 **V2 工具目录**：`tool-catalog.ts` 现有 13 个描述符全部是 sales/gmail/calendar 域，tender 工具为零；每个新 task type = 一个 ToolDescriptor（name/riskLevel/readOnly/requiresApproval）+ `adapters.ts` 的执行 case。

### 13.2 任务映射表（只定义职责契约，禁止实现）

| Task | taskKind | 读/写 | 输入（objective 要点） | Handoff outputs（≤4KB/值） | 人工节点 |
|---|---|---|---|---|---|
| `archive_tender` | work | 写（blob+archive rows） | projectId, sourceUrl? | archivedCount, itemIds[], hashes 摘要 | 无（纯归档） |
| `extract_tender` | work | 写（analysis 域） | projectId, runScope | runId, factCount, requirementCount | 逐条 confirm（现有流） |
| `build_fingerprint` | work | 写（fingerprint 投影/缓存；物化按 §6.4 LEVEL 3 Gate） | projectId | fingerprintVersion, keySignals | 低置信 buyer 归一需人批 |
| `search_memory` | work | 只读 | projectId/fingerprint | topSimilar[]（id+score+reasons） | 无 |
| `research_historical_awards` | work | 写（claims+AwardRecord 草稿） | buyerId, category | claimIds, awardCandidateCount | award 事实入库前人批 |
| `analyze_competitors` | work | 写（claims） | buyerId/category | claimIds, topCompetitors 摘要 | 无（claim 态即防线） |
| `analyze_procurement_cycle` | work | 写（claims） | buyerId, category | cycleEstimate, confidence | 无（INFERRED 起步） |
| `watch_award` | work | 写（award.found 事件草稿） | projectId, sourceRefs | awardFound?, evidence | award 确认人批 |
| `consolidate_memory` | synthesis | 写（derived memory view 装配 + claims；snapshot 物化按 §6.4 LEVEL 3 Gate） | projectId | memoryRef, claimIds | 复盘确认（现有 ProjectReview 流） |
| `assemble_intelligence` | synthesis | 只读→写（情报装配 claim 集） | projectId | intelligenceSummary | 无 |

### 13.3 人工节点（任务书 §19 的三类，映射到现有机制）

| 类别 | 例子 | 机制 |
|---|---|---|
| 1 低置信度事实 | "是否确认这是同一个 Buyer？"、award 候选入库 | claim 确认流（新 UI）+ 可选投影进 `capabilities/approvals` 读模型；不建第五套审批 |
| 2 重要财务信息 | "Site Visit Cost = $418，是否确认？"、报价确认 | cost.recorded 二次确认（金额阈值触发）；报价沿用 ProjectQuote 确认 |
| 3 战略判断 | "Loss 主因 = PRICE，是否确认？"、GO/NO_GO | 现有 go-decision 与 review confirm 流保留；AI 只产草稿 |
| 其余归档/结构化 | 自动完成，仅记 Ledger | — |

AI 侧写操作（发邮件/改状态/外发）继续走 `PendingAction` 铁律，与 Workforce park/resume 语义天然衔接（2C-1 已合并 `resumeWorkforceJob` 单入口）。

---

## 14. SOURCE OF TRUTH MATRIX（现状 → 目标）

| 事实类别 | 现状权威 | 现状影子拷贝 | 目标态 |
|---|---|---|---|
| Tender 元数据 | `Project` | sourceMetadataJson / ExternalReference / 分析 section / room module / structuredSummary | `Project`（+buyerId）；分析产物回填走人工确认，不再各存各 |
| 阶段/进度 | Project 日期列（stage 派生） | 5 个状态字段互漂 | 保持派生制；词表收敛（§10.1），Ledger 记过程 |
| Go/No-Go | `BidIntelligenceRoom.goDecision` | bidPhaseStatus / module JSON 三写 | Room 保留权威；事件记账；module JSON 降级纯展示 |
| 文档字节 | Blob（`ProjectDocument.blobUrl`） | 生成 PDF 双行 | Blob + ArchiveItem（内容寻址）；双行合一 |
| 文档文本 | `ProjectDocumentPage` | `ProjectDocument.contentText`（旧管线） | Page 级唯一；旧 parse 管线退役（T2 债） |
| Requirement | `TenderExtractedRequirement` | section 文本 / room 投影 / checklist JSON | 行级唯一 + requirementFingerprint；其余为投影 |
| Evidence | `TenderAnalysisSourceRef` | BidIntelligenceFact 平行字段 / requirement.sourcePage | SourceRef 唯一证据边（补 FK）；claim.evidenceRefs 引用之 |
| 事实/结论 | 三表三词表 | — | 提取层（AnalysisFact）→ 确认层（L2 字段/AwardRecord）→ 推断层（MemoryClaim）三层清晰化 |
| 报价 | `ProjectQuote` | ourBidPrice 手填 / review priceAnalysis | Quote 确认版派生 ourBidPrice |
| 结果/Outcome | tenderStatus（唯一写入点 tender-result） | ProjectReview.outcome 词表漂移 / description 追加备注 / abandon 组 | 词表统一；备注入事件；AWAITING_AWARD 补态 |
| 过程历史 | 无（9 套分裂） | — | **`ProjectEvent`（新唯一业务账本）**；AuditLog=技术审计；其余投影/退役（§3.5） |
| 成本 | 无 | AI 成本 6 处分裂 | Ledger 成本事件 + `AiUsageLedger`（AI 部分唯一账本，tender 补写入） |
| 企业记忆 | ProjectReview/Insight（未检索化） | UserMemory/OrgKnowledge/KB 各域 | 四层模型（§6）；claim 为 L4 唯一载体 |
| 历史中标 | 无 | — | `AwardRecord` + `Buyer`（新） |
| 相似项目 | `ProjectSimilarity`（Jaccard） | — | 表保留，写入器换混合匹配（§7.3） |

---

## 15. Schema 影响汇总（全部 T2+ 提案，本轮 NONE）

| 阶段 | 新表 | 扩展 | 明确不做 |
|---|---|---|---|
| T0/T1 | — | — | 任何 migration |
| T2 | `ProjectEvent`、`TenderArchiveItem`（表方向批准；**ProjectEvent 生产写入点在 LEGACY_EVENT_STORE_DECISION_GATE 通过前 NOT YET APPROVED**，见路线图 T2 Entry Gate） | ProjectDocument（orgId/supersede/软删）、AuditLog 小修（Json/traceId/索引）、tender→AiUsageLedger 桥接 | 不动 Workforce 表 |
| T3 | **初始核心（LEVEL 1）：`MemoryClaim`、`Buyer`**；`TenderFingerprint` / `ProjectMemorySnapshot` = **Design Gate（概念批准、物化未批准，LEVEL 3）** | Project.buyerId、ProjectInsight.embedding→vector（**REUSE FIRST**）、HNSW 索引、Review 词表对齐 | 不做向量库迁移（继续 pgvector）；不默认新建 MemoryEmbedding/TenderEmbedding |
| T4 | `AwardRecord`（**LEVEL 2 域表**：Historical Award / Buyer Pattern / Cycle / Competitor / Pricing 数据源） | ProjectSimilarity 明细字段 | 不建 MarketCompetitor 合并 |
| T5 | —（预期 NONE；deterministic plan 若需列级支持由 Runtime Owner Design Gate 提案） | Workforce 入口面 + Deterministic Plan Injection（**T5 HARD DEPENDENCY**，Runtime Owner 设计） | 不建第二队列/第二 runtime |

---

## 16. ASSUMPTION_INVALID（架构侧）

| # | 任务书假设 | 实际 | 调整 |
|---|---|---|---|
| 1 | "检查现有 Activity/Audit/Event/Timeline/AgentRunEvent/Cost/Project History 是否可复用，禁止新建重复系统" | 可复用的是**模式**而非表：9 套存储无一能当业务账本；Cost 存储对人工侧根本不存在 | 新建 `ProjectEvent` 一张表 + 显式判决 9 套存量（§3.5），符合"不建重复系统"的实质 |
| 2 | "Firecrawl/Apify 能力如何复用" | Firecrawl 仅市场/外贸监控（含成熟 webhook+快照模型）；**Apify 全库不存在** | 复用 Firecrawl 客户端与 MarketSnapshot 形状；Apify 从设计中移除 |
| 3 | "Obsidian 已有知识层" | 只有单向 md/zip 导入（自述不双向同步） | 定位维持"人工知识/非事实源"，零改造成本；可选 T3 加只写导出 |
| 4 | "Email Sent/Received 事件" | 收件根本未实现（`inbound_not_implemented`），ProjectEmail 无 direction/threading | email.received 事件与供应商报价自动摄取列为 T5 依赖项：先补邮件入站能力，设计中标注为**外部前置** |
| 5 | "不要建立 TenderQueue 第二套任务系统" | **已存在**（tender-auto-analysis 自带整套队列语义） | 登记为既有债 `TENDER_SECOND_QUEUE_DEBT`；T5 收敛决策点，前置=Phase 2 合并 + deterministic plan 路径 |
| 6 | "AgentRun/AgentRunStep/AgentRunEvent 调查复用" | 全部存在且为 Workforce 冻结架构（Job=AgentRun 等式已在代码证实） | 未来 tender Job 直接以此为载体，AgentRunEvent 与 ProjectEvent 以 sourceRef 互链 |

---

*实施顺序、Phase 2 冲突矩阵与验收标准见 `QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`。*
