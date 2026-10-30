# Design

## Context

见 proposal.md「Why」。已核实的现状（2026-10-30，main @ `33139de`）：

- `priceFor`（`src/lib/blinds/pricing-engine.ts`）：无绳在 `isCordlessEligible` 后先查 `CORDLESS_MAX_WIDTH/HEIGHT = 75` 报错；折扣取 `discountOverridePct ?? DEFAULT_DISCOUNTS[product]`；最低价 `PRICE_FLOOR[product] = 100`；最后 ×1.15。Door Screen Sheer 与 Roller 分支各自重复这段逻辑。
- Order Form Shades 行没有无绳字段，`page.tsx:890` 用 `cordless: l.lift === "L" || l.lift === "R"`；客户端 `computeShadeLinePrice` 调 `priceFor` 时根本不传无绳 → 预览从不 ×1.15，服务端却对 L/R 行 ×1.15。工艺单映射 `quote-mapping.ts:203-205` 把 L/R 当普通拉绳，`BlindsItemDraft.controlType` 只有 `"普通" | "电动"`，而 `calculation-engine.ts` 的 `ControlType` 已含 `"无绳"` 且 `deduction-rules.ts` 有无绳减尺表。
- Part A（`part-a.tsx:224`）与量房页（`measure/page.tsx:44`）已有独立无绳勾选，并把 `cordless` 传给引擎。
- PRICE-1 加的 `applyOrgDiscountDefaults` 会给每一行填 `discountOverridePct = 企业产品折扣`；引擎把它当显式覆盖 → 不改的话无绳折扣永远套不上。
- 布帘 / 纱帘：Order Form `drapeFullness / sheerFullness` 与 Part A `fullness` 都是 `"180" | "230"`，只喂给工艺单（`quote-mapping.ts:366` → 1.8 / 2.3）；定价按实际窗宽查表（等价于褶皱率 2）。
- 企业设置 JSON 已有 `pricing.discounts`（PRICE-1）与 `pricing.leadMaxPct`；`readJsonDiscounts` / `mergeJsonDiscounts` 是只动子键的纯函数；`validateDiscountsInput` 按键表分组校验。
- 黄金文件 `DEFERRED` 110 条标签：cordless-zebra / cordless-zebra-bo / cordless-roller / cordless-roller-cassette / cordless-override / fullness-drapery / fullness-sheer / fullness-default / fullness-invalid / door-screen-no-fullness。

## Goals / Non-Goals

**Goals:**
- 158 条黄金用例全部一致，`DEFERRED` 为空。
- 无绳只来自显式开关（Q4 = A），报价、预览、工艺单三处对同一行的无绳判断一致。
- 褶皱率与工艺单共用同一字段，不新增设置项。

**Non-Goals（不动的东西）:**
- `src/lib/blinds/pricing-addons.ts`、Part B（PRICE-3）。
- `src/lib/sales/period/**`（STAT-1）。
- `config/pricelist/2026-10-28-golden-cases.json`、`config/pricelist/2026-10-28-lucas-quote.json`：只读契约，不改。
- `src/lib/blinds/calculation-engine.ts`、`deduction-rules.ts`：无绳减尺表已存在，不改数值。
- `src/lib/sunny-process/drapes-calc.ts`：褶皱率用法不变。
- Door Screen Sheer 两档定价与企业折扣套用方式。
- `prisma/schema.prisma`、`QuoteDiscountSettings` 列集合。
- `src/lib/muse-bridge/**`、`src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx` 内嵌 HTML 的产品逻辑（只透传新的 DTO 键）。

## Decisions

### D1 无绳 = Order Form 行上的显式开关（Q4 选 A）
- 做法：`ShadeOrderLine.cordless?: boolean`（随 `formDataJson` 存，零 schema）；Shades 表 Lift 列右侧加"Cordless"开关列，非 Zebra / Roller 禁用并在切换产品时清掉；`page.tsx` 构造 items 时 `cordless: l.cordless === true`。老表单无字段 → `undefined` → 关。
- 否决：维持 L/R 即无绳（B）—— 与工艺单矛盾，PRICE-2 的 30% 折扣与最低价会把差异放大。否决：新增列 —— 纪律 1。

