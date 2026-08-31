# QYANE SUPPLIER INTELLIGENCE — M1 ARCHITECTURE AUDIT

状态：PART A 架构审计（只读盘点，本轮不改代码）
日期：2026-08-31
审计基线：main @ 7094d165
任务书：`QYANE_SUPPLIER_INTELLIGENCE_M1` + `M1 ADDENDUM: SOCIAL SUPPLIER DISCOVERY`
配套：`docs/QYANE_SUPPLIER_INTELLIGENCE_M1_DESIGN.md`（PART B）

> 基线声明：原任务书全文未在仓库/会话记录归档，审计范围按 Addendum 复述的 M1 管线（Discover → Evaluate → Recommend → Save）圈定。详见 DESIGN 文档 §0。

---

## 1. 结论摘要

| 维度 | 现状 | 对 M1 的含义 |
|---|---|---|
| Supplier 主数据 | **已存在**（`Supplier` 表带 orgId，含 source/sourceDetail/AI 分类/评分/画册解析） | 不必新建 canonical Supplier，做「信号→关联」 |
| 来源模型 | 单值 `source` 枚举（已含 xiaohongshu/1688）+ 自由文本 `sourceDetail` | 与多来源 Sources 展示有结构差距；用信号表反推，不动主表 |
| 去重/合并 | **全域没有**（无 `@@unique([orgId,name])`、无模糊匹配、无 merge 端点） | Entity Resolution 全新建；两条高频建档路径正持续制造重复 |
| 中文搜索词生成 | **全仓库空白**（所有查询生成器只产英文/拉丁词） | `buildSupplierSearchBrief()` 是真正的新地基 |
| 外部搜索通道 | **已有且生产在用**：Tavily（tender-intel M2/M3/M4）+ Serper/Firecrawl（trade） | 层 B 发现复用，不新建抓取设施；三份重复 Tavily client 要统一 |
| 信任/验证词表 | 已有两套：企业记忆 canonical（AI_EXTRACTED/HUMAN_CONFIRMED/SYSTEM_VERIFIED/NEEDS_REVIEW）+ legacy（CONFIRMED/HIGH_CONFIDENCE/INFERRED/UNKNOWN）。**CLAIMED/OBSERVED/VERIFIED 全仓库不存在** | Addendum 词表在信号层新建，落记忆时映射 canonical（DESIGN §5.4） |
| Requirement Matching 先例 | `tender-compliance-memory`（指纹 + Jaccard 0.75 建议式匹配） | 供应商↔需求匹配直接沿用该引擎形态 |
| 企业记忆预留 | `SUPPLIER_FACT` claimType / `VENDOR` subjectType / `VENDOR_CONFIDENTIAL` accessClass **均已在词表** | Supplier Memory 落地零 schema 变更 |
| 社媒集成 | 抖音/视频号零代码；小红书/1688 仅惰性枚举值 | 全部从 Adapter 层新建 |
| 平台政策 | 小红书 robots 全站默认禁抓；抖音搜索结果页 Disallow；视频号封闭（§9） | 社媒自动发现只能「用户提交 + 搜索引擎间接」 |
| UI 落点 | `/projects/intelligence/supply-chain` 是刻意 `notEnabled` 占位页；情报室固定 8 模块含 `supply_chain`（供应链调查）；org 级 supply-chain slot「建设中」 | Supplier Intelligence 的天然 UI 家 |

---

## 2. 现有 Supplier 域盘点

### 2.1 数据模型（prisma/schema.prisma，「供应商询价」区 @ :2283）

