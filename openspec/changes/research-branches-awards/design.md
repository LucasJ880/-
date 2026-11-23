# Design：三个子代理（TREE-3）

## Context

TREE-2（`research-tree-runtime`）已经有：六步两波的图、`tender_research_branch` 的通用分支循环（一轮 = 一次模型请求，代码执行搜索 / 读页并扣额度）、审计游标 `research.branch_step`、外发闸、事实逐字核对、交接单 `research-handoff/v1`、分叉规则、树干摘要。条款一支交「未接通」；往期同标与同类项目两支用同一个通用目标，交回散的事实。

任务书 TREE-3 要：条款员（不联网，关键词规则 + 一次模型调用，引页码，结果在招标要求页只读可见）、往期同标员（联邦合同数据 + 搜索 + 读页）、同类项目员（搜索 + 读页，交回一组记录），单价与可比度是纯函数，子代理输出过不了结构校验就记失败、不编结果。

开工核对（2026-11-23，本地分支基于 main `70da7956` + TREE-2 `40371d3c`，只读）：

- 已解析的标书页：`ProjectDocumentPage`（`pageNumber` 从 1 起；PDF 是真页码，docx / xlsx / 纯文本是单元序号，显示要用 `unitLabel`；扫描页 `parseStatus = OCR_REQUIRED`、正文空）。只读加载 `tender-understanding/load-package.ts` 的 `loadTenderPackageInventory(projectId)`，「哪些是标书」用同目录 `package-input.ts` 的纯函数 `buildTenderPackage(...).includedDocuments`（排除系统生成文件、非招标文件、没解析好的与空文件），与一键分析同一口径。`tender-auto-analysis/package.ts` 的 `getTenderPackageDocuments` 会回写 `contentHash`，不用。
- 现有代码里没有等效品 / 指定品牌 / 加拿大含量的条款识别（只有测试夹具与一句提示词），规则表要新写；可借的写法是 `extract/facts.ts` 的「正则 + 优先页」表。
- 招标要求页：`src/components/project-detail/tabs/requirements-tab.tsx`（进度条、`BidFitMatrixCard`、`TenderAnalysisPanel`、RFI）。只读外挂卡片的先例：`BidFitMatrixCard`（读写 `TenderAnalysisRun.summaryJson.bidFitMatrix`）、`sourcing-suggestions-card.tsx`（接口 404 就不渲染）。其它轨道没有未合并的改动碰 `requirements-tab.tsx`（逐个看了 2026-11-20 之后推送的远端分支）。
- 联邦合同公开数据：`tender-intel/canadabuys.ts` 的 `searchAwardHistory({query, env, fetchImpl})`，GET `open.canada.ca` 的 CKAN 数据接口（不要 key），内部先判 `isExternalIntelEnabled`（`TENDER_EXTERNAL_INTEL_ENABLED`），超时 25 秒、每次最多 20 行；行里有中标方、合同额（加元）、合同日期、采购部门、描述、合同编号、可点开的查询网址，没有数量。`deriveAwardQueries` 是纯函数，从项目名、采购方、品项文字里取英文检索词。模块里没有敏感词闸。
- 公司名三档：`tender-competition/company-identity.ts` 的 `compareCompanyNames`（同名 / 建议同一实体 / 无关，纯函数）。
- 现有代码里没有「合同额 ÷ 数量」的函数；币种识别各处各写一份（`quote-engine/import/parse-xlsx.ts`、`tender-rfq/inbound-parse.ts`），都不是给授标原文用的。
- 项目的数量与合同期：`Project` 没有这两列；在最新一次可用分析（`REVIEW_REQUIRED` / `APPROVED`）的 `summaryJson.criticalFacts.quantity` / `contract_duration`，读法 `tender-rfq/round-pure.ts` 的 `readCriticalFactSlot`，归一化 `tender-understanding/normalize.ts` 的 `normalizeFactValue`。

## Goals / Non-Goals

