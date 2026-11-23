# Design：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

## Context

- 新页面 ② 定报价（BIDPAGE-1）现在挂的是旧组件：投标工作区面板（`BidWorkspacePanel`，里面的成本卡把成本写在浏览器 `localStorage`）、我方报价卡（`TenderOurBidCard`）、旧报价区（`BidQuoteArea` = 报价引擎列表 + 折叠的「外贸标准报价」）。整块只给「报价内部成本权限 ∧ 财务查看权」的人挂（附录 C 决定 C，BIDPAGE-1 design D5）。
- 报价引擎（`src/lib/quote-engine/`）：一份 `ProjectQuote` 带若干 `QuoteCostLine`；`computeQuote`（纯函数，浮点 `round2`）按「直接成本 → 成本百分比（关税）→ Sunny 链（资金使用 → 管理费 → 现金备用金）→ 卖价 → 收入基数行 → 提成」算出卖价、成本、毛利；结果只到每条成本行的成本金额（`LineResult.amount`），没有逐行卖价。`engineConfigSchema` 是非严格 `z.object`。专业模式（`PricingControlCenter`）整组提交成本行（`updateEngineQuote` 删掉不在提交里的行、按 id 更新、其余新建，新建行不带 `metadata`）；`reviseQuote` 照抄所有成本行字段（含 `metadata`）与 `engineJson`，行 id 换新。
- 只供货模板（`templateSupplyOnlyLines`）有 15 行：货品（`PROCUREMENT` 按件，CNY）、国内运费、海运费（按柜）、报关费、关税（成本百分比，基数 `PROCUREMENT`，默认不计入）、加拿大境内运费、包装、深化图、保险、售后预留（不计入）、资金使用（年化 8%，1 个月）、管理费（自含 3%）、现金备用金（1%，类别 `OTHER`）、提成（毛利 30%）、预备金（不计入）。
- 价格表：投标工作区把人核对过、校验通过的价格表存在 `BidIntelligenceRoom.summaryJson.bidWorkspace.priceSchedule.lines`（行身份是 `lineNo`，单位须属 `PRICE_SCHEDULE_UOMS`）；读取函数 `loadWorkspace` 不看投标工作区的开关。招标分析里的数量线索由 `loadSchedulePrefill` 变成粘贴框文本（只读、不看开关），由人核对后保存。按招标方价格表导出 `exportOfficialPriceSchedule(lines, unitPrices)`（纯函数，单价取到分、行合计 = 单价 × 数量）今天没有接口、没有界面。
- 询价回复：`InquiryItem` 一家供应商一轮一个 `unitPrice` / `totalPrice` / `currency`，没有逐行报价。既有询价、比价接口只要项目读权限（CHAIN-2e #556 在收口），新页面不拿它们给金额。
- 在途：CHAIN-2e（#556，草稿）改 `src/lib/quote-engine/access.ts`、`quote-engine-contract.test.ts`、专业模式四个组件、`project-finance/access.ts`；本 change 不碰这些文件。FIX-21（#554，2026-11-23 已合并）的目录守卫 `project-routes-guard.test.ts` 要求 `src/app/api/projects/[id]/` 下每个处理函数第一步不带条件地调用名单里的守卫并紧接着检查（`requireQuoteAccess` 在名单里），本 change 的新接口照这个写法，由它与本 change 自己的源码断言各查一遍。

## Goals / Non-Goals

**Goals**：逐行做报价、成本进系统（换电脑、换人看到同样的数）；只有引擎一套算法，逐行表的数与引擎、专业模式完全一致；差几分钱时明说；能按招标方价格表导出；开关关着时零变化。

**Non-Goals**：见 proposal「Out of scope」。

## Decisions

### D1：做法存在 `engineJson.entryMode`；新建时两问；只有「逐行 + 只供货」进逐行表