- **`Supplier`**（:2287）：`orgId` 必填（FK→Organization）；`name`、联系方式、`category`、`region`、`status`(active/inactive)、`source`（注释枚举 `exhibition/referral/online/xiaohongshu/1688/cold_call/other`，canonical 词表在 src/lib/inquiry/types.ts:76）、`sourceDetail`（自由文本）、`website`、`tags`（逗号串，AI 生成）、`capabilities`（AI 能力画像散文）、`aiClassification Json`、`rating`/`ratingDetail Json`、画册四件套（`brochureUrl/ParseStatus/ParseResult/ParseWarning`）。索引 `[orgId,status]/[orgId,name]/[orgId,source]/[orgId,tags]`。**无任何 unique 约束**。
- **`ProjectSupplierLink`**（:2336）：项目↔供应商多对多；`role`(candidate/shortlisted/selected/rejected，词表 src/lib/bid-workflow/supplier-link-roles.ts)、`inquiryStatus`、`quoteStatus`、**`evidenceStatus`（default "missing"，全仓库唯一 evidenceStatus 字段，无 normalizer，词表松散）**、`sampleStatus`、`techMatch`（自由文本占位）。幂等键 `@@unique([projectId, supplierId])`。
- **`ProjectInquiry`**（:2735）+ **`InquiryItem`**（:2755，事实上的 SupplierQuote）：轮次询价与逐供应商报价，`@@unique([inquiryId, supplierId])`。两表**无 orgId**，租户经 project 派生。
- 松散引用（无 FK）：`QuoteCostLine.supplierId/supplierName`（:2909）、`QuoteCostImport.supplierName`（:2989）、`ProjectCost.supplierId`（:7428）、`TradeIntelligenceCase.supplierCandidates Json`（:3628）。
- **不存在**：`SupplierProduct`、独立 `SupplierQuote` 表、`SupplierPerformance` 表、任何 discovery/signal 类表。
- **性质判定**：`Supplier` 是可变 CRUD 业务表，**不是** canonical 身份实体——没有 `normalizedName`/`aliases`/`externalIdentifiers`/`NEEDS_REVIEW` 状态，可硬删。同域的 canonical 身份范本是 `Buyer`（§5.2）。

### 2.2 服务层 src/lib/supplier/

- `access.ts`：唯一租户门 `requireSupplierOrgAccess(user, supplierId)`（404/统一 403 防枚举）。
- `service.ts`：纯 CRUD，**内部不做租户过滤**（依赖路由先守门；`getSupplier`/`getSupplierHistory` 裸查）；`listSuppliers(orgId,…)` 带 stats 聚合；`deleteSupplier` 被 InquiryItem 引用即拒删。
- `classifier.ts`：AI 分类（14 主类目，Sunny Shutter 业务框定；`classifySupplier` 直接回写 tags/capabilities/aiClassification，无 org 校验）+ `parseSupplierFromText`（名片/微信记录/展会笔记→结构化，截 3000 字）。
- `brochure-parser.ts` / `brochure-types.ts`：PDF 画册→结构化字段 + 分析（certifications/targetMarkets 等），分段感知截断 8000 字。

### 2.3 API 面（src/app/api/suppliers/**）

`requireAuth` + `resolveRequestOrgIdForUser`（集合路由）或 `requireSupplierOrgAccess`（条目路由）——**早于** `requireTenantContext` 惯例（新路由推荐 src/lib/tenancy/context.ts:131）。路由：list/create、[id] GET/PATCH/DELETE、classify、history、batch-import（text 模式逐行建档；`classifyBatchAsync` 是未 await 漂浮 promise）、parse-brochure（仅 requireAuth + magic-byte 校验 + 私有 blob temp/brochures/）。

**去重现状**：全域无去重。仅有的幂等点：`ProjectSupplierLink@@unique` 竞态恢复（supplier-links/route.ts:83-125，恢复行三字段复核，测试 supplier-link-idempotency.test.ts）与 InquiryItem 409。**重复建档两条高频通道**：batch-import text 模式、询价页快速建档（add-supplier-dialog.tsx:68 只填 name+email 直接 POST）。

### 2.4 UI 面

- `/suppliers` 列表（客户端桶过滤=region/category/tags 正则启发）、supplier-table（source 彩色徽章）、详情页（联系信息/AI 分类/评分/合作历史四卡）。
- **Sources 展示现状**：单值 source 徽章 + `sourceDetail` 一行文本；**没有**复数来源列表与 provenance 记录；画册解析结果建档后不再展示。
- `SOURCE_LABELS` 在 4 个 UI 文件各复制一份（未 import canonical `SUPPLIER_SOURCES`）——漂移债 D5。
- 关联组件：add-supplier-dialog、supplier-recommend-card（AI 工作建议→建询价轮）、project-supplier-links（bid tab）、china-supplier-brief-panel（§2.5）。

### 2.5 china-supplier-brief（易误解，特别说明）

`src/lib/bid-workflow/china-supplier-brief.ts` 是**外发防泄漏简报**（把标书需求安全交给中国工厂的 13 段文本），三层敏感过滤（SENSITIVE_PATTERNS / AMOUNT_LIKE / `assertNoForbiddenLeak` throw），产物落 `ProjectGeneratedDocument`。T0 架构文档称其为「全库唯一 egress 分级器…任何档案外发必经此层」。**它不做供应商发现、不生成任何中文搜索词**——是 M1 管线的**下游邻居**（找到供应商之后发给对方的东西）。M1 本轮无外发动作；M2 起任何面向供应商的外发必须过此层。

