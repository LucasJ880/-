# Design：报价做法二「只报总价」（BIDPAGE-4）

## Context

- 动机见 proposal「Why」；行为契约见 `specs/tender/quote-lump-sum-mode/spec.md` 与 `specs/tender/quote-line-mode/spec.md`。
- BIDPAGE-3 已经有：做法字段 `engineJson.entryMode`（只认 `LINE`，不认识的值 `.catch` 丢掉）、行身份 `QuoteCostLine.metadata.bidLine`（`goods` / `shared` / `preset` 三种，`discriminatedUnion`，读不出 → 当作「其它成本行」不碰）、四条预置、乐观锁 + 只动自己管的行的保存、`lineModeGate` 金额门、报价列表与新建两问。
- 报价引擎（`src/lib/quote-engine/calc.ts`，不改）的事实：
  - ① 直接成本：`FIXED` = 金额 × 汇率；`PER_UNIT` = 数量 × 单价 × 汇率；各行先 `round2`。基数 `DIRECT_COST` = ① 合计，`PROCUREMENT` = 采购类 + 材料类。
  - ② `PERCENT_OF_COST` 只引用 ① 的基数：按比例算的关税（属 ②）**不**进 `DIRECT_COST`，填金额的关税（属 ①）进。
  - 链式预置 → `baseCost`；`sellingPrice = (baseCost + 加成) ÷ (1 − (Σ售价百分比 + 毛利率) / 100)`；`PERCENT_OF_REVENUE`（保函按报价）进分母；提成 `PCT_OF_GROSS_PROFIT` =（售价 − baseCost）× 比例，算进 `estimatedCost`、不进分母。
  - `computeTax(sellingPrice, engine.tax)` → `{ gst, hst, pst, total }`，各项 `round2(税前 × 比例)`；结果在 `QuoteCalcResult.tax`，快照进 `summaryJson`。我方报价 `ourBidPrice = sellingPrice`（税前）。
  - `QuoteCostLine.unitCost` 是 `Decimal(18,4)`，`rate` 是 `Decimal(9,4)`，`notes` 专业模式校验最多 2000 字。
- 专业模式（`pricing-control-center.tsx`，CHAIN-2e 在改，不碰）保存时 `header.engine` 只带长期供货协议的参数，服务端 `{ ...engineOf(q), ...h.engine }` 合并 → 配置里的税与做法保留；专业模式更新成本行不写 `metadata`，另起新版复制 `metadata` 与 `notes`；专业模式没有改税的界面。

## Goals / Non-Goals

**Goals：**
- 一张总价构成表能做验收 3、4：数全部取 `computeForQuote`，与专业模式同一份结果。
- 总价表与逐行表、专业模式改同一份报价时，谁都不悄悄改掉别人的行；改不了的写明。
- 逐行 ↔ 总价互转是一次显式动作，前后报价引擎的数不变，不变就不转。

**Non-Goals（具体到文件）：**
- 不改 `src/lib/quote-engine/calc.ts`、`templates.ts`、`service.ts`、`customer-view.ts`、`customer-quote.ts`、`advisors.ts`、`tender-bid.ts`；不改 `quoteHeaderSchema`（专业模式保存的校验）。
- 不碰 `src/components/quote-engine/pricing-control-center.tsx`、`src/lib/quote-engine/access.ts`、`src/lib/project-finance/access.ts`、`src/app/api/projects/[id]/quote-engine/**`（CHAIN-2e #556 在改）。
- 不改 `prisma/`；不改 `src/lib/tender-bid-workspace/**`、`src/lib/tender-price-schedule/**`；不改 BIDPAGE-1 的 `src/lib/bid-page-v2/service.ts`、`next-step.ts`（我方报价是总价报价时「已定」仍去 ③，与改版前相同）。
- 不做 AI 建议按钮（BIDPAGE-5）、一次定价（BIDPAGE-6）、并排多列（判断点 3）。

## Decisions

