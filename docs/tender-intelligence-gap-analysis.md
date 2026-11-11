# Tender Intelligence · 现有架构审查与差距分析（Phase A）

> 任务书 Phase A 的交付物。只读审查，没有改代码、没有碰生产数据、没有任何对外动作。
> **Owner Gate A 已过**（Lucas，2026-11-11：「按照你的推荐去做」）：§10 的 10 项全部按「我的建议」一列执行，拍板记录见 §10a。同时新增两条需求，见 §17。

| 项 | 值 |
|---|---|
| 日期 | 2026-11-11 |
| 仓库 | `LucasJ880/-`——青砚生产代码库（Next.js 16 / Prisma 6 / PostgreSQL），不是 `qyane-agent-network` |
| 审查基点 | `main` @ `f08de3f`（Merge #409）；该提交 CI 第 1143 次运行结论 success |
| 工作分支 | `claude/zealous-shannon-p48grg`（只含文档提交；未开 PR） |
| 输入 | `skill.zip`（sha256 前 16 位 `bf802a04351136ab`，与交接包内的同名文件字节一致）；`Claude_Code_Qyane_Tender_Intelligence_Implementation.md`；`Qyane_Tender_Workflow_Quick_Start.md` |
| Skill 离线校验 | 按快速上手的三条命令跑过：结构有效、`bid_ready=false`、9 条阻断（第 13–15 项各 3 条）、6 项单测全过、成本合计 914.12 / 报价 1252.20（§13） |
| 审查方式 | 第 1 轮：八路只读审查分头读代码（分析链、询价定价、情报与界面、供应商情报、证据与文档模型、平台、成本，另加开源对照）；第 2 轮：主会话对关键结论直接读代码复核，分歧记入 §15 |

**可信度标记**：**A** = 主会话直接读过代码原文；**B** = 审查读过并给出 `文件:行`，主会话未逐条复核，动手改那一块之前先复核；**D** = 仓库里无法确定（生产环境变量、仓库外的资料）。

路径相对仓库根目录；`S:` 表示 `prisma/schema.prisma` 的行号。

---

## 0. 结论

1. **地基大半已经在了。** 任务书按「可能要新建」列出的 12 类实体里，证据链、供应商候选与主备推荐、逐要求匹配、认证核验、采购金额口径分离、Go / No-Go 决定、审批、审计都已有实现（§3）。真正缺的是五样：
   - 价格表行项（行号、数量、单位、包装数、尺寸）；
   - 文件领取方（Plan Taker）快照；
   - 竞争对手的公司实体与别名；
   - 历史进口线索到供应商线索的关联；
   - 逐行成本情景，含进口与本地分流、税费现金流、预备金口径。
2. **任务书与仓库硬纪律有 6 处冲突，按仓库规则走还是开例外，需要你定**（§10）。最大的一处：任务书要「增量迁移」，仓库第 1 条纪律是零 schema。我的建议是 Phase B 不动数据库，是否加表留到 Gate B 用实物判断。
3. **有三个现存问题会直接挡路，都不是本任务引入的**（§8）：
   - 询价单按大写类别筛要求，入库的类别是小写——真实数据下询价单很可能一条要求都带不上；
   - 分析引擎抽到了数量和单位，入库时被丢弃；
   - 证书扫描件、授标证据所指向的档案表，在非测试代码里没有任何写入方。
4. **海关数据要降预期。** 仓库里已经写明：加拿大不公开逐票报关记录，CBSA 只向申报人本人提供。「竞争对手 → 进口记录 → 出口商」这一环只能来自第三方商业数据库或人工录入，默认状态必须是「未接通」（§9 风险 1）。
5. **成本实验室应当扩报价引擎，不另写计算器。** 报价引擎已经有成本加成与按售价毛利率两种口径、运费 / 清关 / 关税 / 预备金成本类别、逐行汇率；缺的是按招标行组织、税费现金流和预备金对账（§3.3）。
6. **界面不新开页签。** 项目详情已有「情报」页签和 7 个情报槽位，任务书的 8 个面板有 6 个能落到现有位置（§4）。
7. **进度状态不再加一套。** 同一个标的进度已有四套说法；Skill 的 12 态流程应映射到现有状态，「可投标」「已过期」做成推导出的判定（§10 第 6 项）。

---

## 1. 现有功能清单

按你点名的九个方面。开关默认值来自代码；生产环境实际值见 §14。

### 1.1 Tender（招投标）

| 能力 | 位置 | 状态 | 可信度 |
|---|---|---|---|
| 上传 → 整包分析 → 关键事实 / 要求 / 澄清问题，带页码证据 | `src/lib/tender-auto-analysis/**`、`src/lib/tender-understanding/**`；定时任务 `api/cron/tender-auto-analysis`（每 2 分钟） | 在用。引擎三代并存，由环境变量切换 | B |
| 人工确认（事实、要求、整轮批准） | `src/lib/tender-auto-analysis/review.ts` | 在用 | B |
| Bid-fit 合规矩阵（HAVE / BUILD / PARTNER / RFI / NO_GO），人工标注 | `api/projects/[id]/bid-fit/route.ts`；存 `TenderAnalysisRun.summaryJson.bidFitMatrix` | 在用；只是标签，不拦任何下游 | B |
| 补遗：增量分析 → 变更候选 → 接受 / 驳回 | `src/lib/tender-auto-analysis/addendum-diff*.ts`；V2 的取代关系 `tender-understanding/precedence.ts` | 「接受」只记意图，不改已确认的要求 | A |
| Go / Hold / No-Go | `src/lib/bid-workflow/go-decision.ts`；`BidIntelligenceRoom.goDecision`（S:2243） | 记录真实操作者并写审计；不被下游读取 | A |
| 外部情报（授标检索、网页搜索、参考标准、市场价格、策略备忘录） | `src/lib/tender-intel/orchestrate.ts` | `TENDER_EXTERNAL_INTEL_ENABLED` 默认关；关时零外呼 | B |
| 授标记录、竞争对手 / 采购机构画像 | `src/lib/tender-intel/{awards,award-intelligence,org-profiles}.ts`；`AwardRecord`（S:8495） | `T4_AWARD_INTELLIGENCE_SCHEMA_READY` 暗合并闸 | A / B |
| 采购监控与政府资料申请（PROC-1） | `src/lib/procurement-records/**`；16 张 `Procurement*` / `Records*` 表 | 2026-11-09 已上生产，业务验收待做 | A |
| 投标草稿、分析备忘录、澄清导出 | `src/lib/tender-bid-draft/**`、`tender-analyst-memo/**` | 在用；HTML → PDF，无 Word，无按官方价格表导出 | B |
| 结果标记与复盘 | `api/projects/[id]/tender-result`；规格 `openspec/specs/tender/{result-marking,award-*}` | 在用 | B |
| 界面：项目详情 5 个页签（工作台 / 招标要求 / 标书与报价 / 情报 / 提交） | `src/lib/tender/detail-tabs.ts`；`src/app/(main)/projects/[id]/page.tsx:564-620` | 在用 | A |

