# QYANE SUPPLIER INTELLIGENCE — M1 DESIGN

状态：PART B 设计文档（DESIGN_ONLY，本轮不编码）
日期：2026-08-31
基线：main @ 7094d165
任务书：`QYANE_SUPPLIER_INTELLIGENCE_M1` + `M1 ADDENDUM: SOCIAL SUPPLIER DISCOVERY`
配套：`docs/QYANE_SUPPLIER_INTELLIGENCE_M1_ARCHITECTURE_AUDIT.md`（PART A）

---

## 0. 基线声明（必须先读）

原任务书 `QYANE_SUPPLIER_INTELLIGENCE_M1` 的全文**未在本仓库或任何本地会话记录中归档**。本轮输入只有 Addendum 全文。Addendum 第 10 节完整复述了 M1 管线、第 21 节复述了交付物与核心原则，因此本设计按以下方式重建基线：

- **Addendum 原文照抄**（视为冻结口径）：M1 = Discover → Evaluate → Recommend → Save；不自动询价、不自动采购、不自动下单；整体数据流（§2）；SupplierDiscoverySignal / SupplierCapabilitySignal 字段（§4）；CLAIMED/OBSERVED/VERIFIED 信任级；Entity Resolution 不足置信必须 NEEDS_HUMAN_REVIEW；Social 不直接影响最终评分；DoD 附加项 20–30。
- **由复述推断**（若与原任务书冲突，以原任务书为准，并在下一轮修订本文档）：`SupplierSourceAdapter` / `SupplierSearchBrief` / `buildSupplierSearchBrief()` 是原方案定义的抽象（当前代码中不存在，见 PART A 审计）；Mandatory Gate / Supplier Score / Recommendation 的具体判定细节；基线 DoD 第 1–19 项的逐条原文。

---

## 1. M1 目标与硬边界

**目标**：让 Qyane 能够从传统 B2B 平台、公开网络以及中国社交内容中发现潜在制造商，并通过实体解析、证据验证、Tender Requirement Matching 和历史供应商数据，把潜在工厂逐步提升为可信赖的 Supplier Candidate。

**M1 只做**：Discover → Evaluate → Recommend → Save。

**M1 硬禁**（写进代码评审 checklist，不是口头约定）：

| # | 禁止项 | 落点 |
|---|---|---|
| H1 | 自动询价 / 自动私信供应商 | 不存在任何向供应商发消息的代码路径 |
| H2 | 自动采购 / 自动下单 | 同上 |
| H3 | 绕过登录 / 验证码 / 逆向平台 API / 账号自动化 | Adapter 层白名单式实现（§8），禁直连平台私有接口 |
| H4 | 大规模 scraping / 违反 robots 与 ToS | Provider 层策略门（§8.4），robots 一手证据见 PART A §9 |
| H5 | Social 证据自动升级为 VERIFIED | 信任模型硬规则（§5.3-R1） |
| H6 | Entity 自动合并 | 置信不足一律 NEEDS_HUMAN_REVIEW（§7.4） |
| H7 | 发现结果自动写入长期 Supplier/Corporate Memory | SAVE_TO_SUPPLIER_MEMORY 仅人工动作（§11） |
| H8 | Social 信号绕过 Mandatory Gate | 门只认 VERIFIED 证据（§10.2） |

---

## 2. 总体数据流（Addendum §10 冻结）

```text
Tender
  ↓
Canonical Requirements
  ↓
Supplier Search Brief          ← buildSupplierSearchBrief()，快照留档
  ↓
Search Planner
  ↓
┌─────────────────────────────┐
│ Qyane Supplier Memory        │  ← 历史供应商（已有 Supplier 域）
│ Commerce Sources             │  ← 1688 / Alibaba / 官网
│ Open Web                     │  ← 搜索引擎（复用既有外部情报通道）
│ Social Discovery             │  ← 抖音 / 小红书 / 视频号（本 Addendum）
└─────────────────────────────┘
  ↓
Supplier Discovery Signals     ← 统一落 SupplierDiscoverySignal，不直接建 Supplier
  ↓
Entity Resolution              ← resolveSupplierEntity()，不足置信 NEEDS_HUMAN_REVIEW
  ↓
Canonical Supplier             ← 人工确认后才产生/关联
  ↓
Supplier Product
  ↓
Requirement Matching
  ↓
Evidence Verification          ← 只有独立证据能产生 VERIFIED
  ↓
Mandatory Gate                 ← FAIL ⇒ NOT_ELIGIBLE，任何来源置信不可豁免
  ↓
Supplier Score
  ↓
Recommendation                 ← PRIMARY / NEEDS_VERIFICATION / NOT_ELIGIBLE
```

关键不变量：**Social Discovery 只进入管线最上游（Signals），永不短路到下游任何一级。**

---

## 3. 与现状的集成点（来自 PART A 审计）

