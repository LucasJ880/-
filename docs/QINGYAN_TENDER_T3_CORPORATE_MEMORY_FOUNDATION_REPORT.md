# Qingyan Tender T3 — Corporate Memory Foundation 实施报告

| 项 | 值 |
|---|---|
| 阶段 | Tender T3 — Corporate Memory Foundation（Buyer + MemoryClaim + Provenance + Retrieval Contract） |
| 起始 main | `b27f0ae`（含 #98 T1A / #99 T2-M1 / #101 T1B Dark Merge）；Final Remediation 已合并最新 `origin/main@871da3b`（含 #97 tender-eval / #100 Tender V2） |
| 分支 | `feature/tender-t3-corporate-memory-foundation`（从 `origin/main@b27f0ae` 创建，与 Tender V2 / T2-P1 为 sibling lane） |
| 日期 | 2026-08-11 |
| 性质 | additive-only schema（3 表）+ 新服务层 `src/lib/corporate-memory/*` + 测试；**无 UI 顶层页面、无 AI 自动写入、无回填、无生产迁移** |
| 交付 | Draft PR #103（`feat(memory): add T3 corporate memory foundation`），保持 Draft，等待人工 Final Review |
| Final Remediation | ①Access class server-authoritative（claim + evidence 独立过滤、caller 只能收窄、evidenceCount 仅计可见）②confirm 证据门（无证据不得提升 HUMAN_CONFIRMED/ACTIVE）③新增 ACCESS-01..07 + MEM-11/12 + 纯逻辑 access 不变式 |

---

## 1. Executive Summary

T3 建立了企业记忆（Corporate Memory）的最小可信基础层，落地三张 additive 表与一套 canonical service：

- **Buyer** —— 采购主体规范化实体（org 级 canonical identity）。
- **MemoryClaim** —— 企业事实层唯一 canonical claim 模型：可追溯、可证明、可版本化、可纠正、可审计，明确区分事实 / 解释 / 推断。
- **MemoryClaimEvidence** —— 一等证据 / provenance 记录（1 claim → N evidence）。

核心产品原则贯彻到位：**RAG Retrieval ≠ Corporate Memory**。每条可用 claim 都能回答「谁说的 / 来自哪里 / 何时捕获 / 有何证据 / 多大置信 / 是否仍有效 / 是否被取代 / 是否人工确认 / 公开还是内部」。

**本轮最重要的 Gate 全部守住**：`AI_AUTO_MEMORY_WRITE = NO`（AI / Agent / V2 / T1B / LLM chat 一律不得直接写记忆）、additive-only migration、无第二套向量基建、无 T4 情报、无 backfill、无生产数据变更。

验证在生产快照隔离 Neon 分支完成：additive migration 干净应用、43 条 Buyer/Claim/Retrieval/Access 集成断言全过（含 Final Remediation 的 ACCESS-01..07 + MEM-11/12）、DB 级 RESTRICT FK 与租户隔离经实测、全量 test-all 回归绿。

---

## 2. Starting Main / Branch

```
git fetch origin
origin/main = b27f0ae8359996e522721096b96e7ab84db31376
```

确认已合入：#98 T1A（`408d08b`）、#99 T2-M1（`9efcfa4`）、#101 T1B Dark Merge（`b27f0ae`）。当前 main 无其他未预期漂移。

分支从 **latest `origin/main`** 创建：

```
main
├── Tender V2       (sibling lane)
├── T2-P1           (sibling lane)
└── T3 Foundation   ← feature/tender-t3-corporate-memory-foundation（本 PR）
```

未从 PR #97 / #100 / T2-P1 分支创建。三条 lane 代码边界独立。

---

## 3. Existing Memory Model Audit（CURRENT_MEMORY_MODEL_MAP）

开写 schema 前对全 repo（~236 Prisma 模型）做了记忆类模型审计。关键结论：