更完整的主流程基线与 12 条断点见 `docs/QINGYAN_TENDER_FLOW_BASELINE.md`。

### 1.2 Supplier Intelligence S1–S4

任务书要求核实而不是采信。核实结果：**S1–S4 的代码都在 HEAD 上，整体受 `SUPPLIER_INTEL_ENABLED` 控制，默认关。**

| 阶段 | 交付了什么 | 代码位置 | 可信度 |
|---|---|---|---|
| S1 | 7 张表、开关、评分契约、提交解析 | `src/lib/supplier-intel/{flags,score-contract,submission-parser,constants}.ts`；S:2658–2938 | B（开关 A） |
| S2 | 发现、实体解析、访问控制、规范要求来源 | `search-brief.ts`、`providers.ts`、`adapters.ts`、`entity-resolution.ts`、`canonical-requirements.ts` | B |
| S3-A | 招投标入口、采购视图、检索轮次工作台、线索收件箱、人工关联 | `src/components/supplier-intel/**`，挂在「标书与报价」页签（`bid-tab.tsx:51`）；页面 `/projects/intelligence/supply-chain` | B |
| S3-B | 能力、产品报盘、认证登记与界面 | `certification-service.ts`、`capability-verification-service.ts`；`api/supplier-intel/suppliers/[supplierId]/**` | B |
| S4-A | 逐要求匹配 + 强制要求闸（不评分） | `deterministic-match.ts`、`mandatory-gate.ts`、`evaluation-service.ts` | B |
| S4-B | 评分、发现优先级、项目内排名 | `score-components.ts`、`discovery-priority.ts`、`project-ranking-model.ts` | B（排名 A） |

对任务书那句话的逐项核对：

- **「S3 采购工作台、S4 需求匹配与推荐、PRIMARY / BACKUP」——属实。** 主备在读取时推导、不落库：排名第 1 且合格的是 PRIMARY，其余合格的是 BACKUP；合格 = 强制要求闸通过且四项分数齐全（A，`project-ranking-model.ts:56-67`）。
- **「已有 1688 排名」——说大了。** 1688 只是一种线索平台和发现优先级的一个输入；1688 专用适配器的状态是 `DEFERRED`（A，`adapters.ts:304-305`），1688 标价不算报价，也不能单独进入正式排名（B）。
- **供应商主档只有一个：`Supplier`（S:2131）。** `SupplierCandidate` 是每轮评估的一行，不是线索；线索是 `SupplierDiscoverySignal`，只能由人工关联成供应商，系统从不自动创建或合并供应商（B）。
- **全部确定性，没有模型产出的数字。** 网页 / 社媒 / 宣传册来源的认证只能是 CLAIMED；VERIFIED 的唯一写路径是「人工 + 独立证据」（A，S:2901–2903 注释）。匹配结论里 UNKNOWN 永不折算成 PASS（A，S:2868–2870 注释）。
- **文档里明确没做的**：HS 编码、关税、运费、落地成本、汇率；自动询价；供应商记忆自动沉淀；报盘批量导入；证书到期提醒（B，`docs/QYANE_SUPPLIER_INTELLIGENCE_M1_S4_B.md` §11）。

### 1.3 供应商询价

| 能力 | 位置 | 可信度 |
|---|---|---|
| 一键起草询价 → 审批卡 → Gmail 发出 → 回信按线程认领入表 → 催单 → 未响应 | `src/lib/tender-rfq/{service,execute,inbound-*,chase-*}.ts`；定时任务 `tender-rfq-inbound`（每 10 分钟） | B |
| 回信解析的证据闸：每个字段必须能在原文逐字找到，否则丢弃并列为缺失 | `inbound-parse.ts:313-416` | B |
| 落地成本：按贸易条款加费用；缺汇率 / 关税率 / 数量就不出结果并写明缺什么 | `landed-cost.ts:100-289` | B |
| 比价矩阵（按供应商一行）与可选解读的数字校验 | `compare.ts`、`interpretation-guard.ts` | B |
| Web 入口「问供应商要价」与原地审批 | `src/components/inquiry/project-inquiry-section.tsx` | B |

三处与本任务直接相关的限制：

- **询价与报价都是「每家供应商每轮一个价」**，`InquiryItem` 唯一键是 `[inquiryId, supplierId]`（B，S:2639）。不存在「招标行 × 供应商」的矩阵——18 行的标没法按行收报价。
- **询价单里的数量只有一个**：取关键事实里的第一个数字（A，`build.ts:127-133、209-216`）。
- **供应商情报到询价没有交接**：`prepareRfqRound` 收的是 `Supplier.id`，排名面板的「下一步：发询价」只是个标签（B）。

### 1.4 任务系统

- 招投标用 `Task`（S:436）：阶段任务按固定模板生成（`src/lib/tender/stage-tasks.ts`）；分析与 PROC-1 也各自往 `Task` 写（B）。
- `AgentTask` 已冻结，写入会让 CI 失败（B，`runtime-architecture/guards.ts`）。
- 结论：新功能只用 `Task`，不建新的任务表。

### 1.5 附件管理

- 上传：`POST /api/projects/[id]/files`，20MB，扩展名白名单含 xlsx 与 jpg / png，校验文件头；私有存储，经 `/api/files` 代理读取（A / B）。
- 解析：xlsx 转成「表 + 行区间」文本单元，没有单元格级模型；**图片不进分析，没有 OCR**（B）。
- 删除是硬删除：文件与数据库行一起删，页级数据级联删除（A，`api/projects/[id]/files/[fileId]/route.ts:21-30`）。
- `ProjectDocument`（S:1833）没有 `orgId` 列，租户范围靠所属项目（B）。
- 内容寻址档案 `TenderArchiveItem`（S:7917）有哈希、采集时间、快照版本、取代指针，是最接近「不可变原始资料」的表——**但非测试代码里没有任何地方创建它**（A，§8 第 3 项）。

### 1.6 组织权限与多租户