### 2.6 supplier-performance

`src/lib/projects/supplier-performance.ts`：`getOrgSupplierPerformance(orgId)` 仅从 InquiryItem 聚合（take 2000 硬顶），replyRate/selectRate（分母=replies）/avgDeliveryDays/avgUnitPrice（**混币种未防护**）。唯一消费方 org/project-intelligence。= M1「历史供应商数据」输入的现成雏形，口径需修（债 D7）。

---

## 3. Tender 域可复用资产

### 3.1 Canonical Requirements（M1 匹配目标的来源）

- 模型族：`TenderAnalysisRun`(:2459) → `TenderExtractedRequirement`(:2628，`@@unique([analysisRunId, requirementCode])`)，兄弟表 Section/Fact/SourceRef/Deliverable/ClarificationQuestion/ChangeCandidate。
- **mandatory 语义分两层**：DB 层 `mandatory Boolean @default(true)` + `complianceStatus`（NOT_ASSESSED/PARTIAL/COMPLIANT/NON_COMPLIANT/NEEDS_CLARIFICATION）+ `reviewStatus`（AI_EXTRACTED/CONFIRMED/REJECTED）；V2 推理层（src/lib/tender-understanding/contract.ts）更细：`MandatoryV2 = true | false | "uncertain"`（:161，「uncertain 不得强行 true」）+ `mandatorySignal`（触发原文短语）+ 派生视图 `mandatoryRequirementIds`（:389）。v2-map.ts:214 落库时 `"uncertain"` 塌缩为 `false`——**供应商侧 Mandatory Gate 若只读 DB boolean 会漏掉 uncertain 项**，DESIGN §10.2 已按此设防。
- 21 个 REQUIREMENT_CATEGORIES（含 MANDATORY 作为*类目*而非强度旗标）；「评分制（RATED）」不是需求旗标，而是 fact slot（`evaluation_criteria` critical fact）。
- **全仓库没有 MANDATORY/RATED 枚举**——M1 供应商匹配消费的是 `mandatory===true`（+ V2 uncertain 告警），不发明新旗标。

### 3.2 合规矩阵：同名两物

- **(a) Bid-fit 矩阵**（人工五态标注 HAVE/BUILD/PARTNER/RFI/NO_GO）：存 `TenderAnalysisRun.summaryJson.bidFitMatrix`（bid-fit/route.ts:170），非独立表；映射到投标语言 complianceStatusFromFit（tender-bid-draft/contract.ts:25）。
- **(b) `src/lib/tender-compliance-memory/`（跨项目合规记忆）= 供应商↔需求匹配的最近先例**：`normalizeRequirementText`（NFKC+小写+去标点）→ `requirementFingerprint`（sha256[0:24]）→ 精确命中自动套用；`jaccard` 分词（拉丁按词/汉字按字）≥ **0.75** 出模糊建议（仅建议、一键采纳）；落记忆为 `claimType=COMPLIANCE_POSITION`、`subjectKey="req:"+fingerprint`。**M1 的 Requirement Matching 沿用此「精确自动/模糊建议/人工采纳」三段式**。

### 3.3 证据模型（M1 信任梯的挂点）

- **CLAIMED/OBSERVED/VERIFIED 在全仓库不存在**。现役词表：

| 概念 | 值 | 位置 |
|---|---|---|
| 验证态（canonical，T3 起） | AI_EXTRACTED / HUMAN_CONFIRMED / SYSTEM_VERIFIED / NEEDS_REVIEW | corporate-memory/types.ts:49 |
| 置信度（与验证态正交） | HIGH / MEDIUM / LOW | types.ts:45；tender-understanding/contract.ts:84 |
| legacy 置信 | CONFIRMED / HIGH_CONFIDENCE / INFERRED / UNKNOWN | BidIntelligenceFact 等 |
| 断言性质 | FACT / INTERPRETATION / INFERENCE | types.ts:41 |
| 陈述类型 | CONFIRMED_FACT / DOCUMENT_INTERPRETATION / AI_INFERENCE / RECOMMENDATION | TenderAnalysisFact.statementKind |