| 模型 | 位置 | 判决 |
|---|---|---|
| `ProjectInsight` | `schema.prisma:1693` | L3 项目内结论层，保留。`embedding Json?` 是**死字段**（零读者/零写者/无 ANN 索引）；`orgId` 可空是历史债。**不作为向量归宿复用**（复用需破坏性列类型变更）。 |
| `ProjectIntelligence` | `:1666` | 不可复用（1:1 项目 AI 报告卡）。 |
| `BidIntelligenceFact` | `:2244` | 语义重叠（content/sourceType/confidence/humanConfirmed）；T0 规划其手工录入路径未来迁 MemoryClaim（T3 不迁、不双写）。 |
| `TenderAnalysisFact` | `:2387` | 提取层保留（run 作用域，`statementKind`）；无 orgId。 |
| `TenderAnalysisSourceRef` | `:2411` | **evidence 先例**（页码 + 原文片段 + confidence + 多态父指针）。 |
| `UserMemory` | `:4268` | 会话记忆（user 作用域），**非本层**；其双时态 + supersession 是形状先例。 |
| `TenderArchiveItem` | `:6938`（T2-M1） | 原始证据快照层；MemoryClaimEvidence 通过 `archiveItemId` 逻辑引用之（无 FK）。 |
| `ProjectEvent/ProjectCost` | `:6824/:6892`（T2-M1） | 约定来源：cuid / orgId 非空 / 无破坏性 FK / String 词表 / producer 供给业务时间 / 新→旧修正链。 |

**命名碰撞检查**：`Buyer` / `MemoryClaim` / `MemoryClaimEvidence` 在 `src/`、`prisma/`、`scripts/` 全库零碰撞。为避免与既有会话记忆家族（`UserMemory` / `src/lib/ai/memory*`）语义混淆，新模块置于 `src/lib/corporate-memory/`。

**Buyer 现状**：全库无 Buyer/Owner/Purchaser/ProcuringEntity 模型；采购方仅是 `Project.clientOrganization`（自由文本、未规范化、未去重）。`Project.ownerId/purchaserId` 是内部 User（我方人员），**不得混为 Buyer**。intel-tab 已预留 `buyer_history`「采购机构画像」空态槽 —— Buyer 是被显式承认的缺口。

审计结论：`EXISTING_MEMORY_MODEL_AUDIT = PASS`；无 `MEMORY_MODEL_COLLISION`、无 `PROJECTINSIGHT_AUTHORITY_CONFLICT`。

---

## 4. Corporate Memory Architecture

沿用 T0 四层模型（`docs/QINGYAN_TENDER_T0_MEMORY_INTELLIGENCE_ARCHITECTURE.md §6`）：

| 层 | 内容 | 载体 | 本轮 |
|---|---|---|---|
| L1 Raw Archive | 原始 PDF/HTML/邮件/照片 | `TenderArchiveItem`（T2-M1）+ Blob | 不动（无 Archive Capture） |
| **L2 Structured Facts** | Buyer、字段级事实 | **`Buyer` + `MemoryClaim`（本 PR）** | ✅ FOUNDATION |
| L3 Internal Project Memory | 报价/成本/参与人/Win-Loss | `ProjectReview`/`ProjectInsight` + Ledger | 不动 |
| L4 Intelligence | Buyer 模式/竞争/价格/周期 | `MemoryClaim`（claim 态）+ Fingerprint | 仅 claim 承载能力，无 producer |

本 PR **只做 Layer 2 Foundation + Buyer identity foundation**，不实施 L3/L4 automation。

统一核心是**一个** `MemoryClaim`，不建 `TenderMemory`/`TenderFact`/`BuyerFact`/`CompetitorFact` 等平行事实表；未来不同业务域通过 `subjectType` / `subjectKey` / `claimType` / `sourceType` / `metadata` 表达（`NO_PARALLEL_MEMORY_SYSTEM`）。

---

## 5. Buyer Model

`prisma/schema.prisma`（T3 段）：