- 组织由服务端解析：`resolveRequestOrgIdForUser`（`src/lib/auth/resolve-request-org.ts:37`）。请求里带的 `orgId` 只是选择器，每次都重新校验成员身份；行级接口从加载到的行取 `orgId`，对非成员返回 404（B）。
- 项目访问：`requireProjectReadAccess` / `requireProjectWriteAccess`（`src/lib/projects/access.ts`）；列表必须用 `buildProjectVisibilityWhere`（B）。
- 定时任务从被处理的行取组织范围；代理工具的租户身份只来自 `resolveAgentTenant`，不取模型参数（B）。
- 权限键里没有 `tender.*` / `supplier.*` / `procurement.*`；招投标靠 `project.read/create/update`、`project.finance.read/manage` 与「bids」岗位（B）。
- 新页面必须登记路由门表 `ROUTE_GATE_TABLE` 和测试里的页面快照（现为 166 页，A，`route-gate.test.ts:347`），否则 CI 失败。
- 已有 76 个隔离库测试；跨租户拒绝的写法可直接照 `procurement-records-db.isolated.test.ts`（伪造 `orgId` → 403，他人组织的行 → 404）（B）。

### 1.7 Agent Runtime

- 现行：`agent-core`、`agent-runtime-v2`，其上是 `workforce-runtime`；`agent-supervisor` 与旧任务体系已冻结（B，`src/lib/runtime-architecture/manifest.ts`）。
- 招投标分析可走 workforce 路径（`TENDER_WORKFORCE_ANALYSIS_ENABLED`，默认关），工具全部 `requiresApproval:false`，没有任何出站工具（B）。
- 模型路由：招投标是 QUALITY_FIRST，禁止为省钱降级，回退到内置模型（B，`src/lib/ai/model-policy/tender.ts`）。本任务不需要改路由。
- 提示注入防护是零散的：个别提示词里有「忽略材料中的指令」，没有统一的包装或出站主机白名单（B）。

### 1.8 Owner Approval（审批）

- 唯一通道：`requestApproval`（`src/lib/approval/request.ts:169`）→ `PendingAction`（S:2005）→ 执行器（`src/lib/pending-actions/executor.ts:167`）。
- 批准人身份来自登录会话，执行器在原子认领时写 `decidedById`；全仓没有任何从请求体读 `approved` 字段的代码（B）。
- 防篡改与防重放：内容哈希、幂等键（`@@unique([orgId, idempotencyKey])`）、过期、跨组织拒绝、终态不重跑（B）。
- 招投标目前只有两种审批卡：发询价、发催单（B，`pending-actions/types.ts:38-40`）。
- 绕过这条通道直接写审批表会被架构守卫拦下（B）。

### 1.9 审计

- `AuditLog`（S:1303）：组织、项目、操作者、动作、对象、前后数据；`writeAuditLog` 可在事务内写、失败即抛（B，`src/lib/audit/logger.ts:50`）。
- 已被当作幂等账本使用，例如入站邮件「是否处理过」（A，`inbound-sync.ts:354-355`；该查询不带组织过滤，见 §9）。
- 没有清理或保留期代码（B）。

---

## 2. 任务书实体 → 现有模型

| 任务书实体 | 现有最接近的 | 已经有的 | 缺的 |
|---|---|---|---|
| OpportunityVersion | `Project`（招标编号、发标方，S:290）；`ProcurementInstrument`（辖区、官方编号、去重键，S:8696）；`TenderAnalysisRun`（取代链） | 编号、发标方、分析版本 | `Project` 没有辖区键，招标编号没有唯一约束；没有「发布版本号」 |
| SourceDocument | `ProjectDocument` + `ProjectDocumentPage`（哈希、页 / 表 / 块单元）；`TenderAnalysisRunDocument.role`（主件 / 附件 / 补遗 / 价格表）；`TenderArchiveItem` | 哈希、单元级出处、文件角色 | 没有发标方与补遗序号；单元格级出处只有文本标签；硬删除；档案表无写入方；图片不解析 |
| TenderRequirementLine | `TenderExtractedRequirement`（S:2479） | 文本要求、强制标记、页码 | **行号、数量、单位、包装数、尺寸、变体全无**（A）。V2 抽出的 `quantity` / `unit` 在入库映射时被丢（A，`v2-map.ts:71-81、212-223`）；「不确定是否强制」塌成「否」 |
| PlanTakerSnapshot | 无 | — | 全缺（A：全仓搜不到 plan taker / document holder） |
| EvidenceSource / Claim | `MemoryClaim` + `MemoryClaimEvidence`（S:8005、8060）；`TenderAnalysisSourceRef`；`AwardRecordSource`；`ProcurementSourceEvidence` | 声明 → 证据 → 来源 → 采集时间 → 核验状态；事实 / 解读 / 推断三分；取代链；禁止硬删（A） | 没有 INDICATIVE、CONTRADICTED 两个值；写入目前只允许管理员，模型直写被拒 |
| Conflict | V2 的冲突，存 `TenderAnalysisRun.summaryJson.conflicts` | 「已由补遗解决 / 未解决」 | 不是独立的行，只针对招标文件内部冲突 |
| EvidenceEdge | 无 | — | 没有边表，没有首次 / 末次出现时间（PROC-1 的来源证据表有，但不是边） |
| 公司实体与别名 | `Buyer`（别名数组、MERGED 状态，S:7972）；`AwardRecord.winnerNameNormalized` | 买家别名；中标方名称规范化，只做精确匹配、绝不模糊合并（A，S:8508 注释） | 竞争对手 / 厂商没有实体；没有带时效的别名；买家合并也未实现（B） |
| 授标与历史采购口径 | `ProcurementLineItem.amountBasis`：上限 / 评标 / 承诺 / 下单 / 开票 / 付款（A，S:9113）；`ProcurementInstrument.contractValueBasis` | 口径分离已在 PROC-1 里做完 | `AwardRecord` 自身只有一个合同金额 |
| SupplierLeadAssociation | `SupplierDiscoverySignal`（S:2705）：线索先行，不直接建供应商；状态 NEW → REVIEWED → LINKED / REJECTED；`procurement-records/supplier-pure.ts` 已列出官方进口线索来源 | 「线索 ≠ 供应商」「人工关联」「不自动合并」 | 没有进口商 / 出口商 / 运单字段；平台目录里没有「贸易记录」这一类；没有「竞争对手 → 出口商」的关联 |
| CostScenario / BidLineScenario | 报价引擎（`src/lib/quote-engine/**`）；`tender-rfq/landed-cost.ts`；`tender-pricing/calc.ts` | 见 §3.3 | 见 §3.3 |
| ComplianceDecision | Bid-fit 矩阵；`SupplierRequirementMatch.verdict`（PASS / PARTIAL / FAIL / UNKNOWN）；`SupplierCertification`（CLAIMED / VERIFIED / REJECTED / EXPIRED，范围含「型号系列」，带证书号、发证机构、有效期）；候选的强制要求闸 | 逐要求 × 候选的判定；认证核验；强制闸（A） | 判定按「要求」而不是按「价格表行」；认证覆盖哪些型号只有「范围 + 单个报盘」；不拦任何下游；没有「可投标」判定 |
| Owner 决定 | `BidIntelligenceRoom.goDecision` + 操作者 + 时间 + 备注；`AuditLog`；`PendingAction` | 真实身份、审计 | 覆盖式写入，历史只在审计里；名称是 GO / HOLD / NO_GO |