### D2 引擎接收无绳策略对象，不再读模块常量
- 做法：`priceFor(product, fabric, w, h, discountOverridePct, cordlessRequested, policy?: CordlessPolicy)`，`CordlessPolicy = { discount, floors: { Zebra, Roller }, multiplier }`，默认 `DEFAULT_CORDLESS_POLICY`（0.30 / 159 / 129 / 1.15，常量从 `config/pricelist/2026-10-28-lucas-quote.json` 的 `cordless` 节拷入）；三条分支（标准 / Roller / Door Screen Sheer）统一走一个 `settlePrice(msrp, price, product, cordless, policy)` 收尾，顺序与原工具 `price()` 一致：先 ×倍率、再与最低价比较（无绳用无绳最低价，否则产品最低价；apply 中按黄金用例更正，原稿写成先最低价后倍率）；删除 `CORDLESS_MAX_WIDTH/HEIGHT` 与其检查。`calculateQuoteTotal` 入参加 `cordlessPolicy?`，透传给每行。
- 否决：把无绳折扣塞进 `DEFAULT_DISCOUNTS` 当伪产品键 —— 折扣表 DTO / 成本率键表会被污染。否决：保留 `cordlessMultiplier` 旧参数 —— 原工具把倍率、折扣、最低价视为一组设置，拆开反而难对照。

### D3 企业折扣填充跳过无绳行；无绳折扣走策略对象
- 做法：`applyOrgDiscountDefaults` 对 `cordless === true && isCordlessEligible(product)` 的行不填 `discountOverridePct`；四个服务端入口把 `dtoToCordlessPolicy(quoteSettings)` 传给 `calculateQuoteTotal`；客户端 `computeShadeLinePrice` 对无绳行传 `null` 覆盖 + 策略对象（策略来自同一个 DTO，`DiscountsOverride` 旁边多一个 `cordlessPolicy` 参数），并开始真正传 `line.cordless`。
- 否决：把无绳折扣当行级覆盖填进去 —— 黄金 `cordless-override` 要求行级覆盖优先于无绳折扣，两者必须可区分。

### D4 无绳设置存 `pricing.cordless` 子键，复用 PRICE-1 的合并 / 审批链
- 做法：`discount-settings.ts` 增加 `CORDLESS_SETTING_KEYS = ["cordlessDiscount","cordlessFloorZebra","cordlessFloorRoller"]`，`readJsonCordless` / `mergeJsonCordless` 纯函数（结构同 `readJsonDiscounts`）；`validateDiscountsInput` 对 discount 走 0–1、对 floors 走 0–10000；`saveDiscountsForOrg` 的拆分逻辑把这三键路由到 `pricing.cordless`；DTO 三个字段；审批描述与幂等键自然包含（`numericPatch`）。
- 否决：单独接口 —— 与 PRICE-1 D1 同样理由（第二条审批链）。

### D5 褶皱率是行级输入，默认 2，不加企业设置
- 做法：`QuoteItemInput.fullness?: number`；`priceFor` 在 `usesFullness(product, fabric)`（Drapery / Sheer 且非 Door Screen Sheer）时 `lookupW = w × fullness / 2`，先校验 1–4，取档用 `lookupW`，安装用 `w`，超范围错误文案带 `Math.round(maxW × 2 / fullness × 100) / 100`。Order Form / Part A 把 `"180" | "230"` 转成 1.8 / 2.3 随 items 上传；量房 / AI / Muse 不带 → 2。
- 否决：企业默认褶皱率设置（任务书原方案）—— Order Form 行上永远有值，其它入口没有褶皱概念，设置项没有读者。否决：Order Form 加 200 / 250 / 300 选项 —— Sunny 只卖 180 / 230 两档，工艺单也只认这两档；要加另开 change。
- 代价（已在 proposal 标 BREAKING）：默认 180% 的布帘查表宽从 1.0× 变 0.9×。这是原工具的规则，不是青砚的发明。

### D6 工艺单：无绳行 `controlType = "无绳"`
- 做法：`BlindsItemDraft.controlType` 放宽为 `"普通" | "无绳" | "电动"`；映射顺序 Lift M → 电动，否则 Cordless 开 → 无绳，否则普通；`controlSide` 仍取 Lift，缺省 R 并保留既有提示。`calculateItem` 已支持无绳减尺（规格 `sunny/process-order-engines`），`blinds-oracle` 夹具不变。
- 否决：无绳行进外采购 —— 卷帘 / 斑马帘无绳是自产件，减尺表已有。