**Goals**：三个子代理按任务书交回；条款三问带页码；授标记录带单价、口径、币种、可比度，全由代码算；分叉规则按记录数；条款结果在招标要求页只读可见；开关关零变化。

**Non-Goals**：核对与「已核实」（TREE-4）；区间、证据表、情报页签的卡片与「开始调研」按钮（TREE-5）；补页（TREE-6）；资料申请与澄清清单（TREE-7、TREE-8）；改关键事实槽位（判断点 3）。

## Decisions

### D1 三个子代理仍是同一个工具，按分支类别分派

`tender_research_branch` 按 `BRANCH_DEFS[stepKey].kind` 分派：`clauses` → 条款员（新文件 `clauses-run.ts`）；`prior_awards` → 往期同标员（通用循环 + 联邦数据一步）；`similar` / `similar_full` / `similar_relaxed` → 同类项目员（通用循环）。开关、Job 自检、项目自检、组织调低分支数与深度、续跑游标都走 TREE-2 的同一段代码。

备选：每个子代理登记一个新工具。不选：要再改 `tender-workforce/tools.ts` 三处与「原 9 个分析工具不变」的四份测试，图不变而工具变，没有收益。

### D2 条款员：规则先找段落，有命中才请求一次模型

1. 读本项目的标书：`loadTenderPackageInventory` + `buildTenderPackage(...).includedDocuments`（只读）。没有可用标书 → 「未接通：项目里还没有解析好的标书文件，没法查条款」；有标书但每页都没有文字（扫描件）→「未接通：标书都是扫描件，没有文字可查」。
2. 关键词规则（`clauses.ts` 的 `CLAUSE_RULES`，英法双语，按三问分组）：等效品（or equal / or approved equal / or equivalent / equivalent products / approved equals / substitutions … accepted、ou l'équivalent、produits équivalents）；指定品牌（no substitute(s) / substitutions will not be accepted / brand name / sole source / single source / proprietary / Limited Tendering / non-competitive / ACAN、aucune substitution、appel d'offres limité）；加拿大 / 本地含量（Canadian content / Buy Canadian / made in Canada / Canadian-made / -manufactured / -origin / domestic content / local preference / reciprocal procurement / country of origin、contenu canadien、fabriqué au Canada）；另有「等效证明」（proof / evidence / documentation / data sheet / test report / certificat… 与 equivalen… 相距 120 字内）。
3. 每个命中取前后各 300 字成一段，同一页重叠的合并；按三问轮流取，最多 16 段、合计不超过 12 000 字。每段由代码编号 S1…Sn，记文件、页码、单元类别与标签。
4. 一条都没命中：**不请求模型**，三问都「未写明」，各给一条澄清问题草稿（D3），理由写「关键词规则在 N 页标书里没有命中，没有请求模型」。
5. 有命中：一次 `callStructured`（`research-clauses/v1`，最多 2 次尝试，与 TREE-2 同口径：同一次请求里的重试与换备用模型不另算）。段落放在不可信资料块里。模型交回三问的答案（枚举）与引文（段号 + ≤200 字摘录），等效品另可交「要什么证明」的摘录。
6. 代码核对：段号必须存在，摘录 ≥12 字、逐字（不计空白多少与大小写）出现在该段里；答案不是「未写明」却没有一条核对通过的引文 → 改成「未写明」并标 `downgraded`（卡片写「模型给的出处对不上原文，按未写明」）。页码、文件名由代码按段号填，**模型不写页码**。

每棵树只请求一次（config 第 7 条例外二已登记）：请求前先记游标 `model_call`；续跑时见到已请求过、没有交单 → 不再请求，交「未接通：条款员这次的模型请求没有拿到结果」。为了不把唯一的一次撞在切片截止上，剩余时间不到「模型超时 + 15 秒」就先让出。组织把每支模型请求调到 0 → 不请求，交「到上限」。

