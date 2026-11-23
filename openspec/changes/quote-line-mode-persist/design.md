# Design：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

## Context

- 新页面 ② 定报价（BIDPAGE-1）现在挂的是旧组件：投标工作区面板（`BidWorkspacePanel`，里面的成本卡把成本写在浏览器 `localStorage`）、我方报价卡（`TenderOurBidCard`，只显示，点进去是专业模式）、旧报价区（`BidQuoteArea` = 报价引擎列表 + 折叠的「外贸标准报价」）。整块只给「报价内部成本权限 ∧ 财务查看权」的人挂（附录 C 决定 C，BIDPAGE-1 design D5）。
- 报价引擎（`src/lib/quote-engine/`）：一份 `ProjectQuote` 带若干 `QuoteCostLine`；`computeQuote`（纯函数，浮点 `round2`）按「直接成本 → 成本百分比（关税）→ Sunny 链（资金使用 → 管理费 → 现金备用金）→ 卖价 → 收入基数行 → 提成」算出卖价、成本、毛利；结果只到每条成本行的成本金额（`LineResult.amount`），没有逐行卖价。`engineConfigSchema` 是非严格 `z.object`。专业模式（`PricingControlCenter`）整组提交成本行（`updateEngineQuote` 删掉不在提交里的行、按 id 更新、其余新建，新建行不带 `metadata`），也能改报价币种、定价方式；`reviseQuote` 照抄所有成本行字段（含 `metadata`）与 `engineJson`，行 id 换新。选为我方报价在专业模式的 `TenderBidPanel` 上做；只有一份已批准时 `syncTenderBidPointerTx` 自动选中。
- 只供货模板（`templateSupplyOnlyLines`）15 行：货品（`PROCUREMENT` 按件，CNY）、国内运费、海运费（按柜）、报关费、关税（成本百分比，基数 `PROCUREMENT`，默认不计入）、加拿大境内运费、包装、深化图、保险、售后预留（不计入）、资金使用（年化 8%，1 个月）、管理费（自含 3%）、现金备用金（1%，类别 `OTHER`）、提成（毛利 30%）、预备金（不计入）。
- 价格表：只有投标工作区面板能保存价格表（存在 `BidIntelligenceRoom.summaryJson.bidWorkspace.priceSchedule.lines`，行身份 `lineNo`，单位须属 `PRICE_SCHEDULE_UOMS`）；面板在 `TENDER_BID_WORKSPACE_ENABLED` 后面（生产没开）。读取函数 `loadWorkspace` 不看开关。招标分析里的数量线索由 `loadSchedulePrefill` 变成粘贴框文本（只读、不看开关）。按招标方价格表导出 `exportOfficialPriceSchedule(lines, unitPrices)`（纯函数，单价取到分、行合计 = 单价 × 数量）今天没有接口、没有界面。
- 询价回复：`InquiryItem` 一家供应商一轮一个 `unitPrice` / `totalPrice` / `currency`（自由字符串，默认 CAD），没有逐行报价。既有询价、比价接口只要项目读权限（CHAIN-2e #556 在收口），新页面不拿它们给金额。
- 在途：CHAIN-2e（#556，草稿）改 `src/lib/quote-engine/access.ts`、`quote-engine-contract.test.ts`、专业模式四个组件、`project-finance/access.ts`；本 change 不碰这些文件。FIX-21（#554，2026-11-23 已合并）的目录守卫 `project-routes-guard.test.ts` 要求 `src/app/api/projects/[id]/` 下每个处理函数第一步不带条件地调用名单里的守卫并紧接着检查（`requireQuoteAccess` 在名单里），本 change 的新接口照这个写法，由它与本 change 自己的源码断言各查一遍。

## Goals / Non-Goals

**Goals**：逐行做报价、成本进系统（换电脑、换人看到同样的数）；只有引擎一套算法，逐行表的数与引擎、专业模式一致；单价取到分带来的差额如实说明；能按招标方价格表导出；开关关着时零变化。

