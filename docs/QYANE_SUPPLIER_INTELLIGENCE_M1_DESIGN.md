# QYANE SUPPLIER INTELLIGENCE — M1 DESIGN

状态：PART B 设计文档 **v2（B.1 Original Spec Reconciliation 已并入）**，DESIGN_ONLY，本轮不编码
日期：v1 2026-08-31 · v2 2026-08-31（B.1 轮）
基线：main @ 7094d165 · PR #188（DRAFT）
任务书：`QYANE_SUPPLIER_INTELLIGENCE_M1`（核心不变量已于 B.1 轮补回）+ `M1 ADDENDUM: SOCIAL SUPPLIER DISCOVERY` + `B.1 ORIGINAL SPEC RECONCILIATION`
配套：`docs/QYANE_SUPPLIER_INTELLIGENCE_M1_ARCHITECTURE_AUDIT.md`（PART A，Final Review = PASS，内容冻结；其 §10 中 `M1_SCHEMA_FOOTPRINT_ESTIMATE = 2` 已被本文档 §4 取代）

---

## 0. 基线声明（v2 更新）

- v1 时原任务书全文未归档，基线按 Addendum 复述重建并逐项标注（v1 全文见本分支提交 e91e34c1）。
- **B.1 轮（2026-08-31）原始 M1 核心不变量已由任务书补回**：完整核心链（§2）、SupplierSearchRun 审计（B1）、Supplier Candidate（B2）、Requirement Match 持久化（B3）、Supplier ≠ Product（B4）、Certification 分级（B5）、确定性评分（B6）、检索优先级、Landed Cost 预留。本 v2 已逐项 reconcile（§4 矩阵）。
- v1 推断项的判定结果：`SupplierSourceAdapter`/`SupplierSearchBrief`/`buildSupplierSearchBrief()` 为原方案抽象——**确认**；推荐词表 v1 推断为 3 态——**修正**为原始 5 态（PRIMARY/BACKUP/NEEDS_VERIFICATION/HIGH_RISK/NOT_ELIGIBLE）；「2 张新表」估计——**废止**，改为 `M1_SCHEMA_FOOTPRINT = MINIMUM REQUIRED BY DOMAIN INVARIANTS`（§4.4）。
- Final Review 结论：PART_A = PASS（审计文档不再改动）；PART_B = PASS_WITH_REQUIRED_CORRECTIONS（即本 v2）；`READY_FOR_IMPLEMENTATION = NO` 直至本 v2 过 Final Review。

## 1. M1 目标与硬边界

**目标**：让 Qyane 能够从传统 B2B 平台、公开网络以及中国社交内容中发现潜在制造商，并通过实体解析、证据验证、Tender Requirement Matching 和历史供应商数据，把潜在工厂逐步提升为可信赖的 Supplier Candidate。

**M1 = Discover → Evaluate → Recommend → Save**（完整链见 §2）。

**硬禁清单**（进代码评审 checklist）：

| # | 禁止项 | 落点 |
|---|---|---|
| H1 | 自动询价 / RFQ / 自动私信供应商 | 不存在向供应商发消息的代码路径 |
| H2 | 自动采购 / 自动 PO / 自动付款 | 同上 |
| H3 | 绕过登录 / 验证码 / 逆向平台 API / 账号自动化 | Adapter 白名单式实现（§9），禁直连平台私有接口 |
| H4 | 大规模 scraping / 违反 robots 与 ToS | Provider 策略门 fail-closed（§9.4） |
| H5 | Social 证据自动升级为 VERIFIED | 信任模型 R1（§6.3） |
| H6 | Entity 自动合并 | 置信不足一律 NEEDS_HUMAN_REVIEW（§8.4） |
| H7 | 发现结果自动写入长期 Supplier/Corporate Memory | SAVE_TO_SUPPLIER_MEMORY 仅人工（§12） |
| H8 | Social 信号绕过 Mandatory Gate | 门只认 VERIFIED 证据（§11.3） |
| H9 | Search 专属分数写入 `Supplier.rating` 作为唯一真相源 | 分数只落 `SupplierCandidate`（B2 冻结）；rating 保持人工关系评分 |
| H10 | LLM 决定数值分 | 评分为冻结版本化纯函数（B6，§11.2）；LLM 只 `explainSupplierScore()` 不 `inventSupplierScore()` |
| H11 | UNKNOWN 判成 PASS / 历史 Run 结果被静默重算 | §11.3 / §5.1 不可变不变量 |

## 2. 总体数据流（原始 M1 完整核心链，B.1 §2 冻结）

```text
Tender
→ Canonical Requirements（快照进 SearchRun，见 §5.1）
→ Supplier Search Brief（buildSupplierSearchBrief，快照进 SearchRun）
→ Supplier Discovery
    ├─ 1. Qyane Supplier Memory（既有 canonical Supplier + Corporate Memory）
    ├─ 2. Previously successful supplier（履约史）
    ├─ 3. Saved supplier（供应商库）
    ├─ 4. External supplier search（Open Web / Commerce）
    └─ 5. New factory discovery（Social Discovery ← 本 Addendum 范围）
→ Supplier Normalization（Entity Resolution，人工确认）
→ Product / Offering Normalization（SupplierOffering，§5.3）
→ Requirement Matching（SupplierRequirementMatch，§5.5）
→ Mandatory Gate（FAIL ⇒ NOT_ELIGIBLE，§11.3）
→ Commercial Evaluation（确定性评分之 commercial 维，§11.2）
→ Supplier Risk（reliability + import/delivery risk 维）
→ Ranked Recommendation（PRIMARY/BACKUP/NEEDS_VERIFICATION/HIGH_RISK/NOT_ELIGIBLE）
→ Human Review（短名单动作桥接 ProjectSupplierLink）
→ Supplier Memory（人工确认后 SAVE_TO_SUPPLIER_MEMORY）
```

三条结构性不变量：

1. **Social Discovery 只是 Supplier Discovery 的一个 source**，不是 Supplier Intelligence 的数据模型本身（B.1 §11 冻结）；社媒内容只进管线最上游（Signals），永不短路到下游任何一级。
2. **检索优先级 1→5**（B.1 §9）：Search Planner 先把内部源（memory / 履约史 / 供应商库）全量入候选池（记 `originSource`），外部与社媒是**补充**——Social/OpenWeb 不得让系统每次忽略已有可靠 Supplier；但历史成功**不豁免**当前 Tender 的 Mandatory Gate（门对一切 origin 一视同仁）。
3. **每次评估都是一次正式 SupplierSearchRun**（§5.1）：历史 Run 的结果永不因后续 Tender/Supplier 数据变化而重算——重评估 = 新 Run。

## 3. 与现状的集成点（PART A 审计结论，保持有效）