- 身份/规范化：`canonicalName`、`normalizedName`（确定性归一产物，**刻意非唯一约束**）、`aliases String[]`、`websiteDomain`、`officialWebsite`、`externalIdentifiers Json?`。
- 归属地：`country` / `province` / `city`；分类：`buyerType`（municipal/provincial/federal/crown/school_board/…）。
- 治理：`status`（ACTIVE/NEEDS_REVIEW/INACTIVE/MERGED）、`metadata`、`createdById`、时间戳。
- **租户边界**：`orgId String`（NOT NULL），索引 `[orgId, normalizedName]` / `[orgId, websiteDomain]` / `[orgId, status]`。
- **无破坏性 FK**：不 FK Organization/User（记忆保留 ≠ 组织/用户生命周期）。

Buyer 表示采购主体 / Owner / Public Buyer / Customer Organization，**不是联系人**。

---

## 6. Buyer Identity Rules

Canonical identity **不得仅靠名字**。确定性归一（`normalize.ts::normalizeBuyerName`）：NFKC fold + 小写 + 标点归一 + `&→and` + 冠词剥离 + `"X, City of"` 倒装复位。

- `City of Toronto` / `The City of Toronto` / `Toronto, City of` → 同一 `city of toronto` 键（可幂等）。
- `Toronto District School Board` 与 `Toronto Catholic District School Board` → 归一后**仍不同**，绝不因名字近似自动合并。

匹配优先级（`buyer-service.ts::findBuyerMatch`，确定性、无 fuzzy、无 LLM）：`externalIdentifier` > `websiteDomain` > `normalizedName` > 显式 `alias`（归一后精确等值）。

**身份不确定时 fail-safe**：同 `normalizedName` 但双方域名并存且不同 → 不合并，新建独立记录并标 `NEEDS_REVIEW` + `metadata.identityConflict.conflictBuyerId` 回指。`BUYER_AUTO_FUZZY_MERGE = NO`。

---

## 7. MemoryClaim Model

`MemoryClaim` 表示「企业目前知道的一条可验证陈述」，**不等于** raw note / chat message / LLM output / vector chunk。字段覆盖任务书 §13 全部语义：

`id` · `orgId`(NN) · `subjectType` · `subjectKey` · `claimType` · `claimNature` · `statement`(≤2000, @db.Text) · `structuredValue Json?` · `confidence` · `verificationStatus` · `sourceType` · `capturedAt`（业务时间，无 default）· `validFrom` · `validTo` · `status` · `supersedesClaimId`（新→旧）· `supersededAt` · `retractedAt` · `retractionReason` · `accessClass` · `createdByType` · `createdById` · `verifiedById` · `verifiedAt` · `reviewNote` · `metadata` · 时间戳。

索引：`[orgId, subjectType, subjectKey, status]` / `[orgId, claimType, status]` / `[orgId, status, capturedAt]` / `[supersedesClaimId]`。

**Subject 契约**（§14）：`subjectType ∈ {BUYER, PROJECT, TENDER, VENDOR, PRODUCT, ORGANIZATION, OTHER}` + `subjectKey` 逻辑引用，**不为每种 subject 建 FK**（跨业务对象存储、避免破坏性级联）。当 `subjectType=BUYER/PROJECT/TENDER/ORGANIZATION` 时，service 层校验 `subjectKey` 属于本 org（fail-closed）；VENDOR/PRODUCT/OTHER 允许 opaque key。

**Claim taxonomy**（§15）：`claimType ∈ {BUYER_POLICY, BUYER_PATTERN, PROJECT_FACT, COMMERCIAL_TERM, TECHNICAL_REQUIREMENT, AWARD_FACT, PRICE_FACT, WIN_LOSS_REASON, SUPPLIER_FACT, OTHER}` —— 受控可扩展词表，不把 statement 文本当唯一类型系统。本轮不为每种 claimType 产生 producer。

**无 Tender/roller shade/RCMP/Somfy 硬编码列**（§40）：core model 域中性，专用信息进 `claimType` / `structuredValue` / `metadata`。

---

## 8. Claim Nature（Fact vs Interpretation vs Inference）