**Non-Goals**（不动的文件 / 模块）：
- `src/components/project-detail/tabs/bid-tab.tsx`、`src/components/quote-engine/bid-quote-area.tsx`、`src/components/quote-engine/pricing-control-center.tsx` 及专业模式页 `src/app/(main)/projects/[id]/quote-engine/[quoteId]/page.tsx`、`src/components/quote-engine/tender-our-bid.tsx`、`src/components/tender/bid-workspace-panel.tsx`（旧页面照挂）。
- `src/lib/quote-engine/calc.ts`、`templates.ts`、`tender-bid.ts`、`access.ts`、`customer-quote.ts`；`src/lib/tender-price-schedule/official-export.ts`、`unit-conversion.ts`；`src/lib/tender-bid-workspace/*`（只读调用）；`src/lib/tender-bid-cost/*`（只复用 `freight.ts` 的 `allocateCharge`）；`prisma/`。
- 既有接口 `/api/projects/[id]/quote-engine/**`、`/bid-workspace/**`、`/inquiries/**`。

## Decisions

### D1：做法存在 `engineJson.entryMode`；新建时两问；只有「逐行 + 只供货」进逐行表

- `engineConfigSchema` 加 `entryMode: z.enum(["LINE"]).optional().catch(undefined)`（BIDPAGE-4 再加 `"LUMP_SUM"`）。核对（不确定处 2）：非严格 `z.object`，旧数据与旧前端照样通过；`engineOf` 用 `safeParse`；`updateEngineQuote` 先合并 `engineOf(q)` 再 `parse`，专业模式回写 `engine: {}` 时字段保留；`reviseQuote` 原样照抄 `engineJson`。没有 `entryMode` 的配置解析结果与改前逐字段相同（测试对照）。不认识的值（例如 BIDPAGE-4 写入 `LUMP_SUM` 后被单独回退）只丢掉这个字段，税、情景等照旧——不用 `.catch` 时整份配置解析失败、`engineOf` 退回默认配置，税额会变。回退本 change 后，旧代码下一次保存引擎配置会丢掉这个字段，那份报价改按专业模式打开，成本行不丢。
- 新建（② 里「新建报价」，要编辑权限）：问「这个标怎么交价？」（本 change 只有「逐行报价」）与「业务类型」（只供货（默认）/ 供货加安装 / 长期供货协议）。
  - 逐行 + 只供货 → 新建逐行报价（`quoteType = SUPPLY_ONLY`、`currency = CAD`、`pricingMethod = MARGIN_ON_REVENUE`、`entryMode = LINE`），同一次写入建好货品行（有价格表时）、4 条共用参数行（汇率不是成本行）、4 条预置行（D3）。
  - 供货加安装 / 长期供货协议 → 照今天的 `createEngineQuote`（同样的模板），不带 `entryMode`，打开专业模式页。这是与任务书的出入：任务书把业务类型问在两种做法之前，但供货加安装的模板有 31 行（安装、人工、设备等），长期供货协议有分级与容器计算，逐行表只管货品与四项共用参数，管不了这些；任务书也写明这两类「供……大项目和长期供货协议使用」专业模式。报告里请 Evan 确认。
- 逐行报价的新建在本 change 的服务里写（照 `createEngineQuote` 的字段、快照与审计 `quote_created`），为的是同一次写入带上 `metadata` 与 `entryMode`；报价编号沿用 `service.ts` 里的 `nextQuoteNumber`（只加 `export`，不改行为）。
- 备选与否决：
  - 做法记在成本行 `metadata` 里、不改 `engineConfigSchema`——否决：任务书指定 `engineJson`，且做法是报价级的属性，放到每条行上要在读时取多数。
  - 先 `createEngineQuote` 再第二步写行——否决：两次写入之间失败会留下一份空的只供货报价。

### D2：成本存在 `QuoteCostLine`；行身份放 `metadata.bidLine`；只动自己管的行