| M1 环节 | 复用/对接的现状 | 方式 |
|---|---|---|
| Canonical Requirements | `TenderExtractedRequirement`（mandatory Boolean + V2 `MandatoryV2=true\|false\|"uncertain"` + `mandatoryRequirementIds`） | 只读消费 + **快照冻结进 SearchRun**（uncertain 保留，见 §11.3） |
| Requirement Matching 引擎形态 | `tender-compliance-memory`（fingerprint 精确自动 / Jaccard≥0.75 建议 / 人工采纳） | 沿用三段式，持久化到新 `SupplierRequirementMatch`（§5.5） |
| 层 B 搜索通道 | tender-intel Tavily（`TENDER_EXTERNAL_INTEL_ENABLED`+`TAVILY_API_KEY` 双门，默认零外呼） | `SearchEngineProvider` 统一现存三份重复 client，不加第四份 |
| 查询快照 | `WebIntelResult.queries` + `TradeIntelligenceCase.searchQueries Json` 先例 | 升级为 `SupplierSearchRun` 一等列（B1） |
| LLM 生成搜索词 | `researchMarketPricingTwoHop` 跳 1（versioned prompt 只产检索词） | `buildSupplierSearchBrief()` 同构，promptName/Version 落 Run |
| 运行状态 | `externalIntelStatus` 防静默 no-op 槽 | `SupplierSearchRun.statusDetailJson` 同型 |
| 证据验证 | `tender-understanding/verify.ts` 逐字 snippet + RejectReasonCode；`TenderArchiveItem` 内容寻址档案 | Match/Certification 证据按值快照 + 存档物走 ArchiveItem（**不建第二套证据系统**） |
| Supplier 主数据 | `Supplier`（带 orgId，非 canonical 身份实体）+ `ProjectSupplierLink`（人工工作面） | Supplier REUSE 不动；候选短名单动作**桥接**回 Link（§5.4） |
| Supplier Memory | corporate-memory 已预留 `SUPPLIER_FACT`/`VENDOR`/`VENDOR_CONFIDENTIAL`；AI 自动写硬禁 | §12，零 schema 变更 |
| Entity 身份纪律 | `Buyer`（normalizedName 刻意非唯一/aliases/永不自动合并）+ `createOrObserveAwardRecord` 结果词表 | §8 全面对齐；复用 `normalizeBuyerName`/`normalizeWebsiteDomain` |
| UI 落点 | `/projects/intelligence/supply-chain` 刻意 `notEnabled` 占位页 + 情报室 `supply_chain` 模块 + org slot「建设中」 | M1 UI 的家（S3 激活） |
| Adapter 落地方式 | `ChannelAdapter` 形态 + `MemorySemanticSearchAdapter`「冻结契约先行」模式 | §9 |
| Flag | canonical 四符号模式 | `SUPPLIER_INTEL_ENABLED` + `SUPPLIER_INTEL_ORG_ALLOWLIST`（§13.2） |
| 外发红线 | `china-supplier-brief` = 全库唯一 egress 分级器 | M1 无外发；M2 起任何面向供应商的外发必经此层 |
| 迁移/DB 安全 | B0 生产库保护（ep-super-field 点名硬编码）+ additive-only + check-release-safety 登记 | §17 迁移纪律 |

## 4. ORIGINAL SPEC RECONCILIATION（B.1 §13 要求）

### 4.1 Reconciliation Matrix

| Original Requirement | Current Repo Asset | PR188 Design (v1) | Decision | Persistence | M1/M2 |
|---|---|---|---|---|---|
| Supplier | `Supplier`（orgId，CRUD，非身份实体） | 复用不动 | **REUSE** | 既有表 | M1 |
| Supplier Source | 单值 `source` 枚举 + `sourceDetail`；无多来源 | 信号 LINKED 聚合反推 Sources | **REUSE(信号反推)** | `SupplierDiscoverySignal.linkedSupplierId` | M1（`SupplierSourceProfile` 归属验证 DEFER→M2） |
| Supplier Offering/Product | **不存在**（`SupplierProduct` 无；QuoteCostLine 仅松散字符串） | 未覆盖（v1 缺口） | **NEW** | `SupplierOffering`（§5.3） | M1 |
| Certification | 画册 `certifications` 散文无验证态；`BidIntelligenceFact` 信任词表不分 scope | 仅 capability signal CLAIMED（v1 不足：无 scope/号码/效期） | **NEW（登记表）+ REUSE（证据载体）** | `SupplierCertification`（§5.6）；证据= `TenderArchiveItem`/registry URL/`MemoryClaimEvidence` | M1 |
| SupplierSearchRun | `TradeIntelligenceCase.searchQueries` 仅词快照；无 run 语义 | 仅 ephemeral `searchRunId` + 模糊的「运行记录」（v1 不足） | **NEW** | `SupplierSearchRun`（§5.1，四快照+版本+不可变） | M1 |
| SupplierCandidate | `ProjectSupplierLink`（**不能承担**：基数=项目×供应商一行、人工可变工作面、无分数/无 run/无 offering 维；审计见 §4.2-B2） | 未持久化（v1 缺口） | **NEW**（Link 保留为人审桥） | `SupplierCandidate`（§5.4） | M1 |
| SupplierRequirementMatch | `ProjectSupplierLink.techMatch` 自由文本；`tender-compliance-memory` 主体是我方合规立场非供应商评估 | 未持久化（v1 缺口） | **NEW** | `SupplierRequirementMatch`（§5.5，证据按值快照） | M1 |
| Mandatory Gate | `TenderExtractedRequirement.mandatory`（V2 uncertain 落库塌缩 false） | 有规则无持久化 | **NEW(随 Candidate 持久化)** | `SupplierCandidate.mandatoryGateResult/-Json` + 需求快照在 Run | M1 |
| Score | 无（`Supplier.rating`=人工关系评分，不可挪用） | 有隔离原则、无确定性契约（v1 不足） | **NEW（冻结契约）** | TS 契约 `SUPPLIER_SCORE_V1`（40/25/20/15）+ `SupplierCandidate.scoreVersion/scoreBreakdownJson` | M1 |
| Recommendation | 无 | 3 态（v1 推断，**修正**） | **NEW** | `SupplierCandidate.recommendation` 5 态 | M1 |
| Search Brief | 中文找厂搜索词全仓库空白 | `buildSupplierSearchBrief()` 四组词 + 快照（正确） | **NEW（保持 v1）** | `SupplierSearchRun.briefSnapshotJson` | M1 |
| Source Adapter | `ChannelAdapter`/`MemorySemanticSearchAdapter` 形态先例 | 接口 + 冻结契约先行（正确） | **NEW（代码契约，保持 v1）** | 无表 | M1 |
| Social Discovery | 零代码 | 信号先行两表 + 三平台策略（正确，PASS 项全保留） | **NEW（保持 v1）** | `SupplierDiscoverySignal` + `SupplierCapabilitySignal` | M1 |
| Entity Resolution | Buyer 纪律 + `createOrObserveAwardRecord` 词表 | 运行期 DTO + `resolutionJson` 快照、永不自动合并（正确） | **NEW（代码契约，保持 v1）** | 快照在信号行；不建表 | M1 |
| Corporate Supplier Memory | 词表已预留 SUPPLIER_FACT/VENDOR/VENDOR_CONFIDENTIAL；AI 写硬禁 | 人工确认后 createMemoryClaim + D-MEM-1 收紧（正确） | **REUSE** | `MemoryClaim`/`MemoryClaimEvidence`，零 schema | M1 |
| Audit Trail | 既有 audit action 惯例 + externalIntelStatus 教训 | 仅 status 槽（v1 不足） | **NEW（脊柱）** | Run→Signal→Candidate→Match 四级持久化 + 快照按值 + run 后不可变 + audit actions | M1 |
| Landed Cost | quote-engine/成本域另有工作线，供应商侧无 | 未涉及 | **DEFER（预留结构）** | `SupplierCandidate.scoreBreakdownJson.commercial.landedCost`（§11.5，允许 manual/partial/unknown） | M2/M3 |

### 4.2 B1–B6 逐项决策记录