---

## 3. 三处需要展开说的

### 3.1 证据词表怎么对上

Skill 用一个五值词表：CONFIRMED / INDICATIVE / INFERRED / UNKNOWN / CONTRADICTED。青砚现在是三根正交的轴（A，S:8014–8021）：

- 性质：FACT / INTERPRETATION / INFERENCE；
- 置信度：HIGH / MEDIUM / LOW；
- 核验状态：AI_EXTRACTED / HUMAN_CONFIRMED / SYSTEM_VERIFIED / NEEDS_REVIEW。

青砚的三轴表达力更强，不应当为了对齐 Skill 而压扁。做法是写一个纯函数把三轴投影成 Skill 的五值用于展示；CONTRADICTED 由「同一主题存在两条有效且互相矛盾的声明」推导，不新增存储值。

### 3.2 认证闸已经有七成

渥太华案例的核心回归点是第 13–15 项：补遗要求整机取得加拿大认可的电气认证，证据未到就不能标为可投标。现有的东西：

- `SupplierCertification` 已有范围（供应商 / 产品 / 型号系列）、证书号、发证机构、有效期、来源类别、核验人与时间。
- 「官网写着 UL certified 不等于已核验」已经是服务层强制的规则。
- `deterministic-match.ts` 的认证规则要求：已核验、未过期、范围正确。

缺的三样：

- 认证没有和**价格表行**挂钩（现在挂在「要求」上）；
- 没有「整机 vs 部件」的区分——范围只有三档，表达不了「加热部件有 UL，整机没有」；
- 强制闸的结果不拦投标流程里的任何一步。

### 3.3 成本：扩报价引擎

| 需要的能力 | 报价引擎现状 | 落地成本模块现状 | 结论 |
|---|---|---|---|
| 毛利率 = (价 − 成本) / 价；加成 = (价 − 成本) / 成本 | 两种定价口径都有，两个比率同时输出（A，`calc.ts:281-282、307-308`） | — | 已有 |
| 运费 / 清关 / 关税 / 预备金分项 | 22 个成本类别里都有（A，`contract.ts:39-62`） | 单一运费估算 | 用报价引擎的类别 |
| 汇率带来源与日期 | 逐行有 | 组织级，一个日期管所有币种 | 用报价引擎的 |
| 缺参数不出结果 | — | 有，且写明缺什么（B） | 保留这条语义 |
| 按招标行组织 | 成本行与招标行无关联 | 单一数量 | **缺** |
| 进口与本地采购分流 | 无 | 无 | **缺** |
| 关税按 HS + 原产地，未确认的只能是敏感性情景 | 可按产品子类分不同税率 | 每项目一个税率，无 HS | **缺** |
| 运费方案互斥（整柜 / 拼柜 / 空运 / 本地） | 无 | 无 | **缺** |
| 进口环节 GST 作为现金流、可抵扣时不进成本 | 只有对售价的统一税率 | 全仓搜不到 ITC | **缺** |
| 预备金「按售价留」与「计入成本」两种口径对账 | 有预备金类别，无对账 | 无 | **缺** |
| 金额运算 | JS 浮点，输出时四舍五入到分 | 同左 | 新写的纯函数用定点（分）或 Decimal；盈利分析模块已有 Decimal 工具（B，`project-finance/money.ts`） |
| 按官方价格表原样导出（行序、单位不变） | 只有对客报价 PDF | — | **缺** |

---

## 4. 任务书 8 个面板 → 现有落点

任务书要求「在现有 Tender 详情里加 Intelligence 工作区，不做独立应用」。项目详情已有「情报」页签，内含 7 个槽位（`src/components/tender-intel/org-award-intel-slots.tsx`）。

| 面板 | 落点 | 复用 | 新做 |
|---|---|---|---|
| 1 机会抬头 | 项目页头 + 工作台指令区 | 截标倒计时、评分标准（已作为关键事实抽出）、补遗变更候选 | 时区显示、强制证据覆盖率、来源覆盖 |
| 2 文件领取方 | 「情报」页签新增一节 | 授标记录按规范化名称关联；我方排除逻辑（`org-profiles.ts`） | 整节；醒目标注「领取文件 ≠ 投标」 |
| 3 供应链情报 | 「情报」页签已有的「供应链情报」槽位（A，`:367`）；深入到 `/projects/intelligence/supply-chain` | 线索收件箱、人工关联 | 进口商 → 出口商的关联展示与证据点击 |
| 4 历史采购 | 「情报」页签已有的采购卡 + PROC-1 台账 | 金额口径分离、资料申请草稿与状态、去重台账——**基本现成** | 与本标行项的匹配质量说明 |
| 5 供应商寻源 | 「标书与报价」页签已有的寻源入口 + 排名面板 | 主备、强制闸、证据工作区 | **到询价的交接**；交期、样品 |
| 6 合规矩阵 | 「招标要求」页签的 Bid-fit 矩阵 | 逐要求判定、认证核验 | 按价格表行展示；规格对照（尺寸、包装）；红色阻断 |
| 7 成本实验室 | 工作台的定价助手卡 + 报价引擎页面 | 见 §3.3 | 逐行情景、每个假设的出处、两套模型对账 |
| 8 Owner 决定 | 工作台的 Go 决定面板 + 「提交」页签 | 决定记录、审计、审批中心 | 阻断项清单；决定对下游生效 |

只在现有页面里加区块就不需要登记新路由；若新增页面，路由门表与 166 页快照两处都要改。

---

## 5. 可复用组件清单

| 用途 | 直接复用 |
|---|---|
| 组织与项目范围 | `resolveRequestOrgIdForUser`、`requireProjectReadAccess/WriteAccess`、`buildProjectVisibilityWhere`、`assertEntityBelongsToOrg` |
| 审批与对外动作 | `requestApproval` → `PendingAction` → 执行器；发信只经 `sendGmail`（带非生产保护） |
| 审计 | `writeAuditLog`（事务内）；审计行作幂等账本的既有写法 |
| 证据与声明 | `src/lib/corporate-memory/claim-service.ts`（声明、证据、取代、撤回） |
| 供应商线索与评估 | `src/lib/supplier-intel/**` 全套；唯一供应商主档 `Supplier` |
| 认证核验 | `certification-service.ts`、`capability-verification-service.ts` |
| 授标与画像 | `src/lib/tender-intel/{awards,org-profiles}.ts`；名称规范化函数 |
| 历史采购与资料申请 | `src/lib/procurement-records/**`；`ProcurementTenderLink` 把官方采购工具关联到项目 |
| 来源能力声明 | `SourceCapability`（模式：自动发现 / 自动刷新 / 自动检索 / 人工）与逐来源结果状态（`procurement-records/watch-config.ts:18-63`） |
| 官方进口线索来源说明 | `procurement-records/supplier-pure.ts` 的 `IMPORT_LEAD_SOURCES` |
| 询价 | `prepareRfqRound`、回信解析、催单、比价 |
| 成本 | 报价引擎的计算与成本类别；落地成本的贸易条款表与「缺参不出结果」 |
| 文件 | 上传路由、文件头校验、私有存储 |
| 开关 | `envBool` + `*WithEnv` 纯函数 + 组织白名单；暗合并闸的写法（PROC-1、授标情报） |
| 测试 | 隔离库测试脚手架与 `assertSafeTestDatabase`；`tender-eval` 评测集 |