- 引文承载：`TenderAnalysisSourceRef`（统一引文表，五个可空 FK）+ 运行期 `evidenceRefSchema`（documentId+pageNumber+**逐字 snippet ≤600**）；非分页源用 `document-units.ts` 的 unit 序数（sheet/block）。
- **硬校验纪律**（M1 证据验证直接照搬）：`tender-understanding/verify.ts` —— snippet 必须逐字出现在被引页（NFKC+空白归一）、数值必须在证据内，否则按 `RejectReasonCode`（DOCUMENT_NOT_IN_SCOPE/PAGE_NOT_FOUND/SNIPPET_NOT_ON_PAGE/VALUE_NOT_IN_EVIDENCE/NO_SEMANTIC_SUPPORT）拒收不落库；market-pricing 同样丢弃 priceRaw 不在 snippet 里的基准价。
- 不可变档案：`TenderArchiveItem`（:7452，内容寻址 sha256、snapshotVersion、supersedes 单向、accessClass、`capturedAt` 刻意无 default）——社媒证据截图/存档的归宿。

---

## 4. 外部情报与搜索通道现状

### 4.1 门与默认零外呼

`TENDER_EXTERNAL_INTEL_ENABLED`（tender-intel/canadabuys.ts:18，**严格 `==="1"`**，与别处 envBool 家族不同）+ `TAVILY_API_KEY` 双门；双关即零 outbound、优雅降级带 note。

### 4.2 模块与 client 现状

M1 award 搜索（canadabuys open data）/ M2 web 搜索（**Tavily**）/ M2.5 AI 分析 / M3 标准追查 / M4 市场价基准 + 策略备忘录。**Tavily client 有三份独立复制**（websearch.ts:109 / referenced-standards.ts:75 / market-pricing.ts:59，同构：POST api.tavily.com/search、max_results 5、25s abort、catch→[]）——**M1 的 SearchEngineProvider 应统一三者，绝不加第四份**。trade 模块另用 Serper（searchGoogle）+ Firecrawl（scrapePage，research-fetch-provider.ts）。

### 4.3 查询生成与快照（buildSupplierSearchBrief 的先例）

- **确定性优先**：`deriveWebQueries`/`deriveAwardQueries`/`deriveMarketQueries` 纯函数、单测覆盖、上限 4–5 条。
- **LLM 两跳**（market-pricing.ts:144 `researchMarketPricingTwoHop`）：跳 1 versioned prompt（promptName/promptVersion）只产 `{searchTerms: string[≤5]}`——「仅检索词，无事实断言，无编造风险，允许猜品牌」；跳 2 与确定性词合并（上限 8）再过逐字 grounding。**这是 LLM 生成搜索词 + 可审计的范本**。
- **快照留档双先例**：`WebIntelResult.queries` 整体写入 `summaryJson.webIntel`（orchestrate.ts:519-533）；`TradeIntelligenceCase.searchQueries Json`（schema:3623）是唯一的查询快照一等 DB 列（intelligence-service.ts:555 与 evidence 同写）。M3/M4 只存 sources 不存 queries——已知缺口，M1 不复制。
- trade 的 `buildInvestigationQueries`（intelligence-service.ts:82，≤14 条：`${pn} Made in China`/`importer`/`wholesale distributor`/`supplier`/`site:${host} ${mpn}`）且候选已分桶（buyer/retailer/importer/**supplier**/contact）——反向找厂查询的现成词库形态。
- **全仓库所有查询生成器只产英文/拉丁词**；`1688` 只出现在 source 标签与 UI 词典，从未作为搜索目标。中文找厂搜索词=真正的新地基。

### 4.4 运行纪律（M1 直接继承的三条）

- **防静默 no-op**：`externalIntelStatus` 槽（orchestrate.ts:60，`{status: ran|skipped|error, trigger, reason, …}`）——此文件头记载了五条静默空跑路径烧钱丢结果的教训。M1 的每次发现运行必须写同型 `supplierIntelStatus`。
- **「真实 ≠ 相关」门**：`isAutoObserveRelevant`（≥2 条查询交叉命中或买方名归一相等才准 canonical 自动观察）。
- 限频 `isExternalIntelRateLimited`（60s 窗）；失败永不向调用方抛（status:"error" 落槽）。

### 4.5 情报室与 UI 落点