- `engineConfigSchema` 加 `entryMode: z.enum(["LINE"]).optional()`（BIDPAGE-4 再加 `"LUMP_SUM"`）。核对（不确定处 2）：非严格 `z.object`，旧数据与旧前端照样通过；`engineOf` 用 `safeParse`；`updateEngineQuote` 先合并 `engineOf(q)` 再 `parse`，专业模式回写 `engine: {}` 时字段保留；`reviseQuote` 原样照抄 `engineJson`。没有 `entryMode` 的配置解析结果与改前逐字段相同（测试对照）。回退本 change 后，旧代码下一次保存引擎配置会丢掉这个字段，那份报价改按专业模式打开，成本行不丢。
- 新建（② 里「新建报价」，要编辑权限）：问「这个标怎么交价？」（本 change 只有「逐行报价」一项）与「业务类型」（只供货（默认）/ 供货加安装 / 长期供货协议）。
  - 逐行 + 只供货 → 新建逐行报价（`quoteType = SUPPLY_ONLY`、`pricingMethod = MARGIN_ON_REVENUE`、`entryMode = LINE`），同一次写入建好货品行（有价格表时）、4 条共用参数行（汇率不是成本行）、4 条预置行（D3）。
  - 供货加安装 / 长期供货协议 → 照今天的 `createEngineQuote`（同样的模板），不带 `entryMode`，打开专业模式页。任务书写明这两类「供……大项目和长期供货协议使用」专业模式。
- 为了在同一次写入里带上 `metadata` 与 `entryMode`，逐行报价的新建在本 change 的服务里写（照 `createEngineQuote` 的字段、快照与审计 `quote_created`）；报价编号沿用 `service.ts` 里的 `nextQuoteNumber`（只加 `export`，不改行为）。

### D2：成本存在 `QuoteCostLine`；行身份放 `metadata.bidLine`；只动自己管的行

- 每条由逐行表管理的成本行带 `metadata.bidLine = { v: 1, role, key, … }`：
  - `role = "goods"`：一个价格表行。另存 `lineNo`、完整说明（≤500 字；成本行 `description` 只收 300 字，截断时以「…」结尾）、单位、包装数、报价口径（按件 / 按招标单位）、原样的供应商报价、证据类别、选中的询价回复 `inquiryItemId`、行来源（价格表 / 招标分析带入 / 粘贴 / 手加）。
  - `role = "shared"`，`key ∈ ocean_freight | customs | duty | domestic_freight`；`role = "preset"`，`key ∈ financing | admin | cash_allowance | commission`。
  - `metadata` 里已有的别的键（成本导入的来源记录）原样保留，只合并 `bidLine`。
- 保存（D7 的写接口）在一个事务里：按 id 更新 / 新建自己管的行；删掉不再出现的货品行；**不碰没有 `bidLine` 的行**（在专业模式里加的行，逐行表不列，四个数照算，界面上写「另有 N 条其它成本行，已算进四个数」）。
- 不写 `QuoteLineItem`（附录 C 决定 H：那张表归给客户的报价单，`customer-quote.ts` 会整组删改，`reviseQuote` 复制时丢字段）；不写 `localStorage`；不写 `BidIntelligenceRoom.summaryJson`。
- 并发：保存带读取时的 `updatedAt`，与库里不同 → 409「这份报价刚被别人改过，请刷新后再改」，不写。冻结状态（已批准等）→ 409，与专业模式同一个 `QUOTE_FROZEN`。
- 与专业模式的关系：在专业模式里改的是同一份成本行。按 id 更新的行 `metadata` 不丢；专业模式删掉的货品行回到逐行表就没有了；专业模式「复制」出来的行没有 `bidLine`，算作其它成本行。另起新版（`reviseQuote`）照抄 `metadata` 与 `entryMode`，新版照样是逐行报价。行身份不依赖成本行 id（新版 id 会换）。

### D3：共用参数与预置都是成本行；值与模板相同；一种币一个汇率