- **B1 SupplierSearchRun = NEW**。ephemeral `searchRunId` 不满足「历史 Run 可回答当时依据」的审计不变量；仓库无可复用载体（`TenderAnalysisRun` 是 tender 分析专用租约模型，`TradeIntelligenceCase` 属 trade 域且语义不合）。四快照（brief / canonical requirements / source config / queries）+ promptName/Version + scoreVersion 全部按值冻结在 Run 行（§5.1）。
- **B2 SupplierCandidate = NEW；`ProjectSupplierLink` 审计结论=不能承担**：① 基数错误——Link 是 `@@unique([projectId, supplierId])` 每项目每供应商一行，Candidate 需要 Supplier×Offering×Run 粒度（同一供应商跨多次 Run、多个 Offering 各有分数）；② Link 是人工可变工作面（role/inquiryStatus/quoteStatus 随手改），与「run 后不可变审计行」冲突；③ 无任何分数/门/推荐字段。**Link 保留原职**：人审短名单动作把 Candidate 桥接为 Link（`role=candidate/shortlisted`），Candidate 行保持不变。`Supplier.rating` 禁写（H9）。
- **B3 SupplierRequirementMatch = NEW**。`techMatch` 自由文本无法承载 PASS/PARTIAL/FAIL/UNKNOWN + confidence + evidence + version；`tender-compliance-memory` 的主体是**我方**对需求的合规立场（COMPLIANCE_POSITION），不是供应商评估——引擎形态（指纹/Jaccard/人工采纳）复用，持久化新建。防漂移：match 行的证据**按值快照**（snippet/url/capturedAt 复制进行），不依赖活指针；重评估=新 Run 新行。
- **B4 SupplierOffering = NEW**。仓库无 SupplierProduct；Requirement Matching 的真正主体 = Supplier + 具体 Offering（同一供应商 Product A compliant / B non-compliant / C unknown 必须可表达）。`priceStatus=UNKNOWN` 合法，**缺价不拒**（§5.3）。
- **B5 SupplierCertification = NEW（登记表）**，证据载体全复用（TenderArchiveItem / registry URL / 保存入记忆时 MemoryClaimEvidence），**不建第二套证据系统**。不能只用 MemoryClaim 承担的硬理由：`VENDOR_CONFIDENTIAL` 不在成员可见 accessClass（审计 §5.3）——执行评估的成员会读不到证书状态；且记忆写入是 CONSERVATIVE_ADMIN_ONLY，工作层需要低摩擦的 CLAIMED 登记。scope 三级（SUPPLIER/PRODUCT/MODEL_SERIES），「官网说 UL certified」永远只是 CLAIMED（§5.6）。
- **B6 确定性评分 = 冻结 domain contract**（非说明文字）：TS 常量 `SUPPLIER_SCORE_V1`（40/25/20/15）+ 纯函数 `computeSupplierScore()`，评分路径零 LLM 调用并有测试断言（T10）；`scoreVersion` 随 Candidate 落库；LLM 仅 `explainSupplierScore(breakdown)`（§11.2）。

### 4.3 v1 已 PASS 且保持不变的结论（B.1 §1 清单）

复用现有 `Supplier` / 不建第二套 Supplier 主域 / 信号先行 / Social 不直建 trusted Supplier / CLAIMED·OBSERVED ≠ VERIFIED / Entity Resolution 永不自动 merge / Social 不进最终评分、不绕 Mandatory Gate / WeChat = 用户提交主路径 / 不做 aggressive scraping / supply-chain 占位页为 UI 落点 / Corporate Memory 复用 SUPPLIER_FACT·VENDOR·VENDOR_CONFIDENTIAL / 不自动 RFQ·私信·PO·付款 / canonical auth 租户隔离。

### 4.4 Schema footprint 结论（B.1 §12）

`M1_SCHEMA_FOOTPRINT = MINIMUM REQUIRED BY DOMAIN INVARIANTS` = **7 张新表**（2 发现层 + 5 审计脊柱），全部 additive-only：不可变审计行**拒绝**塞进可变 Supplier 主表或不适配的 JSON 槽（B.1 §12 明令）；同时不机械照抄示例表——Entity Resolution / Score contract / Search Brief / Discovery Confidence 均以代码契约或 Run 内快照承载，不建表。

## 5. 数据模型设计（持久化审计脊柱）

分层：**发现层**（Signal 两表，社媒/公开网络的原始信号）→ **评估脊柱**（Run/Offering/Candidate/Match/Certification 五表，正式、可审计、run 后不可变）→ **长期层**（既有 Supplier + Corporate Memory，人工确认才进入）。枚举一律 String + TS 常量（仓库惯例）；所有新表带 `orgId` 且服务层内部过滤（不复制 supplier/service.ts 旧模式）。

### 5.1 SupplierSearchRun（NEW，B1）

```prisma
model SupplierSearchRun {
  id                      String    @id @default(cuid())
  orgId                   String
  projectId               String?
  tenderId                String?                    // 与 projectId 至少其一（app 层校验；纯探索 run 可仅 org 级）

  status                  String    @default("PLANNED")   // PLANNED | RUNNING | COMPLETED | FAILED | CANCELLED

  briefSnapshotJson       Json                       // SupplierSearchBrief 全量（§5.8）
  requirementSnapshotJson Json                       // canonical requirements 冻结副本：id/code/text/category/
                                                     // mandatory（含 V2 uncertain 与 mandatorySignal）——取自 V2 层，
                                                     // 绕开「uncertain 落库塌缩为 false」陷阱
  sourceConfigJson        Json                       // 启用的 adapters/providers + 可用性 + 参数
  queriesJson             Json                       // 逐 source 实发查询词（含层 B 组合结果）

  promptName              String?                    // LLM 词扩展 prompt（无 LLM 时 null）
  promptVersion           String?
  scoreVersion            String                     // run 创建即冻结，如 "supplier-score-v1"
  evaluationVersion       String                     // matching/gate 逻辑版本

  createdByUserId         String                     // trusted user（canonical auth 上下文取得）
  startedAt               DateTime?
  completedAt             DateTime?
  statusDetailJson        Json?                      // supplierIntelStatus 同型：ran|skipped|error + reason
                                                     // + 逐 source 计数（防静默 no-op）
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  @@index([orgId, status])
  @@index([orgId, projectId])
  @@index([orgId, tenderId])
}
```

**不可变不变量（B1 核心）**：`COMPLETED/FAILED/CANCELLED` 后，快照与版本字段**禁改**（service 层字段白名单强制，同 MemoryClaim「语义字段不可原地改」纪律）；Tender Requirement 后续变化、Supplier 数据后续更新，都**不得**触发历史 Run 及其下属 Candidate/Match 的重算——重评估 = 新建 Run。任何时点都能回答：「当时根据什么 Requirements、什么 Brief、什么 Source、什么算法版本推荐了这些 Supplier」。

### 5.2 SupplierDiscoverySignal + SupplierCapabilitySignal（NEW，v1 冻结，微调）

v1 定义全文保留（Addendum §3/§4 为准），v2 仅一处对齐脊柱：`searchRunId` 从松散字符串升级为指向 `SupplierSearchRun.id`（可空——用户提交/手工录入的信号可独立于 Run 存在）。

```prisma
model SupplierDiscoverySignal {
  id               String   @id @default(cuid())
  orgId            String                    // 第一天就有（吸取 BlindsOrder 缺 orgId 的教训）
  projectId        String?
  tenderId         String?
  searchRunId      String?                   // FK → SupplierSearchRun（v2 对齐）；用户提交可为空

  platform         String                    // DOUYIN | XIAOHONGSHU | WECHAT_CHANNELS | ONE688 | WEBSITE | OPEN_WEB | MANUAL
  contentType      String                    // VIDEO | POST | PROFILE | USER_SUBMITTED
  sourceOrigin     String                    // USER_SUBMITTED | PUBLIC_WEB | PROVIDER | MANUAL_ENTRY

  accountName      String?
  accountUrl       String?
  contentUrl       String?
  title            String?
  description      String?
  publishedAt      DateTime?

  rawText          String?                   // 用户粘贴的分享文案/识别文本
  rawMetadataJson  Json?                     // provider 原始返回快照（审计）

  status           String   @default("NEW") // NEW | REVIEWED | LINKED | REJECTED（REJECTED 终态不物理删）
  linkedSupplierId String?
  resolutionJson   Json?                     // 最近一次 SupplierEntityResolutionResult 快照（§8）
  reviewedByUserId String?
  reviewedAt       DateTime?

  discoveredAt     DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([orgId, status])
  @@index([orgId, platform])
  @@index([orgId, linkedSupplierId])
  @@index([orgId, tenderId])
  @@index([orgId, searchRunId])
}

model SupplierCapabilitySignal {
  id                 String   @id @default(cuid())
  orgId              String                   // 冗余落一份，跨表查询不 join 也能过滤租户
  discoverySignalId  String
  type               String                   // 目录见下，fail-closed
  value              String?
  evidenceStatus     String                   // CLAIMED | OBSERVED | VERIFIED | UNKNOWN
  confidence         Float?                   // 0..1
  explanation        String?
  extractedBy        String                   // HUMAN | AI_ASSISTED
  createdAt          DateTime @default(now())

  @@index([orgId, discoverySignalId])
  @@index([orgId, type, evidenceStatus])
}
```