| M1 环节 | 复用/对接的现状 | 方式 |
|---|---|---|
| Canonical Requirements | `TenderExtractedRequirement`（mandatory Boolean + V2 `MandatoryV2=true\|false\|"uncertain"` + `mandatoryRequirementIds`） | 只读消费，不发明新旗标（uncertain 处理见 §10.2） |
| Requirement Matching | `src/lib/tender-compliance-memory/`（fingerprint 精确自动 / Jaccard≥0.75 建议 / 人工采纳三段式） | 沿用引擎形态，主体从「我方合规立场」换成「供应商能力/证据」 |
| 层 B 搜索通道 | tender-intel Tavily 通道（`TENDER_EXTERNAL_INTEL_ENABLED` + `TAVILY_API_KEY` 双门，默认零外呼） | `SearchEngineProvider` 包一层并**统一现存三份重复 Tavily client**，不加第四份 |
| 查询快照 | `WebIntelResult.queries` 落 summaryJson 先例 + `TradeIntelligenceCase.searchQueries Json` 一等列先例 | 发现运行记录存 `briefSnapshotJson` + `queries[]` + promptName/promptVersion |
| LLM 生成搜索词 | `researchMarketPricingTwoHop` 跳 1（versioned prompt，只产检索词无事实断言） | `buildSupplierSearchBrief()` 同构 |
| 运行状态 | `externalIntelStatus` 防静默 no-op 槽（ran/skipped/error + reason） | 每次发现运行写同型 `supplierIntelStatus` |
| 证据验证 | `tender-understanding/verify.ts` 逐字 snippet + RejectReasonCode 拒收词表；`TenderArchiveItem` 内容寻址档案 | 社媒证据引用 contentUrl+快照文本；存档物走 ArchiveItem |
| Supplier 主数据 | `Supplier`（带 orgId，非 canonical 身份实体）+ `ProjectSupplierLink` | 信号经 `linkedSupplierId` 关联，不动主表结构 |
| Supplier Memory | corporate-memory 词表**已预留** `SUPPLIER_FACT`/`VENDOR`/`VENDOR_CONFIDENTIAL`；AI 自动写硬禁 | §11，零 schema 变更 |
| Entity 身份纪律 | `Buyer`（normalizedName 刻意非唯一/aliases/externalIdentifiers/`mergeBuyers` 抛 NOT_IMPLEMENTED）+ `createOrObserveAwardRecord` 结果词表 | §7 全面对齐；复用 `normalizeBuyerName`/`normalizeWebsiteDomain` |
| UI 落点 | `/projects/intelligence/supply-chain` 刻意 `notEnabled` 占位页 + 情报室固定 8 模块之 `supply_chain` + org 级 slot「建设中」 | M1 UI 的家；激活即替换占位 |
| Adapter 落地方式 | `ChannelAdapter` 形态 + `MemorySemanticSearchAdapter`「冻结契约先行」模式 | §8 |
| Flag | canonical 四符号模式（envBool/envList/isXEnabledWithEnv/describeXFlag） | `SUPPLIER_INTEL_ENABLED` + `SUPPLIER_INTEL_ORG_ALLOWLIST`（§12） |
| 外发红线 | `china-supplier-brief` = 全库唯一 egress 分级器 | M1 无外发；M2 起任何面向供应商的外发必经此层 |

---

## 4. 数据模型设计

### 4.1 SupplierDiscoverySignal（新表，M1 核心）

Addendum §3 字段为准，补齐本仓库多租户与审计惯例：

```prisma
model SupplierDiscoverySignal {
  id               String   @id @default(cuid())
  orgId            String                    // 第一天就有（吸取 BlindsOrder 缺 orgId 的教训）
  projectId        String?                   // 可挂到具体项目/投标
  tenderId         String?                   // 可挂到具体 Tender
  searchRunId      String?                   // 归属哪次发现运行（审计链）

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

  status           String   @default("NEW")  // NEW | REVIEWED | LINKED | REJECTED
  linkedSupplierId String?
  resolutionJson   Json?                     // 最近一次 SupplierEntityResolutionResult 快照
  reviewedByUserId String?
  reviewedAt       DateTime?

  discoveredAt     DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([orgId, status])
  @@index([orgId, platform])
  @@index([orgId, linkedSupplierId])
  @@index([orgId, tenderId])
}
```

设计取舍：

- **枚举用 String + TS 常量**，不用 Prisma enum（沿用仓库既有惯例：域状态零 schema 演进成本）。
- `sourceOrigin` 与 `platform` 分开：同是抖音内容，可能来自用户粘贴（USER_SUBMITTED）也可能来自搜索引擎发现（PUBLIC_WEB）或未来的商业数据商（PROVIDER）。信任与合规策略按 `sourceOrigin` 走，展示按 `platform` 走。
- `resolutionJson` 让实体解析结果随信号留档，`SupplierEntityResolutionResult` 本身**不建表**（运行期 DTO，见 §7），M1 新表控制在 2 张。
- 删除语义：REJECTED 是终态之一，不物理删（保留「看过并否决」的记忆，避免同一账号反复浮上来）。