---

## 6. 需要新增的模块

全部是在现有目录里加文件，或新增一个纯函数目录；不新建并行的 Tender / Supplier / Task 体系。最终命名在 `/opsx:propose` 时定——注意架构守卫禁止 `src/lib` 文件名含 plan / engine / queue / scheduler 等词，所以「Plan Taker」在代码里要叫「文件领取方（document holder）」（A，`runtime-architecture/guards.ts:80-105`）。

| # | 模块 | 性质 | 对应验收 |
|---|---|---|---|
| N1 | 价格表行项契约：行号、数量、单位、包装数、尺寸；单位换算（单件报价 → 每包 2 / 每盒 12 / 每卷 25）；尺寸不符守卫 | 纯函数 + 类型 | A1、A2、A8、A9、A10 |
| N2 | 截标时间校验：拒绝不带时区的时间；过期判定 | 纯函数 | A16 |
| N3 | 文件领取方快照契约：来源类别（用户上传截图）、采集时间、条数；与「投标人」「中标方」分属不同类型 | 纯函数 + 类型 | A3 |
| N4 | 公司别名：候选合并只出建议，不自动合并 | 纯函数；沿用授标记录「只精确匹配」的规矩 | A4 |
| N5 | 进口线索关联：竞争对手 → 历史运单 → 出口商，状态固定为「线索，未证实当前供货」 | 契约 + 接到现有供应商线索 | A5 |
| N6 | 来源连接状态：在现有来源能力声明上增加「未接通」 | 纯函数 | A6 |
| N7 | 逐行成本情景：§3.3 标「缺」的六项 | 纯函数，定点金额 | A10–A14 |
| N8 | 历史金额口径类型：评标总价、实付、预算估计互不相加 | 类型层面禁止 | A15 |
| N9 | 可投标判定：强制认证未核验即阻断；补遗使旧匹配与旧成本假设失效；来源过期或矛盾时压掉无支撑的结论 | 纯函数，读现有认证与匹配 | A7、A21 |
| N10 | 证据词表投影（§3.1） | 纯函数 | A21 |
| N11 | 按官方价格表导出 | 纯序列化 | A1、A10 |
| N12 | 持久化与接口（取决于 §7 选哪个方案） | 接口 + 隔离库测试 | A17、A20 |
| N13 | 界面（§4） | 组件 | — |
| N14 | 只读研究适配器（官方授标、厂家资料） | 需要先定 §10 第 2、4 项 | A18、A19 |

N1–N11 不需要数据库、不需要网络、不需要模型，构成 Phase B。

---

## 7. 数据库调整

任务书写的是「优先增量、可回滚的迁移」。仓库第 1 条硬纪律是零 schema：不新增模型、不加字段、不写迁移，唯一例外是 PROC-1 的 16 张表，且「例外不外延到其它 change」（`openspec/config.yaml` `context:` 第 1 条）。两者直接冲突，所以给两个方案。

### 方案甲：零 schema

| 数据 | 落点 | 先例 |
|---|---|---|
| 价格表行项 | `TenderAnalysisRun.summaryJson` 下新键 | `bidFitMatrix` 就存在这里 |
| 文件领取方快照 | `BidIntelligenceModule.dataJson`（每个模块一行，S:2269） | `commercial_judgment` 模块 |
| 成本情景 | `BidIntelligenceRoom.summaryJson` 下新键 | `pricingInputs.ourCostCad` 就存在这里 |
| 进口线索 | `SupplierDiscoverySignal`：平台是字符串列、取值目录在 TS 常量里，新增一个目录值；运单细节进 `rawMetadataJson` | 现有 7 种平台都是这么加的 |
| 别名与公司事实 | `MemoryClaim`（主题类型已有 VENDOR / ORGANIZATION） | 合规记忆用的就是它 |
| 认证与行的挂钩 | 匹配行的证据快照 JSON | 现有 `evidenceJson` |
| Owner 决定历史 | 现有 Go 决定 + 审计 | — |

- 好处：不动数据库，不走生产迁移的 Owner Gate，开关一关就完全回到现状。
- 代价：行项、情景都是整块 JSON，没有数据库层约束，跨项目查询（「这家公司领过哪些标的文件」）做不了或很慢；并发编辑要自己处理。
- 一处需要你确认：`config.yaml` 把零 schema 的落点写成「`Organization.settingsJson` / User settings / Notification / AuditLog」，而代码里早已在用分析轮次与情报室的 JSON 位（上表「先例」列）。我按先例把它们算作可用落点；若你认为不算，方案甲不成立。

### 方案乙：受限例外

照 PROC-1 的做法开一条例外：只新增表、不改既有表、暗合并闸保护、生产迁移走 Owner Gate（`docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md`）。最小集合大约 4–6 张：价格表行、文件领取方快照及其条目、成本情景及其行、公司别名。

- 好处：有约束、可查询、可按行审计。
- 代价：要 Lucas / Evan 批准例外并写进 `config.yaml`；一次生产迁移；表名要避开架构守卫的禁用词（Plan / Run / Task / Event / Memory / Ledger 等，A）。

### 建议

- **Phase B 两个方案都不需要**——全是纯函数和夹具测试。
- **Gate B 再定**：那时有类型契约和通过的测试在手，能具体看出哪些数据真的需要跨项目查询。我的预判是只有「公司别名」和「竞争对手 → 出口商关联」值得建表，其余按项目存 JSON 就够。
- 无论哪个方案，都**不改** PROC-1 的表结构；历史采购面板只读它们。

---

## 8. 三个会挡路的现存问题

都不是本任务引入的，但不处理的话，「寻源 → 询价 → 按行定价」这条链接不上。Phase A 只读，没有动它们。