- 每条由逐行表管理的成本行带 `metadata.bidLine = { v: 1, role, key, … }`：
  - `role = "goods"`：一个价格表行。另存 `lineNo`、完整说明（≤500 字；成本行 `description` 只收 300 字，截断时以「…」结尾）、单位、包装数、报价口径（按件 / 按招标单位）、原样的供应商报价、证据类别、选中的询价回复 `inquiryItemId`、行来源（价格表 / 招标分析带入 / 粘贴 / 手加）。
  - `role = "shared"`，`key ∈ ocean_freight | customs | duty | domestic_freight`；`role = "preset"`，`key ∈ financing | admin | cash_allowance | commission`。
  - `metadata` 里已有的别的键（成本导入的来源记录）原样保留，只合并 `bidLine`。
- 保存（D7 的写接口）在一个事务里：按 id 更新 / 新建自己管的行；删掉不再出现的货品行；**不碰没有 `bidLine` 的行**（在专业模式里加的行，逐行表不列，四个数照算，界面上写「另有 N 条其它成本行，已算进四个数」）。
- 不写 `QuoteLineItem`（附录 C 决定 H：那张表归给客户的报价单，`customer-quote.ts` 会整组删改，`reviseQuote` 复制时丢字段）；不写 `localStorage`（只有一个不含金额的「提示过」标记，D8）；不写 `BidIntelligenceRoom.summaryJson`。
- 并发：保存带读取时的 `updatedAt`；事务第一句按 `id + updatedAt + 非冻结` 做条件更新，0 行 → 409「这份报价刚被别人改过，请刷新后再改」，整笔不写。冻结状态（已批准等）→ 409。
- 与专业模式改同一份报价（规格「与专业模式改同一份报价」）：
  - 按改后的读出并提示：货品行单价改过（按改后的价、按招标单位）、品名改过、同一币种填了不同汇率（读第一个，保存后统一）。
  - 保存时改回并事先提示：货品行被设成不计入（重新计入）、货品行或共用参数 / 预置行的类别或算法被改（改回模板的算法）、共用参数或预置行被删（重新建一条；预置按关掉显示）、定价方式改成了成本加成（改回按售价毛利；目标毛利率空着时保存 400「请先填目标毛利率」，不会悄悄变成零毛利）。
  - 专业模式删掉的货品行回到逐行表就没有了；专业模式「复制」出来的行没有 `bidLine`，算作其它成本行。
  - 专业模式把报价币种改成别的：逐行读、存、导出都 409，叫去专业模式（逐行表的汇率、金额都按加元写）。
  - 另起新版（`reviseQuote`）照抄 `metadata` 与 `entryMode`，新版照样是逐行报价；行身份不依赖成本行 id（新版 id 会换）。
- 备选与否决：
  - 写 `QuoteLineItem`（任务书原文）——否决：附录 C 决定 H。
  - 逐行保存复用 `updateEngineQuote` 整组提交——否决：它不写 `metadata`（新建行丢行身份），而且会删掉专业模式加的行。

### D3：共用参数与预置都是成本行；值与模板相同；一种币一个汇率

| 界面 | 成本行（类别 / 计算方式） | 默认 |
|---|---|---|
| 汇率（每种出现的外币一个，「1 CNY = ? 加元」+ 来源） | 写进每条该币种的行的 `fxRate` / `fxRateSource` | 空（必须填，否则引擎报「需要汇率」） |
| 海运费（柜数 × 每柜） | `FREIGHT` / `PER_CONTAINER`（柜数写在 `duration`） | 空或柜数 0 = 这项没有（不计入） |
| 报关费 | `CUSTOMS` / `FIXED` | 空 = 没有 |
| 关税率 | `DUTY` / `PERCENT_OF_COST`，基数 `PROCUREMENT` | 空 = 没有 |
| 国内运费（中国境内） | `LOGISTICS` / `FIXED` | 空 = 没有 |
| 资金使用 | `FINANCING` / `PCT_ANNUALIZED_ON_COST`，8%，1 个月 | 计入 |
| 管理费 | `ADMIN` / `PCT_SELF_INCLUSIVE_ON_COST`，3% | 计入 |
| 现金备用金 | `OTHER` / `PCT_ON_COST_SUBTOTAL`，1% | 计入 |
| 提成 | `COMMISSION` / `PCT_OF_GROSS_PROFIT`，30% | 计入 |
| 目标毛利率（按售价） | `pricingMethod = MARGIN_ON_REVENUE`，`pricingRate` | 空 |