| 界面 | 成本行（类别 / 计算方式） | 默认 |
|---|---|---|
| 汇率（每种出现的币一个，「1 CNY = ? 加元」+ 来源） | 写进每条该币种的行的 `fxRate` / `fxRateSource` | 空（必须填，否则引擎报「需要汇率」） |
| 海运费（柜数 × 每柜） | `FREIGHT` / `PER_CONTAINER` | 空 = 这项没有（不计入） |
| 报关费 | `CUSTOMS` / `FIXED` | 空 = 没有 |
| 关税率 | `DUTY` / `PERCENT_OF_COST`，基数 `PROCUREMENT` | 空 = 没有 |
| 国内运费（中国境内） | `LOGISTICS` / `FIXED` | 空 = 没有 |
| 资金使用 | `FINANCING` / `PCT_ANNUALIZED_ON_COST`，8%，1 个月 | 计入 |
| 管理费 | `ADMIN` / `PCT_SELF_INCLUSIVE_ON_COST`，3% | 计入 |
| 现金备用金 | `OTHER` / `PCT_ON_COST_SUBTOTAL`，1% | 计入 |
| 提成 | `COMMISSION` / `PCT_OF_GROSS_PROFIT`，30% | 计入 |
| 目标毛利率（按售价） | `pricingMethod = MARGIN_ON_REVENUE`，`pricingRate` | 空 |

- 计算方式、比例、月数与 `templateSupplyOnlyLines` 逐项相同（测试对照），所以同一份报价在逐行表与专业模式里的数一样。
- 空着的共用参数写成「不计入」而不是 0（避免引擎的「未定价」警告挡住批准）；货品行没填报价的照样计入、引擎报「未定价」——没填完的报价批不了。
- 说明文字照引擎的真实算法写（与任务书的简写不同处）：
  - 资金使用 =（直接成本 + 关税）× 年化比例 ÷ 12 × 月数（不足一月按一月）；
  - 管理费 = 基数 ÷（1 − 比例）− 基数，基数 = 直接成本 + 关税 + 资金使用（100 → 103.09）；
  - 现金备用金 =（直接成本 + 关税）× 比例；
  - 提成 =（报价 − 提成前的成本）× 比例，计入成本，所以顶部毛利率比目标毛利率低。
- 一种币一个汇率：读取时取该币种第一条有汇率的行；保存时写到该币种的每一条自己管的行。专业模式里给同一币种填了不同汇率的，逐行表读到第一个、保存后统一（界面提示）。
- 本 change 新建的行用中文说明（新代码路径，只在开关开时走）；模板本身的说明不改（BIDPAGE-8）。加拿大境内运费、包装、保险等模板里的其它行不进逐行报价，需要时在专业模式里加（它们算作其它成本行）。

### D4：每行的数怎么来（不确定处 1 / 4 的结论，正式写入）

逐行表只显示引擎结果的分摊，不另算：

1. 每条货品行的货值 `g_i` = 引擎该行 `LineResult.amount`（加元，已 `round2`）；`G = Σ g_i`（只算自己管的货品行）。`G = 0` 时不分摊，各行显示「—」。
2. 份额 `s_i = g_i / G`。关税按货值计、海运等共用费用按货值摊（`tender-bid-cost/freight.ts` 的「按货值」口径），资金使用 / 管理费 / 备用金 / 提成按到手成本比例摊——这几样全都与货值成正比，所以一律按 `s_i` 摊，各行毛利率相同（取到 0.1% 显示一致）。其它成本行（专业模式加的）也按 `s_i` 摊进去。
3. 到手成本 `= (directCost + percentOfCostTotal) × s_i`，到手单位成本 = 到手成本 ÷ 数量（显示到分）。
4. 我方单价 = `sellingPrice × s_i ÷ 数量` 按四舍五入取到分（`priceLine`，与导出同一个函数）；行合计 = 单价 × 数量（取到分）。没填报价的行（`g_i = 0`）单价为空，导出时按「缺单价」拒绝。
5. 行毛利率 =（行合计 − `estimatedCost × s_i`）÷ 行合计。
6. 顶部四个数一律取引擎：报价合计 `sellingPrice`、成本合计 `estimatedCost`、利润 `grossProfit`、毛利率 `grossMarginPct`（已扣提成）。
7. 逐行合计 `Σ 行合计`（`priceSchedule().total`）与 `sellingPrice` 最多差 `Σ(数量 × 0.005)`（数量带小数的行，行合计还要再取一次整，每行再加 0.005）；不为 0 时顶部单列一句：「逐行合计 X 比报价合计 Y 多 / 少 Z：每行单价取到分后乘数量造成。导出给招标方的是逐行合计。」差额与上限都由测试锁住（多组合成数据）。系统记的我方报价仍是引擎合计（`Project.ourBidPrice` 不变），这是已知后果（附录 C）。
8. 引擎算不出（缺汇率、毛利率 ≥ 100% 等）→ 不分摊，顶部写引擎给的原因；警告（未定价、亏损、没有预备金）照引擎列出，中文说明。

