# Design

## Context

见 proposal.md「Why」。已核实的现状（2026-10-30，main @ `1aab138`，PRICE-3 已合并）：

- 报价单页面：`page.tsx` 的 `preTaxForSave = max(0, productsSubtotal + subtotalB + subtotalC − specialPromotionNum)`，税额 `round(preTax × taxRate × 100) / 100`，结果存进 `formDataJson.displayGrandTotal`。请求体带 `specialPromotion`（数字）和 `finalDiscountPct`（= 让利 ÷ 产品税前，供三档审批判定）。
- 服务端：`calculateQuoteTotal`（`src/lib/blinds/pricing-engine.ts`）的 `preTaxTotal = merch + addons + installApplied + deliveryFee`，不认识让利。`quotes/route.ts` 把 `specialPromotion` 存进同名列；`quote-update.ts` 的 `nextPromotionAmount` = 提交值或 0，同样只存列。
- 读库里金额的地方：期间汇总 `src/lib/sales/period/load.ts`（`grandTotal` / `preTaxTotal`）；折扣统计 `src/app/api/sales/cockpit/discount-stats/route.ts`（`grandTotal`）；财务报价列表 `src/lib/accounting/service.ts`（`preTaxTotal` / `grandTotal` / `specialPromotion` 分列）；客户详情报价列表（显示 `grandTotal`，旁边小字显示让利）；签约 `mark-signed` 用 `grandTotal` 兜底约定尾款。全仓 grep 过，**没有**任何地方自己再做 `grandTotal − specialPromotion`，改了之后不会重复扣。
- 签约改价审批：`quotes/[quoteId]/route.ts` 比较 `existing.grandTotal` 与 `prepared.calc.grandTotal`。因为 `calc` 不含让利，已签约报价只改让利时两者相等 → 直接生效。执行器（`pending-actions/executor.ts` 的 `sales.update_signed_quote`）用 `prepareQuoteUpdate` 重算，与 PUT 同一算法。
- 其他调用 `calculateQuoteTotal` 的入口（预览、量房生成报价、AI 报价 intake、agent-core 报价工具、量房页预估）都不传让利。
- PRICE-3 走查数据：一张不带让利的报价，库里 `grandTotal` 1253.59、`displayGrandTotal` 1253.60。

## Goals / Non-Goals

**Goals:**
- 库里税前合计 / 税额 / 含税总额 = 报价单对客金额（±0.01），让利同样计入。
- 签约后只改让利也进签约改价审批。

**Non-Goals（不动的东西）:**
- `src/lib/sales/discount-tier.ts`、`src/lib/sales/promotion-approval.ts`、`request-promotion-approval` 路由：让利率与三档审批不变。
- `src/lib/sales/quote-display-amounts.ts`：对客金额取数顺序不变。
- `src/lib/sales/period/**`、`openspec/specs/sales/period-summary`、`discount-stats`、`accounting/service.ts`：不改代码与口径定义。
- `src/app/(main)/sales/quote-sheet/**`：报价单页面已经在请求体里带让利，不改。
- 预览 / 量房 / AI / agent-core 报价入口：不传让利，行为不变。
- 服务端税额取整方式；`prisma/schema.prisma`；`src/lib/muse-bridge/**`。

## Decisions

### D1 在计价引擎里扣让利，入口只负责传值
- 做法：`QuoteTotalInput.specialPromotion?: number`（非数 / 负数按 0）。`calculateQuoteTotal` 先算毛税前 `gross = merch + addons + installApplied + deliveryFee`，再 `preTaxTotal = max(0, gross − promo)`，`taxAmount = preTaxTotal × taxRate`，`grandTotal = preTaxTotal + taxAmount`。结果加 `promotionApplied = gross − preTaxTotal`（实际扣掉的金额，让利超过税前时小于提交值）。`quotes/route.ts` 传规范化后的提交值，`quote-update.ts` 传 `nextPromotionAmount`。
- 否决：只在 `quotes/route.ts` / `quote-update.ts` 里对 `calc` 结果做后处理。两处要各写一遍，执行器重算要第三遍，容易漏。否决：统计改读 `displayGrandTotal`。要改 KPI-1 / STAT-1 口径和全部聚合查询（JSON 进不了 SQL 聚合），而且 PRICE-3 已经确定"库里金额 = 对客金额"的方向。

### D2 不改税额取整
- 服务端继续 `preTax × taxRate` 不取整，报价单页面按分取整，差额不超过 0.005 + 0.005。验收用 ±0.01。
- 否决：服务端也按分取整。会改变所有已有报价重新保存后的金额（多数差 0.00x），让每张已签约报价重存都触发改价审批，收益不值得。

### D3 已签约报价：不豁免
- 只改让利 → 总额变 → 进改价审批（新增规格要求）。有让利的老签约报价第一次重存，总额从"未扣"变"已扣"，同样进审批。与 PRICE-3 Part B 的处理一致。
- 否决：重存时如果差额正好等于让利就豁免。等于给"改让利"开了不经审批的口子，与本 change 要堵的漏洞相反。

### D4 不回填历史
- 老报价下次保存时才更新。统计在过渡期内是新旧混合：老单未扣让利，新单已扣。报告里写明，并给出可复跑的只读核对方法：查 `specialPromotion > 0` 且 `updatedAt` 早于上线时间的报价数。
- 否决：迁移脚本批量改库里金额。已签约报价的金额被静默修改，违背签约改价审批的初衷；草稿 / 已发送的可以改，但需要逐张重算（依赖当时的企业折扣设置），风险大于收益。

## 八条硬纪律

1. 零 schema：触碰（报价金额列的取值），只改既有列的值，不加列、不迁移；验证 `git diff origin/main -- prisma/` 为空。
2. 出站先审批：不涉及对外发送；签约后改让利新增进入既有 `sales.update_signed_quote` 审批（更严，不更松）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及（不新增输出字段；让利本来就在对客 PDF 上）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：纯计算，无 LLM。
8. 测试注册：不新增测试文件，只扩已注册的 `quote-fees`、`quote-settings-db.isolated`、`signed-quote-amount-db.isolated`；`scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/blinds/__tests__/quote-fees.test.ts`：让利 100 扣后税前 / 税额 / 总额；让利超过税前 → 0、`promotionApplied` = 税前；不传 / 负数 / NaN → 与改动前相同。
- 隔离库 `NODE_ENV=test npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts`：真实路由新建（产品 + Part B + 安装 + 运费 = 1109.375，让利 100，税率 0.13）→ 库里 1009.375 / 1140.59，且与按报价单页面算式得到的 `displayGrandTotal` 相差 ≤ 0.01；编辑让利改 0 → 1253.59。
- 隔离库 `signed-quote-amount-db.isolated.test.ts`：已签约报价只改让利 0 → 50 → 202、报价不变；只改备注 → 200。
- 黄金对照 158 条、`pricelist-2026-10-addons` 14 条不变；typecheck、lint:baseline、test:ci、registry、`openspec validate quote-total-net-of-promotion --strict`、`npm run build`；全量 `npm test` 失败项逐个与 origin/main 对照。
- 浏览器走查（生产构建 + 隔离库）：报价单填让利 100 保存 → 库里 `grandTotal` 与页面 Grand Total 一致；客户详情报价列表显示扣后金额。
