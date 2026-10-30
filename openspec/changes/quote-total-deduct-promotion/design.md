# Design

## Context

见 proposal.md「Why」。已核实的现状（2026-10-30，main @ `1aab138f`，PR #357 合并后）：

- 客户端（`src/app/(main)/sales/quote-sheet/page.tsx`）：`specialPromotionNum = max(0, parseFloat(specialPromotion) || 0)`；保存时 `preTaxForSave = max(0, productsSubtotal + subtotalB + subtotalC − specialPromotionNum)`，`displayGrandTotal = preTaxForSave + round(preTaxForSave × taxRate, 2)` 写进 `formDataJson`；请求体（POST 与 PUT）已带 `specialPromotion: specialPromotionNum` 与 `finalDiscountPct`（= 让利 ÷ 产品税前小计）。页面底部 Grand Total、定金比例校验与客户 PDF（`quote-pdf.ts` 第 653 行起）用同一算式。
- 服务端：`calculateQuoteTotal`（`src/lib/blinds/pricing-engine.ts` 第 270 行起）`preTaxTotal = merchSubtotal + addonsSubtotal + installApplied + deliveryFee`，`taxAmount = preTaxTotal × taxRate`（不舍入），`grandTotal = preTaxTotal + taxAmount`；`QuoteTotalInput` 没有让利字段。`src/app/api/sales/quotes/route.ts`（POST）与 `src/lib/sales/quote-update.ts`（PUT 与签约改价执行器共用的 `prepareQuoteUpdate` / `commitQuoteUpdate`）把 `specialPromotion` 归一化（有限数、≥ 0，否则 0）后只写 `SalesQuote.specialPromotion` 列，金额三列取 `calc.*`，即让利前。
- 读库里金额的地方：期间汇总 `src/lib/sales/period/load.ts`（Σ `grandTotal` / `preTaxTotal`）、会计 `src/lib/accounting/{service,commission}.ts`（成交额 Σ `grandTotal`；报价过程列 `preTaxTotal` / `grandTotal` / `specialPromotion`）、驾驶舱折扣统计 `src/app/api/sales/cockpit/discount-stats/route.ts`（按 `grandTotal` 分档）、签约改价判定 `src/app/api/sales/quotes/[quoteId]/route.ts`（`decideSignedAmountChange` 比 `existing.grandTotal` 与 `prepared.calc.grandTotal`，阈值 0.005）、商机估值 `src/lib/sales/opportunity-lifecycle.ts`（新建 full 模式 `estimatedValue = grandTotal`）、约定尾款 `src/lib/sales/quote-agreed-payment.ts`。
- 对客金额：`src/lib/sales/quote-display-amounts.ts` 优先 `formDataJson.displayGrandTotal`，其次定金 + 尾款，最后库里 `grandTotal`；没有任何地方在库里 `grandTotal` 上再减 `specialPromotion`（已 grep `grandTotal − specialPromotion` 类写法，零命中）。
- 其它 `calculateQuoteTotal` 调用方（预览接口、量房生成报价、AI 解析建单、agent 建单工具、量房页预估、快速报价面板经 POST）都不传让利。

## Goals / Non-Goals

**Goals:**
- 新保存的报价：库里 `preTaxTotal` / `taxAmount` / `grandTotal` 与客户看到的金额同口径（扣让利），期间汇总、会计成交额、签约改价比较都看到让利后的数。
- 库里各列满足 `merchSubtotal + addonsSubtotal + installApplied + deliveryFee − min(specialPromotion, 让利前合计) = preTaxTotal`，会计能从库里各列对出账。
- 不带让利的入口逐分不变。