不用 `tender-bid-cost` 的逐行核算（`prepareLine` / `computeCostScenario`）出数：它是第二套算法，没有管理费 / 资金使用 / 提成（不确定处 4 已核对）。MOQ / 整箱取整引擎没有，逐行报价不做；供应商按件报价、价格表按包计的，按包装数换成招标单位价（`convertQuoteToTenderUom`）后写进成本行。

### D5：行从哪里来

- 新建时：投标工作区存下的价格表（`loadWorkspace` + `validatePriceSchedule` 通过）→ 每行一条货品行（来源「价格表」）。不看投标工作区开关、不调它的接口（任务书 Out of scope）。
- 没有可用价格表：逐行表先是空的，上方三个入口——「从招标分析带入」（`loadSchedulePrefill` 的文本填进粘贴框，连同它的说明与没带入的条目；人核对后点「导入这些行」）、粘贴（`parseSchedulePaste`，有问题逐行说明、不猜）、「加一行」（品名、数量、单位从 `PRICE_SCHEDULE_UOMS` 里选）。导入是追加，行号接着排；删行后行号重排（价格表导出要求从 1 连续）。
- 上限 300 行（与招标分析带入同一个上限）；品名 ≤500 字；数量 > 0。

### D6：供应商报价——从询价回复里点选，或手填带证据

- 读接口附带本项目已回报价的询价回复（各轮、未取消的询价单、状态「已报价」）：供应商、轮次、回复时间、单价、总价、币种。只给看得到金额的人（与整个接口同一门）。
- 点选：把该回复的单价与币种填进这一行，记下 `inquiryItemId` 与供应商（成本行的 `supplierId` / `supplierName`），来源记「询价回复」。只报了总价、没有单价的回复不能点选，写明「这家只报了总价 X，请手填单价」——不按数量去除（不猜）。
- 手填：必须选证据类别（`QUOTE_EVIDENCE_KINDS`：已签报价 / 平台标价 / 零售价 / 估计），不选不让保存（400，指到那一行）。
- 报价口径：价格表行有包装数时可选「按件」或「按招标单位」，按件时乘包装数换成招标单位价写进成本行，原价与口径留在 `metadata`；没有包装数时只能按招标单位。

### D7：接口与权限

| 接口 | 守卫（第一步） | 之后 |
|---|---|---|
| `GET /api/projects/{id}/bid-page/quotes` | `requireQuoteAccess(…, "internal_cost")` | 金额门；返回报价列表（名称、编号、版本、状态、做法、报价合计、是否我方报价）、能力（能否编辑 / 批准）、是否有可用价格表 |
| `POST …/bid-page/quotes` | `requireQuoteAccess(…, "edit")` | 金额门；两问 → 新建 |
| `GET …/bid-page/quotes/{quoteId}/line` | `requireQuoteAccess(…, "internal_cost")` | 金额门；不是逐行报价 → 409（去专业模式）；返回行、共用参数、预置、其它成本行、引擎结果、分摊、差额、询价回复、表空时的带入文本 |
| `PUT …/bid-page/quotes/{quoteId}/line` | `requireQuoteAccess(…, "edit")` | 金额门；校验 → 事务写 → 快照 → 审计 `quote_updated` |
| `GET …/bid-page/quotes/{quoteId}/export` | `requireQuoteAccess(…, "internal_cost")` | 金额门；必须是当前我方报价（`resolveTenderBid` 为 AUTHORITATIVE 且指向这一份）且是逐行报价 → CSV |