`BidIntelligenceRoom`（projectId @unique）+ `BidIntelligenceModule`（`@@unique([roomId, moduleKey])`，**固定 8 模块**含 `supply_chain` 供应链调查）+ `BidIntelligenceFact`（sourceType: tender_document/historical/ai_inference/manual；confidence: CONFIRMED/HIGH_CONFIDENCE/INFERRED/UNKNOWN + humanConfirmed 三件套）。`summaryJson` 槽位键 9 个（externalCandidates/webIntel/…/externalIntelStatus），`externalConfirmed` 仅人可写。**`/projects/intelligence/supply-chain` 页面是刻意 `notEnabled` 占位**；org 级 slot（org-award-intel-slots.tsx）supply-chain 亦「建设中」（备注依赖「M3 海关数据源」）。= Supplier Intelligence 的天然 UI 家。

---

## 5. Corporate Memory 层

### 5.1 写路径法则

`src/lib/corporate-memory/index.ts` 头部即法：「生产写入统一走此处…禁止业务代码直连 prisma.memoryClaim.* / prisma.buyer.*」，`AI_AUTO_MEMORY_WRITE = NO`、`MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY`。`assertWritableActorType`（claim-service.ts:117）对 `ai/ai:*/agent` 直接抛 `AI_AUTO_MEMORY_WRITE_DISABLED`，`system` 抛 `SYSTEM_WRITER_NOT_ENABLED`。相关不变量：`FACT_REQUIRES_EVIDENCE`、`AI_DERIVED_CANNOT_BE_FACT`、`SYSTEM_VERIFIED` 创建时拒绝。

### 5.2 模型与身份纪律（SupplierIdentity 的范本）

- `Buyer`（:7507）：`canonicalName` + `normalizedName`（**刻意非唯一**——同名不同实体可合法共存→NEEDS_REVIEW）+ `aliases String[]` + `externalIdentifiers Json` + `websiteDomain`；**永不按名字相似自动合并**，`mergeBuyers()` 直接抛 `BUYER_MERGE_NOT_IMPLEMENTED`。`normalizeBuyerName`/`normalizeWebsiteDomain`（normalize.ts）已导出可复用。
- `MemoryClaim`（:7540）：语义字段不可原地改（改=新 claim + supersedesClaimId 链）；`capturedAt` 无 default（生产者必填）。
- `MemoryClaimEvidence`（:7595）：证据语义字段 **IMMUTABLE create-only**；`claimId` 是三表唯一内部 FK（Restrict）。三表对 Project/User/Org 均**刻意无 FK**（记忆留存与业务对象生命周期解耦）。

### 5.3 词表预留（M1 零 schema 落点）

`MEMORY_CLAIM_TYPES` 已含 **`SUPPLIER_FACT`**（types.ts:33）；`MEMORY_SUBJECT_TYPES` 已含 **`VENDOR`**（subjectKey 允许 opaque，claim-service.ts:403）；`MEMORY_ACCESS_CLASSES` 已含 **`VENDOR_CONFIDENTIAL`**（成员不可见，admin 门槛）；`MEMORY_SOURCE_TYPES` 已含 `PUBLIC_WEB`/`VENDOR_QUOTE`/`USER_ENTRY`，且证据源类型**排除 `AI_DERIVED`**（「AI 产物不是独立证据」）。`MEMORY_TRUST_ORDER` 仅用于排序展示，禁止驱动自动删除。

### 5.4 对 M1 的两个既判点

1. **`assertSubjectInScope` 的 VENDOR 分支目前接受任意 opaque key**（不校验是否本 org 的 Supplier.id）——M1 保存路径落地时应收紧为镜像 BUYER 分支（DESIGN §11 采纳为 M1 决策 D-MEM-1）。
2. `Supplier` 非 canonical 身份实体（§2.1）——Buyer 式 `SupplierIdentity` 层是 additive 正路，但**不在 M1**（M1 用信号表 + linkedSupplierId 过渡，DESIGN §7.5）。
3. 语义检索 `MemorySemanticSearchAdapter` 冻结为 DESIGN_ONLY（available:false，调用即抛）——结构化确定性检索是唯一活路径；该「冻结契约先行」模式恰是 M1 落 Adapter 接口的方法论。

---

## 6. 横切约定（新模块接入清单）

### 6.1 导航/权限/i18n 五件套

navigation/registry.ts 加 NavigationItem（labelKey/moduleKey/requiredPlatformRoles/displayOrder…；新 group 还要 NAV_GROUP_META + NAV_SECTION_LABEL + MOBILE_TOP_CATEGORIES）→ tenancy/modules.ts `NAV_HREF_MODULES` → permissions-client.ts `MODULE_ROLES`（与 rbac/roles.ts、rbac/role-access.ts MODULE_VISIBILITY 三处 SYNC）→ i18n 三文件（messages.ts 接口→zh.ts→en.ts，缺实现即编译错）。