| # | 问题 | 证据 | 影响 | 可信度 |
|---|---|---|---|---|
| 1 | **询价单筛要求时大小写对不上。** 询价生成器只收类别属于大写清单（`PRODUCT`、`TECHNICAL`…）的要求，比较区分大小写；而入库的类别是小写（V2：`r.category.toLowerCase()`）或旧式代码（V1：`mandatory_technical`）；询价服务把库里的值原样传入，中间没有转换。测试只用了大写样例 | `tender-rfq/build.ts:23-34、187`；`tender-auto-analysis/v2-map.ts:214`；`extract/requirements.ts:181、242`；`tender-rfq/service.ts:268-277` | 真实数据下，全部要求被判为「非供应商侧」，生成器返回「没有已确认且属于供应商侧的要求」，询价发不出去 | A（代码层确认；**未用真实数据复现**） |
| 2 | **数量与单位被丢弃。** V2 抽取结果里有 `quantity` / `unit`，入库映射的输入类型里没有这两个字段 | `tender-understanding/contract.ts:178-179`；`v2-map.ts:71-81、212-223` | 价格表行项无从谈起；询价单只能拿到一个总数量 | A |
| 3 | **档案表没有写入方。** 认证的「独立证据」、授标来源、记忆声明都通过 `archiveItemId` 指向 `TenderArchiveItem`，但只有测试代码创建它 | 全仓搜 `tenderArchiveItem.(create\|upsert\|update)`：命中全在 `__tests__` | 「上传证书扫描件 → 核验为 VERIFIED」这条路实际走不通，除非来源是官方登记网址 | A |

另有四个较小的：

- 询价发送「邮件已发出但状态回写失败」时，该项被记为失败且仍是待发状态，再次批准可能重复发送（B，`tender-rfq/execute.ts:64-75`；与验收 A19 直接相关）。
- 定价助手的成本与毛利率对任何能读项目的人可见（B，`api/projects/[id]/pricing-helper/route.ts`）；成本实验室不能沿用这个口径。
- 截标时间可以以不带时区的形式写入（B，`api/projects/[id]/route.ts:188-194`）。
- 文件硬删除后，分析证据里的文档引用悬空（A / B）。

建议把第 1 项作为 Phase B 的第一个测试：先写一个用入库真实类别值的用例把它复现出来，再决定是否单开一个修复 change。

---

## 9. 风险

| # | 风险 | 说明 | 对策 |
|---|---|---|---|
| 1 | 海关数据拿不到或覆盖不足 | 仓库已写明加拿大不公开逐票报关记录（A，`procurement-records/supplier-pure.ts:9、206`）。渥太华案例里的历史运单线索来自第三方数据库；这类数据库对加拿大收货人的覆盖范围我没有核实（D） | 连接器默认「未接通」；第一版只支持人工录入一条线索并附来源；是否购买数据授权由你决定 |
| 2 | 线索被读成结论 | 「领取文件」被当成「投标」，「2024 年有过一票货」被当成「现在的供货渠道」 | 类型上分开（N3、N5）；界面常驻说明；A3、A5 自动化 |
| 3 | 竞争合规 | 研究公开与合法授权的资料是正当的；向对手打听报价或协调投标不是 | Skill 已明确禁止；系统不提供任何联系竞争对手的动作 |
| 4 | 敏感数字外泄 | 成本、毛利率属于硬纪律第 4 条的脱敏对象；通知与邮件不出金额 | 成本实验室按财务访问规则（`openspec/specs/projects/finance-access`）授权；通知沿用现有整段脱敏 |
| 5 | 提示注入 | 研究适配器会读外部网页；现有防护零散 | 研究步骤只读、无出站工具；对外动作只能经审批卡；A18 自动化 |
| 6 | 夹具里有真实公司名 | `ottawa-bedbug-case.json` 写了一家竞争对手和两家出口商的名称，并带「未证实」的说明 | 进仓库前由你决定保留还是改成代号（§10 第 9 项） |
| 7 | 我方身份识别 | 「我方不算竞争对手」目前只按组织名称精确匹配；法定名称与商号不同时会漏（B） | 文件领取方里的我方条目用同一规范化函数，并允许人工标注 |
| 8 | 生产跑的是哪一代分析引擎 | V1 根本不抽数量；V2 抽了但丢了（§8 第 2 项） | 见 §14 第 1 项 |
| 9 | 审计账本不带组织过滤 | 入站邮件的「是否处理过」按消息 ID 查，不带组织条件（A） | 新功能的幂等键一律带组织；该处是否修另议 |
| 10 | 进度状态再多一套 | 现有四套已经互不相通 | §10 第 6 项 |

---

## 10. Owner Gate A：需要你拍板的 10 项

| # | 事项 | 任务书 / Skill 怎么说 | 仓库现状 | 我的建议 |
|---|---|---|---|---|
| 1 | 数据库 | 增量迁移 | 零 schema，例外逐条批准 | Phase B 不动库；Gate B 再定（§7） |
| 2 | 新增模型调用 | 研究、摘要由模型做 | 第 7 条：不新增 LLM 调用，例外逐条批准 | Phase B 零调用。之后优先修「数量被丢」而不是加调用；截图识别先用人工录入。确需新增时单独报批 |
| 3 | Muse / MVP-002 / MVP-003 | 「Personal Muse 可以编排」 | Muse Connector 永久冻结，青砚不做任何助理 / 插件对接（TASKFLOW 已决定第 10 条） | 不做任何对接，与你说的「保持既定边界」一致 |
| 4 | 需要登录的门户 | 「已有权限时可用认证门户」 | 第 5 条：不触碰任何需要登录的站点 | 按仓库规则。MERX 文件领取方名单只接受用户上传的截图或表格 |
| 5 | 交付粒度 | 一个 Draft PR | 一个 change 一个 PR，每个不超过 8 条任务，走 `/opsx:propose → apply → verify`，产物用中文 | 按仓库规则，拆成 §12 的若干小 PR，每个都是 Draft |
| 6 | 流程状态 | 12 态流程 | 已有四套进度模型 | 不新增。映射到现有投标相位；「可投标」「已过期」做成推导判定 |
| 7 | 开关 | `TENDER_INTELLIGENCE_V2`，默认关 | 现有写法：环境变量 + 组织白名单 | 沿用现有写法，默认关。它依赖 `SUPPLIER_INTEL_ENABLED`，后者生产未开（D） |
| 8 | 三个现存问题（§8） | 不在任务书里 | — | 第 1、2 项各开一个小修复 change，排在 Phase B 之前或并行；第 3 项随持久化一起做 |
| 9 | Skill 与夹具放哪 | 「检查现有约定后解包到技能目录」 | `.claude/skills/` 下全是开发流程技能；业务知识包在 `docs/knowledge-packs/` | 夹具转成测试夹具进 `src/lib/**/__tests__/`（公司名是否代号化由你定）；Skill 正文与参考资料暂不入库，或放 `docs/knowledge-packs/`。注意 `docs/` 下的文件按约定不删 |
| 10 | 成本与毛利谁能看 | 未规定 | 定价助手对所有项目读者可见；财务访问另有规则 | 成本实验室按财务访问规则；是否顺手收紧定价助手另议 |