`claimNature ∈ {FACT, INTERPRETATION, INFERENCE}`：

- **FACT** = 证据直接支撑陈述 → 必须有 evidence；`sourceType=AI_DERIVED` 时**禁止** FACT（`AI_DERIVED_CANNOT_BE_FACT`）。
- **INTERPRETATION** = 有来源依据的人/系统解读。
- **INFERENCE** = 派生结论。

**AI 推理绝不默认 FACT**。`CLAIM_NATURE = FACT / INTERPRETATION / INFERENCE SUPPORTED`。

---

## 9. Confidence vs Verification（正交）

两个维度分离存储：

- `confidence ∈ {HIGH, MEDIUM, LOW}`（陈述强度）。
- `verificationStatus ∈ {AI_EXTRACTED, HUMAN_CONFIRMED, SYSTEM_VERIFIED, NEEDS_REVIEW}`（验证状态）。

`confidence=HIGH` + `verificationStatus=AI_EXTRACTED` ≠ `HUMAN_CONFIRMED`。本轮无 system verifier，创建时不可直接标 `SYSTEM_VERIFIED`（`SYSTEM_VERIFICATION_NOT_ENABLED`）；`AI_DERIVED` 创建时不可直接标 `HUMAN_CONFIRMED`（须先创建再经 `confirmMemoryClaim` 受控提升）。`CONFIDENCE_VERIFICATION_SEPARATED = PASS`。

---

## 10. Evidence Model

**决策：first-class `MemoryClaimEvidence` 表**（非 JSON array）。理由：audit / supersession / source freshness / confidence / citation 都将依赖 evidence 的可查询性与 per-source 分级；JSON array 无法承载 per-evidence accessClass 与跨 claim 的证据检索。`MEMORY_EVIDENCE_MODEL = MemoryClaimEvidence`。

字段：`sourceType`（去掉 AI_DERIVED —— AI 产物不是独立证据）· `sourceKey` · `archiveItemId`（→ TenderArchiveItem 逻辑引用）· `documentId` · `pageNumber` · `sectionLabel` · `sourceUrl` · `sourceSnippet`（≤2000，是证据片段**不是整份文档复制**）· `contentHash` · `capturedAt`（无 default）· `accessClass` · `metadata`。

关系：`MemoryClaim 1 → N MemoryClaimEvidence`，唯一内部 FK `onDelete: Restrict`（对齐 ProjectEventActor 先例；证据不可经级联抹史）。`MULTI_EVIDENCE = PASS`（实测 create 2 + attach 1 = 3 保留）。

**证据政策**：每个可用 claim 必须有 evidence；唯一例外 = `USER_ENTRY` 无证据 → 强制 `status=NEEDS_REVIEW` + `verificationStatus=NEEDS_REVIEW`（`EVIDENCE_REQUIRED` / `FACT_REQUIRES_EVIDENCE`）。`PROVENANCE = PASS`。

---

## 11. Archive Relationship

`TenderArchiveItem`（immutable raw snapshot，T2-M1）与 MemoryClaim 的桥是 `MemoryClaimEvidence.archiveItemId`，**逻辑引用无 FK**（记忆保留与来源保留生命周期可不同）。本轮**不做 Archive Capture**、不 materialize。写入路径会校验 `archiveItemId` 属本 org（`EVIDENCE_SOURCE_OUT_OF_SCOPE` fail-closed）。`TENDER_ARCHIVE_AUTO_MATERIALIZATION = NO`。

---

## 12. Claim Lifecycle

`status ∈ {ACTIVE, SUPERSEDED, RETRACTED, NEEDS_REVIEW}`。事实语义字段**不可原地改写**：