### 6.2 API 门与前端请求

新业务路由用 `requireTenantContext`（tenancy/context.ts:131）；项目挂靠资源用 `requireProjectReadAccess/WriteAccess`。`apiFetch` 的 `ORG_SCOPED_API_PREFIXES` 必须登记新前缀（如 `/api/supplier-intel/`），否则平台管理员身份下一律 400；org-scoped 下载不得用裸 `<a href>`。

### 6.3 Flag 惯例（canonical 四符号模式，全仓库 ~12 处复用）

每域一个 `flags.ts`：`envBool`/`envList`/`isXEnabledWithEnv(input, env)`（纯函数可注入）/`isXEnabled`/`describeXFlag`。命名 `<DOMAIN>_<FEATURE>_ENABLED` + `_ORG_ALLOWLIST`（主开关关=全关；allowlist 非空且不在内=关；空=不加限制），默认全 OFF。可抄的组合规则：**两道独立门**（tender-workforce flag 只开触发，job 创建另过 workforce 主门）；**fail-closed 不回落**（确定性计划失败必须失败而非回落 LLM，「正确回滚方式是关掉本 flag」）；**dark-merge 激活契约**（award-flags.ts 明文 OFF 路径返回什么、暗态写入如何幂等补偿）。注意：多数 TENDER_* flag 未记入 .env.example——新模块应补记。

### 6.4 Adapter / Provider 先例

- **`ChannelAdapter`**（mention-gateway/types.ts:138）：最干净形态——`readonly provider` + 判别式结果联合 `{ok:true,…}|{ok:false,code,…}` + 阶段化错误码；纪律「adapters normalize, they do not interpret」。
- **`MemorySemanticSearchAdapter`**（semantic-retrieval-design.ts:36）：「冻结契约、零运行时依赖」模式（`available:false` + 未接线即抛 + 未来约束写进 doc comment）——**M1 落 SupplierSourceAdapter/DiscoveryAdapter 接口先行的正确姿势**。
- **`LlmInvoker`**（tender-understanding/llm.ts:33）：函数型 adapter + `promptName/promptVersion`；所有 intel 模块接受可选 `invoker?` 注入测试。
- **注入缝惯例**：Tavily 函数统一 `env?: NodeJS.ProcessEnv` + `fetchImpl?: typeof fetch`；`AwardsDbClient`（awards.ts:109）DB client 注入。
- **幂等观察先例**：`createOrObserveAwardRecord`（awards.ts:242）——`@@unique([orgId, sourceType, sourceKey])` + 结果词表 `CREATED | ALREADY_OBSERVED | ATTACHED_EXISTING | NEEDS_REVIEW` + `possibleDuplicateOfId` 弱匹配存疑、永不自动合并。**Entity Resolution 的结果词表直接对齐此形态**。

### 6.5 迁移与枚举

additive-only + 登记 check-release-safety active 清单；本地 dev DATABASE_URL 指向生产同库（ep-super-field 受保护目标），迁移按 safe-migrate-deploy 流程。schema 惯例：**String + `///` 词表注释，不用 Prisma enum**（全库仅 OrgAccessMode 一个真 enum）。

---

## 7. Gap 分析与既有债

**M1 需要而不存在的**：

| Gap | 说明 | 先例可借 |
|---|---|---|
| G1 SupplierDiscoverySignal | 无任何 discovery/signal 表 | TradeIntelligenceCase 状态机形态 |
| G2 能力信号 + CLAIMED/OBSERVED/VERIFIED | `capabilities` 是 AI 散文；画册 certifications 无验证态 | canonical 验证词表映射（§3.3） |
| G3 Entity Resolution | 无去重/合并/关联判定 | Buyer 身份纪律 + createOrObserveAwardRecord 词表 |
| G4 中文 Search Brief 生成 | 全仓库空白 | 两跳 LLM + 查询快照双先例（§4.3） |
| G5 SupplierSourceAdapter/Provider | 无；社媒零代码 | ChannelAdapter + 冻结契约模式（§6.4） |
| G6 多来源 Sources 展示 | 单值 source 枚举装不下 | 信号表反推聚合 |
| G7 供应商侧 Matching→Gate→Score | `techMatch` 自由文本占位 | tender-compliance-memory 三段式（§3.2） |

**既有债（编码轮前置或绕开）**：