规则（v1 冻结）：`sourceOrigin` 与 `platform` 分开（信任与合规策略按 sourceOrigin，展示按 platform）；social 写路径 evidenceStatus 值域仅 {CLAIMED, OBSERVED, UNKNOWN}（R1，双保险 + T1）——capability signal 里的 VERIFIED 仅允许由「已验证事实回填」产生；AI 标注 OBSERVED 上限 confidence 0.8 且 UI 标注（R2）；capability type 目录 fail-closed（未知 type 拒收，T8）：

```text
FACTORY_FLOOR / CNC_CAPABILITY / LASER_CUTTING / INJECTION_MOLDING /
POWDER_COATING / ASSEMBLY_LINE / CUSTOM_TOOLING / OEM_SUPPORT / ODM_SUPPORT /
EXPORT_PACKAGING / TESTING_CAPABILITY / WAREHOUSE / HIGH_VOLUME_PRODUCTION /
SMALL_BATCH_PRODUCTION / CUSTOM_PACKAGING / OVERSEAS_EXPORT / CANADA_EXPORT
```

### 5.3 SupplierOffering（NEW，B4）

```prisma
model SupplierOffering {
  id              String   @id @default(cuid())
  orgId           String
  supplierId      String                       // FK → Supplier
  name            String                       // product / model
  sku             String?
  category        String?
  description     String?  @db.Text
  attributesJson  Json?                        // 结构化属性（材质/尺寸/IP 等级…）

  unitPrice       Decimal? @db.Decimal(18, 2)
  currency        String?
  moq             Int?
  leadTimeDays    Int?
  incoterm        String?                      // FOB | CIF | DDP | …
  priceStatus     String   @default("UNKNOWN") // KNOWN | ESTIMATED | UNKNOWN

  sourceKind      String                       // DISCOVERY | MANUAL | BROCHURE | INQUIRY
  sourceUrl       String?
  sourceSignalId  String?                      // 溯源到发现信号
  status          String   @default("active")  // active | archived
  createdByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([orgId, supplierId])
  @@index([orgId, category])
}
```

规则：**Supplier ≠ Product**——Requirement Matching 与 Candidate 的主体是 Supplier + 具体 Offering（同一供应商 A 合规 / B 不合规 / C 未知并存）；`priceStatus=UNKNOWN` 完全合法，**不得因缺价拒绝供应商**（T13）；发现阶段允许先有 supplier 级 Candidate（offeringId 空），Offering 归一后补建更细粒度候选。

### 5.4 SupplierCandidate（NEW，B2）

```prisma
model SupplierCandidate {
  id                   String   @id @default(cuid())
  orgId                String
  searchRunId          String                      // FK → SupplierSearchRun（Tender 语境经 Run 携带）
  supplierId           String                      // FK → Supplier
  offeringId           String?                     // FK → SupplierOffering；空 = supplier 级候选
  candidateKey         String                      // `${searchRunId}:${supplierId}:${offeringId ?? "-"}`
                                                   // （幂等键，规避可空列 unique 的 NULL 陷阱；
                                                   //  形态对齐 createOrObserveAwardRecord 的 sourceKey 先例）
  originSource         String                      // MEMORY | HISTORICAL_SUCCESS | SAVED | EXTERNAL_SEARCH | NEW_DISCOVERY
                                                   // （检索优先级 1–5 的审计痕迹，B.1 §9）

  technicalScore       Float?                      // 0–100
  commercialScore      Float?
  reliabilityScore     Float?
  importRiskScore      Float?
  totalScore           Float?
  scoreVersion         String                      // 与 Run.scoreVersion 一致（冗余落行，行内自证）
  scoreBreakdownJson   Json?                       // 确定性输入痕迹（explain / 复算用）

  mandatoryGateResult  String   @default("PENDING") // PASS | FAIL | INCOMPLETE | PENDING
  mandatoryGateJson    Json?                        // 逐条 mandatory 结果汇总（指向 Match 行）

  recommendation       String?                     // PRIMARY | BACKUP | NEEDS_VERIFICATION | HIGH_RISK | NOT_ELIGIBLE
  rejectionReason      String?
  discoveryConfidenceJson Json?                    // §10 四轴，与分数隔离

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([candidateKey])
  @@index([orgId, searchRunId])
  @@index([orgId, supplierId])
}
```

规则：Run 完成后 Candidate 行不可变（与 §5.1 同治理）；**分数只住这里**——禁写 `Supplier.rating`（H9）；人审短名单动作 = 读 Candidate → upsert `ProjectSupplierLink`（既有幂等键与竞态恢复照用），Candidate 不动；`recommendation` 为确定性推导（§11.4），不是自由文本。

### 5.5 SupplierRequirementMatch（NEW，B3）

```prisma
model SupplierRequirementMatch {
  id                 String   @id @default(cuid())
  orgId              String
  candidateId        String                      // FK → SupplierCandidate
  requirementKey     String                      // Run.requirementSnapshotJson 内的 code/id（真相源=快照）
  requirementRefId   String?                     // TenderExtractedRequirement.id（导航用，非真相源）
  mandatory          Boolean                     // 快照当时判定
  mandatoryUncertain Boolean  @default(false)    // V2 "uncertain" 保留位

  verdict            String                      // PASS | PARTIAL | FAIL | UNKNOWN
  confidence         Float?
  explanation        String?  @db.Text
  evidenceJson       Json                        // 按值快照：[{kind, url?, signalId?, certificationId?,
                                                 //   archiveItemId?, snippet?, capturedAt}]
  evaluationVersion  String
  evaluatedBy        String                      // HUMAN | AI_ASSISTED | DETERMINISTIC
  createdAt          DateTime @default(now())

  @@unique([candidateId, requirementKey])
  @@index([orgId, candidateId])
}
```

规则：证据**按值快照**进 `evidenceJson`（snippet/url/capturedAt 当场复制），历史 match 不因 Supplier/信号/证书后续更新而漂移（T11）；verdict 判定纪律见 §11.3（UNKNOWN 永不折算 PASS）；逐字 snippet 与拒收词表纪律沿 verify.ts。

### 5.6 SupplierCertification（NEW，B5）

```prisma
model SupplierCertification {
  id                String    @id @default(cuid())
  orgId             String
  supplierId        String                      // FK → Supplier
  offeringId        String?                     // scope=PRODUCT/MODEL_SERIES 时指向
  scope             String                      // SUPPLIER | PRODUCT | MODEL_SERIES
  certificationType String                      // UL | ETL | CSA | BIFMA | GREENGUARD | ISO_9001 | …
                                                // TS 目录 fail-closed + OTHER(+label)
  status            String    @default("CLAIMED") // CLAIMED | VERIFIED | REJECTED | EXPIRED
  certificateNumber String?
  issuer            String?
  validFrom         DateTime?
  expiresAt         DateTime?

  sourceKind        String                      // SOCIAL | WEBSITE | BROCHURE | USER_ENTRY | REGISTRY
  sourceUrl         String?
  sourceSignalId    String?
  archiveItemId     String?                     // TenderArchiveItem（证书扫描件，复用既有档案）

  verifiedByUserId  String?
  verifiedAt        DateTime?
  verificationNote  String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([orgId, supplierId, status])
  @@index([orgId, certificationType])
}
```