### D1：做法与业务类型
- `QUOTE_ENTRY_MODES = ["LINE", "LUMP_SUM"]`；`.catch(undefined)` 与 `quoteHeaderSchema` 的 `omit({ entryMode })` 照旧。
- 总价报价 = `entryMode === "LUMP_SUM"` ∧ `quoteType ∈ { SUPPLY_ONLY, PROJECT_SUPPLY_INSTALL }`；读写还要求币种加元（同 BIDPAGE-3 `assertLineMode`）。
- 新建两问：「这个标怎么交价？」逐行报价 / 只报总价。只报总价 + 只供货或供货加安装 → 总价报价；只报总价 + 长期供货协议 → 照改版前模板、返回专业模式地址（分级定价与按柜的单位经济总价表管不了）。逐行仍只配只供货。
- **否决**：只报总价只配只供货——清单里有安装、测量、深化图、项目管理，Sunny 的总表也有安装，只配只供货就做不了验收以外最常见的那类标。**否决**：长期供货协议也进总价表——它的价格是分级单价，不是一个总价。

### D2：行身份
- 总价表自己的项用 `metadata.bidLine = { v: 1, role: "lump", key, seq?, label?, evidenceKind?, inquiryItemId? }`，由 `src/lib/bid-page-v2/lump-sum/contract.ts` 里**单独的** schema 解析。BIDPAGE-3 的 `bidLineMetaSchema` 不加这个 role：逐行表读到它 → 解析不出 → 当作其它成本行、照样计入、逐行保存不碰——这正是「总价 → 逐行」后那些项要的行为，不用改逐行保存。
- `key`：`goods_total`、`ocean_freight`、`duty`、`domestic_freight`、`customs`、`inland_freight`、`packaging`、`installation`、`measurement`、`shop_drawing`、`equipment_site`、`bond`、`insurance`、`cleaning`、`travel`、`project_management`、`warranty_reserve`、`contingency`、`other`。`other` 带 `seq`（区分多条）与 `label`（人填的名称）；其余每个 key 只认排在最前的一条，多出的当其它成本行。
- 货品明细沿用 BIDPAGE-3 的 `goods` 身份（新行：单位默认 `Each`、按招标单位报价、来源手填）；四条预置沿用 `preset` 身份。这样互转时货品与预置一行都不用改写。
- **否决**：借用 BIDPAGE-3 的 `shared` 身份放海运 / 关税——逐行保存的 `sharedWrite` 会把固定金额的海运改回按柜计，柜数为空就设不计入，金额从合计里掉出去。**否决**：把 `lump` 加进 BIDPAGE-3 的联合类型——逐行表的每个分支都要处理它，反而要改 BIDPAGE-3 的保存逻辑。

### D3：每项的类别与算法
| 项 | 类别 | 填金额 | 可改填比例 | 默认 |
|---|---|---|---|---|
| 货品总数 | PROCUREMENT | FIXED | — | 金额 |
| 海运费 / 加拿大境内运费 | FREIGHT | FIXED | — | 金额 |
| 国内运费 / 包装 | LOGISTICS | FIXED | — | 金额 |
| 报关费 | CUSTOMS | FIXED | — | 金额 |
| 关税 | DUTY | FIXED | `PERCENT_OF_COST`，基数 `PROCUREMENT` | 金额 |
| 安装 / 测量 | LABOUR | FIXED | — | 金额 |
| 深化图 | ENGINEERING | FIXED | — | 金额 |
| 设备 / 场地、差旅 | SITE_GENERAL | FIXED | — | 金额 |
| 保函 | BOND | FIXED | `PERCENT_OF_REVENUE` | 比例 |
| 保险 | INSURANCE | FIXED | — | 金额 |
| 项目管理 | PROJECT_MANAGEMENT | FIXED | — | 金额 |
| 清洁 / 其它 | OTHER | FIXED | — | 金额 |
| 售后预留 | OTHER | FIXED | `PERCENT_OF_COST`，基数 `DIRECT_COST` | 比例 |
| 下错单 / 漏单预备金 | CONTINGENCY | FIXED | `PERCENT_OF_COST`，基数 `DIRECT_COST` | 比例（判断点 5） |

- 都是既有类别与计算方式。设备 / 场地合成一项落 `SITE_GENERAL`（不拆出 `EQUIPMENT`，表上是一项）。
- 金额 = 固定金额，可带原币；一种币一个汇率（同 BIDPAGE-3 `fx`）。比例行币种恒为加元。
- 空着 = 不计入（`included = false`，数写空）；货品总数空着且没有明细时计入、按引擎「未定价」提示（与逐行表货品行同例，审批门 fail-closed）。
- 备注写 `QuoteCostLine.notes`（≤500 字）；总价表的写入带 `notes`，BIDPAGE-3 的写入不带（照旧不碰）。
- 排序：货品总数 100、明细 1～300（行号）、各项 3010 起按清单顺序、其它 3900 + seq、预置 2010～2040（同 BIDPAGE-3）。
- **否决**：每项让人选任意计算方式——那是专业模式；任务书只要「金额（或比例）」。**否决**：海运按「柜数 × 每柜」——总表上海运是一个数，柜数写在备注里即可。