- 实质变化 → `supersedeMemoryClaim`：旧 `ACTIVE→SUPERSEDED`（`supersededAt`），新 `ACTIVE` 且 `supersedesClaimId=旧id`，subject 继承旧 claim。
- 事实证伪 → `retractMemoryClaim`：旧 `→RETRACTED`（保留 statement + `retractionReason`），可选 correction claim 挂链。
- 人工确认 → `confirmMemoryClaim`：`verificationStatus→HUMAN_CONFIRMED`，`NEEDS_REVIEW` 生命周期同时提升 `ACTIVE`。**证据门（Final Remediation）**：无证据 claim（只可能是 `USER_ENTRY`+`NEEDS_REVIEW`）**不得**被 confirm 提升——必须先 `attachMemoryClaimEvidence` 补证据，否则 `EVIDENCE_REQUIRED`（MEM-11）；补证据后可正常提升 ACTIVE + HUMAN_CONFIRMED（MEM-12）。

`CLAIM_SUPERSESSION = PASS`、`CLAIM_RETRACTION = PASS`。

---

## 13. Supersession / Retraction / Material Update

原地更新白名单（`updateMemoryClaimGovernance`）**仅** `metadata` / `reviewNote` / `accessClass`。任何事实语义字段（statement/confidence/subject/…）出现在 patch → `GOVERNANCE_FIELD_FORBIDDEN`。`MATERIAL_CLAIM_UPDATE = DISALLOWED`。

禁止 hard delete 作为普通纠正方式；DB 级 RESTRICT FK 实测阻止删除带证据的 claim（历史保全）。

---

## 14. Access Classification

`accessClass ∈ {PUBLIC_SOURCE, INTERNAL_COMPANY, CLIENT_CONFIDENTIAL, VENDOR_CONFIDENTIAL, RESTRICTED}`（复用 TenderArchiveItem 词表），claim 与 evidence 各自独立分级。

**Server-authoritative 过滤（Final Remediation 强化）**：可见分级由已鉴权上下文的角色裁定，**不接受 client 输入**（`access.ts::serverAllowedAccessClasses`）：
- `org_member` → 仅 `PUBLIC_SOURCE` + `INTERNAL_COMPANY`；
- `org_admin` / `platform_admin` → 全部分级。

caller 的 `allowedAccessClasses` 只能在 server 授权集**之内收窄**（`effectiveAccessClasses` = server ∩ caller），传入越权分级被交集剔除、绝不扩大可见范围（请求纯越权集 → 空集 → 零结果，无泄漏）。检索对 **claim 与 evidence 各自按自身 `accessClass` 独立过滤**：可读 claim 上的越权证据既不返回、也不计入 `evidenceCount`（不泄漏隐藏证据的存在或 snippet）。`getMemoryClaim` 对越权 claim 返回 `null`（redact，不可枚举）。

**No public-private collapse**（§36）：同一 statement 不同来源的证据各自保留 `sourceType` / `accessClass` / `capturedAt`，不因文本相同合并。`ACCESS_CLASSIFICATION = PASS`（ACCESS-01..07 实测：member 不可读 RESTRICTED/CLIENT/VENDOR、caller 无法越权升权、admin 可读机密、可读 claim 的受限证据不泄漏、caller 可收窄）。

---

## 15. Tenant Isolation

Buyer 与 MemoryClaim 均 `orgId NOT NULL`；所有读写 org-scoped。跨 org 一律 fail-closed：禁止读 / 更新 / supersede / retract / evidence attachment，即使已知 claimId（`loadOwnedClaim` 按 org 过滤 → `CLAIM_NOT_FOUND`，不可枚举）。client 侧 orgId spoof 在 `access.ts` 复核成员资格被拒。实测 MEM-07/08、RET-07、BUYER-05 全过。`TENANT_ISOLATION = PASS`；无 `TENANT_ISOLATION_GAP`。

---

## 16. Write Authorization

`MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY`（§26）：写 = platform admin（`isSuperAdmin`）或该 org 的 `org_owner`/`org_admin` 活跃成员；读 = platform admin 或该 org 任意活跃成员。复用既有 RBAC（`src/lib/rbac/roles.ts`），未发明新 RBAC 系统。