规则（B5）：`status=VERIFIED` 只能由**人工**写入，且必须携带独立证据引用（`archiveItemId`，或 `sourceKind=REGISTRY` 的官方可查库 `sourceUrl`）——镜像记忆层 `FACT_REQUIRES_EVIDENCE`；`sourceKind=SOCIAL/WEBSITE/BROCHURE` 的行永远只能是 CLAIMED（「官网说 UL certified」≠ 整个 Supplier VERIFIED，H5 同族）；**scope 必须匹配**——PRODUCT 级 VERIFIED 不满足 SUPPLIER 级要求，反之亦然（T14）；到期治理动作置 EXPIRED。Mandatory Gate 的证书类判定只读本表 `VERIFIED` 且 scope 匹配且未过期的行。保存入长期记忆时（§12）promote 为 `MemoryClaim`（structuredValue 携带全字段）+ `MemoryClaimEvidence`——证据系统仍是既有那一套。

### 5.7 Supplier 侧最小增量

维持 v1：**不重构 Supplier 主表**；Sources 展示由 LINKED 信号聚合 + 主表既有 source/website 字段反推；`SupplierSourceProfile`（来源账号归属验证）DEFER→M2。

### 5.8 SupplierSearchBrief（运行期结构 + Run 快照）

```ts
interface SupplierSearchBrief {
  tenderId?: string
  productKeywords: string[]
  technicalRequirements: string[]
  mandatoryRequirements: string[]
  searchTermsEn: string[]
  commercialSearchTermsZh: string[]     // 1688/官网找厂词
  socialSearchTermsZh: string[]         // 平台内容搜索词（Addendum）
  capabilitySearchTermsZh: string[]     // 能力词：CNC铝壳加工 / 钣金喷粉厂家 / IP65外壳定制
  scenarioSearchTermsZh: string[]       // 场景词：工厂实拍 / 来图加工 / 支持打样 / 小批量定制 / 源头工厂
}
```

生成器 `buildSupplierSearchBrief()`：**确定性生成优先 + LLM 两跳扩展**（照搬 `researchMarketPricingTwoHop` 跳 1 形态——versioned prompt 只产检索词、无事实断言、允许猜测；跳 2 合并确定性词并封顶）；LLM 不可用时确定性模板兜底。产品词、能力词、场景词分组输出，Search Planner 组合使用（产品词×场景词、能力词×地域词），不允许只搜产品名。v2 起快照**唯一落点 = `SupplierSearchRun.briefSnapshotJson`**，promptName/promptVersion 同落 Run（不再有游离的「发现运行记录」表述）。

## 6. Platform Trust Model（v1 冻结，保持）

### 6.1 信任梯

```text
DISCOVERY SIGNAL → CLAIM（内容里「说」的）→ OBSERVATION（内容里「看到」的）
→（独立证据 + 人工确认）→ VERIFIED EVIDENCE
```

### 6.2 判定口径

| 情形 | 判 | 不许判 |
|---|---|---|
| 视频文案写「拥有 UL 认证」 | CLAIMED（并可登记 `SupplierCertification(status=CLAIMED, sourceKind=SOCIAL)`） | VERIFIED / UL_VERIFIED |
| 画面中明显出现 CNC 机床 | OBSERVED（CNC_CAPABILITY） | FACTORY_VERIFIED |
| 账号自称「源头工厂」 | CLAIMED | OBSERVED |
| 车间实拍 + 连续多条同场景内容 | OBSERVED + 较高 confidence | VERIFIED |
| 上传营业执照并对过国家企业信用信息公示系统 | VERIFIED（identity） | —— |
| 证书扫描件 + 发证机构可查库核验 | VERIFIED（certification，落 §5.6） | —— |

### 6.3 硬规则（R1–R4）

R1 social 写路径 evidenceStatus 值域 = {CLAIMED, OBSERVED, UNKNOWN}（类型收窄 + service 校验 + T1）；R2 AI 标注 OBSERVED 上限 confidence 0.8 且 UI 标「AI 标注」；R3 VERIFIED 唯一写路径 = 独立证据 + 人工确认；R4 信任级变更一律 append 新记录。

### 6.4 与 canonical 验证词表的映射（信号层 ↔ 记忆层）

CLAIMED/OBSERVED → 落记忆时 `claimNature=INTERPRETATION` + `AI_EXTRACTED/NEEDS_REVIEW`；VERIFIED → `claimNature=FACT` + 独立证据（非 AI_DERIVED）+ `HUMAN_CONFIRMED`；UNKNOWN 不入记忆；confidence 数值留 metadata。

## 7. Social Discovery 三平台策略（v1 冻结，保持）

平台政策一手证据与风险矩阵见 AUDIT §9。

### 7.1 通用分层（所有平台一致）

```text
M1 层 A：USER_SUBMITTED —— 用户粘贴链接/分享文案 → 解析 → SupplierDiscoverySignal（三平台全支持，主路径）
M1 层 B：PUBLIC_WEB    —— 经通用搜索引擎（既有 Tavily 通道）间接发现平台上可公开索引的页面（能力视平台而定）
M1 层 C：MANUAL_ENTRY  —— 采购人员手工记录（表单直建信号）
未来层 D：PROVIDER     —— 商业数据商（TikHub / Apify / 蝉妈妈类），仅接口预留，M1 不接
```

**M1 不做**：直连平台私有接口、登录态自动化、验证码处理、批量抓取、绕过 robots/ToS（Addendum §8 原文边界）。

### 7.2 DOUYIN_STRATEGY

- 官方开放平台面向企业资质开发者且以电商/自有账号数据为主，无通用内容搜索 API → 不接官方 API。
- robots.txt（实测）：无 `User-agent: *` 默认禁抓，但 `*general_search*` 搜索结果页对白名单爬虫也 Disallow → **任何形态的搜索结果页抓取都不做**；单页由通用搜索引擎已索引的走层 B 间接获得（消费搜索引擎结果，不自建爬虫）。
- M1 支持：层 A（v.douyin.com / www.douyin.com 分享链解析：账号名、标题、文案、发布时间，取不到留空不猜）+ 层 B（`site:douyin.com 铝合金外壳 源头工厂` 类查询）+ 层 C。
- 未来层 D：TikHub / Apify 类 provider 挂同型接口后替换，业务层零改动。

### 7.3 XIAOHONGSHU_STRATEGY

- 无官方公开内容 API；web 搜索登录墙；robots.txt（实测）`User-agent: * Disallow: /` 全站默认禁抓 → **不做任何自建直抓**，层 B 仅消费通用搜索引擎已合法索引的入口（覆盖率有限，如实呈现空结果，不造假数据）。
- M1 支持：层 A（xhslink.com / xiaohongshu.com 分享链解析公开元数据，登录墙内内容不碰）+ 层 C。
- 定位：小红书在 M1 是「用户带回来的线索池」，不是自动发现主力。

### 7.4 WECHAT_CHANNELS_STRATEGY

- 封闭生态：无公开 API、内容基本不被搜索引擎索引、分享链接仅受限 H5 场景 → **不作为 M1 依赖，无层 B**。
- 唯一路径 = `USER_ASSISTED_DISCOVERY`（Addendum §9 原文）：采购人员在微信看到工厂视频 → 分享文案/链接/截图交给 Qyane → 解析 account / company / product / location / contact clue / capability / claimed certifications → 建 Signal → 走实体解析。
- 截图/视频媒体理解（Addendum §8-C）标 **M1_OPTIONAL**：纯文本粘贴先行。

### 7.5 Social pipeline 全链（B.1 §11 冻结）

```text
Tender Requirements → Search Brief → Social Search Terms → SupplierDiscoverySignal
→ Entity Resolution → Supplier / Offering Candidate → Independent Verification
→ Requirement Match → Mandatory Gate → Score
```

不允许 Social Signal：直接进入 VERIFIED / 直接进入 Mandatory PASS / 直接修改 Supplier score。

## 8. Entity Resolution（v1 冻结，保持）

### 8.1 问题定义

同一家工厂可能同时以下列身份出现：抖音昵称「佛山办公椅老周」、小红书「XX家具源头工厂」、1688「佛山市XX家具有限公司」、官网 xxfurniture.cn。系统要判断它们是否同一 canonical Supplier。