### 4.2 SupplierCapabilitySignal（新表）

```prisma
model SupplierCapabilitySignal {
  id                 String   @id @default(cuid())
  orgId              String                    // 冗余落一份，跨表查询不用 join 才能过滤租户
  discoverySignalId  String
  type               String                    // 见 §4.3 目录
  value              String?
  evidenceStatus     String                    // CLAIMED | OBSERVED | VERIFIED | UNKNOWN
  confidence         Float?                    // 0..1
  explanation        String?                   // 为什么这么判（人写或 AI 写，AI 写要标注）
  extractedBy        String                    // HUMAN | AI_ASSISTED
  createdAt          DateTime @default(now())

  @@index([orgId, discoverySignalId])
  @@index([orgId, type, evidenceStatus])
}
```

硬规则（应用层强制，测试覆盖）：

- `evidenceStatus = VERIFIED` **不允许**由任何 social/discovery 写路径产生。VERIFIED 只能由 Evidence Verification 路径（证书文件、官方登记库、独立证据）+ 人工确认写入，且写入点是 Supplier 侧的验证记录，不是 capability signal——capability signal 里的 VERIFIED 仅允许由「已验证事实回填」产生（例如已核验 UL 证书后，把对应 claim 标记为已被独立验证覆盖）。
- `confidence` 只影响 Discovery Confidence（§9），不进 Supplier Score。

### 4.3 Capability 类型目录（Addendum §4 起始集，可扩展）

```text
FACTORY_FLOOR / CNC_CAPABILITY / LASER_CUTTING / INJECTION_MOLDING /
POWDER_COATING / ASSEMBLY_LINE / CUSTOM_TOOLING / OEM_SUPPORT / ODM_SUPPORT /
EXPORT_PACKAGING / TESTING_CAPABILITY / WAREHOUSE / HIGH_VOLUME_PRODUCTION /
SMALL_BATCH_PRODUCTION / CUSTOM_PACKAGING / OVERSEAS_EXPORT / CANADA_EXPORT
```

目录以 TS 常量表落地（fail-closed：未知 type 拒收并要求先扩目录——沿用布纱比目录 fail-closed 的既有做法），不是自由文本。

### 4.4 Supplier 侧的最小增量

M1 **不重构** Supplier 主表。canonical Supplier 与来源的关系全部通过 `SupplierDiscoverySignal.linkedSupplierId` 反向推导（Sources 展示 = 按 supplier 聚合其 LINKED 信号的 platform 去重 + Supplier 自身已有的官网/1688 字段）。独立的 `SupplierSourceProfile` 表留待 M2（当需要给来源账号记「验证过归属」时再建）。

### 4.5 SupplierSearchBrief 与快照

`SupplierSearchBrief` 保持为运行期结构（原方案抽象），但**生成结果必须留档**：M1 以 `searchRunId` + 落在发现运行记录里的 `briefSnapshotJson` 满足 auditability（生成的搜索词、生成时的 requirements 输入、LLM 模型与提示版本）。字段扩展（Addendum §6/§15）：

```ts
interface SupplierSearchBrief {
  // —— 原方案已有（重建）——
  tenderId?: string
  productKeywords: string[]
  technicalRequirements: string[]
  mandatoryRequirements: string[]
  searchTermsEn: string[]
  commercialSearchTermsZh: string[]     // 1688/官网找厂词
  // —— Addendum 新增 ——
  socialSearchTermsZh: string[]         // 平台内容搜索词
  capabilitySearchTermsZh: string[]     // 能力词：CNC铝壳加工 / 钣金喷粉厂家 / IP65外壳定制
  scenarioSearchTermsZh: string[]       // 场景词：工厂实拍 / 来图加工 / 支持打样 / 小批量定制 / 源头工厂
}
```

生成器 `buildSupplierSearchBrief()`：**确定性生成优先 + LLM 两跳扩展**（照搬 `researchMarketPricingTwoHop` 的跳 1 形态——versioned prompt 只产检索词、无事实断言、允许猜测，跳 2 合并确定性词并封顶）；LLM 不可用时确定性模板兜底（产品词直译仍能跑）。产品词、能力词、场景词**分组输出**，Search Planner 组合使用（产品词×场景词、能力词×地域词），不允许只搜产品名。每次发现运行同时落 `supplierIntelStatus`（ran/skipped/error + reason，继承 externalIntelStatus 防静默 no-op 纪律）。

---

## 5. Platform Trust Model（社媒信任模型）

### 5.1 信任梯（冻结）