- 写法照 FIX-21（#554，已合并）：取参数后第一句就是守卫、紧接着检查；之后依次：新页面开关与招投标项目（否则 404「新版标书与报价页未启用」，不读库）、金额门（`resolveFinancePrivilege(user, orgId, ownerId).canReadAll`，否则 403「报价的金额与成本只给项目负责人和有财务查看权的同事看……」）。报价引擎开关关着时 `requireQuoteAccess` 自己就是 404。
- 接口放在 `bid-page/` 下而不是 `quote-engine/` 下：不碰 CHAIN-2e 正在改的 `quote-engine-contract.test.ts`；本 change 自己的测试用源码断言锁住每个处理函数的守卫与金额门。
- 任务书写「没有成本权限的人只看到报价合计」，与附录 C 决定 C（新页面所有金额都要金额门）不一致；按更保守的决定 C：② 整块只给看得到金额的人（BIDPAGE-1 已如此），报价合计也不给。
- 不恢复「有编辑权、没有财务查看权」的人在新页面上编辑（BIDPAGE-1 TASKFLOW 里记的义务改判）：逐行表本身就是成本，编辑必须看见成本；Evan 2026-11-22 对 CHAIN-2e 的答复 ① 已接受「不是项目负责人的投标同事不能新建、编辑、批准报价」，前提「谁做报价谁就是负责人」（负责人有财务特权，`decideFinancePrivilege`）。

### D8：旧的本地成本草稿

- 只在逐行报价打开时、只在浏览器里读一次 `costDraftStorageKey(projectId)`（`parseCostDraft`，坏数据当空）；有行时在表上方提示一次：「发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？」——「导入」/「不导入」。
- 导入（纯函数，按 `lineNo` 对上）：供应商报价、口径、币种、证据类别、各币汇率与来源；目标毛利率只在报价还没填时带入（草稿「按售价毛利」= 引擎 `MARGIN_ON_REVENUE`）。草稿里逐行的关税、运费、送货费、其它费用、进口 GST 不导入（逐行报价里是共用参数），提示里写明。导入只改表上的值，人点「保存」才写库。
- 提示过一次后在这台电脑上记一个不含任何金额的标记（`qy.bidPage.costDraftPrompted.<projectId>`），不再提示；草稿本身不删、不改。

### D9：按招标方价格表导出

- ② 底部：当前我方报价已定（AUTHORITATIVE）且是逐行报价 → 「按招标方价格表导出」可点；否则灰着并写原因（「报价定为我方报价后才能导出」/「我方报价不是逐行报价做的，不能按价格表导出」）。
- 接口用 D4 的单价调 `exportOfficialPriceSchedule`（品名用完整说明、单位与数量取 `metadata` / 成本行），返回 CSV（`text/csv`，文件名含报价编号）；校验不过 / 缺单价 → 409 带它的中文原因。导出的单价、行合计与逐行表一致（同一个 `priceLine`）。CSV 列名与「不含 HST」是交给招标方的英文正文，照 `official-export.ts`。

### D10：② 的新内容；「更多 → 专业模式」；「下一步」去处