- 计算方式、比例、月数与 `templateSupplyOnlyLines` 逐项相同（测试对照），所以同一份报价在逐行表与专业模式里的数一样。货品类别用模板的 `PROCUREMENT`（任务书写「按 tender-bid-cost 已对齐的类别」，那边货品是 `MATERIAL`；两者同属 `PROCUREMENT` 基数，关税结果一样）。
- 空着的共用参数写成「不计入」并保留库里原来的数，而不是写 0（避免引擎的「未定价」警告挡住批准）；货品行没填报价的照样计入、引擎报「未定价」——没填完的报价批不了。
- 说明文字照引擎的真实算法写（与任务书的简写不同处）：
  - 资金使用 =（直接成本 + 关税）× 年化比例 ÷ 12 × 月数（不足一月按一月）；
  - 管理费 = 基数 ÷（1 − 比例）− 基数，基数 = 直接成本 + 关税 + 资金使用（100 → 103.09）；
  - 现金备用金 =（直接成本 + 关税）× 比例；
  - 提成 =（报价 − 提成前的成本）× 比例，计入成本，所以顶部毛利率比目标毛利率低；
  - 定价：报价 = 提成前的成本 ÷（1 − 目标毛利率）。
- 一种币一个汇率：读取时取该币种第一条有汇率的行；保存时写到该币种的每一条自己管的行。
- 本 change 新建的行用中文说明（新代码路径，只在开关开时走）；模板本身的说明不改（BIDPAGE-8）。加拿大境内运费、包装、保险等模板里的其它行不进逐行报价，需要时在专业模式里加（它们算作其它成本行）。
- 备选与否决：共用参数放在 `engineJson` 里、读时展开成虚拟行——否决：引擎只认成本行，放在别处要改 `computeQuote` 的输入（任务书禁止改算法）。

### D4：每行的数怎么来（不确定处 1 / 4 的结论，正式写入）

逐行表只显示引擎结果的分摊，不另算：

1. 每条货品行的货值 `g_i` = 引擎该行 `LineResult.amount`（加元，已 `round2`）；`G = Σ g_i`（只算填了报价的自己管的货品行）。`G = 0` 时不分摊，各行显示「—」。
2. 份额 `s_i = g_i / G`。关税按货值计、海运等共用费用按货值摊，资金使用 / 管理费 / 备用金 / 提成按到手成本比例摊——这几样都与货值成正比，所以一律按 `s_i` 摊；其它成本行（专业模式加的）也按 `s_i` 摊进去。
3. 到手成本 =（`directCost + percentOfCostTotal`）× `s_i`，舍入到分、余数归最后一行（`tender-bid-cost/freight.ts` 的 `allocateCharge`，「按货值」），各行之和等于引擎的数；到手单位成本 = 到手成本 ÷ 数量。到手成本含专业模式里加的其它直接成本（保险、深化图等），表下写明。
4. 我方单价 = `sellingPrice × s_i ÷ 数量` 按四舍五入取到分（`priceLine`，与导出同一个函数）；行合计 = 单价 × 数量（取到分）。没填报价的行单价为空，导出时按「缺单价」拒绝。
5. 行毛利率 =（行合计 − 成本合计 × `s_i`）÷ 行合计。各行毛利率**接近**整体但不总相同：单价取到分的相对误差是 0.005 ÷ 单价，单价很小时偏差明显（例：真实单价 0.123、数量 1000，取成 0.12，这一行约 15.4%，整体 17.5%）。
6. 顶部四个数一律取引擎：报价合计 `sellingPrice`、成本合计 `estimatedCost`、利润 `grossProfit`、毛利率 `grossMarginPct`（已扣提成）。
7. 逐行合计 `Σ 行合计`（`priceSchedule().total`）与 `sellingPrice` 的差不超过 `Σ(数量 × 0.005)`（数量带小数的行，行合计还要再取一次整，每行再加 0.005）。差额不为 0 时顶部单列一句：「逐行合计 X 比报价合计 Y 多 / 少 Z：每行单价取到分后乘数量造成（最多差 B）。导出给招标方的是逐行合计。」差额不总是「几分钱」：数量大时可观（数量 50,000 的一行最多差 250 加元），所以界面同时写出上限。系统记的我方报价仍是引擎合计（`Project.ourBidPrice` 不变），与交给招标方的价格表合计可能差这么多——已知后果，报告里量化并请 Lucas / Evan 确认。差额与上限都由测试锁住（60 组随机合成数据 + 一组手算）。
8. 引擎算不出（缺汇率、毛利率 ≥ 100% 等）→ 不分摊，顶部写引擎给的原因；警告（未定价、亏损、没有预备金）照引擎列出，中文说明。