```text
DISCOVERY SIGNAL   内容存在本身（一条视频/笔记/账号）
      ↓ 提取
CLAIM              内容里「说」的：文案写"拥有UL认证"/"出口加拿大" → CLAIMED
OBSERVATION        内容里「看到」的：车间画面里有 CNC → OBSERVED
      ↓ 独立证据（证书文件 / 官方登记库 / 第三方报告）+ 人工确认
VERIFIED EVIDENCE  才是 VERIFIED
```

### 5.2 判定口径

| 情形 | 判 | 不许判 |
|---|---|---|
| 视频文案写「拥有 UL 认证」 | CLAIMED | VERIFIED / UL_VERIFIED |
| 画面中明显出现 CNC 机床 | OBSERVED（CNC_CAPABILITY） | FACTORY_VERIFIED |
| 账号自称「源头工厂」 | CLAIMED | OBSERVED |
| 车间实拍 + 连续多条同场景内容 | OBSERVED + 较高 confidence | VERIFIED |
| 上传了营业执照并对过国家企业信用信息公示系统 | VERIFIED（identity） | —— |
| 证书扫描件 + 发证机构可查库核验 | VERIFIED（certification） | —— |

### 5.3 硬规则

- **R1（H5 落点）**：social 写路径的 `evidenceStatus` 值域 = {CLAIMED, OBSERVED, UNKNOWN}。VERIFIED 不在其值域内——用类型收窄（TS 层）+ 写入校验（service 层）双保险，并有测试断言（§13-T1）。
- **R2**：OBSERVED 需要标注 `extractedBy`。AI 视觉/文本抽取的 OBSERVED 上限 confidence 0.8，且 UI 必须展示「AI 标注」。
- **R3**：VERIFIED 的唯一写路径是 Evidence Verification（独立证据 + 人工确认），复用企业记忆「AI 不得自动写入」纪律。
- **R4**：信任级只升不降的自动迁移不存在；任何升级都是新记录（append），保留判定历史。

### 5.4 与既有验证词表的映射（信号层 ↔ 记忆层）

CLAIMED/OBSERVED/VERIFIED 是 Addendum 冻结的**信号层**词表（DoD #22），全仓库此前不存在；企业记忆已有 canonical 验证词表。两层各说各话，桥在保存动作上：

| 信号层（新表） | 落 Corporate Memory 时（§11） |
|---|---|
| CLAIMED | `claimNature=INTERPRETATION`（供应商自述），`verificationStatus=AI_EXTRACTED` 或 `NEEDS_REVIEW`，`sourceType=PUBLIC_WEB`/`USER_ENTRY` |
| OBSERVED | `claimNature=INTERPRETATION`（内容中可见），同上；`statement` 写明「内容中观察到」 |
| VERIFIED | `claimNature=FACT` + 独立证据（`MemoryClaimEvidence`，源类型**不得是 AI_DERIVED**——既有不变量「AI 产物不是独立证据」）+ `verificationStatus=HUMAN_CONFIRMED` |
| UNKNOWN | 不入记忆 |

`confidence`（0..1，信号层）与记忆层 HIGH/MEDIUM/LOW 正交，保存时按阈值折算并把原值留在 metadata。

---

## 6. Social Discovery 三平台策略（M1）

平台政策一手调研证据与风险矩阵见 PART A §9。此处只给结论性策略。

### 6.1 通用分层（所有平台一致）

```text
M1 层 A：USER_SUBMITTED —— 用户粘贴链接/分享文案 → 解析 → SupplierDiscoverySignal（三平台全支持，主路径）
M1 层 B：PUBLIC_WEB    —— 经通用搜索引擎（复用既有外部情报搜索通道）间接发现平台上可公开索引的页面（能力视平台而定）
M1 层 C：MANUAL_ENTRY  —— 采购人员手工记录（表单直建信号）
未来层 D：PROVIDER     —— 商业数据商（TikHub / Apify / 蝉妈妈类），仅接口预留，M1 不接
```

**M1 不做**：直连平台私有接口、登录态自动化、验证码处理、批量抓取、绕过 robots/ToS（Addendum §8 原文边界）。

### 6.2 DOUYIN_STRATEGY

- 官方开放平台 API 面向企业资质开发者且以电商/自有账号数据为主，**无面向第三方的通用内容搜索 API** → M1 不接官方 API。
- robots.txt（2026-08-31 实测）：无 `User-agent: *` 默认禁抓，但 `*general_search*` 搜索结果页对白名单爬虫也明确 Disallow → **任何形态的搜索结果页抓取都不做**；单条视频/账号页由通用搜索引擎已索引的，走层 B 间接获得（我们消费搜索引擎结果，不自建爬虫）。
- M1 支持：层 A（v.douyin.com / www.douyin.com 分享链解析：账号名、标题、文案、发布时间，取不到的字段留空不猜）+ 层 B（搜索词形如 `site:douyin.com 铝合金外壳 源头工厂`）+ 层 C。
- 未来层 D：TikHub / Apify 类 provider 挂 `SearchProvider` 同型接口后替换，业务层零改动。