生产写入统一走 `src/lib/corporate-memory/*` service（`createMemoryClaim` / `supersedeMemoryClaim` / `retractMemoryClaim` / …），业务代码禁止直连 `prisma.memoryClaim.create`。本轮**不新增** API route、**不新增**普通用户 UI；人工/受控写入路径以 domain service 形态提供（供测试/管理员/未来 internal tools）。`MEMORY_WRITE_AUTHORIZATION = PASS`。

---

## 17. AI Auto-Write Gate（本轮最重要 Gate）

`AI_AUTO_MEMORY_WRITE = NO`。`createByType` 词表 = `user | system`；`assertWritableActorType` 硬拒 `actorType ∈ {ai, ai:*, agent}`（`AI_AUTO_MEMORY_WRITE_DISABLED`）与 `system`（`SYSTEM_WRITER_NOT_ENABLED`，本轮未启用）。

明确禁止：Tender V1/V2 → MemoryClaim、T1B Workforce → MemoryClaim、LLM chat → MemoryClaim、Agent → MemoryClaim 的自动写入。未来 AI 提议的 claim 最多进入 candidate / pending review（**本轮不实现 candidate flow**）。实测 `MEM-AI actorType=ai 直写 → 拒绝`。

`TENDER_V2_MEMORY_WRITE = NO`、`T1B_MEMORY_WRITE = NO`。

---

## 18. Retrieval Contract

`searchMemoryClaims({ orgId, actor, subjectType?, subjectKey?, claimType?, status?, includeHistory?, query?, allowedAccessClasses?, asOf?, limit?, offset? })` —— 确定性检索：

- **结构化过滤优先**（本阶段不依赖 embedding）。
- 默认仅 `ACTIVE`；`includeHistory=true` 纳入 superseded/retracted（历史分析）。
- **Trust ordering**（§32）：HUMAN_CONFIRMED > SYSTEM_VERIFIED > AI_EXTRACTED > NEEDS_REVIEW，仅用于 ranking/display，绝不删除或改写低 trust claim。
- **Freshness**（§33）：同 trust 下 `capturedAt` 新者优先；`id` 稳定 tie-break（确定性）。
- `asOf` 时点有效性过滤（validFrom/validTo）。

**返回契约**（§31）：绝不只有 statement；每项含 `claimId` / subject / `claimType` / `claimNature` / `statement` / `structuredValue` / `confidence` / `verificationStatus` / `sourceType` / `status` / `accessClass` / `capturedAt` / `validFrom` / `validTo` / `supersedesClaimId` / `evidenceCount` / evidence 摘要（含 citation metadata）。`RETRIEVAL_CONTRACT = PASS`。

---

## 19. ProjectInsight Embedding Reuse Decision

`PROJECTINSIGHT_REUSE_DECISION = REUSE-AUDITED / SEMANTIC = DESIGN_ONLY`。

审计确认 `ProjectInsight.embedding` 是 `Json?` 死字段（零读者/零写者/无 ANN 索引）；「激活」它需 `Json? → Unsupported("vector(1536)")?` 破坏性列类型变更 + HNSW 索引 —— 违反本轮 additive-only 纪律。既有真 pgvector 6 列亦全无 ANN 索引（顺序扫描）。

因此 `RETRIEVAL_SEMANTIC_LAYER = DESIGN_ONLY`（§30 授权）：以适配器契约（`semantic-retrieval-design.ts::MemorySemanticSearchAdapter`，`available=false`）冻结未来接线方式（复用 `src/lib/ai/embedding.ts` 与 `org-knowledge.ts` 的 org-scoped 检索模板），**零运行时依赖**。`SECOND_VECTOR_INFRASTRUCTURE = NO`：不新建第二 pgvector pipeline / embedding worker / vector database；结构化确定性检索是本轮唯一可用检索路径。

---

## 20. Schema / Migration