- 备选与否决：
  - 按行挑进位方向（最大余数法）把总差额压到约「最大数量 × 0.01」——否决：每行单价不再是「份额 × 报价 ÷ 数量」的四舍五入，同一组数据不同的人看到的单价取法不直观，交给招标方的单价也会出现「看起来该进不进」；差额上限已在界面写明。
  - 让引擎按逐行合计反推报价——否决：要改 `computeQuote` 的口径（任务书禁止）。
  - 按体积 / 重量分摊共用费用——否决：价格表与询价回复里都没有体积、重量；按货值是唯一有数据的依据。
  - 用 `tender-bid-cost` 的逐行核算（`prepareLine` / `computeCostScenario`）出数——否决：第二套算法，没有管理费 / 资金使用 / 提成（不确定处 4 已核对）；它的 `reconcile.ts` 是两套算法对账用的，只有一套算法时不需要。
- MOQ / 整箱取整引擎没有，逐行报价不做。供应商按件报价、价格表按包计的，按包装数换成招标单位价写进成本行（`mapping.ts` 的换算与 `unit-conversion.ts` 的 `convertQuoteToTenderUom` 同一规则：成组单位必须有包装数，其余单位每单位 1 件；结果取到 4 位，与库里 `Decimal(18,4)` 一致）。

### D5：行从哪里来

- 新建时：投标工作区存下的价格表（`loadWorkspace` + `validatePriceSchedule` 通过）→ 每行一条货品行（来源「价格表」）。不看投标工作区开关、不调它的接口（任务书 Out of scope）。**生产上几乎没有存过的价格表**：只有投标工作区面板能存，它的开关没开，新页面也不再挂它（D10）。所以实际的入口是下一条。
- 没有可用价格表：逐行表先是空的，上方三个入口——「从招标分析带入」（`loadSchedulePrefill` 的文本填进粘贴框，连同它的说明与没带入的条目；人核对后点「导入这些行」）、粘贴（`parseSchedulePaste`，有问题逐行说明、不猜）、「加一行」（品名、数量、单位从 `PRICE_SCHEDULE_UOMS` 里选）。导入是追加；删行后行号重排（价格表导出要求从 1 连续）。
- 验收 5「行自动来自已确认的价格表」：预发要先有存过的价格表（隔离库测试已覆盖这条路径）；否则按「招标分析带入 → 核对 → 导入 → 保存」验。报告里写明。
- 上限 300 行（与招标分析带入同一个上限）；品名 ≤500 字；数量 > 0。`tender-bid-workspace/line-entry.ts` 管的是品牌型号与证书，与加行无关，不复用。
- 备选与否决：逐行报价导入的行顺便写回投标工作区的价格表——否决：那要调投标工作区的保存（它的接口在开关后面），且会让投标工作区里出现没核对过的价格表。

### D6：供应商报价——从询价回复里点选，或手填带证据