### D7 黄金测试分组：`DEFERRED` 清空，机制保留
- 做法：把 10 个标签移入 `MUST_MATCH`，`DEFERRED = new Set([])`；`priceFor` 调用加上 `fullness` 透传（通过 `calculateQuoteTotal` 单行调用或直接传参）；比对规则不变。
- 否决：删掉分组机制 —— 下次价表更新还要用。

### D8 顺带修复量房「生成报价」写库 500（apply 中发现，Lucas 2026-10-30 同意）
- 现状：`src/app/api/sales/measurements/[id]/generate-quote/route.ts` 把 `SalesQuoteItem` 嵌在 `rooms.create.items.create` 里并写 `quoteId: undefined as any`；行同时属于报价与房间，Prisma 要求给出 `quote` 关联 → 每次 500（origin/main 上即如此，与定价无关）。规格「褶皱率来源 / 量房生成按 2」场景要经过这个路由才能验证。
- 做法：同一事务内先建报价，再逐个建房间并 `createMany` 该房间的行（显式 `quoteId` + `roomId`），最后带 rooms / items 读回；响应结构不变。
- 否决：预先生成报价 id 再嵌套 connect —— 依赖 cuid 生成细节；拆成单独 PR —— 本 change 已改动该路由且规格场景依赖它，Lucas 同意并入。

## 与八条硬纪律的关系

| 条 | 关系 |
|---|---|
| 1 零 schema | 触碰：无绳开关与褶皱率随 `formDataJson`；无绳设置存 `settingsJson.pricing.cordless`；无 Prisma 改动（验证：`git diff --stat prisma/` 为空） |
| 2 出站先审批 | 触碰：无绳设置修改沿用 `sales.update_quote_settings`（验证：隔离库测试 202 → 批准生效） |
| 3 禁止第三套队列 | 不涉及 |
| 4 脱敏 | 触碰：预览 / 折扣接口不出成本（沿用 PRICE-1 断言） |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 不涉及 |
| 7 确定性优先 | 触碰：查表纯函数，黄金 158 条零 LLM |
| 8 测试注册 | 触碰：不新建测试文件，只扩既有已注册测试；`bash scripts/check-test-registry.sh` 通过 |

## Risks / Trade-offs

- [老报价 L/R 行重算后不再 ×1.15，金额变小] → 只在编辑重算时发生；报告与 PR 写明；销售若确为无绳需打开开关。
- [默认 180% 布帘查表宽变 0.9×，部分尺寸掉一档变便宜] → 原工具规则；报告给出 100" × 120" 前后对比；Lucas 可改用 230。
- [三条 `priceFor` 分支的无绳收尾合并时漏掉 Roller 罩盖顺序] → 黄金 `cordless-roller-cassette` 组 8 条逐条比（bump 在折扣后、倍率前；最低价最后）。
- [客户端第一次真正按无绳计价，总价与此前预览不同] → 这是修正而非回归；走查对比开关开 / 关两种总价。
- [`applyOrgDiscountDefaults` 跳过无绳行后，无绳行拿不到企业产品折扣] → 规格明确无绳行不用产品折扣。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 黄金对照 | `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`（158 条，DEFERRED 0） |
| 设置读写 / 审批 | `npx tsx src/lib/blinds/__tests__/cost-rates.test.ts`（扩 `readJsonCordless` / `mergeJsonCordless`）、`npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts`、隔离库 `quote-settings-db.isolated.test.ts`（扩无绳场景） |
| 工艺单 | `npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts`（扩无绳行）、`blinds-oracle`、`real-orders` |
| 回归 | `sunny-motor`、`quote-fees`、`valance-options`、`signed-quote-amount-db.isolated` |
| 门禁 | typecheck / lint:baseline / test:ci / registry / `openspec validate pricelist-2026-10-cordless-fullness --strict` / `npm run build` |
| 走查 | 隔离库 + `next start` + Playwright：Zebra 24" × 36" 开 Cordless → $159；关 → 有绳价；Zebra 90" × 100" 开 Cordless → $557.10 不报错；布帘 Without liner 100" × 120" 默认 180% → $831.41；保存后 `SalesQuoteItem.cordless` 与工艺单操控方式一致 |
