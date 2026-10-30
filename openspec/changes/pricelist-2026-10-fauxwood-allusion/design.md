# Design

## Context

见 proposal.md「Why」。关键现状（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §0 F1–F15）：

- 定价引擎是纯函数：`priceFor(product, fabric, w, h, discountOverride, cordless)` 查 `BRACKETS` + `MSRP_*`，`calculateQuoteTotal` 汇总；`Allusion` / `Roman` 走 `isManualPriceShadeProduct` 的手填分支（`pricing-engine.ts:260`）。
- 品类折扣是 `QuoteDiscountSettings` 的列，DTO 键表 `PRODUCT_KEYS` 同时决定成本率允许的键（`discount-settings.ts:76-88`）；修改走 `sales.update_quote_settings` 审批，执行器 `execSalesUpdateQuoteSettings` 调 `saveDiscountsForOrg`（`executor.ts:1239-1290`）。
- `Organization.settingsJson.pricing` 已被 `pricing-policy.ts` 用作合价上限的零 schema 落点，读法是"坏值回默认"的纯函数。
- 没有工艺模板的 Shades 产品已经自动进外采购行（`quote-mapping.ts:230-239`），品类文字是 `帘子 ${product}`。
- SKU 目录来自 `public/sku-catalog.csv`，无别名机制（`sku-catalog.ts:143-155`）。
- 三方矩阵比对与黄金用例已在 `config/pricelist/` 落盘（任务书 §2、§6 V1 / V2）。

## Goals / Non-Goals

**Goals:**
- 引擎对 Fauxwood / Allusion 的输出与黄金用例逐条一致；老产品回归组零变化。
- 新折扣项走同一条审批链，零 schema。
- 黄金对照测试成为后续每个价表 change 的常驻门禁。

**Non-Goals（不动的东西）:**
- `src/lib/blinds/pricing-engine.ts` 的无绳分支（`isCordlessEligible`、`CORDLESS_MAX_*`、折扣与最低价）与 Drapery / Sheer 查表宽度 —— PRICE-2。
- `src/lib/blinds/pricing-addons.ts` 的 `ADDON_CATALOG` —— PRICE-3。
- `src/lib/sales/period/**`、`sales-period-panel.tsx` —— STAT-1。
- `prisma/schema.prisma`、`QuoteDiscountSettings` 的列集合、`SalesQuoteItem` 的列集合。
- `src/lib/sunny-process/{domestic-calc,drapes-calc,vinyl-calc}.ts`：不给 Fauxwood 建工艺引擎。
- `src/lib/muse-bridge/**`：不加意图、不改响应。
- `QuoteDiscountSettings.deliveryFee` 默认值。

## Decisions

### D1 新折扣落 `settingsJson.pricing.discounts`，与列存折扣合并读取
- 做法：`discount-settings.ts` 增加纯函数 `readJsonDiscounts(settingsJson)` → `{fauxwood?, allusion?}`（坏值丢弃）；`loadDiscounts` / `loadDiscountsDto` 同时查 `quoteDiscountSettings` 与 `organization.settingsJson`，合并为同一张 `DiscountsByProduct`；`PRODUCT_KEYS` 加 `fauxwood` / `allusion`，这样成本率校验自动接受这两个键（成本率本来就是 Json 列，零 schema）。
- 写入：`saveDiscountsForOrg` 把 patch 按键拆成两份——列键进 `quoteDiscountSettings.update`，JSON 键进 `organization.settingsJson.pricing.discounts`（读 → 只改 `pricing.discounts` 子对象 → 写回），放在同一个事务里；版本号仍只在 `QuoteDiscountSettings` 上加一。
- 否决：给 `QuoteDiscountSettings` 加两列 —— 违反纪律 1。否决：单独一个 JSON 设置接口 —— 会出现第二条审批链与第二张卡片，PERM-2 的"折扣表修改走审批"规格被绕开。

### D2 Allusion 查表 + 手动成交价覆盖只对 Allusion 开放
- 做法：`isManualPriceShadeProduct` 只剩 `Roman`；`calculateQuoteTotal` 在 `priceFor` 成功后，若 `item.product === 'Allusion'` 且 `manualPrice` 为 > 0 的有限数，则 `price = manualPrice`，`discountValue = max(0, msrp − price)`，`discountPct` 保持查表值；客户端 `computeShadeLinePrice` 同样处理，保证预览与落库一致。
- 否决：所有产品通用手动成交价（对应原工具的 `offer`）—— 牵涉 Part A 行折扣覆盖、折扣三档判定的分母与审批，属另一个 change。否决：Allusion 继续手填 —— 价表已给完整矩阵，继续手填等于放弃价表。

### D3 Fauxwood 的安装费走普通帘子分支
- 做法：`priceFor` 标准分支已是"非 Drapery / Sheer / Shutters → 18 / 26"，Fauxwood 不加特例；黄金用例 `fauxwood` 组（72" → 26，66" → 18）验证。
- 否决：按 Shutters 每扇计 —— 原工具 `price()` 不这么算，黄金用例会不一致。