- 读接口附带本项目已回报价的询价回复（各轮、未取消的询价单、状态「已报价」）：供应商、轮次、回复时间、单价、总价、币种。只给看得到金额的人（与整个接口同一门）。
- 点选：把该回复的单价与币种填进这一行，记下 `inquiryItemId`；供应商（成本行的 `supplierId` / `supplierName`）由服务端按回复取，不信提交里的；来源记「询价回复」。提交时价或币种与回复不一致 → 400「改了价就请改成手填并选证据类别」。只报了总价、没有单价的回复不能点选，写明「这家只报了总价 X，请手填单价」——不按数量去除（不猜）。回复的币种不在报价币种里（如「RMB」）不能点选，写明请手填。点选后提示核对单位与币种（回复的币种默认是 CAD，可能掩盖供应商没写币种）。
- 手填：必须选证据类别（`QUOTE_EVIDENCE_KINDS`：已签报价 / 平台标价 / 零售价 / 估计），不选不让保存（400，指到那一行）。
- 报价口径：价格表行有包装数时可选「按件」或「按招标单位」，按件时乘包装数换成招标单位价写进成本行，原价与口径留在 `metadata`；成组单位没有包装数时只能按招标单位。
- 备选与否决：按品名把询价回复自动对到行——否决：回复是一家一个价、没有逐行，自动对等于猜。

### D7：接口与权限

| 接口 | 守卫（第一步） | 之后 |
|---|---|---|
| `GET /api/projects/{id}/bid-page/quotes` | `requireQuoteAccess(…, "internal_cost")` | 报价列表（名称、编号、版本、状态、做法、币种、报价合计、是否我方报价、专业模式地址）、能否编辑 / 批准、可用价格表行数、能否导出（不能时的原因） |
| `POST …/bid-page/quotes` | `requireQuoteAccess(…, "edit")` | 两问 → 201 `{ id, entryMode, proModeHref }`；请求不对 → 400 |
| `GET …/bid-page/quotes/{quoteId}/line` | `requireQuoteAccess(…, "internal_cost")` | 不是逐行报价、或币种不是加元 → 409（去专业模式）；返回行、共用参数、预置、提示、其它成本行、引擎结果与分摊、询价回复、表空时的带入文本 |
| `PUT …/bid-page/quotes/{quoteId}/line` | `requireQuoteAccess(…, "edit")` | 校验 400（指到第几行）→ 冻结 / 被别人改过 409 → 事务写 → 快照 → 审计 `quote_updated` → 返回新视图 |
| `GET …/bid-page/quotes/{quoteId}/export` | `requireQuoteAccess(…, "internal_cost")` | 不是当前我方报价 / 不是逐行报价 / 有新版待定 / 缺单价 → 409 带原因；否则 `text/csv`，`Content-Disposition` 文件名含报价编号与版本 |

- 写法照 FIX-21：取参数后第一句就是守卫、紧接着检查；之后依次：新页面开关与招投标项目（否则 404「新版标书与报价页未启用」，不读库）、金额门（`resolveFinancePrivilege(user, orgId, ownerId).canReadAll`，否则 403「报价的金额与成本只给项目负责人和有财务查看权的同事看……」）。报价引擎开关关着时 `requireQuoteAccess` 自己就是 404。写接口在过门之前不读请求体。
- 接口放在 `bid-page/` 下而不是 `quote-engine/` 下：不碰 CHAIN-2e 正在改的 `quote-engine-contract.test.ts`；本 change 自己的测试用源码断言锁住每个处理函数的守卫与金额门。
- 任务书写「没有成本权限的人只看到报价合计」，与附录 C 决定 C（新页面所有金额都要金额门）不一致；按更保守的决定 C：② 整块只给看得到金额的人（BIDPAGE-1 已如此），报价合计也不给。
- 不恢复「有编辑权、没有财务查看权」的人在新页面上编辑（BIDPAGE-1 TASKFLOW 里记的义务改判，TASKFLOW 行同步改写）：逐行表本身就是成本，编辑必须看见成本；Evan 2026-11-22 对 CHAIN-2e 的答复 ① 已接受「不是项目负责人的投标同事不能新建、编辑、批准报价」，前提「谁做报价谁就是负责人」（负责人有财务特权，`decideFinancePrivilege`）。实际后果：开关开着时，不是负责人、只有分派范围财务查看权的投标同事，在新页面上完全做不了报价（旧页面上他们能）——报告里请 Evan / Lucas 确认。
- 看得到金额但没有编辑权限的人：列表写「新建、修改报价需要项目编辑权限，请找项目负责人」；逐行报价里写「你可以看这份报价，但没有编辑权限；要修改请找项目负责人」（Evan ① 要求的白话说明）。
- 备选与否决：写接口只要 `edit`、不要财务查看权——否决：存接口返回整份逐行视图（全是成本），没有财务查看权的人等于拿到成本。