| 债 | 内容 | M1 态度 |
|---|---|---|
| D1 | Supplier 无 `@@unique([orgId,name])`，两条高频重复建档通道敞开 | 不加 unique（存量重复未清洗，加必炸）；在信号→关联层拦截，存量清洗出圈 |
| D2 | supplier/service.ts 无内部租户过滤（getSupplier/getSupplierHistory 裸查） | 新 supplier-intel service 全函数带 orgId 内部过滤，不复制 |
| D3 | batch-import 漂浮 promise（serverless 冻结即静默丢） | 不复制；异步动作入既有任务设施或同步 |
| D4 | suppliers API 旧鉴权模式 | 新路由一律 requireTenantContext |
| D5 | SOURCE_LABELS 四处复制漂移 | 扩来源枚举前先收敛 canonical（随 S1） |
| D6 | `ProjectSupplierLink.evidenceStatus` 无词表/normalizer | M1 定词表时顺带补 normalizer（不改默认值语义） |
| D7 | performance 混币种均值 + 2000 硬顶 | 评分引用前修口径或声明局限 |
| D8 | M3/M4 情报只存 sources 不存 queries | M1 不复制此缺口（快照全存） |
| D9 | `assertSubjectInScope` VENDOR 分支接受任意 opaque key | M1 保存路径收紧（D-MEM-1） |
| D10 | classifier 直接回写 Supplier（AI 写主数据无验证态） | M1 信任模型落地后回标 CLAIMED（S3 范围评估） |

**无硬前置**：D1–D10 均可绕开或随片清偿。

## 8. 与在飞工作线的冲突面

- 主工作区 branch `feature/sales-quote-cost-foundation` 与 vinyl 工艺单线：文件面与 supplier-intel **不相交**（涉 supplier 仅 QuoteCostLine.supplierId 松散引用）。
- Mention Gateway / Workforce / Tender 观察期各线：无共享写路径。M1 编码轮独立分支，无排序依赖。
- 唯一注意：`/projects/intelligence/supply-chain` 占位页与 org supply-chain slot 是 M1 的 UI 落点，激活前确认 tender 观察期没有并行改这两处的任务书。

## 9. 平台政策调研（Addendum §16 逐问回答）

一手证据：两平台 robots.txt 于 2026-08-31 实测抓取；API/生态结论来自公开资料检索（2026-08-31）。

### 9.1 Douyin / 抖音

| 问题 | 答案 |
|---|---|
| Official API? | 有开放平台，但面向**企业资质认证**开发者，接口以电商（商品搜索）与自有账号数据为主；**无面向第三方的通用内容搜索 API**。配额制（默认 1 万次/日量级，超出走商务） |
| Public search? | Web 端有搜索页，但 robots.txt 对白名单爬虫也明确 `Disallow: *general_search*`（搜索结果页禁抓）；无默认 `User-agent: *` 禁抓段（单页内容对未列名 UA 无 robots 层禁令，但受 ToS 与风控约束） |
| Login required? | 浏览单条视频/账号页基本无需登录；搜索与连续浏览触发风控/登录引导 |
| Rate limits? | 官方 API 配额制；web 端强风控（无公开数值） |
| Terms risk? | ToS 禁未授权抓取；中国司法实践下大规模抓取平台数据有《反不正当竞争法》风险，涉个人信息另有 PIPL 风险 |
| Third-party providers? | TikHub、Apify actors（SocialDataX 等）、国内商业数据商（蝉妈妈/新抖类，偏营销数据） |
| Browser automation feasibility? | 技术上可行但违反 M1 边界（登录态/验证码/风控对抗），**不采用** |
| Recommended M1 approach | 层 A 用户提交分享链解析 + 层 B 搜索引擎间接发现（`site:douyin.com` 类查询走既有 Tavily 通道）+ 层 C 手工录入；provider 接口预留，商业数据商 M2+ 尽调后评估 |

### 9.2 Xiaohongshu / 小红书

| 问题 | 答案 |
|---|---|
| Official API? | **无面向第三方的公开内容 API**（开放平台面向电商商家场景） |
| Public search? | robots.txt（实测）`User-agent: * Disallow: /` **全站默认禁抓**，白名单搜索引擎也仅放行 `/explore`、`/sitemap-notes-` 等有限入口；web 关键词搜索登录墙 |
| Login required? | 搜索是；部分笔记详情公开可见但风控激进 |
| Rate limits? | 无公开数值；业界公认反爬最激进的中文平台之一（签名/滑块/设备指纹） |
| Terms risk? | 同抖音，且 robots 明示禁抓使「善意访问」抗辩不成立 |
| Third-party providers? | Apify 多个 actor（关键词搜索类多需登录态 cookie——即违反 M1 边界）、国内商业数据商（千瓜/新红/灰豚，营销向） |
| Browser automation feasibility? | 违反 M1 边界，**不采用** |
| Recommended M1 approach | **以层 A 用户提交为主**（xhslink 分享链解析公开元数据）+ 层 C；层 B 覆盖率极有限（如实呈现空结果）；自动发现主力不放在小红书 |

