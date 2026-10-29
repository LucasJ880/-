# PRICE-1 报告 — Sunny 价格表 2026-10-28：Fauxwood 新产品 + Allusion 查表定价 + 企业折扣零 schema 落点 + 黄金对照门禁

change：`openspec/changes/pricelist-2026-10-fauxwood-allusion/`（proposal / specs：新 `sales/price-list` 10 条、`fulfillment/order-category-access` 修改 1 条、`sales/quote-settings-approval` 新增 1 条、`sunny/process-order-autogen` 新增 1 条 / design D1–D7 / tasks 10/10）
来源：Lucas 2026-10-29 上传 `LUCAS_QUOTE.zip`（报价工作台 `2026.10-local.1`），"把价格表更新到青砚后台，直接在青砚上报价"；判断点 Q1–Q11 "都按照推荐的来"。方案与三方比对：`docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md`。
零 schema：新折扣存 `Organization.settingsJson.pricing.discounts`，价表版本存 `SalesQuote.formDataJson.pricelistVersion`；`git diff prisma/` 为空。不加权限键、不加 LLM 调用、无出站。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 9 个老产品的 MSRP / 折扣 / 最低价 / 安装费 | 2026-10 价表 | **一格未动**（三方逐格比对 0 差异；黄金 `regression` 组证明） |
| Fauxwood（仿木百叶） | 没有 | 11 宽档 × 9 高档查表，折扣 30%，最低价 209，最大 78" × 75"，安装 18 / 26；Order Form / Part A / 量房页下拉可选；AI 文字解析认 `fauxwood / faux wood / 仿木 / 仿木百叶` |
| Allusion（梦幻帘） | 销售手填单价，折扣 0 | 14 宽档 × 15 高档查表，折扣 35%，最低价 200；Order Form 价格格下多一个可选"手动$"成交价（留空按价表，填了成交价取它、MSRP 仍是价表、折扣额 = MSRP − 手填值）；AI 解析认 `allusion / 梦幻帘` |
| Roman（罗马帘手填） | 手填 | 不变 |
| 价表版本 | `2026-10` | `2026-10-28`；新建 / 重算报价时服务端把版本写进 `formDataJson.pricelistVersion`，原字段保留 |
| 企业折扣（驾驶舱折扣卡） | 9 个品类列 | 多 Fauxwood / Allusion 两行；存企业设置 JSON 的 `pricing.discounts` 子键，读取合并成一张表；修改走既有 `sales.update_quote_settings` 审批（老板改、另一位老板批、super_admin 直接生效）；批准写入只替换该子键，`sunnyWarranty` / `calendarWatch` / `leadMaxPct` 原样；品类成本率也接受 `fauxwood` / `allusion` |
| 服务端计价与客户端预览 | 服务端 `POST /api/sales/quotes`、PUT、预览、量房生成**用平台默认折扣**（客户端预览用企业折扣，两者在企业改过折扣时不一致，见 §4） | 四处都先把企业折扣套到没有行级覆盖的行上，再进引擎；与客户端预览同源 |
| SKU 目录 | Zebra `LOUIA-WHITE-LF-BL201` | 正式编号 `LOUIA-WHITE-BL201-LF`（Lucas 2026-10-29 BL201 更新）；旧编号在目录层做别名，历史报价行仍能解析并按 Light Filtering 定价；条目仍 350 |
| 出单品类 / 工艺单 | — | Fauxwood → `shades`（Roller/Zebra/Roman 出单岗）；签字自动生成工艺单时作外采购行，品类文字"仿木百叶 Fauxwood"，不阻断 |
| 黄金对照门禁 | 没有 | `pricelist-2026-10-golden.test.ts`：读 `config/pricelist/2026-10-28-golden-cases.json`（158 条，由上传工具 `price()` 原函数算出），`MUST_MATCH` 48 条逐条比（金额 ≤ 0.01、安装、取档、报错 ↔ 报错），`DEFERRED` 110 条留给 PRICE-2，未归组标签即失败；已注册 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/blinds/pricing-types.ts` | `ProductName` 加 `Fauxwood`；`isManualPriceShadeProduct` 只剩 `Roman`；`manualPrice` 语义注释 |
| `src/lib/blinds/pricing-data.ts` | 版本 `2026-10-28` + 来源 SHA-256 常量；Allusion 档位改为价表档位；Fauxwood 档位；`MSRP_ALLUSION` / `MSRP_FAUXWOOD`（脚本从 `config/pricelist/2026-10-28-lucas-quote.json` 拷入并回读比对相等）；折扣 / 最低价；`getMsrpTable` / `getAvailableFabrics` / `ALL_PRODUCTS` |
| `src/lib/blinds/pricing-engine.ts` | `allowsManualSellingPrice`（仅 Allusion）、`applyManualSellingPrice`（纯函数，客户端与服务端共用）；`calculateQuoteTotal` 在 `priceFor` 后套用 |
| `src/lib/blinds/discount-settings.ts` | `JSON_DISCOUNT_KEYS`、`readJsonDiscounts` / `mergeJsonDiscounts`（纯函数）；`PRODUCT_KEYS` 加两键（校验与成本率键自动跟随）；`loadDiscounts` / `loadDiscountsResult` / `loadDiscountsDto` 合并列存与 JSON；`saveDiscountsForOrg` 事务内拆分写入；`applyOrgDiscountDefaults` / `dtoToProductDiscounts` |
| `src/lib/blinds/pricelist-version.ts`（新） | `stampPricelistVersion` / `readPricelistVersion` |
| `src/lib/blinds/sku-catalog.ts`、`public/sku-catalog.csv` | `SKU_ALIASES` / `canonicalSku`；`findSku` / `skuToPricingFabric` 先归一；CSV 改正式编号 |
| `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`、`src/app/api/sales/quotes/preview/route.ts`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts` | 套企业折扣；POST / PUT 写价表版本 |
| `src/lib/fulfillment/category.ts`、`src/lib/sunny-process/quote-mapping.ts` | Fauxwood → shades；外采购行品类文字表 `PURCHASE_LABEL` |
| `src/app/(main)/sales/quote-sheet/{types,order-shades,pricing-helpers,page,rough-quote-panel}.tsx` | 产品代号 `F`、品类 shade；Shades 表加 Fauxwood、Allusion 走 SKU 类别下拉 + 手动成交价；预览用同一纯函数；折扣映射与保存带两键；保存时 Allusion 手填值随行上传 |
| `src/app/(main)/sales/cockpit/discount-settings-card.tsx` | 两行折扣（成本率随 `FIELDS`） |
| `src/lib/sales/ai-quote-parser.ts` | 词表与正则 |
| 测试 | 新：`blinds/__tests__/pricelist-2026-10-golden.test.ts`、`sales/__tests__/ai-quote-parser.test.ts`、`sales/__tests__/quote-settings-db.isolated.test.ts`（三个均注册进 `scripts/test-all.sh`）；扩：`cost-rates`（+12 断言）、`quote-settings-approval`（18 → 20）、`category`（shades 列表）、`quote-mapping`（48 → 51） |
| 文档 | 本报告；HANDOFF；TASKFLOW PRICE-1 → `[G]` |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` | MUST_MATCH 48 条、280 断言全过（Fauxwood 14 / Allusion 14 / 回归 11 / Zebra、Roller、Door Screen、cordless-ignored 9）+ 本地用例（Allusion 手填覆盖、Roman 仍报错、非 Allusion 忽略 manualPrice、SKU 别名、价表版本写入） |
| `cost-rates` / `quote-settings-approval` / `category` / `quote-mapping` / `ai-quote-parser` | 通过 / 20 / 18 / 51 / 通过 |
| 老产品回归 | `sunny-motor`、`quote-fees`、`valance-options` 13、`blinds-oracle` 9488、`real-orders` 164、`discount-tier` 14、`pricing-policy` 10 全过（开工前基线相同） |
| 隔离库 + 真实路由 `quote-settings-db.isolated.test.ts` | 20 通过，0 失败：老板 PUT `{fauxwood:0.25}` → 202、settingsJson 未变、收件人另一位老板；批准 → `pricing.discounts.fauxwood=0.25`、其它键原样、版本 0 → 1、审计含批准人；`{allusion:1.5}` → 400 无审批；super_admin `{allusion:0.4}` → 200；预览与新建报价 Allusion 行 `discountPct 0.4`；Fauxwood 36.5" × 48" 落库 MSRP 410.06、取档 42 × 48、企业折扣 25%；`formDataJson.pricelistVersion = 2026-10-28`；预览响应无成本字段 |
| 隔离库回归 `signed-quote-amount-db.isolated.test.ts` | 20 通过（报价 POST / PUT 改动后不变） |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint；`scripts/pricelist/gen-golden.mjs` 改 ESM 后） |
| `bash scripts/check-test-registry.sh` | 已注册 492（开工前 489），欠账基线 71 不变 |
| `openspec validate pricelist-2026-10-fauxwood-allusion --strict` | valid |
| `git diff --stat prisma/` | 空 |
| `npm run test:ci` | __TESTCI__ |
| `npm run build` | __BUILD__ |
| 浏览器走查（本地生产构建 `next start -p 3100` + 隔离库 + Playwright） | __WALK__ |
| 全量 `npm test`（隔离库） | __FULL__ |

## 4. 实施中对规划的调整 / 发现（审核请重点看）

1. **服务端原来不套企业折扣。** `POST /api/sales/quotes` 等四处只用 `loadDiscountsDto` 取运费 / 电机 / 最低安装，行折扣交给引擎默认值；客户端预览却按企业折扣算。企业折扣等于平台默认时两者一致，所以此前没暴露。本次按 design D1 "定价、预览与报价创建同一来源"，四处都先套企业折扣（行上有销售手动覆盖的不动）。副作用：企业把某品类折扣改离默认值后，落库金额从此与预览一致（之前落库按默认值）。
2. **Door Screen Sheer 的折扣字段。** 上传工具的 `discount` 字段对 Door Screen Sheer 给的是产品默认折扣 35%，实际分支按 0 折扣计价（金额核对一致）；青砚 `discountPct` 记录实际套用值，黄金测试对该组不比折扣字段，只比金额。另：客户端与服务端现在都把 Sheer 的企业折扣套到 Door Screen Sheer 行上（客户端原本就这样），与上传工具"只认行级覆盖"不同，留 PRICE-2 一并看。
3. **PUT 重算也写价表版本**（规格只要求新建）：编辑报价会用当时价表重算，记录当时版本更诚实。
4. **Fauxwood 工艺单**：没有工艺模板的 Shades 产品本来就自动进外采购行，本次只补中文品类文字；没有新建工艺引擎（proposal Out of scope）。
5. `isManualPriceShadeProduct` 的调用方（Order Form / Part A / 量房 / 工艺单映射）全部跟随变化，Allusion 在工艺单仍映射"梦幻帘"国内下单（`QM-04c` 不变）。

## 5. 上线后要做 / 已知限制

- **历史 Allusion 报价行不重算**：已落库的 `SalesQuoteItem` 保持原金额；编辑重算时才按价表。
- **Fauxwood / Allusion 没有 SKU**：下拉只有类别回退 `Standard`（与 SHANGRILA 等一致）；面料画册附页不在范围。
- **企业折扣**：Fauxwood 30% / Allusion 35% 为默认；要改走驾驶舱折扣卡（老板改、另一位老板批）。
- 无绳独立折扣 / 最低价 / 取消 75" 上限、褶皱率 → PRICE-2（黄金测试 `DEFERRED` 110 条）；附加项目 → PRICE-3；按人报价清单 → STAT-1。