`SCHEMA_CHANGE = ADDITIVE_ONLY`。migration `20260811040000_add_tender_t3_corporate_memory_foundation`：`CREATE TABLE Buyer / MemoryClaim / MemoryClaimEvidence` + 11 索引 + 1 FK（Evidence→Claim, RESTRICT）。**零 DROP / 零 rename / 零对既有表 ALTER / 零 backfill / 零生产数据变更**（`EXISTING_TABLE_ALTERATION = NONE`；无 `T3_EXISTING_SCHEMA_BLOCKER`、无 `DESTRUCTIVE_MIGRATION`）。

治理白名单同步登记两处（对齐 T2-M1 先例 commit `dcbfcf7`）：
- `scripts/verify-migration-history.ts`：`EXPECTED_ACTIVE` 追加 + `IMMUTABLE` sha256 = `ce7e975fd1e836143cc0e08b016815c15618aa85f1cbfc78c2babd3c2a12b3f4`。
- `scripts/check-release-safety.test.ts`：sorted 名称数组追加 + 断言标签更新。

**索引策略**（§48）：Buyer(`orgId,normalizedName`/`orgId,websiteDomain`/`orgId,status`)；MemoryClaim(`orgId,subjectType,subjectKey,status`/`orgId,claimType,status`/`orgId,status,capturedAt`/`supersedesClaimId`)；Evidence(`claimId`/`orgId,sourceType`/`orgId,archiveItemId`)。基于实际 query contract，未过度加。

**回滚 rehearsal**：additive 隔离特性使回滚 = 依赖序 DROP 三表（Evidence → Claim → Buyer），零对既有表影响；`migrate deploy` 幂等（重跑显示 up to date）。

---

## 21. Test Matrix

| 组 | 覆盖 | 结果 |
|---|---|---|
| Buyer（BUYER-01..05 + 附加） | 创建 canonical；强身份幂等；近似名不同实体不合并；同名异域 NEEDS_REVIEW；跨 org 独立；orgId spoof 拒绝；org_member 写拒绝 | 7/7 PASS |
| Claim（MEM-01..12 + AI-ban） | ACTIVE FACT+证据；无证据拒绝；USER_ENTRY NEEDS_REVIEW；AI_DERIVED 标 FACT 拒绝；ai 直写拒绝；supersede；retract 保史；原地改 statement 拒绝；治理字段可改；跨 org 读/supersede 拒绝；证据跨 org fail-closed；多证据保留；**MEM-11 无证据 confirm 拒绝 + MEM-12 补证据后 confirm** | 20/20 PASS |
| Retrieval（RET-01..08） | subject/claimType 过滤；ACTIVE 默认；includeHistory；trust 排序；freshness 排序；跨 org 零泄漏；证据含 citation | 9/9 PASS |
| **Access class（ACCESS-01..07，Final Remediation）** | member 不可读 RESTRICTED/CLIENT/VENDOR；caller 无法越权升权；admin 可读机密；可读 claim 的受限证据不泄漏（evidenceCount 仅计可见）；caller 可收窄 | 7/7 PASS |
| **T3 集成合计** | 隔离 Neon 分支 | **43/43 PASS** |
| T3 schema 契约（静态，无 DB） | 三表形状 + additive-only migration 断言 | 4/4 PASS |
| T3 纯逻辑（无 DB，可进 CI） | 归一/域名/排序比较器/校验器 + access 分级 server 权威/收窄不变式 | 13/13 PASS |

DB 级 rehearsal：Buyer 17 / MemoryClaim 28 / Evidence 17 列到位；Evidence→Claim `delete_rule=RESTRICT` 实测阻止删除带证据 claim；索引数匹配。

三套件注册：`scripts/test-all.sh`（schema-contract + pure + integration）；`scripts/test-ci-unit.sh`（schema-contract + pure，DB-free；integration 属 DB 平面不入 CI，对齐 t1b-integration）。

---

## 22. Isolated Neon

`ISOLATED_NEON = PASS`，`ISOLATED_NEON_BRANCHES_LEFT = 0`。