备选 A：只用规则。不选：任务书要一次模型判断；规则分不清「equivalents will not be accepted」与「will be accepted」。备选 B：整份标书给模型。不选：成本高、注入面大，页码要模型写。

### D3 澄清问题草稿用固定模板

三问各一条英文草稿（采购方是加拿大政府，正式澄清用英文）+ 中文说明，只在该问「未写明」时给。例：等效品「Please confirm whether equivalent products will be accepted for the specified items and, if so, what documentation is required to demonstrate equivalency (e.g., product data sheets, test reports).」。不调模型。

备选：让模型写。不选：例外二没有登记这一处调用；草稿要稳定、可审。

### D4 条款员的结果在招标要求页只读展示

- 新卡片 `ResearchClausesCard`（`src/components/tender-analysis/research-clauses-card.tsx`）放在 `BidFitMatrixCard` 之后，`requirements-tab.tsx` 只加一行。
- 卡片读新接口 `GET /api/projects/[id]/research-tree`：第一步不带条件地调用 `requireProjectReadAccess`（FIX-21 写法，读权限即可，与授标历史读取同口径）；项目没有组织或开关关 → 404，卡片不渲染（同 `sourcing-suggestions-card.tsx`）。返回本项目最新一棵调研树（按建立时间）的 Job 状态与条款一步的结果；不读情报室（条款一支完成就能看到，不用等树干）。
- 没有调研树 → 卡片不渲染（「开始调研」按钮在 TREE-5）；在查 → 「条款员还在查」；查完 → 三问、引文（文件名 + 页码 / 单元标签 + 摘录）、证明要求、未写明的澄清草稿；未接通 → 原因句。读取中与读取出错也不渲染：这张卡是补充信息，不让开关关着的项目因为网络出错多出一张卡（代价：开关开着时读取出错，用户看不到这张卡，要刷新）。
- 只读：卡片与接口不写任何数据、不改已确认的要求、不进关键事实槽位（判断点 3）。

备选 A：写进 `TenderAnalysisRun.summaryJson`。不选：调研 Job 去写分析运行，会与一键分析重跑互相覆盖，且要锁分析行；TREE-2 的隔离库测试还断言分析记录不被调研碰。备选 B：只放情报页签。不选：任务书写明招标要求页。

接口只给条款结果（文件名、页码、标书摘录与枚举），不给金额与网页内容；TREE-5 在同一接口上加整棵树的读取。

### D5 授标记录：事实分组，由代码组装

- 模型交事实时可带 `group`（≤12 字的组名）：同一页上属于同一笔授标的事实同组；没写组名的，同一页的事实算一组。
- 代码把同一网址、同一组的已核对事实组装成一条记录 `ResearchAwardRecordV1`：采购方、中标方、品项、往期标名、合同额、数量、年份、币种、口径，每个字段带原值与摘录；再由纯函数算解析后的金额 / 数量 / 年份、单价、口径、币种、可比度。
- 事实类型：往期同标 `prior_tender`、`winner`、`buyer`、`item`、`award_amount`、`quantity`、`award_year`、`currency`、`scope_basis`；同类项目同上去掉 `prior_tender`。去掉 TREE-2 的 `comparable_award`（被记录取代）。
- 保留条件：往期同标记录要有中标方、合同额或往期标名之一；同类记录要有合同额或中标方之一。凑不成记录的事实仍在 `found[]` 里。每支最多 20 条记录。

备选：模型直接交记录（每个字段一个摘录）。不选：与给事实分组等价，却要另写一套核对；分组让 TREE-2 的逐字核对原样复用。

### D6 单价：合同额 ÷ 数量，原币，精确到分