**Non-Goals（不动的东西）:**
- `src/app/(main)/sales/quote-sheet/{page,quote-pdf,part-b}.tsx`：请求体已带让利，客户端算式不改。
- `src/lib/sales/quote-display-amounts.ts`：对客取数顺序不变。
- `src/lib/sales/period/**`、`openspec/specs/sales/period-summary`：口径仍是 Σ `grandTotal`，不改代码与规格。
- `src/lib/accounting/commission.ts` 的真实毛利算式（产品行 `price − costPrice`）。
- `src/lib/sales/discount-tier.ts`、`src/lib/sales/promotion-approval.ts`、`src/lib/pending-actions/quote-promotion-settle.ts`：让利率与让利审批判定不变。
- `src/lib/pending-actions/executor.ts`：签约改价执行器只调用 `quote-update.ts`，本身不改。
- `src/lib/blinds/pricing-data.ts`、`priceFor`、`src/lib/blinds/pricing-addons.ts`：行级定价与附加项目小计不变。
- `src/app/api/sales/quotes/preview/route.ts`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts`、`src/app/api/sales/ai-quote-intake/route.ts`、`src/lib/agent-core/tools/sales-quote.ts`、`src/app/(main)/sales/measure/page.tsx`：不加让利入参。
- `prisma/schema.prisma`：不加列、不写 migration。
- `src/lib/muse-bridge/**`。

## Decisions

### D1 让利在计价引擎里扣，作为 `calculateQuoteTotal` 的可选入参
- 做法：`QuoteTotalInput` 增加 `specialPromotion?: number`；引擎内归一化（有限且 > 0 才用，否则 0），`preTaxTotal = max(0, 让利前合计 − 让利)`，`taxAmount` / `grandTotal` 由扣除后的 `preTaxTotal` 算出。`QuoteTotalResult` 增加 `promotionApplied`（实际扣掉的数，= min(让利, 让利前合计)），只供测试与审计对账，不落库。POST 与 `prepareQuoteUpdate` 把已归一化的让利金额传进去（两处原有归一化逻辑不变，引擎再归一化一次作兜底）。
- 否决：在 `route.ts` 与 `quote-update.ts` 拿到 `calc` 后各自减 —— 两份算式，且 `calc.grandTotal` 又被签约改价判定、商机估值、约定尾款、执行器审计分别读，任何一处漏改就口径分叉；放进引擎后这些读方自动一致。否决：统计改读 `formDataJson.displayGrandTotal` —— 同 PRICE-3 D4 的否决理由（改 KPI-1 / STAT-1 口径，JSON 不能进 SQL 聚合）。

### D2 三种保存模式统一扣除，下限 0
- 做法：full / partial / shell 都走 D1 同一算式；只存表单（shell）时让利前合计可能只有附加项目，扣除后截到 0。
- 否决：只在 full 模式扣 —— 会让 `preTaxTotal` 与 `specialPromotion` 两列的关系依保存模式而变，会计对账要先知道保存模式；partial / shell 报价本身就是 `draft`，扣不扣都不等于客户金额，统一算式更可预期。

### D3 `specialPromotion` 列存提交值，不截断
- 做法：列沿用现有归一化（负数与非数字为 0），超过让利前合计时仍存提交值；实际扣除额由 `preTaxTotal` 体现。
- 否决：把列截到让利前合计 —— 会改变让利审批快照比较（`approvalSnapshotMatches` 比的是提交额与快照额），已批的让利在保存后可能被判为"快照不一致"而失效。

### D4 已签约报价首次重存进审批，不豁免；不回填历史
- 做法：同 PRICE-3 D6。带让利的签约报价首次重新保存时库里总价变小，`decideSignedAmountChange` 判为改总价 → 202 审批（平台 super_admin 直接生效并审计）。报告 BREAKING 写明。老报价不回填，下次保存时自然更新。
- 否决：按"差额恰等于让利 × (1 + 税率)"豁免审批 —— 需要反推差额来源，规则复杂且给改价留后门。否决：回填脚本 —— 要改已签约报价金额且绕过签约改价审批，违背该规格。

### D5 税额舍入保持现状
- 做法：服务端税额继续不舍入。客户端 `round(preTax × taxRate, 2)` 与服务端 `preTax × taxRate` 相差不超过半分，不会单独触发签约改价审批（阈值是相差"超过" 0.005）。
- 否决：本次一并把服务端税额舍入到分 —— 所有报价（含无让利、已签约的）`grandTotal` 都会有分以下的变动，影响面超出本 change，单独议。

## 八条硬纪律

1. 零 schema：触碰（金额列语义）。只改既有 `preTaxTotal` / `taxAmount` / `grandTotal` 的计算，不加列、不写 migration；验证 `git diff origin/main --stat -- prisma/` 为空。
2. 出站先审批：不涉及对外发送；签约报价首次重存走既有 `sales.update_signed_quote` PendingAction（D4），批准前报价不变。
3. 禁止第三套队列：不涉及，无新 cron / 队列 / worker / approval 类型。
4. 脱敏：触碰（对客金额与 Muse 金额）。对客金额取数不变且不重复扣让利（spec「对客金额不重复扣除让利」）；Muse `sales_overview` / `opportunity_status` 输出的金额随库里金额变为让利后，决定 B（销售角色不输出商机金额）不变；不输出毛利率、项目估值与成本，本次不新增任何输出字段。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：纯算式，无新 LLM 调用。
8. 测试注册：新增 `src/lib/blinds/__tests__/quote-promotion.test.ts`，注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；扩的两个隔离库测试已注册；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不增。

## Risks / Trade-offs

- [签约报价首次重存触发审批，老板会收到一批"总价变小"的改价审批] → 报告 BREAKING 写明；审批描述已含改前改后总价，老板能看出是让利计入。
- [上线前已提交、上线后才批准的签约改价审批：执行器按新算式重算，落库总价与提交时的 `afterTotal` 不同] → 执行器审计已同时记 `grandTotal` 与 `submittedTotal`；报告写明上线前清空待批签约改价（Migration Plan 第 1 步）。
- [期间汇总、会计成交额、驾驶舱折扣分档在新旧报价混存期间口径不一：老报价让利前、新报价让利后] → 与 PRICE-3 Part B 同样处理，报告写明"有让利的老报价下次保存才更新"；不回填（D4）。
- [商机 `estimatedValue` 只在新建 full 模式写一次] → 本次不改生命周期；编辑报价不回写估值是既有行为。

## Migration Plan

1. 部署前在生产查待批的 `sales.update_signed_quote`，有则提醒老板先处理（只读查询，不改数据）。
2. 部署即生效，无数据迁移；新建与编辑报价按新算式落库。
3. 回滚：回退本 change 的提交即可，期间按新算式保存的报价金额保持让利后（这是正确值，不需要反向处理）。

## 验证方式

- `npx tsx src/lib/blinds/__tests__/quote-promotion.test.ts`：让利 100 → 税前 900 / 税额 117 / 总额 1017；让利超过合计 → 0；-50、NaN、未传 → 与不带让利相同；不带让利与让利 0 逐字段相等；`promotionApplied`；对客取数（`displayGrandTotal` 1017 原样、无快照回退库里 1017）。
- `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 158 条、`quote-fees.test.ts`、`pricelist-2026-10-addons.test.ts` 不变。
- 隔离库 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts`：真实 POST 带让利 → 库里三列为扣除后；PUT 改让利 0 → 恢复；发出后 `loadSalesPeriodSummary` 报价金额为扣除后的数。
- 隔离库 `signed-quote-amount-db.isolated.test.ts`：签约单库里总价为让利前，原样重存 → 202，报价不变。
- typecheck、lint:baseline、test:ci、registry、`openspec validate quote-total-deduct-promotion --strict`、`git diff origin/main --stat -- prisma/` 为空。
- 浏览器走查（生产构建 + 隔离库 + Playwright）：报价单录一行产品 + 让利 100 保存 → 库里 `grandTotal` 与 `formDataJson.displayGrandTotal` 相差 < 0.01。