流程（§46，初版 + Final Remediation 各跑一次隔离分支）：从生产 project `polished-thunder-16018212` 开子分支（初版 `preview-t3-memory`；Remediation `preview-t3-remediation`）→ 处理生产快照已知问题 `20260805090000_marketing_economics`（表已物化但无 migration 记录，`migrate resolve --applied`，先核对其 CREATE TABLE / ADD COLUMN 目标均已存在，零漂移）→ `migrate deploy` 干净应用 T2-M1 + T3 → prisma validate/generate → 43 集成断言（BUYER + MEM-01..12 + RET + ACCESS-01..07）+ 租户隔离 + 检索 + RESTRICT rehearsal 全过 → 全量 test-all 回归 **216/216 通过, 0 失败**（含 V2/eval sibling lane 合并后的 7 个 tender 套件）→ 删除临时分支（LEFT=0）。**未做生产 migration**。

---

## 23. Known Gaps

1. `RETRIEVAL_SEMANTIC_LAYER = DESIGN_ONLY`：语义排序未接线；结构化确定性检索是本轮唯一路径（设计冻结见 §19）。
2. `searchMemoryClaims` 采用有界扫描（`SEARCH_SCAN_CAP=500`）+ 内存 trust 排序（DB 无法直接表达 trust 词序）；大规模分页语义留待检索 v2（记为债，非静默截断）。
3. Buyer merge = `NOT_IMPLEMENTED`（`mergeBuyers` 抛 `BUYER_MERGE_NOT_IMPLEMENTED`）；未来 merge contract 已在代码注释冻结。
4. `system` producer 未启用（`SYSTEM_WRITER_NOT_ENABLED`）；candidate/pending-review flow 本轮不实现（§27 明确不要求）。
5. 无 API route / 无 UI 顶层页面（§51 遵循）：写入仅 domain service，供测试/管理员/未来 internal tools。
6. Evidence `archiveItemId`/`documentId` 为逻辑引用无 FK：孤儿引用可能（记忆保留 ≠ 来源保留的刻意取舍）；写入时校验 org 归属，但来源后续被删不阻断记忆存活。

---

## 24. T4 Dependencies

T4 Tender Intelligence 在本 Foundation 上开展，前置依赖：

- `AwardRecord`（LEVEL 2 域表，T4 建）—— 本轮 `AWARD_RECORD_CREATED = NO`。
- Buyer merge contract 落地（低置信实体合并人工流）。
- Candidate / pending-review flow（AI 提议 claim 的受控入口）。
- 语义检索接线（`MemorySemanticSearchAdapter` 实现 + 单独 additive-safe 向量 migration 批准）。
- `TenderFingerprint` / `ProjectMemorySnapshot` 物化 Design Gate（本轮 derived-first，未建表）。

本 PR 不启动上述任何一项（`T4_INTELLIGENCE = NO`）。

---

## 25. Final Gate

| Gate | 状态 |
|---|---|
| CROSS_LANE_SCOPE_VIOLATION | 无（未改 tender-understanding / tender-eval / workforce runtime / T2 ProjectEvent·ProjectCost 实现） |
| T3_EXISTING_SCHEMA_BLOCKER | 无（additive-only） |
| MEMORY_MODEL_COLLISION | 无（三名全库零碰撞） |
| PROJECTINSIGHT_AUTHORITY_CONFLICT | 无（ProjectInsight 保留 L3；未夺权，未破坏性改列） |
| TENANT_ISOLATION_GAP | 无（orgId NN + fail-closed，实测） |
| MEMORY_RETENTION_GAP | 无（无破坏性 Project FK cascade；逻辑引用） |
| AI_AUTO_WRITE_REQUIRED_TO_PROCEED | 无（AI 写入硬禁，未阻塞交付） |
| DESTRUCTIVE_MIGRATION_REQUIRED | 无 |

`T3_FOUNDATION_STATUS = READY_FOR_FINAL_REVIEW`。保持 Draft，不 merge、不生产迁移、不 backfill、不 AI 自动写入、不启动 T4。等待人工 Final Review。

---

*Schema 契约与集成测试见 `src/lib/corporate-memory/__tests__/`；服务实现见 `src/lib/corporate-memory/`。*