### D4：销售税
- 销售税一行三个比例 HST / GST / PST，存 `engineJson.tax`（附录 A 已登记 GST / HST / PST 保留原文）。保存时读库里的配置 `engineConfigSchema.parse({ ...engineOf(q), tax })`，只换 `tax`，做法与其它字段照旧，与成本行在同一事务里写。
- 显示：销售税 = `tax.gst + tax.hst + tax.pst`，含税总价 = `tax.total`，都取引擎结果。
- **否决**：只给一个「销售税 %」再猜是 HST 还是 GST——引擎本来分三项，安省 HST、其它省 GST + PST 都要能填；验收的 7% 填哪一项结果都一样（测试锁住）。**否决**：把税做成一条成本行——任务书明令不当成本行，而且会进定价分母、我方报价变成含税。

### D5：定价一行与算式
- 结果六个数（成本合计 `estimatedCost`、税前报价 `sellingPrice`、销售税、含税总价、利润 `grossProfit`、毛利率 `grossMarginPct`）全部来自 `computeForQuote`；页面只格式化。
- 算式用引擎结果里的 `baseCost`、`revenuePctTotal`、`pricing.marginOnRevenue` 与提成行金额拼出：「税前报价 X = baseCost ÷（1 − 毛利率 − 保函比例）」；有提成时加一句「销售提成 =（税前报价 − 不含提成的成本）× 比例，算进成本合计」；「含税总价 = 税前报价 + 销售税」。不写任务书原句（提成开着时不成立，proposal 出入 5）。
- 验收 4 的证明：隔离库里同一份报价，总价视图的四个数与 `computeForQuote(getQuote(...))`（专业模式 GET 用的同一函数）逐项相等。
- **否决**：页面上用任务书的式子自己算一遍对照——那就是第二套算法。

### D6：货品总数与明细
- 货品总数那一条（`lump/goods_total`，PROCUREMENT/FIXED）新建时就有、一直在。有明细（`goods` 行）时是明细模式：总数那一条不计入、数留着；没有明细时是总数模式。请求里写着总数模式又带明细 → 400。
- 「改回填一个总数」在页面上先确认「会删掉 N 条明细」，再把明细清空、总数那一条重新计入。
- 点选：总数从回复的 `totalPrice`、明细从 `unitPrice`；服务端核对沿用 BIDPAGE-3 的 `resolveInquiryRows`（导出给总价服务用），总数另核对 `totalPrice` 与币种；供应商一律取自库里。手填要证据类别。
- 专业模式把总数那一条又设成计入、同时有明细时：读出时提示「货品总数和明细重复计入；在这里保存时总数会改成不计入」。
- **否决**：明细存进总数那一条的 `metadata` 数组——明细合计与那条的 `unitCost` 要自己保持一致，专业模式改了 `unitCost` 就对不上，转逐行还得拆行。**否决**：明细存 `engineJson`——要改共用 schema，专业模式也看不到。

### D7：保存
- `GET` / `PUT …/{quoteId}/lump`，`{ baseUpdatedAt, state }`；校验（指到哪一项）→ 核对点选 → 事务：按 `updatedAt` 占住报价（同时写定价与配置里的税）→ 删 / 改 / 建自己管的行（货品总数、明细、各项、预置）→ 快照 → 审计 `QUOTE_UPDATED`（`afterData.entryMode = "LUMP_SUM"`）。
- 自己管的行 = 身份读得出、且类别与算法是这一项允许的组合（D8）；其余都是其它成本行，一字不改。
- 冻结 → 409；别人改过 → 409；定价方式在专业模式里改过且没填目标毛利率 → 400（同 BIDPAGE-3）。
- **否决**：把整份报价的成本行按状态重写——会冲掉专业模式加的行。

### D8：与专业模式改同一份报价
- 总价表的一项在专业模式里改成这一项不允许的类别 / 算法 / 基数 → 不再当作这一项，列进其它成本行并写明「在专业模式里改了算法，这里不再管它（照样计入）」。不改回：改回会悄悄改掉别人算好的数。
- 改了金额、比例、备注、币种、汇率 → 照改后的显示（这些都是总价表本来就管的字段）。
- 明细行与预置的读法与提示直接复用 BIDPAGE-3（从 `costLinesToState` 拆出读货品行、读预置、读汇率的小函数，`costLinesToState` 改为调用它们，行为不变，BIDPAGE-3 测试照跑）。
- **否决**：照 BIDPAGE-3 共用参数那样「保存时改回原来的算法」——共用参数的算法是逐行表定义的；总价表的一项被改成按柜计、按小时计后，改回固定金额会丢掉专业模式里填的柜数、工时。