### D8：旧的本地成本草稿

- 只在逐行报价打开时、只在浏览器里读一次 `costDraftStorageKey(projectId)`（`parseCostDraft`，坏数据当空）；没提示过、且草稿里有填了报价的行，才在表上方提示一次：「发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？」——「导入」/「不导入」。判定是纯函数 `draftToPrompt`（测试覆盖）。
- 导入（纯函数，按 `lineNo` 对上——草稿与逐行表的行都来自同一张价格表）：供应商报价、口径、币种（转大写；不在报价币种里的那一行不带入并写明）、证据类别、各币汇率与来源；目标毛利率只在报价还没填时带入（草稿「按售价毛利」= 引擎 `MARGIN_ON_REVENUE`）。草稿里逐行的关税、运费、送货费、其它费用、进口 GST 不导入（逐行报价里是共用参数），提示里写明。导入只改表上的值，人点「保存」才写库。
- 提示过一次后在这台电脑上记一个不含任何金额的标记（`qy.bidPage.costDraftPrompted.<projectId>`），不再提示；草稿本身不删、不改。
- 备选与否决：打开时自动导入——否决：判断点 6「人点了才导入」。按品名再核一遍行——否决：价格表的品名常有重复（同品不同尺寸），按品名对反而更容易错。

### D9：按招标方价格表导出

- ② 底部：当前我方报价已定（AUTHORITATIVE）且是逐行报价 → 「按招标方价格表导出」可点；否则灰着并写原因（「报价定为我方报价后才能导出」/「我方报价有新版还没定……」/「我方报价不是逐行报价做的，不能按价格表导出」）。导出处写明「导出的是逐行表里的行（品名、数量、单位以表里为准），交出去之前请与招标方的价格表核对」。
- 接口用 D4 的单价调 `exportOfficialPriceSchedule`（品名用完整说明、单位与数量取行），返回 CSV；校验不过 / 缺单价 → 409 带它的中文原因。导出的单价、行合计与逐行表一致（同一个 `priceLine`）。CSV 列名与「不含 HST」是交给招标方的英文正文，照 `official-export.ts`。
- 已知限制：`official-export.ts` 的 CSV 没有防公式注入（品名以 `=`、`+`、`-`、`@` 开头时 Excel 会当公式）；品名来自招标方自己的价格表，本 change 不改那个共用文件，记为后续。
- 备选与否决：有存过的价格表时逐行比对、不一致就拒绝导出——否决：生产上几乎没有存过的价格表（D5），而且补遗常要改行；改为在导出处写明并请人核对。

### D10：② 的新内容；「更多 → 专业模式」；「下一步」去处

- ② 改为：我方报价卡（`TenderOurBidCard`，到 BIDPAGE-6 并入标题）→ `div#bid-quote-area`（FLOW-H1 的锚点保留）里的报价区：报价列表 + 「新建报价」+ 打开的逐行报价 + 导出 → 折叠的「旧版报价单（外贸标准报价）」。都在金额门里。不再挂 `BidWorkspacePanel` 与 `BidQuoteArea`（旧页面照挂，不改）；改版前投标工作区的 `#bid-workspace` 落到 ②（只展开分区）。
- 不是逐行做的报价在列表里写「在专业模式里打开」并链到 `/projects/{id}/quote-engine/{quoteId}`；逐行报价的「更多」里也有「专业模式」。
- 提交、批准、选为我方报价：本 change 不加按钮（BIDPAGE-6）。逐行报价的标题旁写「提交、批准在专业模式里做」并给链接；选为我方报价也在专业模式里做（我方报价卡点进去就是专业模式），只有一份已批准时系统自动选中。
- 「下一步」的 `bid_decided`（「导出价格表 / 生成投标文件」）：我方报价是逐行报价时去 ②（导出在 ② 底部，③ 紧接在下面）；不是、或不知道时照旧去 ③。汇总接口多读一次我方报价的做法字段。
- 备选与否决：
  - 一律去 ②——否决：我方报价是专业模式做的时候 ② 底部的导出是灰的，还得自己展开 ③。
  - 保留 `BidQuoteArea`、只在旁边加逐行报价——否决：两处「新建报价」并存，旧的那处建出的报价不带做法，又绕回专业模式。