### 6.3 XIAOHONGSHU_STRATEGY

- **无官方公开内容 API**；web 端关键词搜索登录墙；风控激进。robots.txt（2026-08-31 实测）：`User-agent: * Disallow: /` **全站默认禁抓** → M1 对小红书**不做任何自建直抓**，层 B 也仅限消费通用搜索引擎已合法索引的入口（覆盖率有限，如实呈现，不造假数据）。
- M1 支持：层 A（xhslink.com / xiaohongshu.com 分享链解析，公开可见的元数据尽力提取，登录墙内内容不碰）+ 层 C。
- 定位：小红书在 M1 是「用户带回来的线索池」，不是自动发现主力。

### 6.4 WECHAT_CHANNELS_STRATEGY

- 封闭生态：无公开 API、内容基本不被搜索引擎索引、分享链接仅限受限 H5 场景 → **M1 不作为依赖，无层 B**。
- 唯一路径 = `USER_ASSISTED_DISCOVERY`（Addendum §9 原文）：采购人员在微信里看到工厂视频 → 把分享文案/链接/截图交给 Qyane → 解析出 account / company / product / location / contact clue / capability / claimed certifications → 建 SupplierDiscoverySignal（contentType=USER_SUBMITTED）→ 走实体解析。
- 截图/视频媒体理解（Addendum §8-C）标 **M1_OPTIONAL**：纯文本粘贴先行，媒体识别列入后续增量。

---

## 7. Entity Resolution 设计

### 7.1 问题定义

同一家工厂可能同时以下列身份出现：抖音昵称「佛山办公椅老周」、小红书「XX家具源头工厂」、1688「佛山市XX家具有限公司」、官网 xxfurniture.cn。系统要判断它们是否同一 canonical Supplier。

### 7.2 抽象

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

### 7.3 匹配键优先级（强 → 弱）

1. 统一社会信用代码（等值即 MATCHED）
2. 已归档的 accountUrl / 官网域名精确匹配（同 org 内此前 LINKED 过）
3. 法定名称规范化后精确匹配（去「市/省/有限公司/厂」等修饰的 canonical form）
4. 电话/微信号等联系方式等值
5. 名称模糊相似 + 地域 + 品类共现（只允许产生候选，**永不单独 MATCHED**）

### 7.4 硬规则

- 阈值：`confidence ≥ 0.9` 且命中键 1–4 之一 → MATCHED（仅做预填；M1 全部 LINKED 动作都是人工在 inbox 里点确认的）；`0.5–0.9` → NEEDS_HUMAN_REVIEW（展示候选与冲突）；`< 0.5` → NO_MATCH（引导新建候选）。
- **两个名字相似的企业不得自动合并**（§13-T2 直接断言）。M1 甚至不做「合并」——只做「信号 → 既有 Supplier 关联」或「新建候选」，Supplier 与 Supplier 的合并工具完全出圈（与 `mergeBuyers()` 抛 `BUYER_MERGE_NOT_IMPLEMENTED` 同一姿态）。
- 名称归一复用既有 `normalizeBuyerName` / `normalizeWebsiteDomain`（corporate-memory/normalize.ts 已导出）；归一名**等值也不算强键**（Buyer 纪律：同 normalizedName 不同实体可合法共存）。
- 解析结果快照落 `resolutionJson`，人工改判也 append 记录。

### 7.5 与 canonical 身份层的关系（M2 议题，先记不做）

`Supplier` 是可变 CRUD 表而非 canonical 身份实体（无 normalizedName/aliases/externalIdentifiers）。长期正路是 Buyer 式 `SupplierIdentity` additive 层；M1 用「信号表 + linkedSupplierId + resolutionJson」过渡，把身份证据先积累起来，M2 再决定是否物化身份层。此取舍与 audit §5.4 第 2 点互为印证。

---

## 8. Adapter / Provider 架构

### 8.1 分层（Addendum §17 冻结）

```text
Platform（业务概念：DOUYIN / XIAOHONGSHU / …）
   ↓
Discovery Adapter（平台语义：怎么把该平台内容变成 Signal）
   ↓
Provider（获取手段：搜索引擎 / 商业数据商 / 用户提交解析器）
```

上层业务只依赖 Adapter 接口；Provider 可替换（今天 SearchEngineProvider，明天 CommercialProvider），Adapter 不得与某一家 provider 强绑定。

### 8.2 接口