---

## 10a. 拍板记录（Owner Gate A）

Lucas 2026-11-11 原话：「按照你的推荐去做。」据此 §10 的 10 项全部取「我的建议」。落到执行上是这样：

| # | 执行口径 |
|---|---|
| 1 | Phase B 不动数据库。是否开例外留到 Gate B |
| 2 | Phase B 零模型调用。之后确需新增时单独报批 |
| 3 | 不做任何 Muse / MVP-002 / MVP-003 对接 |
| 4 | 不碰需要登录的站点。MERX 名单只接受用户上传 |
| 5 | 每个 change 一个 Draft PR，走 `/opsx:propose → 审 → apply → verify`。当前会话只被授权在 `claude/zealous-shannon-p48grg` 一个分支上推送，尚未被要求开 PR；开 PR 与多分支都要 Lucas 另行开口 |
| 6 | 不新增流程状态；「可投标」「已过期」做成推导判定 |
| 7 | 开关沿用现有写法，默认关 |
| 8 | FIX-1（询价类别）、FIX-2（数量与单位）各开一个小修复 change；档案表写入方随持久化一起做 |
| 9 | 夹具转成测试夹具。§10 第 9 项里公司名「是否代号化由你定」这一点没有单独答复，我取保守做法：**入库的夹具把竞争对手与出口商名称换成代号**；需要保留原名时告诉我。Skill 正文与参考资料暂不入库 |
| 10 | 成本实验室按财务访问规则授权 |

这次拍板**不包含**：合并、部署、生产数据或凭证、付费数据、发询价、提交投标或资料申请。这些仍然每一项单独授权。

---

## 11. 测试计划

### 11.1 验收项 A1–A22

| 验收项 | 类型 | 阶段 | 可借的现有测试 |
|---|---|---|---|
| A1、A2、A8、A9、A10 行项、数量、单位、尺寸、分位对账 | 纯函数 | B | 渥太华夹具；Skill 的 Python 测试移植为金标 |
| A3、A4、A5 领取方 ≠ 投标人；别名不自动合并；历史运单只是线索 | 纯函数 | B | 授标记录的规范化与去重测试 |
| A6 未接通不造数据 | 纯函数 | B | PROC-1 来源结果状态测试 |
| A7、A21 认证未核验即阻断；过期 / 矛盾压掉结论 | 纯函数 | B | `mandatory-gate`、`deterministic-match` |
| A11–A14 进口与本地分流；税不重复；两模型对账；运费互斥 | 纯函数 | B | `landed-cost.test.ts`、`quote-calc.test.ts` |
| A15 金额口径不相加 | 类型 + 纯函数 | B | PROC-1 分析测试 |
| A16 时间校验与过期 | 纯函数 | B | `src/lib/time` |
| A17 租户隔离 | 隔离库 | 持久化之后 | `procurement-records-db.isolated.test.ts` |
| A18 提示注入不触发对外动作 | 集成 | 适配器之后 | 执行器测试 |
| A19 并发重试不重复对外 | 隔离库 | 适配器之后 | 安装保修邮件的「咨询锁 + 审计行」写法 |
| A20 开关关闭零影响 | 隔离库 + 源码断言 | 持久化之后 | 暗合并闸测试 |
| A22 批准人来自登录身份 | 隔离库 | 持久化之后 | 审批端口测试 |

### 11.2 纪律

- 新测试全部登记进 `scripts/test-all.sh`（硬纪律第 8 条）；不往 `ci/test-registry-baseline.txt` 加欠账。
- 每个 change 结束前跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、架构守卫。
- 隔离库测试只连本地或标明 isolated 的库；本地 `.env` 直连生产，不在本地起应用。
- 夹具是历史回归样例，不是实时价格，也不是合规证明；测试里不出现「已核验」的假状态。

---

## 12. 分阶段安排

每一行是一个 change、一个 Draft PR，不超过 8 条任务。编号为暂定。

| 阶段 | change | 内容 | 动库 | 外呼 | 闸门 |
|---|---|---|---|---|---|
| A | TI-0 | 本文 | 否 | 否 | **Owner Gate A（现在）** |
| 前置 | FIX-1 | 复现并修复询价类别大小写（§8 第 1 项） | 否 | 否 | 随 Gate A 决定做不做 |
| 前置 | FIX-2 | 数量与单位不再被丢（§8 第 2 项）；落点按 §7 的方案 | 视方案 | 否 | 同上 |
| B | TI-1 | 行项契约、单位换算、尺寸守卫、时间校验、官方价格表导出（N1、N2、N11）；渥太华夹具 | 否 | 否 | — |
| B | TI-2 | 逐行成本情景（N7）；金额口径类型（N8）；Python 测试移植为金标 | 否 | 否 | — |
| B | TI-3 | 领取方、别名、进口线索、连接状态、证据词表、可投标判定（N3–N6、N9、N10） | 否 | 否 | **Owner Gate B**：审契约与测试，定 §7 方案 |
| C | TI-4 | 持久化与接口；租户隔离、开关、批准身份测试（N12） | 视方案 | 否 | 方案乙时加迁移 Owner Gate |
| C | TI-5 | 只读适配器：官方授标来源；厂家资料人工录入（N14） | 否 | 是，只读公开来源 | 需先定 §10 第 2、4 项 |
| D | TI-6 | 界面一：机会抬头、文件领取方、合规矩阵 | 否 | 否 | — |
| D | TI-7 | 界面二：成本实验室、供应链情报、Owner 决定；寻源到询价的交接 | 否 | 否 | **Owner Gate C**：截图、数据血缘走查 |
| E | — | 财务与质量闸收尾；列出每个未接通的连接器与每张未核验的强制证书 | — | — | 合并、部署、凭证、付费数据、发询价、提交投标或资料申请：每一项单独授权 |

Phase B 三个 change 之间没有先后依赖，可以并行审。

---

## 13. 对 Skill 自带脚本的复核

脚本是示例，不是实现。离线运行结果与快速上手的预期一致（表头）。按任务书的验收项对照，有这些差距，移植时要补：