## 与八条硬纪律的关系

1. 零 schema：只用 `QuoteCostLine.metadata`、`ProjectQuote.engineJson` 两个既有 JSON 位；`prisma/` 无 diff。
2. 出站先审批：不涉及；不新增任何外发（导出是用户自己下载的 CSV）。
3. 不新增队列 / 定时任务：全部请求时现算。
4. 脱敏：成本、供应商报价、毛利只经 `requireQuoteAccess` + 金额门的新接口返回；不写进投标工作区、不写浏览器；测试只用合成数字。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不调模型；逐行的数是对引擎结果的确定性分摊。
8. 测试注册：新测试都在 `scripts/test-all.sh` 注册，纯逻辑与渲染测试进 CI 子集。

## 验证方式

- 纯逻辑 `npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`：词表与模板对照；`engineConfigSchema` 对旧配置解析结果不变、不认识的做法值只丢自己；映射往返；只动自己管的行、保留其它 `metadata` 键；专业模式改过的读出与提示；四个数与直接调用 `computeQuote` 相同（含一组手算）；分摊不变量与差额上限（60 组随机合成数据）；保存前校验；数字输入解析（「12.」「0.」不被吞）；粘贴；草稿提示判定与导入；接口源码写法。
- 渲染 `npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`：列表、两问、7 列表头、四个数、差额说明、预置与定价公式说明、询价回复点选与不能点选的原因、只读 / 冻结、没有编辑权限的说明、导出灰态原因与提示。
- BIDPAGE-1 的 `next-step.test.ts`、`bid-page-v2.test.tsx` 照跑（开关关时入口与旧 `BidTab` 逐字节相同；「已定」按做法去 ② / ③）。
- 隔离库 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`（真实路由）：开关、新建、读存、换人看到同样的数、各种身份、专业模式改过以后（加行、改定价方式、改币种）、并发、冻结、导出、另起新版、不写客户报价单与投标工作区。
- FIX-21 目录守卫 `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`。
- 浏览器抽检（tasks 7）：逐键输入带小数的汇率。

## Risks / Trade-offs

- 逐行合计与引擎合计不等（上限 Σ(数量 × 0.005)，数量大时可达几十上百加元）：如实显示并写出上限，导出用逐行合计；系统记的我方报价是引擎合计。
- 开关开着时，非负责人、没有组织范围财务查看权的投标同事在新页面上做不了报价（D7）。
- 一种币一个汇率：专业模式里给同一币种填不同汇率的报价，逐行保存后会统一成一个（界面提示）。
- 专业模式与逐行表改同一份成本行：逐行保存会把专业模式改过的算法、不计入、定价方式改回（界面事先提示；定价方式空着时拦下）。
- 生产上几乎没有存过的价格表：逐行表的行实际要从招标分析带入或粘贴（D5）。
- 导出 CSV 没有防公式注入（D9，已知限制）。
- 单位直接显示 Each、Pack、sqft 等招标原文：BIDPAGE-8 的英文守卫要把它们列入例外（招标文件原文）或配中文名，交接里记下。

## Migration Plan

- 不迁移数据；旧报价没有 `entryMode`，照旧按专业模式打开。
- 回退：回退本 PR；已建的逐行报价在旧代码下按专业模式打开（成本行与 `metadata` 都在），旧代码下一次保存引擎配置会丢掉 `entryMode`。或开关保持关。