`unitPriceOf(amount, quantity)`：两数都是从值里解析出的十进制（`BigInt` 运算，不用浮点），单价 = 合同额 × 10^小数位 ÷ 数量，四舍五入到分；不换汇、币种照合同额的。金额或数量缺、为 0、写成区间、一个值里有两个数 → 不算（`null`）。金额写法认 `230,000`、`$230,000.00`、`230000 CAD`、`1.25 million`、`230k`、`230 thousand`、`23万`；数量认 `10,000`、`10 000 units`。验收合成数：10000 / 230000 → 23.00、8000 / 200000 → 25.00、12500 / 262500 → 21.00。

### D7 口径：四个标签加「不明」，子代理判断，代码核摘录

`scope_basis` 事实的值只能是 `installation`（含安装）/ `freight`（含运费）/ `multi_year`（多年期）/ `multi_item`（多品项），摘录逐字在页上，并且摘录里要有对应的提示词（install… / freight、delivery、shipping、FOB、DDP… / year、term、multi-year、两个年份… / items、lots、various、assorted…），对不上就丢。一条记录可有多个标签；一个都没有 → 「不明」。口径不影响单价怎么算，TREE-4 规则 ⑤「口径不明另标」据此判断。

备选：让代码按关键词自己判口径。不选：任务书写「口径由子代理从原文判断并附摘录」；代码只做提示词核对，防模型乱贴标签。

### D8 币种：写明的、按网站推断的、数据集的、不明

先看 `currency` 事实（值 CAD / USD，摘录里要有对应写法）；再看合同额的值与摘录里的写法（`CAD`、`C$`、`CA$`、`CDN$`、`Canadian dollars` → CAD；`USD`、`US$`、`U.S. dollars` → USD；两种都有 → 不明）；都没有时按网站推断（主机以 `.ca` 结尾 → CAD，以 `.gov`、`.mil`、`.us` 结尾 → USD），标「按网站推断」；联邦合同公开数据 → CAD（数据集口径）；其余 → 不明。币种分开列，不换汇（拍板第 6 项）。

备选：没写明一律「不明」。不选：加拿大政府页几乎都只写 `$`，会让多数记录币种不明、TREE-5 出不了区间；推断另标，TREE-4 / TREE-5 可以不认。

### D9 可比度：四项，每项 是 / 否 / 不明，分数为「是」的个数

`comparabilityOf(record, project)`（纯函数）：

| 项 | 「是」的条件 | 「不明」 |
|---|---|---|
| 同采购方 | 公司名三档为同名或建议同一实体 | 任一方没有采购方 |
| 同规格 | 项目名与类别的关键词（去掉 supply、delivery、contract、tender、city 等通用词，复数归一，最多 5 个）与记录品项 / 往期标名的关键词相同的不少于一半（至少 1 个） | 任一方没有关键词 |
| 数量相近 | 记录数量 ÷ 项目数量在 0.5 到 2 之间（含两端） | 任一方没有数量 |
| 近 3 年 | 参照年（截标年份，没有就今年）往前 3 年到往后 1 年之内 | 记录没有年份 |

项目数量取最新一次可用分析的关键事实 `quantity`（`normalizeFactValue` 取出第一个数），没有就「不明」。

备选：加权分。不选：任务书写「四项打分」，权重没有依据；四项分开给，人与 TREE-4 都能看懂。

### D10 往期同标员先查联邦合同公开数据（确定性的一步）

- 第一轮模型请求之前，代码用 `deriveAwardQueries({项目名, 采购方, [类别]})` 取前 2 个检索词，逐个过外发闸，再调 `searchAwardHistory`；每次算本支一次搜索（与网页搜索共用 16 次）。外部情报开关没开、没有英文检索词或被闸拦下 → 跳过，理由写明，接着用网页搜索与读页。
- 结果行里采购方与本项目同一（三档不是「无关」；本项目没有采购方时全收）的，按合同日期从近到远取前 5 行转成记录：来源「联邦合同公开数据」，网址是查询网址，字段的摘录是代码按原始字段拼的一行（`中标方 · 合同额 · 日期 · 采购部门 · 描述`），币种 CAD（数据集口径），带合同编号。
- 全部行（最多 10 行）放进不可信资料块交给模型，提示「已记为记录，可以搜它们的授标公告补数量」。
- 游标：发出前记 `search_sent`（`source: "open_data"`），结果记 `open_data_result`（状态、行数、收下的记录）；续跑不再查。
- 剩余时间不到一轮（45 秒，大于数据接口的 25 秒超时 + 15 秒余量）就先让出。