### 9.3 WeChat Channels / 微信视频号

| 问题 | 答案 |
|---|---|
| Official API? | 无公开内容 API（官方接口面向号主/小店经营场景） |
| Public search? | 无 web 端公开搜索；内容基本不被搜索引擎索引 |
| Login required? | 内容消费在微信客户端内；分享链接（channels.weixin.qq.com / finder 链）仅受限 H5 场景 |
| Rate limits? | 不适用（无公开面） |
| Terms risk? | 腾讯生态对自动化访问历来最严；任何绕开客户端的批量获取都是高风险 |
| Third-party providers? | 存在解析分享链的第三方服务（TikHub/Apify 类）——自身处灰色地带，M1 不接 |
| Browser automation feasibility? | 不可行且禁止 |
| Recommended M1 approach | **USER_ASSISTED_DISCOVERY 唯一路径**（Addendum §9 原文）：分享文案/链接/截图人工带回 → 解析建信号。不作为 M1 依赖 |

### 9.4 横向结论

1. 三平台**都不存在**「合规 + 免登录 + 可编程」的官方内容搜索面 → Addendum §8 的 M1 边界不仅是纪律，也是唯一可行解。
2. 层 B 的唯一合规形态 = **消费通用搜索引擎的既有索引**（我们已为 Tender 外部情报付费接入的 Tavily 通道），不自建对平台的直接爬虫。
3. 商业数据商是未来扩展正路，但多数抖音/小红书数据商的采集方式自身合规性存疑，接入前必须 provider 尽调（DESIGN §8.4 策略门即为此设计）。

## 10. 审计键值输出

```text
SUPPLIER_DOMAIN_EXISTS = YES（Supplier/ProjectSupplierLink/ProjectInquiry/InquiryItem；Supplier 带 orgId 但非 canonical 身份实体）
DEDUPE_OR_MERGE_EXISTS = NO（全域无；两条高频重复建档通道敞开）
SEARCH_BRIEF_PIPELINE_EXISTS = NO（中文找厂搜索词全仓库空白；china-supplier-brief 是 egress 分级器非发现工具）
EXTERNAL_SEARCH_CHANNEL = LIVE（Tavily×3 份重复 client 待统一 + trade 侧 Serper/Firecrawl；默认零外呼双门）
TRUST_VOCAB_PRECEDENT = canonical AI_EXTRACTED/HUMAN_CONFIRMED/SYSTEM_VERIFIED/NEEDS_REVIEW + legacy CONFIRMED/HIGH_CONFIDENCE/INFERRED/UNKNOWN；CLAIMED/OBSERVED/VERIFIED 不存在（信号层新建 + 映射）
REQUIREMENT_MATCHING_PRECEDENT = tender-compliance-memory（fingerprint 精确自动 / Jaccard≥0.75 建议 / 人工采纳）
MEMORY_RESERVED_SLOTS = SUPPLIER_FACT + VENDOR + VENDOR_CONFIDENTIAL（零 schema 落点；VENDOR scope 校验需收紧 D9）
ENTITY_RESOLUTION_PRECEDENT = Buyer 身份纪律（normalizedName 非唯一/aliases/externalIdentifiers/永不自动合并）+ createOrObserveAwardRecord 结果词表
UI_HOME = /projects/intelligence/supply-chain 占位页 + 情报室 supply_chain 模块 + org slot「建设中」
SOCIAL_CODE_FOOTPRINT = ZERO（抖音/视频号零代码；xiaohongshu/1688 仅惰性 source 枚举值）
PLATFORM_POLICY_EVIDENCE = 小红书 robots 全站默认禁抓（实测）/ 抖音搜索结果页 Disallow（实测）/ 视频号封闭生态
M1_SCHEMA_FOOTPRINT_ESTIMATE = 2 张新表（SupplierDiscoverySignal / SupplierCapabilitySignal），additive-only
EXISTING_DEBT_BLOCKING_M1 = NONE_HARD（D1–D10 均可绕开或随片清偿）
```
