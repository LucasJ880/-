# Tasks

## 1. 计价引擎

- [x] 1.1 `pricing-types.ts` 加 `QuoteTotalInput.specialPromotion?` 与结果字段 `promotionApplied`；`pricing-engine.ts` 的 `calculateQuoteTotal` 按 design D1 扣让利（扣后最低 0，税额按扣后算）；verify：`quote-fees.test.ts` 扩 4 条（让利 100 / 让利超过税前 → 0 / 不传 / 负数与 NaN 当 0）通过，黄金对照 158 条与 `pricelist-2026-10-addons` 不变（开工前先跑记基线）

## 2. 报价入口与签约改价

- [x] 2.1 `quotes/route.ts` 与 `quote-update.ts` 把规范化后的让利传给 `calculateQuoteTotal`（执行器经 `prepareQuoteUpdate` 自动同源）；verify：`quote-settings-db.isolated.test.ts` 扩——真实路由新建（1109.375 税前、让利 100、税率 0.13）→ 库里 `preTaxTotal` 1009.375、`grandTotal` 1140.59（±0.01）、与报价单页面算式的 `displayGrandTotal` 差 ≤ 0.01；编辑让利改 0 → 1253.59；`signed-quote-amount-db.isolated.test.ts` 扩——已签约报价只改让利 0 → 50 → 202 且报价不变，只改备注 → 200

## 3. 收口

- [x] 3.1 全量门禁：typecheck（8 GB 堆）、lint:baseline、test:ci、registry、`openspec validate quote-total-net-of-promotion --strict`、`git diff origin/main --stat -- prisma/` 为空、`npm run build`、隔离库 `npm test`（失败项逐个与 origin/main 对照）；浏览器走查：报价单让利 100 保存 → 库里 `grandTotal` 与页面 Grand Total 一致、客户详情报价列表显示扣后金额；verify：以上命令退出 0，数字写进报告
- [x] 3.2 写 `docs/QINGYAN_STAT-2_REPORT.md`（做了什么 / 怎么验 / BREAKING：签约后改让利进审批、老签约单首次重存进审批 / 已知限制：历史不回填、过渡期统计新旧混合及只读核对方法）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` STAT-2 状态列 + `docs/QINGYAN_PRICELIST_HANDOFF.md` §0；verify：三个文件在同一提交里，报告 §3 每条命令都有实际输出

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive quote-total-net-of-promotion --yes`（独立小 PR）。