备选：让模型决定查不查联邦数据。不选：确定性优先；这一步便宜、该先做。备选：联邦数据不占搜索额度。不选：它是对外的查询，按次计才守得住「每支 16 次」。

### D11 分叉规则按记录

- 第二波甲：② 一条记录都没有 → 跑（「往期同标没查到成条的授标」）；有 → 「无需追查：往期同标查到了 N 条」。
- 第二波乙：③ 与甲能算出单价的同类记录（按记录号去重）不足 3 条 → 跑；否则「无需追查：同类授标已有 N 条能算单价」。
- 待反查：往期同标记录的中标方名，照 TREE-2 只收安全的名字。

### D12 交接单仍是 `research-handoff/v1`，加两项

加 `records[]`（授标支）与 `clauses`（条款支，其余为 `null`）；没有这两项的旧单按空处理。短标签：授标支「查到 N 条」的 N 是记录数（只有零散事实、凑不成记录时状态「没查到」，原因句写「只收下了零散的事实，凑不成一条授标」）；条款支「写明了 N 项」/「都未写明」。

备选：升 `v2`。不选：TREE-2 没在任何环境打开过开关，没有存量交接单；加字段向后兼容，TREE-4 / TREE-5 读同一个版本。

### D13 交给模型的项目资料加数量与合同期

同类项目员要「数量」，往期同标员要「合同期」。来自同一份关键事实，只给归一化后的形式：数量只给一个数，合同期只给天数（只有文字时不给）。这两项是招标文件写明的，不是我方内部数；外发闸照旧只拦估值、我方报价、中标价。

### D14 树干摘要加两项

每支加 `recordCount`；整树加 `clauses`（三问的答案枚举，没有条款结果为 `null`）。仍不放金额、摘录、页码、网址与模型自由文字。

### D15 提示词版本

授标支 `research-branch/v2`（加分组、新事实类型、数量与合同期、联邦数据块）；条款员 `research-clauses/v1`。

## 不确定处的结论（与本 change 有关的）

| 任务书不确定处 | 结论 |
|---|---|
| 6 授标金额对谁可见 | 现有口径是项目读权限（`award-history` 的读取用 `requireProjectReadAccess`，只有我方成本另有财务权）。本 change 的读取接口只给条款结果，不给金额；记录（含金额）只在步骤业务输出里，TREE-5 的读取照项目读权限给 |
| 3 判断点「条款员要不要进关键事实槽位」 | 按默认：不进，只在调研树里；招标要求页只读展示（D4） |
| 5 美国范围用什么找 | 按默认：只用搜索与读页（第二波乙「加上美国」） |

## Risks / Trade-offs

- 关键词规则会漏写法（例如只写「brand X model Y」不写 or equal）：漏了就「未写明」+ 澄清草稿，宁可问。
- 联邦数据的采购方名与项目采购方写法不同（缩写、英法两写）时三档判「无关」，记录会少；模型仍看得到全部行，可以接着搜。
- 「同规格」只比关键词，英法两写、同义词会判「否」；四项分开给，人能看出来。
- 币种按网站推断可能错（例如 `.ca` 网站转载美国授标）；另标「按网站推断」。
- 条款员的唯一一次请求失败就没有结论（不重试第二次），要等「重新查」（TREE-5）。

## Migration Plan

无迁移。回退：revert 本 PR；交接单多出的两项字段旧代码不读。

## Open Questions

- 「同规格」的关键词口径、「近 3 年」往后 1 年的宽容，待预发用真实标书看效果再调（只改常量）。
