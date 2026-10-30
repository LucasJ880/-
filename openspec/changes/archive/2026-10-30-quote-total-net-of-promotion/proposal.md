# Proposal

## Why

报价单的"特别让利"（Special Promotion）在客户看到的金额里是税前直减的，但服务端存进库里的税前合计、税额和含税总额都没有扣它，所以按人 / 按期间统计（KPI-1 / STAT-1 取库里 `grandTotal`）在有让利的单子上偏高。签约改价审批比的也是这个总额，已签约报价只改让利时总额不变，会直接生效、绕过审批（PRICE-3 报告 §5 已登记）。

TASKFLOW：STAT-2（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase P）。

## What Changes

- 报价新建与编辑时，服务端从税前合计里扣除提交的特别让利（扣后最低为 0），税额按扣后的税前合计计算，库里的税前合计、税额、含税总额都存扣除后的值；让利金额照旧单独保存在 `specialPromotion`。
- 库里含税总额与报价单对客金额（`formDataJson.displayGrandTotal`）一致，差额不超过 0.01（只差税额四舍五入）。
- **BREAKING** 已签约报价只改特别让利时，总额会变化，进入既有的 `sales.update_signed_quote` 改价审批（此前直接生效）。已签约且有让利的老报价第一次重新保存时，总额从"未扣让利"变为"已扣让利"，同样进入改价审批。
- 不提交特别让利的入口（预览、量房生成报价、AI 报价、Muse / agent 报价工具、快速报价）行为不变。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sales/price-list`：新增「特别让利计入报价金额」要求。
- `sales/signed-quote-amount-approval`：新增「只改特别让利同样视为改总价」要求。

## Impact

- 计价：`src/lib/blinds/{pricing-types,pricing-engine}.ts`
- 报价入口：`src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`（已签约改价审批执行器经 `prepareQuoteUpdate` 复用同一算法）
- 统计：`src/lib/sales/period/**`、`src/app/api/sales/cockpit/discount-stats/route.ts`、`src/lib/accounting/service.ts` 不改代码。它们读库里的金额，新保存的报价自然变成扣让利后的值；口径定义不变（仍是 `grandTotal` / `preTaxTotal` 之和）
- 已核实没有任何地方再用 `grandTotal − specialPromotion` 自行扣减，所以不会重复扣
- 测试：扩 `quote-fees.test.ts`、`quote-settings-db.isolated.test.ts`、`signed-quote-amount-db.isolated.test.ts`；不新增测试文件
- 不触碰 muse-bridge：无受影响 Muse 意图

## Out of scope

- 历史报价金额回填（老报价下次保存时才更新；已签约的走改价审批）。
- 让利率（`finalDiscountPct`）的算法与三档审批规则（`sales/discount-tiering`）不变。
- 服务端税额的四舍五入方式不变（报价单页面按分取整，服务端不取整，差额不超过 0.01）。
- 对客金额取数顺序（`quote-display-amounts.ts`）不变。
- 期间汇总、折扣统计、财务报价列表的字段与口径定义不变。