| 项 | 脚本现状 | 差距 |
|---|---|---|
| 运费 | 每行一个 `freight_cad` | 表达不了「本地设备不计中国海运」（A11）和「运费方案互斥」（A14）——需要分类型的运费 |
| 预备金 | 只有「按售价留」一种口径 | A13 的两模型对账没有实现 |
| 过期 | 只校验时间带时区 | A16 后半「过期且无回执 → EXPIRED」没有实现 |
| 尺寸 | 不比较 | A9 没有实现 |
| 领取方 | 只在夹具里有一句说明 | A3 没有可执行的断言 |
| 关税未知 | 需要调用方给税率 | 「未确认只能是敏感性情景」没有类型区分 |
| 关税为 0 的进口行与本地行 | 靠 `origin` 字符串是否等于 Canada | 应是显式的采购类型 |

与青砚现有语义的两处差异：

- 青砚的落地成本在缺汇率、缺税率时**拒绝出数**；Skill 的思路是出一个带标注的情景。两者可以共存：已核实参数走现有路径，未核实参数只能产出标为「敏感性」的情景，且不得进入可投标判定。
- Skill 的五值证据词表对青砚的三轴词表，见 §3.1。

夹具里的数字我核对过：1–9 项合计 6,119，枕套 2,903 包，拦截器 436 盒，热处理设备 54 台，洗衣袋 1,140 卷，与任务书 A2 一致。

---

## 14. 未核对

1. 生产环境开关的实际值：`TENDER_ANALYSIS_V2_ENABLED`、`TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`、`SUPPLIER_INTEL_ENABLED`、`TENDER_EXTERNAL_INTEL_ENABLED`、`T4_AWARD_INTELLIGENCE_SCHEMA_READY`。文档称供应商情报与 V2 在生产未开；需要 Evan 在 Vercel 上确认。这决定了这套功能今天在生产上「能看到多少」。
2. §8 第 1 项没有用真实数据复现。
3. 供应商情报各阶段的合并状态来自文档；克隆是浅克隆，`git log` 里看不到对应合并提交。代码在 HEAD 上是确定的。
4. 第三方贸易数据库对加拿大收货人的覆盖、授权条款、价格。
5. 任务书里的四个官方网址（渥太华授标与招标、CBSA 关税表与进口指南）本轮没有访问。
6. 本轮没有安装依赖、没有跑仓库测试（只读审查，只新增文档）。
7. 标 B 的条目均未逐条复核。

---

## 15. 交叉核对更正记录

主会话复核时与审查报告或输入材料不一致的地方，以本节为准。

| # | 原说法 | 复核结果 | 依据 |
|---|---|---|---|
| 1 | 任务书：「已有 1688 排名」 | 1688 专用适配器是 DEFERRED；1688 只是线索平台与发现优先级输入 | `src/lib/supplier-intel/adapters.ts:304-305` |
| 2 | 审查：「PROC-1 例外的措辞禁止其它功能复用这些表」 | 措辞是「例外不外延到其它 change」，约束的是再开新表，不是读取已有数据；项目情报页已经在读。把 `ProcurementScanRun` 当队列用才是明令禁止的。写入这些表存放别的东西属于滥用，本方案不做 | `openspec/config.yaml` `context:` 第 1、3 条 |
| 3 | 审查：「询价类别大小写不一致」标为推断 | 升为代码层确认：生成器、入库映射、服务层三处都读了原文，中间没有任何转换 | §8 第 1 项 |
| 4 | 审查：「`TenderArchiveItem` 可能闲置」标为推断 | 确认：创建只出现在测试里 | §8 第 3 项 |
| 5 | 审查：「比价矩阵只有 Muse 通道在用」（上一轮） | Web 有矩阵与解读两个接口；只有定价情景投影是 Muse 独占 | `docs/QINGYAN_TENDER_FLOW_BASELINE.md` §10 |
| 6 | 文档：`tender-understanding/flag.ts` 注释称 V2「零生产路由接线」 | 已过时，V2 已接进分析 worker | `src/lib/tender-auto-analysis/worker.ts:453` |

---

## 16. 与 FLOW-0 的关系

上一轮的「招投标主流程重排」（`docs/QINGYAN_TENDER_FLOW_PLAN.md`）在等 ChatGPT 一方的 workflow。这份 Skill 就是那一方的原文，三方对比矩阵的第三列已据此填入方案 §6。

两条线的分工：

- **FLOW 解决「步与步之间连上」**：把「下一步」查表搬上 Web、比价进定价、交付前检查。
- **Tender Intelligence 解决「每一步里有没有情报」**：文件领取方、历史采购、进口线索、逐行成本、认证闸。

重叠处：本文的「可投标判定」（N9）就是 FLOW 假设 H4（交付前检查）与 H5（闸门生效）的实现；成本实验室吸收 H2（比价进定价，TASKFLOW W-3）。H1（一张表指路）仍然单独有价值——本文产生的阻断项需要一个地方显示给用户，那张表就是。

---

## 17. Gate A 之后新增的两条需求（Lucas，2026-11-11）

### 17.1 通用流程：只读的事不再逐项询问

现状的痛点：每次用 ChatGPT 跑，它都要停下来问「要不要查海关数据」之类的问题。

原因在 Skill 本身：它把「能不能做」和「要不要做」都留给了对话。青砚里的做法是把这件事从对话里拿出来，变成一张确定性的**阶段策略表**——每个阶段事先定好属于哪一类，运行时不再问：

| 类别 | 含义 | 运行时表现 |
|---|---|---|
| 自动 | 只读、不花钱、不对外 | 默认全部执行，不询问 |
| 等材料 | 需要用户手里的东西（门户截图、厂家报价、证书） | 不询问、不阻塞其它阶段；在结果里写明「缺什么、放到哪里」 |
| 未接通 | 数据源没有授权或没有接入 | 不询问；在结果里显示「未接通」，不造数据 |
| 要批准 | 对外发送、付费、提交 | 只有这一类停下来，走审批卡 |

Skill 流程蓝图里的 11 个阶段按这张表归类后，只有「供应商外联」「提交」「政府资料申请」三处会停，其余全部直接跑完。「要不要查海关数据」这类问题不再出现：接通了就查，没接通就标「未接通」。

落地方式：策略表是代码里的常量加组织设置里的覆盖项（零 schema），与硬纪律第 7 条「下一步是查表，不让模型决定」同一思路。归入 TI-3（N15）。

ChatGPT 那边在青砚做完之前想先止住询问，可以在 Skill 的 `SKILL.md` 第 1 节末尾加一段默认执行策略，文本见交接文档 §6。

### 17.2 成本核算表要「表现出来」

成本核算表作为一等产物，不只是计算结果。归入 TI-2：除计算函数外，交付一个与界面无关的**核算表视图模型**（行、分组、小计、合计、假设与出处、情景对比），界面、PDF、表格导出都从它渲染，保证三处数字一致。版式在 TI-2 的四件套里定，参考第二轮开源调研（`docs/QINGYAN_TENDER_FLOW_OSS_SURVEY.md` §6，调研完成后补）。