### 8.2 抽象（运行期 DTO，不建表；快照落 `SupplierDiscoverySignal.resolutionJson`）

```ts
resolveSupplierEntity(input: {
  orgId: string
  signal: SupplierDiscoverySignal
  extracted: { companyNameCandidates: string[]; region?: string; phone?: string;
               website?: string; unifiedSocialCreditCode?: string }   // 统一社会信用代码，最强键
}): Promise<SupplierEntityResolutionResult>

interface SupplierEntityResolutionResult {
  decision: "MATCHED" | "NEEDS_HUMAN_REVIEW" | "NO_MATCH"
  supplierId?: string
  legalName?: string
  candidateNames: string[]
  confidence: number            // 0..1
  matchedSources: Array<{ kind: string; key: string }>   // 命中的匹配键
  conflicts: string[]           // 冲突事实（如两候选地域不同）
}
```

### 8.3 匹配键优先级（强 → 弱）

1. 统一社会信用代码（等值即 MATCHED）
2. 已归档的 accountUrl / 官网域名精确匹配（同 org 内此前 LINKED 过）
3. 法定名称规范化后精确匹配（复用 `normalizeBuyerName`；**归一名等值也不算强键单独放行**——Buyer 纪律：同 normalizedName 不同实体可合法共存）
4. 电话/微信号等联系方式等值
5. 名称模糊相似 + 地域 + 品类共现（只产候选，**永不单独 MATCHED**）

### 8.4 硬规则

- 阈值：`confidence ≥ 0.9` 且命中键 1–4 之一 → MATCHED（仅做预填；M1 全部 LINKED 动作都是人工在工作台点确认的）；`0.5–0.9` → NEEDS_HUMAN_REVIEW（展示候选与冲突）；`< 0.5` → NO_MATCH（引导新建候选）。
- **名字相似的两企业不得自动合并**（T2 直接断言）。M1 不做任何「Supplier 合并」——只做「信号 → 既有 Supplier 关联」或「新建候选」（与 `mergeBuyers()` 抛 `BUYER_MERGE_NOT_IMPLEMENTED` 同一姿态）；结果词表对齐 `createOrObserveAwardRecord`（CREATED / ALREADY_OBSERVED / ATTACHED_EXISTING / NEEDS_REVIEW + possibleDuplicateOf 存疑）。
- 解析结果快照落 `resolutionJson`，人工改判也 append 记录。

### 8.5 与 canonical 身份层的关系（M2 议题，先记不做）

`Supplier` 是可变 CRUD 表而非 canonical 身份实体（无 normalizedName/aliases/externalIdentifiers）。长期正路是 Buyer 式 `SupplierIdentity` additive 层；M1 用「信号表 + linkedSupplierId + resolutionJson」过渡积累身份证据，M2 再决定是否物化（与 AUDIT §5.4 互为印证）。

## 9. Adapter / Provider 架构（v1 冻结，保持）

### 9.1 分层（Addendum §17 冻结）

```text
Platform（业务概念：DOUYIN / XIAOHONGSHU / …）
   ↓
Discovery Adapter（平台语义：怎么把该平台内容变成 Signal）
   ↓
Provider（获取手段：搜索引擎 / 商业数据商 / 用户提交解析器）
```

上层业务只依赖 Adapter 接口；Provider 可替换，Adapter 不得与某一家 provider 强绑定。

### 9.2 接口与 M1 实现矩阵

```ts
// 原方案抽象（B.1 确认），M1 起统一：
interface SupplierSourceAdapter {
  readonly source: string
  fetchCandidates(brief: SupplierSearchBrief, opts?): Promise<SupplierDiscoverySignal[]>
}

// Addendum §7：
interface SupplierDiscoveryAdapter {
  readonly platform: string
  discover(brief: SupplierSearchBrief, options?: DiscoveryOptions): Promise<SupplierDiscoverySignal[]>
  parseUserSubmission?(input: { url?: string; rawText?: string }): Promise<SupplierDiscoverySignal | null>
}
```

| Adapter | discover() | parseUserSubmission() |
|---|---|---|
| DouyinSupplierDiscoveryAdapter | 层 B（SearchEngineProvider） | 层 A ✓ |
| XiaohongshuSupplierDiscoveryAdapter | 层 B（覆盖率受限，如实返回空） | 层 A ✓ |
| WeChatChannelsDiscoveryAdapter | 无（返回空 + 说明） | 层 A ✓（分享文案解析） |
| OpenWebSupplierAdapter | 层 B | —— |
| ManualEntryAdapter | —— | 层 C ✓ |

**落地方式**：照 `MemorySemanticSearchAdapter` 的「冻结契约先行」模式——S1 先落接口 + `available:false` 占位实现 + doc comment 写明未来约束；结果类型用 `ChannelAdapter` 式判别联合（`{ok:true, signals} | {ok:false, code, message}`），adapter 只归一不解读。

### 9.3 Provider 抽象

```ts
interface DiscoveryProvider {
  readonly providerId: string          // "search-engine:tavily" / "commercial:tikhub"
  readonly available: boolean          // 冻结契约位：未接线=false，调用即抛
  search(query: string, opts): Promise<ProviderResult[]>
}
```

第一实现 `SearchEngineProvider` = 统一 tender-intel 现存三份重复 Tavily client（绝不加第四份）；注入缝沿既有惯例（`env?: NodeJS.ProcessEnv` + `fetchImpl?: typeof fetch`）。商业数据商为未来第二实现。

### 9.4 Provider 策略门（合规 fail-closed，H3/H4 机制化落点）

每个 Provider 注册时声明 `respectsRobots` / `requiresPlatformLogin` / `dataLicense`；`requiresPlatformLogin=true` 在 M1 一律拒绝启用；未声明视为不合规（fail-closed，T7）。

## 10. Discovery Confidence（v1 冻结，保持）

四轴（entityIdentity / factoryCapability / certification / canadaExport，值或 UNKNOWN）由 capability signals + 解析结果确定性聚合；只用于 DISCOVERY / CAPABILITY SIGNAL / RESEARCH PRIORITY；**绝不进 Supplier Score**；v2 起快照可随 Candidate 落 `discoveryConfidenceJson`（仍与分数隔离）。

## 11. 确定性评分、Mandatory Gate 与 Recommendation（B6 重写）

### 11.1 评分与来源隔离

- Score 输入 = Requirement Matching 结果 + VERIFIED 证据（§5.6）+ 历史履约（InquiryItem 聚合；引用前注意混币种债 D7）+ 结构化商务/物流因子。
- **Social 信号数量/热度对 Score 贡献 = 0**（T6）；Discovery Confidence 与 Score 物理隔离（§10）。
- **Search 分数永不写 `Supplier.rating`**（H9）；rating 保持人工关系评分，可作为 reliability 维的一个输入，但不是分数存放地。

### 11.2 冻结的确定性评分契约（B6：domain contract，非说明文字）

```ts
// src/lib/supplier-intel/score-contract.ts（S1 落地，冻结后改动=升版本）
export const SUPPLIER_SCORE_V1 = {
  version: "supplier-score-v1",
  weights: {
    technical: 0.40,       // Technical Fit
    commercial: 0.25,      // Commercial
    reliability: 0.20,     // Supplier Reliability
    importRisk: 0.15,      // Import / Delivery Risk（分高=风险低）
  },
} as const;   // 权重和恒为 1（T10 断言）

export function computeSupplierScore(input: SupplierScoreInput): SupplierScoreBreakdown
// 纯函数：同输入必同输出；无 IO、无 LLM、无时钟；UNKNOWN 输入按维度规则折算并在
// breakdown 里显式标注，绝不虚构数值。

export function explainSupplierScore(breakdown: SupplierScoreBreakdown): Promise<string>
// LLM 允许出现的唯一位置：解释既有 breakdown。LLM SHALL NOT determine numeric score。
```