- ② 改为：我方报价卡（`TenderOurBidCard`，到 BIDPAGE-6 并入标题）→ `div#bid-quote-area`（FLOW-H1 的锚点保留）里的报价区：报价列表 + 「新建报价」+ 打开的逐行报价 → 导出 → 折叠的「旧版报价单（外贸标准报价）」。不再挂 `BidWorkspacePanel` 与 `BidQuoteArea`（旧页面照挂，不改）。
- 不是逐行做的报价在列表里显示「专业模式」并链到 `/projects/{id}/quote-engine/{quoteId}`；逐行报价的「更多」里也有「专业模式」。
- 提交 / 批准 / 选为我方报价：本 change 不加按钮（BIDPAGE-6），逐行报价的标题旁写「提交、批准在专业模式里做」并给链接；我方报价卡照旧能选定。
- 「下一步」的 `bid_decided`（「导出价格表 / 生成投标文件」）去处由 ③ 改为 ②：导出在 ② 底部，③ 紧接着在下面。

## 与八条硬纪律的关系

1. 零 schema：只用 `QuoteCostLine.metadata`、`ProjectQuote.engineJson` 两个既有 JSON 位；`prisma/` 无 diff。
2. 出站先审批：不涉及；不新增任何外发。
3. 不新增队列 / 定时任务：全部请求时现算。
4. 脱敏：成本、供应商报价、毛利只经 `requireQuoteAccess` + 金额门的新接口返回；不写进投标工作区、不写浏览器；测试只用合成数字。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不调模型；逐行的数是对引擎结果的确定性分摊。
8. 测试注册：新测试都在 `scripts/test-all.sh` 注册，纯逻辑与渲染测试进 CI 子集。

## 验证方式

- 纯逻辑：映射往返（状态 → 成本行 → 状态）；预置与模板逐项相同；分摊各行之和等于引擎（到手成本、成本），逐行合计与报价合计之差不超过上限（多组合成数据，含 0 行、未定价行、外币、其它成本行）；四个数与直接调用 `computeQuote` 相同；`engineConfigSchema` 对旧配置解析结果不变；草稿导入；输入校验。
- 渲染：② 新区块（列表、两问、7 列表头、四个数、差额说明、导出灰态原因、草稿提示）；看不到金额的人仍只看到说明；开关关时入口仍与旧 `BidTab` 逐字节相同（BIDPAGE-1 的测试照跑）。
- 源码断言：新接口每个处理函数第一步守卫并紧接着检查、之后金额门；新代码不写 `QuoteLineItem`、不写 `localStorage` 的成本、不写投标工作区；`computeQuote` / `QUOTE_ENGINE_CALC_VERSION` / 模板未改。
- 隔离库端到端（真实路由）：新建逐行报价（带 / 不带价格表）→ 保存 → 另一位有财务查看权的同事读到同样的成本与结果；没有财务查看权的成员、只读成员、组织外的人 403 / 404 且不写库；开关关 404；专业模式 `updateEngineQuote` 改过后 `metadata` 仍在、其它成本行不被逐行保存碰；另起新版仍是逐行报价；并发 409；导出只在已定后可用、CSV 合计等于逐行合计；全程 `QuoteLineItem` 行数不变、投标工作区 JSON 不变。
- 浏览器抽检（本地合成数据）：开关开时新建逐行报价、填两行、四个数、导出。

## Risks / Trade-offs

- 逐行合计与引擎合计差几分钱：如实显示，导出用逐行合计；系统记的我方报价是引擎合计。若要完全一致需要改引擎的取整口径——不在本期。
- 一种币一个汇率：专业模式里给同一币种填不同汇率的报价，逐行保存后会统一成一个（界面提示）。
- 专业模式与逐行表改同一份成本行：专业模式删行 / 复制行会让逐行表少一行 / 多一条「其它成本行」；不丢数据，界面写明。
- 金额门比任务书严（报价合计也不给没有财务查看权的人）：按决定 C；若要放开，另起 change。
- 新增 5 个处理函数：FIX-21 合并后由它的目录守卫再检查一遍（本 change 已按它的写法写）。

## Migration Plan

- 不迁移数据；旧报价没有 `entryMode`，照旧按专业模式打开。
- 回退：回退本 PR；已建的逐行报价在旧代码下按专业模式打开（成本行与 `metadata` 都在），旧代码下一次保存引擎配置会丢掉 `entryMode`。或开关保持关。