```ts
// 原方案已有抽象（重建），M1 起统一：
interface SupplierSourceAdapter {
  readonly source: string
  fetchCandidates(brief: SupplierSearchBrief, opts?): Promise<SupplierDiscoverySignal[]>
}

// Addendum §7 新增：
interface SupplierDiscoveryAdapter {
  readonly platform: string
  discover(brief: SupplierSearchBrief, options?: DiscoveryOptions): Promise<SupplierDiscoverySignal[]>
  parseUserSubmission?(input: { url?: string; rawText?: string }): Promise<SupplierDiscoverySignal | null>
}
```

M1 实现清单：

| Adapter | discover() | parseUserSubmission() |
|---|---|---|
| DouyinSupplierDiscoveryAdapter | 层 B（SearchEngineProvider） | 层 A ✓ |
| XiaohongshuSupplierDiscoveryAdapter | 层 B（覆盖率受限，如实返回空） | 层 A ✓ |
| WeChatChannelsDiscoveryAdapter | 无（返回空 + 说明） | 层 A ✓（分享文案解析） |
| OpenWebSupplierAdapter | 层 B | —— |
| ManualEntryAdapter | —— | 层 C ✓ |

### 8.3 Provider 抽象

```ts
interface DiscoveryProvider {
  readonly providerId: string          // e.g. "search-engine:tavily" / "commercial:tikhub"
  readonly available: boolean          // 冻结契约模式：未接线=false，调用即抛
  search(query: string, opts): Promise<ProviderResult[]>
}
```

第一个实现 `SearchEngineProvider` = 把 tender-intel 现存**三份重复 Tavily client** 统一收进来（websearch.ts / referenced-standards.ts / market-pricing.ts 同构复制——M1 是统一时机，绝不加第四份）；注入缝沿用既有惯例（`env?: NodeJS.ProcessEnv` + `fetchImpl?: typeof fetch`）。商业数据商（Apify / Firecrawl / TikHub / 蝉妈妈类）为未来第二实现，接入前必过 §8.4 策略门。

**接口落地方式**：照 `MemorySemanticSearchAdapter` 的「冻结契约先行」模式——M1 编码首片先落接口 + `available:false` 的占位实现 + doc comment 写明未来约束，业务层即可按最终形态写，实现随片接线。结果类型用 `ChannelAdapter` 式判别联合（`{ok:true, signals} | {ok:false, code, message}`），adapter 只归一不解读。

### 8.4 Provider 策略门（合规 fail-closed）

每个 Provider 注册时声明：`respectsRobots` / `requiresPlatformLogin` / `dataLicense`。运行时策略：`requiresPlatformLogin=true` 的 provider 在 M1 一律拒绝启用；未声明者视为不合规（fail-closed）。这是 H3/H4 的机制化落点。

---

## 9. Discovery Confidence（与评分隔离）

按 Addendum §12，单独维护，不混入 total supplier score：

```ts
interface DiscoveryConfidence {
  entityIdentity: number | "UNKNOWN"        // 例 0.92
  factoryCapability: number | "UNKNOWN"     // 例 0.78
  certification: number | "UNKNOWN"         // 例 0.20
  canadaExport: number | "UNKNOWN"
}
```

- 由 capability signals + 实体解析结果推导（确定性聚合函数，可重算，不落表——UI 现算或缓存在信号聚合层）。
- 用途：**DISCOVERY / CAPABILITY SIGNAL / RESEARCH PRIORITY**（决定「值得优先去验证谁」），绝不用于合规判定。

---

## 10. Scoring、Mandatory Gate 与 Recommendation

### 10.1 评分与来源隔离

- Supplier Score 的输入 = Requirement Matching 结果 + VERIFIED 证据 + 历史履约（Supplier Memory / performance）。
- **Social 信号数量/热度对 Score 的直接贡献 = 0**（§13-T5 断言）。抖音内容再多，不加分；它只影响 Discovery Confidence 与研究优先级。

### 10.2 Mandatory Gate

- 逐条 mandatory requirement 判 PASS / FAIL / UNKNOWN；判定只消费 VERIFIED 证据。
- 需求来源：`TenderExtractedRequirement.mandatory === true`；**注意 V2 的 `"uncertain"` 落库时塌缩为 `false`**（v2-map 现状）——Gate 必须另取 V2 层 uncertain 集呈现为「疑似强制，待澄清」，不得静默当作非强制（fail-open 反模式）。
- **任何 FAIL ⇒ NOT_ELIGIBLE**，social capability confidence 再高也不豁免（Addendum §19 原文场景）。
- UNKNOWN 不算 PASS：呈现为「待验证」，配合 NEEDS_VERIFICATION 推荐态。

### 10.3 Recommendation 输出（对齐 Addendum §14 示例）

```text
PRIMARY             身份 VERIFIED + mandatory 全 PASS + 分数达标
NEEDS_VERIFICATION  信号强但身份/认证未验证（XHS/抖音来源常态落点）
NOT_ELIGIBLE        mandatory 任一 FAIL
```

推荐卡片必须携带：Score、identity 状态、capability 置信、mandatory x/y、social signals 数、Sources 列表、Notes。

