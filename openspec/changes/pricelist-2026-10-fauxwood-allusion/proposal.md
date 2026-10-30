# Proposal

## Why

Lucas 2026-10-29 上传的 Sunny 价格表（报价工作台 `2026.10-local.1`）与青砚现有价表三方逐格比对后，9 个老产品零差异，真正的增量是 Fauxwood 新产品和 Allusion 的完整矩阵（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §2 D1 / D2 / D9）。销售要能直接在青砚上按这份价表报仿木百叶与梦幻帘，而不是手填单价。

TASKFLOW：PRICE-1（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase P）。

## What Changes

- 新增产品 `Fauxwood`：11 宽档 × 9 高档 MSRP 矩阵，默认折扣 30%，最低价 209，最大 78" × 75"，安装费按普通帘子规则（18 / 26）。数值只从 `config/pricelist/2026-10-28-lucas-quote.json` 拷入。
- `Allusion` 改为查表定价：14 宽档 × 15 高档 MSRP 矩阵，默认折扣 35%，最低价 200；Order Form 上原"手填单价"降为可选的手动成交单价覆盖，有值时成交价取手填值、折扣额 = MSRP − 手填值。**BREAKING**：Allusion 行不再因未填单价而被跳过，改为查表计价。
- `Roman`（罗马帘手填）保持手填分支不变。
- 价表版本升为 `2026-10-28`；新建报价把价表版本写进 `formDataJson.pricelistVersion`（零 schema）。
- Fauxwood / Allusion 的企业折扣落 `Organization.settingsJson.pricing.discounts.{fauxwood,allusion}`（零 schema）；折扣接口读写这两项，修改走既有 `sales.update_quote_settings` 审批；品类成本率同样接受这两个键。
- 驾驶舱折扣卡新增 Fauxwood / Allusion 两行。
- Fauxwood 进 Order Form（Shades 表）、Part A、量房页产品下拉；AI 报价文字解析识别"fauxwood / faux wood / 仿木 / allusion / 梦幻帘"。
- 出单品类：Fauxwood → `shades`；签字自动生成工艺单时 Fauxwood 行作外采购行，品类文字"仿木百叶"。
- SKU 目录：Zebra `LOUIA-WHITE-LF-BL201` 改名为 `LOUIA-WHITE-BL201-LF`，旧编号作为别名仍能解析到同一条。
- 新建黄金对照测试：读 `config/pricelist/2026-10-28-golden-cases.json`，按标签分"本次必须一致 / 留给 PRICE-2"两组，逐条与定价引擎比对；注册进 `scripts/test-all.sh`。

## Capabilities

### New Capabilities
- `sales/price-list`：Sunny 零售价表的版本、产品 / 面料定价查表规则（含 Fauxwood、Allusion）、手动成交价覆盖、企业折扣的零 schema 落点、SKU 别名、报价记录价表版本、黄金用例对照文件作为契约。

### Modified Capabilities
- `fulfillment/order-category-access`：「品类判定」要求加入 `Fauxwood → shades`。
- `sales/quote-settings-approval`：新增要求——存于企业设置 JSON 的品类折扣（fauxwood / allusion）与成本率键同样经由 PUT 折扣接口提交、同样进入审批、批准后才生效。
- `sunny/process-order-autogen`：新增要求——Fauxwood 行进外采购行，品类文字"仿木百叶"，不产生阻断项。

## Impact

- 定价：`src/lib/blinds/{pricing-types,pricing-data,pricing-engine,discount-settings,cost-rates,sku-catalog}.ts`；`public/sku-catalog.csv`
- 报价创建 / 预览：`src/app/api/sales/quotes/route.ts`、`src/app/api/sales/quotes/preview/route.ts`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts`
- 折扣设置：`src/app/api/sales/quote-settings/discounts/route.ts`、`src/lib/sales/quote-settings-approval.ts`、`src/lib/pending-actions/executor.ts`（`sales.update_quote_settings` 执行）、`src/app/(main)/sales/cockpit/discount-settings-card.tsx`
- 报价单 UI：`src/app/(main)/sales/quote-sheet/{order-shades,part-a,pricing-helpers,page}.tsx`、`src/app/(main)/sales/measure/page.tsx`、`src/lib/sales/ai-quote-parser.ts`
- 出单 / 工艺单：`src/lib/fulfillment/category.ts`、`src/lib/sunny-process/quote-mapping.ts`
- 测试：新建 `src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`；扩 `cost-rates` / `category` / `quote-mapping` / `quote-settings-approval` 测试；`scripts/test-all.sh` 注册
- 不触碰 muse-bridge：无受影响 Muse 意图

## Out of scope

- 无绳独立折扣 / 最低价 / 取消 75" 上限、布帘纱帘褶皱率（PRICE-2）。
- 附加项目目录扩充、Downtown 服务费（PRICE-3）。
- 按人报价清单展开、周预设（STAT-1）。
- 所有产品通用的"手动成交单价"覆盖（本次只对 Allusion 开放）。
- Fauxwood 的工艺计算引擎、面料画册附页、经销商参考价。
- 运费默认值（企业设置已有，不改）。
