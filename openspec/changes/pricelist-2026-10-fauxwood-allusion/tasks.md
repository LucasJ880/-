# Tasks

## 1. 价表与黄金门禁

- [ ] 1.1 `pricing-types.ts` 加 `Fauxwood`，`isManualPriceShadeProduct` 只剩 `Roman`；`pricing-data.ts` 从 `config/pricelist/2026-10-28-lucas-quote.json` 拷入 Fauxwood / Allusion 的 `BRACKETS` 与 MSRP 表、`DEFAULT_DISCOUNTS`（0.30 / 0.35）、`PRICE_FLOOR`（209 / 200）、`ALL_PRODUCTS`、`getMsrpTable` / `getAvailableFabrics`，`BASE_PRICE_VERSION` 升 `2026-10-28` 并记录来源 SHA-256；verify：`npx tsx src/lib/blinds/__tests__/sunny-motor.test.ts` 与 `quote-fees.test.ts` 仍过（开工前先跑记基线）
- [ ] 1.2 新建 `src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`（design D4：`MUST_MATCH` / `DEFERRED` 分组，未归组标签即失败，金额误差 ≤ 0.01），同一提交注册进 `scripts/test-all.sh`；verify：`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 全过且 `bash scripts/check-test-registry.sh` 通过

## 2. 引擎与折扣落点

- [ ] 2.1 `pricing-engine.ts` 新增纯函数 `applyManualSellingPrice`，`calculateQuoteTotal` 对 Allusion 的 `manualPrice` 作成交价覆盖（design D2）；`Roman` 手填分支不变；verify：黄金测试新增 2 条本地用例（Allusion 24" × 36" 手填 300 → price 300、discountValue = msrp − 300；Roman 未填 → 报错文案不变）通过
- [ ] 2.2 `discount-settings.ts`：`PRODUCT_KEYS` 加 `fauxwood` / `allusion`，新增 `readJsonDiscounts(settingsJson)` 纯函数，`loadDiscounts` / `loadDiscountsDto` 合并列存与 JSON 存，`saveDiscountsForOrg` 把 JSON 键写入 `settingsJson.pricing.discounts` 子对象（事务内只替换该子键）；`cost-rates.ts` 随 `PRODUCT_TO_FIELD` 自动支持新键；verify：`cost-rates.test.ts` 扩 3 条（fauxwood 率、allusion 率、`readJsonDiscounts` 坏值回默认）通过
- [ ] 2.3 `quote-settings/discounts/route.ts` 的 GET / PUT 校验与返回含 `fauxwood` / `allusion`；`quote-settings-approval.ts` 描述文字含新键；执行器 `execSalesUpdateQuoteSettings` 经 `saveDiscountsForOrg` 落 JSON 键；新建或扩 `src/lib/sales/__tests__/quote-settings-db.isolated.test.ts`：老板 PUT `{fauxwood:0.25}` → 202、settingsJson 未变；批准后 `pricing.discounts.fauxwood=0.25` 且 `sunnyWarranty` 键保留；`{allusion:1.5}` → 400；verify：该隔离库测试通过并注册进 `scripts/test-all.sh`

## 3. 报价入口

- [ ] 3.1 `POST /api/sales/quotes` 把 `pricelistVersion` 合并进 `formDataJson`（design D5）；`preview` / `measurements/[id]/generate-quote` 用合并后的折扣；`sku-catalog.ts` 加别名表并改 `public/sku-catalog.csv` 的 BL201 行；verify：`sales-record-access-db.isolated.test.ts` 或新增隔离库断言 `formDataJson.pricelistVersion === "2026-10-28"`；`grep -c LOUIA-WHITE public/sku-catalog.csv` 为 1 且为新编号；别名解析用黄金测试文件里的 2 条本地用例覆盖
- [ ] 3.2 Order Form `order-shades.tsx` 的 `SHADE_PRODUCTS` 加 Fauxwood，Allusion 行改为 SKU 类别下拉 + 可选"手动成交价"输入；`pricing-helpers.ts` 调 `applyManualSellingPrice`，`ZERO_DISCOUNTS` / `DiscountsOverride` 含新产品；`part-a.tsx`、`measure/page.tsx` 随 `ALL_PRODUCTS` 出现 Fauxwood；驾驶舱 `discount-settings-card.tsx` 加 Fauxwood / Allusion 两行；`ai-quote-parser.ts` 加词表与正则；verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0，`npm run build` 通过，解析 `2 faux wood 36x48; 1 allusion 48x60` 得 2 + 1 行（在 `quote-mapping.test.ts` 同目录新增或扩既有解析测试）

## 4. 出单与工艺单

- [ ] 4.1 `fulfillment/category.ts` 加 `Fauxwood: "shades"`；`quote-mapping.ts` 无模板分支加 `PURCHASE_LABEL`（Fauxwood → "仿木百叶"）；verify：`npx tsx src/lib/fulfillment/__tests__/category.test.ts` 与 `npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` 各扩 1 条（Fauxwood → shades；Fauxwood 36" × 48" → 外采购行 `仿木百叶 Fauxwood`、无阻断）通过

## 5. 收口

- [ ] 5.1 全量门禁：`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate pricelist-2026-10-fauxwood-allusion --strict`、隔离库 `npm test`（失败项逐个与 origin/main 对照）；隔离库 + `next start` + Playwright 走查 Order Form 录 Fauxwood 36.5" × 48"（287.05 / 18）与 Allusion 25.5" × 36.5"（= 黄金用例）→ 保存 → `formDataJson.pricelistVersion`；`git diff --stat prisma/` 为空；verify：以上命令退出 0，走查截图与数字写进报告
- [ ] 5.2 写 `docs/QINGYAN_PRICE-1_REPORT.md`（做了什么 / 怎么验 / 对规划的调整 / 已知限制：历史 Allusion 行不重算、Fauxwood 无 SKU 只有类别回退）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` PRICE-1 状态列 + `docs/QINGYAN_PRICELIST_HANDOFF.md` §0 流水线表；verify：三个文件在同一提交里，报告 §2 每条命令都有实际输出

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive pricelist-2026-10-fauxwood-allusion --yes`（独立小 PR），确认 `openspec list --specs` 列出 `sales/price-list`。
- 归档后 PRICE-2 从黄金测试的 `DEFERRED` 组接手。