---

## 11. Supplier Memory 边界

- 发现信号（SupplierDiscoverySignal）是**工作区数据**，不是长期记忆。互联网搜索结果**永不自动**写入 Supplier/Corporate Memory。
- 人工确认（LINKED + 显式「保存为供应商」动作）后才 `SAVE_TO_SUPPLIER_MEMORY`：写 Supplier 行（或既有 Supplier 的来源补充）+ 长期事实走既有 canonical 写路径 `createMemoryClaim`，**零 schema 变更**——词表已预留：`subjectType="VENDOR"`（subjectKey=Supplier.id）、`claimType="SUPPLIER_FACT"`、`accessClass="VENDOR_CONFIDENTIAL"`、`sourceType=PUBLIC_WEB|USER_ENTRY|VENDOR_QUOTE`；验证态映射见 §5.4。
- AI 不得自动写已由 `assertWritableActorType` 硬禁（actor=ai/agent 直接抛）——M1 不需要新增机制，只需不绕过。
- **D-MEM-1（M1 决策）**：保存路径落地时收紧 `assertSubjectInScope` 的 VENDOR 分支为「必须是本 org 的 Supplier.id」（镜像 BUYER 分支；现状接受任意 opaque key，audit 债 D9）。
- Sources 列表与 Discovery Signals 引用留在信号域（LINKED 状态即关系），记忆层只存经人确认的事实断言。

## 12. UI、租户隔离与权限

### 12.1 UI 设计（Addendum §13 对齐）

- **落点**：`/projects/intelligence/supply-chain` 占位页激活为 Supplier Intelligence 工作台（项目/Tender 语境入口）；org 级 supply-chain slot 同步从「建设中」接上真实数据。
- **Signal Inbox**：按 status 分栏（NEW/REVIEWED/LINKED/REJECTED），逐条展示平台徽章 + 实体解析预填结果（MATCHED 候选/NEEDS_HUMAN_REVIEW 冲突面板）；LINK/REJECT 都是人工点按。
- **Supplier 详情新增 Sources 区块**：来源清单（Qyane Memory / 1688 / Website / Douyin / Xiaohongshu / WeChat / Manual）= 按 LINKED 信号聚合去重 + 主表既有 source/website 字段；展开 Social Evidence 三栏 **Observed / Claimed / Verified**（Addendum §13 示例样式），一眼区分「看到的 / 供应商自己说的 / 真正验证过的」；AI 标注的 OBSERVED 带「AI 标注」徽章（§5.3-R2）。
- **推荐卡**：§10.3 字段集（Score/identity/capability 置信/mandatory x/y/social signals 数/Sources/Notes）。
- **空态诚实**：无数据显式「未发现/未验证」，禁假 0（沿用情报 tab data-intel-slot 惯例）。

### 12.2 租户隔离与权限

- 两张新表全部带 `orgId`，所有查询 `orgId` 同筛（API 层 `requireTenantContext` 惯例，见 PART A）；Org A 的发现信号 Org B 永不可见（§13-T4）。
- 新页面按导航/模块/权限/i18n 五件套接入（挂点清单见 PART A §6.1–6.2；`apiFetch` 的 `ORG_SCOPED_API_PREFIXES` 登记 `/api/supplier-intel/`）。
- Flag：`src/lib/supplier-intel/flags.ts` 按 canonical 四符号模式落 `SUPPLIER_INTEL_ENABLED` + `SUPPLIER_INTEL_ORG_ALLOWLIST`（default OFF，双双记入 .env.example）；**两道独立门**——层 B 外呼另须 `TENDER_EXTERNAL_INTEL_ENABLED` + `TAVILY_API_KEY` 已开（supplier-intel flag 不代开外呼门）。

## 13. 测试计划（M1 编码轮必须落）

| # | 测试 | 断言 |
|---|---|---|
| T1 | Social claim is not verification | 抖音文案「UL Certified」→ capability `evidenceStatus=CLAIMED`；任何 social 写路径写 VERIFIED 抛错 |
| T2 | Entity resolution ambiguity | 两个名字相似企业 → `NEEDS_HUMAN_REVIEW`，无自动合并副作用 |
| T3 | User submitted social link | 粘贴抖音/小红书/视频号链接 → 各建 1 条 SupplierDiscoverySignal，字段取不到留空 |
| T4 | Cross-org isolation | Org A 信号在 Org B 上下文 list/get 均不可见 |
| T5 | Social does not bypass mandatory gate | capability confidence 0.95 + mandatory 证书 FAIL → NOT_ELIGIBLE |
| T6 | Score isolation | 同一 supplier ±20 条 social 信号，Score 不变；Discovery Confidence 变 |
| T7 | Provider policy gate | `requiresPlatformLogin=true` 的 provider 启用被拒（fail-closed） |
| T8 | Capability type fail-closed | 未知 capability type 拒收 |
| T9 | Search brief snapshot | 每次发现运行留有 brief + 查询词快照，可回放 |