### D9：互转
- 接口 `POST …/{quoteId}/convert`，`{ to: "LUMP_SUM" | "LINE", baseUpdatedAt }`；纯函数 `src/lib/bid-page-v2/lump-sum/convert.ts` 由现有成本行算出要写的行与新的配置。
- 逐行 → 总价：货品行不动（成为明细）；共用参数四项改写成同名的总价项——海运 `PER_CONTAINER` → `FIXED`，金额 =（数量缺省 1）× 柜数 × 每柜（原币、汇率不变）；报关、国内运费金额照搬；关税率 → 关税按货值比例；没计入的 → 空着的项；预置与其它成本行不动；建一条空着的货品总数（没有时）；做法 → `LUMP_SUM`。
- 总价 → 逐行（只供货、货品有明细）：明细不动；报关、国内运费金额与按货值的关税比例改写成 `shared` 身份；空着的海运、关税、报关、国内运费改写成没填的 `shared`；其余有数的项保留 `lump` 身份（逐行表里是其它成本行、照样计入）；税留在配置里（逐行表不显示，转换处写明）；做法 → `LINE`。再转回总价时这些项原样回来（身份与备注都在）。
- 写库前对「转换前的行」与「转换后、数值按库里位数取过的行」各算一次 `computeQuote`，成本合计、税前报价、利润、销售税任一项不同 → 409 并写明差多少，什么都不写；同一 key 两边都有数（例如逐行表填了关税率、另有一条总价关税金额）→ 409 写明先清掉哪一条。CAS、冻结同 D7；审计 `QUOTE_UPDATED`，`afterData.convert = "LINE→LUMP_SUM"` 或反向。
- 逐行表里来自总价表的其它成本行写「从只报总价转来的项（照样计入，在这里不改）」，不写「专业模式里加的」。
- 「互转一次」= 一次显式的转换动作，不限次数（proposal 出入 6）。
- **否决**：逐行 → 总价时把货品行合成一个总数——转回逐行就没有明细了，任务书要求转逐行时有明细；表上货品一项照样显示合计，明细可展开，满足「按类别汇总」。**否决**：总价 → 逐行时去掉那些项的身份——再转回来就成了「专业模式里加的行」，备注与项名都丢了。**否决**：海运金额改写成「1 柜 × 金额」塞进逐行的共用参数——柜数是编出来的。

### D10：接口与权限
- 新路由 `src/app/api/projects/[id]/bid-page/quotes/[quoteId]/lump/route.ts`（GET `internal_cost` / PUT `edit`）、`…/convert/route.ts`（POST `edit`）：取参数后第一句 `requireQuoteAccess` 并紧接着检查，再 `lineModeGate`（开关 / 招投标项目 → 404；内部成本权限 ∧ 财务查看权 → 403），再读请求体。错误用 `lineModeErrorResponse`。
- `POST /bid-page/quotes` 收 `entryMode: "LUMP_SUM"`；列表 `entryMode: "LINE" | "LUMP_SUM" | null`；导出可用性对总价报价写专门的原因。
- 不是总价报价读 / 存总价视图 → 409；跨项目 → `getQuote` 按项目取不到 → 404。
- **否决**：总价与逐行共用一个 `/line` 接口按做法分支——两种状态的结构不同，混在一个 schema 里校验更容易漏。

### D11：界面
- `src/components/bid-page-v2/lump-sum-editor.tsx`：构成表（项目 | 金额或比例 | 备注）、「添加一项」下拉（中文清单，只列还没加的，其它可多条）、货品总数 / 明细切换、销售税一行三个比例、预置区（文案与逐行表相同）、定价一行六个数与算式、其它成本行、「更多 → 用专业模式打开 / 转成逐行报价」、「提交、批准在专业模式里做」。不读写浏览器存储。
- 从 `quote-step.tsx` 把 `Note`、`NumInput`、`CurrencySelect`、`InquiryPicker`、`PresetRow` 与输入校验的 context 挪到 `quote-ui.tsx`，两个编辑器共用；`quote-step.tsx` 的渲染结果不变（BIDPAGE-3 渲染测试照跑）。
- `QuoteStep`：新建两问加「只报总价」；列表里总价报价写「只报总价」、点开调 `/lump`；逐行编辑器「更多」里加「转成只报总价」。转换前确认一次，说明转换后会变什么。
- **否决**：在 `LineQuoteEditor` 里加一个总价分支——那个组件已经 400 多行，两种表的状态完全不同。

