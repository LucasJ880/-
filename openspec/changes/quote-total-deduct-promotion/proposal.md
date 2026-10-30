# Proposal

## Why

报价单的"特别让利"（Special Promotion）只从对客总价里扣（`formDataJson.displayGrandTotal`），服务端存的 `preTaxTotal` / `taxAmount` / `grandTotal` 仍是让利前的数，所以"每个人报了多少钱 / 成交多少"（KPI-1 / STAT-1 期间汇总）、会计成交额和签约改价比较在有让利的单子上一律偏高（PRICE-3 报告 §5 记的已知限制）。PRICE-3 已把 Part B 计入库里金额，让利是库里金额与客户看到的金额之间剩下的那一块差额。

TASKFLOW：PRICE-4（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase P，本 change 新提）。

## What Changes

- **BREAKING** 报价新建（POST `/api/sales/quotes`）与编辑（PUT `/api/sales/quotes/[quoteId]`，含签约改价审批批准后的执行）落库时，税前合计 = 产品 + 附加项目 + 安装（补足最低安装费后）+ 运费 − 特别让利，下限 0；税额与含税总额按扣除后的税前合计计算。
- 特别让利金额沿用请求体 `specialPromotion`，非数字或负数按 0；`specialPromotion` 列仍按原样存提交的金额（不截到税前合计）。
- 不带特别让利的入口（快速报价面板保存、快速报价预览接口、量房生成报价、AI 解析建单、agent 建单工具 `src/lib/agent-core/tools/sales-quote.ts`、量房页预估）结果与改动前逐分相同；黄金对照 158 条不变。
- 对客金额（邮件、分享页、客户 PDF）取数不变，SHALL NOT 再扣一次让利；表单里没有 `displayGrandTotal` 的老快照回退到库里总额时，拿到的是扣除后的数。
- **BREAKING** 已签约且有让利的报价第一次重新保存时，库里总价从"让利前"变为"让利后"，按既有 `sales.update_signed_quote` 进入改价审批（与 PRICE-3 Part B 首次入库同一处理，不豁免）。
- 新建 `src/lib/blinds/__tests__/quote-promotion.test.ts`（注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；扩 `quote-settings-db.isolated.test.ts`（真实路由新建 / 编辑带让利）与 `signed-quote-amount-db.isolated.test.ts`（签约单带让利首次重存 → 202）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sales/price-list`：新增要求——特别让利从库里报价金额扣除（税前合计、税额、含税总额）、无让利入口不变、对客金额不重复扣除。
- `sales/signed-quote-amount-approval`：「改总价进入审批」增加一条场景——签约单因让利首次入库导致总价变化同样进入审批。

## Impact

- 计价：`src/lib/blinds/pricing-engine.ts`（`calculateQuoteTotal` 接可选让利）、`src/lib/blinds/pricing-types.ts`（`QuoteTotalInput`）
- 报价入口：`src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`（PUT 与 `src/lib/pending-actions/executor.ts` 签约改价执行器共用，执行器本身不改）
- 数值跟着变、代码不改的读方（都取库里 `grandTotal` / `preTaxTotal`）：
  - 期间汇总 `src/lib/sales/period/**`（KPI-1 / STAT-1，口径仍是 Σ `grandTotal`）
  - 会计成交额与报价过程 `src/lib/accounting/{service,commission}.ts`
  - 驾驶舱折扣统计 `src/app/api/sales/cockpit/discount-stats/route.ts`（按 `grandTotal` 分档，带让利的单子可能落到更低档）
  - 商机估值 `src/lib/sales/opportunity-lifecycle.ts`（新建报价 full 模式时写 `estimatedValue = grandTotal`）
  - 约定尾款 `src/lib/sales/quote-agreed-payment.ts`（表单未填尾款时按 `grandTotal − 定金` 推算）
- Muse：代码不改；`sales_overview`（带 period 时的期间汇总）与 `opportunity_status`（商机估值，仅管理角色输出，决定 B 不变）输出的金额随库里金额变为让利后
- 报价单页面 `src/app/(main)/sales/quote-sheet/page.tsx` 已在请求体里带 `specialPromotion`，不改
- 测试：新增 `quote-promotion.test.ts`；扩两个隔离库测试

## Out of scope

- 历史报价回填：老报价下次保存时才扣除；不写回填脚本。
- 税额舍入对齐：客户端税额四舍五入到分，服务端不舍入，两端含税总额相差不超过半分；改舍入会让所有报价（含已签约）总额变动，另议。
- 提成毛利口径：`src/lib/accounting/commission.ts` 的真实毛利按产品行 `price − costPrice` 计，不扣让利；本次只改成交额（`grandTotal`），毛利是否分摊让利另立 change。
- 让利率（`finalDiscountPct`）的计算与折扣三档 / 让利审批判定：仍由客户端按"让利 ÷ 产品税前小计"提交，服务端不重算。
- 产品行单价、附加项目行单价按让利分摊（行级金额不变，让利只在报价合计层扣）。
- 快速报价预览接口、量房生成报价、AI 解析入口新增让利输入。
- `prisma/schema.prisma`：不加列（零 schema）。