## 14. M1 Definition of Done

**基线部分（原文未归档，按 Addendum 复述重建为原则）**：M1 全链路 = 从 Tender 生成 Search Brief → 多源发现 → 信号入箱 → 人工实体解析确认 → 需求匹配 + 证据验证 → Mandatory Gate → 评分 → 推荐 → 人工保存进 Supplier Memory；全程无自动询价/采购/下单；租户隔离；审计可回放。

**Addendum 附加项（20–30，原文冻结）**：

20. Supplier Source abstraction 支持 Social Discovery（§8）
21. 存在 SupplierDiscoverySignal（§4.1）
22. 支持 CLAIMED / OBSERVED / VERIFIED（§5）
23. Search Brief 支持 capability/social keywords（§4.5）
24. Entity Resolution 有明确 abstraction（§7）
25. 用户可手动添加 social source（§6.1 层 A/C）
26. Social evidence 不可直接提升为 verified certification（§5.3-R1）
27. Social adapter 不绕过平台限制（§8.4）
28. Architecture 可以未来接 Douyin / Xiaohongshu / WeChat（§8）
29. Social discovery 与 Supplier Corporate Memory 分离（§11）
30. Tenant isolation PASS（§12 / T4）

## 15. 实施切分建议（后续编码轮，本轮不执行）

```text
M1-S1  schema（2 表）+ 用户提交链接/文案 → 信号入箱 + inbox UI（落点=supply-chain 占位页激活）
M1-S2  buildSupplierSearchBrief() + SearchEngineProvider（统一三份 Tavily client）+ OpenWeb/Douyin 层 B
M1-S3  实体解析辅助 + capability signal 标注（人工为主、AI 辅助）+ Supplier 详情 Sources/Social Evidence UI
M1-S4  Requirement Matching 接线 + Mandatory Gate + Score/Recommendation + SAVE_TO_SUPPLIER_MEMORY（含 D-MEM-1 收紧）
```

每片独立 flag-off 可合，验收含 §13 对应测试。风险最高的是 S3 的解析质量与 S4 的判定口径，建议各配 golden 样例集。

## 16. 汇报键值块（Addendum §21 要求）

```text
SOCIAL_DISCOVERY_MODEL = 信号先行（SupplierDiscoverySignal + SupplierCapabilitySignal 两张新表；社媒只进管线最上游，不直建 Supplier、不进评分、不越 Mandatory Gate）
DOUYIN_STRATEGY = 用户提交分享链解析 + 搜索引擎间接发现（复用 Tavily 通道）+ 手工录入；不接官方 API（企业资质门槛+无通用内容搜索）；商业数据商仅预留接口
XIAOHONGSHU_STRATEGY = 用户提交为主（robots 全站默认禁抓实测证实）+ 手工录入；层 B 覆盖率如实呈现；不做任何直抓/登录态
WECHAT_CHANNELS_STRATEGY = USER_ASSISTED_DISCOVERY 唯一路径（分享文案/链接人工带回→解析建信号）；不作为 M1 依赖；截图/媒体理解标 M1_OPTIONAL
ENTITY_RESOLUTION_DESIGN = resolveSupplierEntity() 运行期 DTO + resolutionJson 快照；匹配键分级（统一社会信用代码>已档 URL>法名归一>联系方式>模糊仅候选）；≥0.9 预填、0.5–0.9 NEEDS_HUMAN_REVIEW、全程人工确认、永不自动合并（对齐 Buyer 纪律与 createOrObserveAwardRecord 词表）
SOCIAL_TRUST_MODEL = DISCOVERY SIGNAL→CLAIM→OBSERVATION→VERIFIED 四级；social 写路径值域仅 {CLAIMED,OBSERVED,UNKNOWN}，VERIFIED 唯一来源=独立证据+人工确认；落记忆映射 canonical 验证词表（DESIGN §5.4）
PLATFORM_POLICY_RISKS = 小红书 robots User-agent:* Disallow:/（实测）；抖音搜索结果页 Disallow（实测）+ ToS/反不正当竞争法/PIPL 风险；视频号封闭生态；多数第三方数据商采集合规性存疑→Provider 策略门 fail-closed
M1_SOCIAL_SCOPE = 用户提交（三平台）+ 搜索引擎间接（抖音/OpenWeb，小红书受限）+ 手工录入；两张新表；inbox 人工确认流；零自动抓取/零登录态/零私信
FUTURE_AUTOMATION_SCOPE = 商业数据商 Provider（尽调后）/ 截图与视频媒体理解 / SupplierIdentity canonical 身份层 / SupplierSourceProfile 归属验证 / 快手·B站扩展——全部在 Adapter/Provider 抽象后面，业务层零改动
```