## 与八条硬纪律的关系

1. 零 schema：只用 `QuoteCostLine.metadata` / `notes`、`ProjectQuote.engineJson` 既有字段；`prisma/` 无 diff。
2. 出站先审批：不涉及；不新增任何外发。
3. 不新增队列 / 定时任务：全部请求时现算。
4. 脱敏：金额、比例、税、备注、供应商只经 `requireQuoteAccess` + 金额门的新接口返回；不写投标工作区、不写浏览器；不新增 Muse 读取路径（muse-bridge 不读 `QuoteCostLine` 与 `engineJson`）；测试只用任务书的合成数字与另造的合成数字。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不调模型；转换是纯函数，前后用引擎核对。
8. 测试注册：三份新测试在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册（隔离库那份在 CI 子集里没有隔离库时按设计跳过，与 BIDPAGE-1 / 3 同例）。

## 验证方式

- 纯逻辑：`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`（判定、映射对照、校验范围、税、验收 3 的数、算式、转换多组数据前后相同、拒绝的情况、守卫源码）。
- 渲染：`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`（4 行、添加一项、默认填法、六个数与算式、算不出、改回总数确认、不写浏览器）。
- 隔离库：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`（新建、保存、税、验收 3 / 4、点选、其它成本行不碰、并发 / 冻结、各种身份、开关关、跨项目、互转、导出原因、专业模式保存与另起新版后做法与税还在）。
- BIDPAGE-3 / 1 回归：`quote-line.test.ts`、`quote-step.test.tsx`、`quote-line-db.isolated.test.ts`、`bid-page-v2.test.tsx`、`next-step.test.ts`、`bid-page-summary-db.isolated.test.ts`；FIX-21 `project-routes-guard.test.ts`。
- 开关关 = 零变化：`bid-page-v2.test.tsx` 开关关时入口与 `BidTab` 逐字节相同；`engineConfigSchema` 对没有做法字段的配置与冻结的旧 schema 深度相同（`quote-line.test.ts`）；新接口开关关 404（隔离库）。
- 全量门禁：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`scripts/check-test-registry.sh`、`openspec validate quote-lump-sum-mode --strict`。
- 浏览器抽检（本地合成数据）：验收 3 的数逐键输入、开预置与专业模式页对照、互转一次。

## Risks / Trade-offs

- [按比例的关税不进「直接成本」] → 预备金、售后预留按直接成本算时不含按比例算的关税（引擎口径，不改）；比例那一格旁写明基数含什么。
- [给客户的报价单按客户可见行重新算税] → 内部的含税总价与客户报价单的税可能不同（客户行与引擎售价不一致时）；本 change 不动客户报价单，交接里记一笔。
- [转换会差几分] → 柜数 × 每柜换成金额后按 4 位小数取整可能差一分；写库前用引擎核对，不同就拒绝、写明，不悄悄转。
- [税在逐行表上看不到] → 总价 → 逐行后税还在配置里（我方报价是税前，不受影响）；转换确认里写明，转回总价时照样显示。
- [专业模式保存与总价保存之间的窄窗口] → 与 BIDPAGE-3 相同：专业模式保存不做乐观锁，总价保存有；只读代码确认，写进报告。
- [逐行表的「其它成本行」文案] → 来自总价表的项改写「从只报总价转来的项」，不冒充专业模式加的。
- [回退后做法丢失] → 回退到 BIDPAGE-3 代码后 `LUMP_SUM` 不认识、读时丢掉，总价报价按专业模式打开（成本行、备注、税都在）；但之后在专业模式保存一次，配置里的做法就被写掉，再升级回来要手工转一次。

## Migration Plan

- 开关 `TENDER_BID_PAGE_V2_ENABLED` + `TENDER_BID_PAGE_V2_ORG_ALLOWLIST` 保持关（八个都合并后由 Evan / Lucas 打开）。没有数据迁移。
- 回退：回退本 PR；已建的总价报价按专业模式打开（见上一条风险）。
