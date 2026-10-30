# Tasks

## 1. 计价引擎

- [ ] 1.1 开工前在最新 main 上记基线：`npx tsx src/lib/blinds/__tests__/{pricelist-2026-10-golden,quote-fees,pricelist-2026-10-addons}.test.ts` 与 `npx tsx src/lib/sales/__tests__/signed-quote-amount.test.ts` 的通过数写进报告草稿；然后 `pricing-types.ts` 给 `QuoteTotalInput` 加 `specialPromotion?`、`QuoteTotalResult` 加 `promotionApplied`，`pricing-engine.ts` 按 design D1 / D2 扣除（归一化、下限 0），`route.ts` 与 `quote-update.ts` 的引擎异常兜底对象补 `promotionApplied: 0`；新建 `src/lib/blinds/__tests__/quote-promotion.test.ts`（让利 100 → 900 / 117 / 1017；1500 → 0 / 0 / 0 且 `promotionApplied` 1000；-50、NaN、未传 → 与无让利逐字段相等；`deriveQuoteDisplayAmounts` 对 `displayGrandTotal` 1017 原样返回、无快照回退库里 1017）并注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：新测试通过，`bash scripts/check-test-registry.sh` 通过，基线四个测试通过数不变（黄金 158 条）

## 2. 报价入口

- [ ] 2.1 `src/app/api/sales/quotes/route.ts`（POST）与 `src/lib/sales/quote-update.ts`（`prepareQuoteUpdate`）把已归一化的让利金额传给 `calculateQuoteTotal`（D1），`specialPromotion` 列仍按提交值写（D3）；`quote-settings-db.isolated.test.ts` 扩：真实 POST 让利前合计 1000（用自定义附加项目 1000 × 1 构造，不依赖价表）、`specialPromotion` 100、税率 0.13 → 库里 900 / 117 / 1017 且 `specialPromotion` 100；PUT 原样内容 + 让利 0 → 1000 / 130 / 1130；把该报价设为已发出后 `loadSalesPeriodSummary` 的报价金额为 1017；verify：隔离库 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts` 全过
- [ ] 2.2 `signed-quote-amount-db.isolated.test.ts` 扩：沿用该文件的 Zebra 行种一份已签约报价（让利 100，库里总价为不扣让利的 G0），合价人原样 PUT → 202 与审批 ID，报价总价 / 状态 / 签约时间不变；批准执行后总价 = G0 − 100 × 1.13、状态 `draft`；verify：隔离库 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sales/__tests__/signed-quote-amount-db.isolated.test.ts` 全过

## 3. 收口

- [ ] 3.1 全量门禁与走查：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate quote-total-deduct-promotion --strict`、`git diff origin/main --stat -- prisma/` 为空、隔离库 `npm test`（失败项逐个与 origin/main 对照）；生产构建 + 隔离库 + Playwright：报价单录一行产品、让利 100 保存 → 库里 `grandTotal` 与 `formDataJson.displayGrandTotal` 相差 < 0.01，期间面板按人金额等于该 `grandTotal`；verify：以上命令退出 0，数字与截图写进报告
- [ ] 3.2 写 `docs/QINGYAN_PRICE-4_REPORT.md`（做了什么 / 怎么验 / BREAKING：让利计入库里金额、带让利签约单首次重存进审批、上线前清空待批签约改价 / 已知限制：历史不回填、税额舍入、提成毛利不扣让利）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` PRICE-4 状态列 + `docs/QINGYAN_PRICELIST_HANDOFF.md` §0 流水线表与 §1；verify：三个文件在同一提交里，报告每条命令都有实际输出

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive quote-total-deduct-promotion --yes`（独立小 PR），TASKFLOW PRICE-4 改 `[x]`。
- 提成毛利是否分摊让利、服务端税额是否舍入到分：各自另立 change（proposal Out of scope）。