- `scoreVersion` 在 Run 创建时冻结、随 Candidate 冗余落行；升级评分逻辑 = 发布 `supplier-score-v2`，历史行不动。
- 评分路径零 LLM：以注入缝测试断言（T10），不是口头约定。
- 各维输入（M1 起始口径，S4 细化为 golden 样例）：technical = mandatory 外的需求 match 加权通过率；commercial = 已知价格的相对位置 + 商务条款完备度（**价格 UNKNOWN → 该子项取中性基线并标注，不惩罚性拒绝**，T13）；reliability = 履约史（replyRate/selectRate/交期）+ 人工 rating + 合作时长；importRisk = 出口能力证据（CANADA_EXPORT 等 VERIFIED/OBSERVED 分级）+ incoterm/物流因子。

### 11.3 Mandatory Gate

- 需求源 = **本 Run 的 `requirementSnapshotJson`**（V2 层取得，uncertain 保留），不读会塌缩 uncertain 的 DB boolean。
- 逐条 mandatory 判 PASS / FAIL / UNKNOWN，只消费 VERIFIED 证据（证书类只读 §5.6 VERIFIED + scope 匹配 + 未过期）。
- **FAIL ⇒ `NOT_ELIGIBLE`，无论价格多低都不得成为 PRIMARY**（B6 原文；T12）。
- **UNKNOWN ⇒ NEEDS_VERIFICATION，不得折算 PASS**（B.1 §5 原文；T12）。`mandatoryUncertain=true` 的条目呈现「疑似强制，待澄清」，Gate 按 mandatory 处理（fail-closed）。
- 历史成功供应商同样过当前 Run 的门（T15）。

### 11.4 Recommendation（5 态，确定性推导）

```text
NOT_ELIGIBLE        mandatory 任一 FAIL（终态，带 rejectionReason）
NEEDS_VERIFICATION  mandatory 存在 UNKNOWN，或身份/关键证书未验证
HIGH_RISK           门过但 importRisk/reliability 触及风险阈值（阈值随 scoreVersion 冻结）
PRIMARY             门全 PASS + 身份 VERIFIED + totalScore 排名首位
BACKUP              门全 PASS，排名次于 PRIMARY
```

推导为纯函数（scoreVersion 的一部分）；推荐卡携带 Score/identity 状态/capability 置信/mandatory x/y/social signals 数/Sources/Notes（v1 保持）。

### 11.5 Landed Cost 预留（B.1 §10，DEFER 不扩本轮）

`scoreBreakdownJson.commercial.landedCost` 预留结构：`{ status: "MANUAL"|"PARTIAL"|"UNKNOWN", components: { factoryPrice?, packaging?, chinaFreight?, exportCharges?, intlFreight?, insurance?, duty?, sima?, brokerage?, canadaFreight?, installation?, warrantyAllowance? }, currency?, note? }`。M1 允许 manual/partial/unknown，UNKNOWN 时 commercial 维按 §11.2 中性规则处理；`SupplierOffering` 已带 unitPrice/currency/incoterm——M2/M3 扩展 landed-cost 自动化无模型阻断，M1 不为此加任何表。

## 12. Supplier Memory 边界（v1 冻结，保持 + B5 补充）

- 发现信号与评估脊柱是**工作区数据**；互联网搜索结果永不自动写入长期记忆。
- 人工确认后 `SAVE_TO_SUPPLIER_MEMORY`：写/补 Supplier 行 + `createMemoryClaim(subjectType="VENDOR", subjectKey=Supplier.id, claimType="SUPPLIER_FACT", accessClass="VENDOR_CONFIDENTIAL", sourceType=PUBLIC_WEB|USER_ENTRY|VENDOR_QUOTE)`，零 schema 变更；VERIFIED 证书按 §5.6 promote（structuredValue 全字段 + MemoryClaimEvidence）。
- AI 自动写已被 `assertWritableActorType` 硬禁——M1 只需不绕过。
- **D-MEM-1（保持）**：落地时收紧 `assertSubjectInScope` VENDOR 分支为「本 org 的 Supplier.id」。

## 13. UI、租户隔离与权限（v1 保持，S 序调整见 §16）

### 13.1 UI（Addendum §13 对齐；v2 改以 SearchRun 为主轴）

- **落点**：`/projects/intelligence/supply-chain` 占位页激活为 Supplier Intelligence 工作台；org 级 supply-chain slot 同步接真实数据。
- **Run 工作台（v2 主轴）**：一次 SupplierSearchRun 一屏——快照区（brief/需求/sources/queries 可回放）、候选榜（分数分解 + 门结果 + 推荐态）、逐候选 Requirement Match 明细。信号 inbox 是其中一个入口，**不是首个交付物**（§16 S 序：审计脊柱先于 UI）。
- **Signal Inbox**：按 status 分栏（NEW/REVIEWED/LINKED/REJECTED），逐条平台徽章 + 实体解析预填（MATCHED 候选 / NEEDS_HUMAN_REVIEW 冲突面板）；LINK/REJECT 全人工点按。
- **Supplier 详情 Sources 区块**：来源清单（Qyane Memory / 1688 / Website / Douyin / Xiaohongshu / WeChat / Manual）= LINKED 信号聚合去重 + 主表既有 source/website；展开 Social Evidence 三栏 **Observed / Claimed / Verified**，一眼区分「看到的 / 供应商自己说的 / 真正验证过的」；AI 标注的 OBSERVED 带「AI 标注」徽章。
- **推荐卡**：Score / identity 状态 / capability 置信 / mandatory x/y / social signals 数 / Sources / Notes（§11.4 五态）。
- **空态诚实**：无数据显式「未发现/未验证」，禁假 0（沿用情报 tab data-intel-slot 惯例）。

### 13.2 租户、权限与 flag

v1 保持：七张新表全带 orgId 且服务层内部过滤；`requireTenantContext`；导航/模块/权限/i18n 五件套；`ORG_SCOPED_API_PREFIXES` 登记 `/api/supplier-intel/`；`SUPPLIER_INTEL_ENABLED` + `SUPPLIER_INTEL_ORG_ALLOWLIST`（四符号，默认 OFF，记入 .env.example）；层 B 外呼另需 `TENDER_EXTERNAL_INTEL_ENABLED`+`TAVILY_API_KEY`（两道独立门）。`createdByUserId` 一律取自 canonical auth 上下文（trusted principal），不收客户端断言。

## 14. 测试计划（M1 编码轮必须落）

| # | 测试 | 断言 |
|---|---|---|
| T1 | Social claim is not verification | 抖音文案「UL Certified」→ capability/certification 均 CLAIMED；social 写路径写 VERIFIED 抛错 |
| T2 | Entity resolution ambiguity | 名字相似两企业 → NEEDS_HUMAN_REVIEW，零自动合并副作用 |
| T3 | User submitted social link | 三平台链接各建 1 条 Signal，取不到的字段留空不猜 |
| T4 | Cross-org isolation | Org A 的 Run/Signal/Candidate/Match/Certification 在 Org B 全不可见 |
| T5 | Social does not bypass mandatory gate | capability confidence 0.95 + mandatory 证书 FAIL → NOT_ELIGIBLE |
| T6 | Score isolation | ±20 条 social 信号 → totalScore 不变；DiscoveryConfidence 变 |
| T7 | Provider policy gate | `requiresPlatformLogin=true` 的 provider 启用被拒（fail-closed） |
| T8 | Capability/certification type fail-closed | 未知 type 拒收 |
| T9 | Run snapshot auditability | Run 落 brief/requirement/source/queries 四快照 + prompt/score/evaluation 版本，可回放 |
| T10 | Deterministic score | 权重和=1；同输入同输出；评分路径注入缝断言零 LLM 调用；scoreVersion 落 Candidate |
| T11 | Historical reproducibility | Run COMPLETED 后改 Supplier 数据/Tender 需求 → 该 Run 的 Candidate/Match 逐字段不变；新 Run 才反映 |
| T12 | Gate 判定纪律 | mandatory FAIL + 全场最低价 → NOT_ELIGIBLE；mandatory UNKNOWN → NEEDS_VERIFICATION 且永不折算 PASS |
| T13 | Price UNKNOWN 不拒 | `priceStatus=UNKNOWN` 的 Offering 正常入池、commercial 取中性基线、不因缺价 NOT_ELIGIBLE |
| T14 | Certification scope | PRODUCT 级 VERIFIED UL 不满足 SUPPLIER 级 UL 要求；scope 匹配才可支撑 mandatory PASS |
| T15 | Search priority | memory/履约史供应商必入候选池（originSource 正确）；历史成功者 mandatory FAIL 照样 NOT_ELIGIBLE |