### D4 黄金对照测试按标签分组，未归组即失败
- 做法：测试文件维护两个常量集合 `MUST_MATCH`（fauxwood / allusion / regression / zebra / roller / door-screen / door-screen-err / cordless-ignored）与 `DEFERRED`（cordless-zebra / cordless-zebra-bo / cordless-roller / cordless-roller-cassette / cordless-override / fullness-drapery / fullness-sheer / fullness-default / fullness-invalid / door-screen-no-fullness），先断言 `文件标签集 ⊆ MUST_MATCH ∪ DEFERRED`；`MUST_MATCH` 逐条调 `priceFor(product, fabric, w, h, discountOverridePct ?? null, cordless ?? false)`：有 `expect` 时比 `msrp` / `standard`（引擎 `price`）误差 ≤ 0.01、`install` 相等、`billW` / `billH` = `bracketWidth` / `bracketHeight`；有 `expectError` 时断言引擎返回 `error`。黄金文件里 `door-screen-no-fullness` 带 `fullness` 字段，PRICE-2 再接。
- 否决：把黄金数值手抄进测试 —— 任务书"价表数值只从文件拷，不手敲"。否决：跳过不一致的标签 —— 会把 PRICE-2 的缺口藏起来。

### D5 价表版本由服务端写进 `formDataJson`
- 做法：`POST /api/sales/quotes` 解析 `formDataJson`，是 JSON 对象时合并 `pricelistVersion: BASE_PRICE_VERSION` 后落库；不是对象（历史 shell 情况）时原样落库不报错。
- 否决：客户端自己写 —— 多个入口（量房生成、AI 导入）会漏。否决：新列 —— 纪律 1。

### D6 SKU 别名表放在目录加载层
- 做法：`sku-catalog.ts` 增加 `SKU_ALIASES: Record<string,string>`（旧 → 新），`findSku` / `productOfSku` / `skuToPricingFabric` 先把入参经别名表归一；CSV 行改为新编号，条数不变。
- 否决：CSV 两行并存 —— 下拉会出现两个同款面料。

### D7 Fauxwood 外采购行只改品类文字
- 做法：`quote-mapping.ts` 的无模板分支增加 `PURCHASE_LABEL: {Fauxwood: "仿木百叶"}`，`categoryZh` 变为 `仿木百叶 Fauxwood`，其它产品维持 `帘子 ${product}`；`fulfillment/category.ts` 的 `QUOTE_PRODUCT_CATEGORY` 加 `Fauxwood: "shades"`。
- 否决：新增品类 `fauxwood` —— 要新增出单岗位键与权限模板，超出本次。

## 与八条硬纪律的关系

| 条 | 关系 |
|---|---|
| 1 零 schema | 触碰：新折扣与价表版本分别落 `settingsJson.pricing.discounts` 与 `formDataJson`；无 Prisma 改动（验证：`git diff --stat prisma/` 为空） |
| 2 出站先审批 | 触碰：折扣修改沿用 `sales.update_quote_settings`，新增键不绕过（验证：approval 纯测试 + 路由返回 202） |
| 3 禁止第三套队列 | 不涉及 |
| 4 脱敏 | 触碰：预览 / 折扣接口不出成本；经销商参考价不进（验证：`price-list` 规格"不输出成本"场景） |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 不涉及 |
| 7 确定性优先 | 触碰：定价全部查表纯函数，黄金用例来自原工具 `price()`；零 LLM |
| 8 测试注册 | 触碰：新建 `pricelist-2026-10-golden.test.ts` 同一 task 注册进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 通过 |

## Risks / Trade-offs

- [合并读取多一次 `organization` 查询] → `loadDiscountsDto` 已在报价创建路径上，增加一次主键查询；两次查询放同一 `Promise.all`。
- [`settingsJson` 整对象覆盖抹掉其它键] → 写入只替换 `pricing.discounts` 子对象，隔离库测试断言 `sunnyWarranty` 等键保留（规格场景"批准后只动 pricing 子键"）。
- [历史 Allusion 报价行没有 `manualPrice` 语义变化] → 已落库的 `SalesQuoteItem` 不重算；只有新建 / 重算时才查表。报告写明。
- [Fauxwood 没有 SKU，下拉只有类别回退 `Standard`] → 与 SHANGRILA 等无 SKU 产品现状一致；面料画册附页不在范围。
- [黄金文件里 `standard` 已四舍五入到分] → 比对阈值 0.01，不用相等。
- [客户端与服务端两处 Allusion 覆盖逻辑] → 两处都调用同一个纯函数 `applyManualSellingPrice(result, manualPrice)`（放在 `pricing-engine.ts`），避免分叉。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 黄金对照 | `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` |
| 折扣 JSON 读写与审批 payload | `npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts`（扩）、`npx tsx src/lib/blinds/__tests__/cost-rates.test.ts`（扩：fauxwood / allusion 键） |
| 品类与工艺单 | `npx tsx src/lib/fulfillment/__tests__/category.test.ts`、`npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` |
| 老产品回归 | `npx tsx src/lib/blinds/__tests__/{sunny-motor,valance-options,quote-fees}.test.ts`、`npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts` |
| 门禁 | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate pricelist-2026-10-fauxwood-allusion --strict` |
| 页面 | `npm run build` 通过；隔离库 + `next start` + Playwright：Order Form 录 Fauxwood 36.5" × 48" 与 Allusion 25.5" × 36.5"，预览金额 = 黄金用例；保存后 `formDataJson.pricelistVersion = "2026-10-28"` |