## 15. M1 Definition of Done

**核心链部分（B.1 补回后取代 v1 重建版）**：

1. 完整链 Tender → Requirements（快照）→ Brief → Discovery（优先级 1–5）→ Normalization（实体/Offering）→ Requirement Matching → Mandatory Gate → Commercial Evaluation → Supplier Risk → Ranked Recommendation → Human Review → Supplier Memory 全程持久化、可审计、可回放（§5）。
2. 历史 Run 结果不可重算不漂移（T11）；每级判定可回答「当时依据什么」。
3. 评分 = 冻结版本化纯函数（40/25/20/15），LLM 零参与数值（T10）；推荐 5 态确定性推导。
4. Mandatory FAIL→NOT_ELIGIBLE、UNKNOWN→NEEDS_VERIFICATION 永不折算 PASS（T12）。
5. Supplier ≠ Offering；缺价不拒（T13）；认证分 scope 且 CLAIMED≠VERIFIED（T14）。
6. 全程无自动 RFQ/私信/PO/付款；租户隔离（T4）；trusted principal。

**Addendum 附加项 20–30（原文冻结，v2 引用节号更新）**：

20. Supplier Source abstraction 支持 Social Discovery（§9）
21. 存在 SupplierDiscoverySignal（§5.2）
22. 支持 CLAIMED / OBSERVED / VERIFIED（§6）
23. Search Brief 支持 capability/social keywords（§5.8）
24. Entity Resolution 有明确 abstraction（§8）
25. 用户可手动添加 social source（§7 层 A/C）
26. Social evidence 不可直接提升为 verified certification（§6.3-R1 + §5.6）
27. Social adapter 不绕过平台限制（§9）
28. Architecture 可以未来接 Douyin / Xiaohongshu / WeChat（§9）
29. Social discovery 与 Supplier Corporate Memory 分离（§12）
30. Tenant isolation PASS（§13.2 / T4）

## 16. 实施切分（B.1 §14 重排：脊柱先行，UI 后置）

```text
M1-S1  Canonical persistence + auth + tenant + audit spine（无 UI）
       · 7 表 additive 迁移（isolated Neon 分支先验证；登记 check-release-safety；遵守 B0 生产库保护）
       · flags（SUPPLIER_INTEL_ENABLED + ORG_ALLOWLIST，默认 OFF，.env.example）
       · requireTenantContext 服务骨架（全函数 orgId 内部过滤）
       · SupplierSearchRun 生命周期 + 完成后不可变治理（字段白名单）
       · SUPPLIER_SCORE_V1 契约文件冻结（纯函数骨架 + T10 权重/零 LLM 断言）
       · 用户提交信号 ingestion API（层 A/C，无 UI）+ audit actions 登记
       · 测试：T3/T4/T8/T9/T10(契约部分)/T11(治理部分)
M1-S2  Brief + Discovery
       · buildSupplierSearchBrief()（确定性+两跳 LLM，快照落 Run）
       · Search Planner（优先级 1–5，内部源直入池记 originSource）
       · SearchEngineProvider（统一三份 Tavily client）+ OpenWeb/Douyin 层 B + Provider 策略门（T7）
       · Entity Resolution 预填（resolutionJson）
M1-S3  Normalization + 人审工作台（UI 从这里开始）
       · SupplierOffering / SupplierCertification 登记流（T13/T14 数据面）
       · capability 标注（人工为主、AI 辅助带标）
       · supply-chain 页激活：Run 工作台 + Signal Inbox + Supplier 详情 Sources/Social Evidence（T1/T2 全流程）
M1-S4  Evaluate + Recommend + Save
       · SupplierRequirementMatch（三段式匹配）+ Mandatory Gate + score v1 各维实现 + Recommendation
       · Candidate → ProjectSupplierLink 人审桥
       · SAVE_TO_SUPPLIER_MEMORY（含 D-MEM-1 收紧）
       · 推荐 UI + golden 样例集 + T5/T6/T12/T15 全量
```

每片独立 flag-off 可合；**不为了尽快看到 UI 把 inbox 页面提到审计链之前**（B.1 §14 原文约束）。

## 17. 迁移纪律（B.1 §15）

additive-only；先在隔离 Neon 分支验证；**本轮 docs-only 零迁移**；实现轮不做生产迁移决策（部署按 safe-migrate-deploy 流程另批）；禁 `prisma db push --accept-data-loss`；禁破坏性迁移；继续遵守 B0 生产库保护（ep-super-field 点名硬编码 + CONFIRM_PRODUCTION_MIGRATION）。>2 张表已由 §4.4 论证为域不变量最小集。

## 18. 汇报键值块（Addendum §21 要求，随 v2 更新）

```text
SOCIAL_DISCOVERY_MODEL = 信号先行：社媒只产 SupplierDiscoverySignal/SupplierCapabilitySignal 两张发现层表，经实体解析与独立验证才进入评估脊柱；Social=discovery source 而非 supplier truth；不进分、不越门、不直 VERIFIED
DOUYIN_STRATEGY = 用户提交分享链解析 + 搜索引擎间接发现（复用既有 Tavily 通道）+ 手工录入；不接官方 API（企业资质门槛、无通用内容搜索）；商业数据商仅预留接口
XIAOHONGSHU_STRATEGY = 用户提交为主（robots 全站默认禁抓实测）+ 手工录入；层 B 覆盖率如实呈现；零直抓/零登录态
WECHAT_CHANNELS_STRATEGY = USER_ASSISTED_DISCOVERY 唯一路径（分享文案/链接人工带回→解析建信号）；不作为 M1 依赖；截图/媒体理解标 M1_OPTIONAL
ENTITY_RESOLUTION_DESIGN = resolveSupplierEntity() 运行期 DTO + resolutionJson 快照；匹配键分级（统一社会信用代码>已档 URL>法名归一>联系方式>模糊仅候选）；0.5–0.9 NEEDS_HUMAN_REVIEW；全程人工确认、永不自动合并（对齐 Buyer 纪律 + createOrObserveAwardRecord 词表）
SOCIAL_TRUST_MODEL = DISCOVERY SIGNAL→CLAIM→OBSERVATION→VERIFIED 四级；social 写路径值域仅 {CLAIMED,OBSERVED,UNKNOWN}；VERIFIED 唯一来源=独立证据+人工确认；落记忆映射 canonical 验证词表
PLATFORM_POLICY_RISKS = 小红书 robots User-agent:* Disallow:/（实测）；抖音搜索结果页 *general_search* Disallow（实测）+ ToS/反不正当竞争法/PIPL 风险；视频号封闭生态；多数第三方数据商采集合规性存疑 → Provider 策略门 fail-closed
M1_SOCIAL_SCOPE = 三平台用户提交 + 抖音/OpenWeb 搜索引擎间接 + 手工录入；inbox 人工确认流；零自动抓取/零登录态/零私信供应商
FUTURE_AUTOMATION_SCOPE = 商业数据商 Provider（尽调后）/ 截图与视频媒体理解 / SupplierIdentity canonical 身份层 / SupplierSourceProfile 归属验证 / Landed Cost 自动化（M2/M3，结构已预留）/ 快手·B站扩展——全部在 Adapter/Provider 抽象后面，业务层零改动
```
