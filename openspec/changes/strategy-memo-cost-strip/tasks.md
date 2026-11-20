# Tasks：投标策略备忘送进模型前去掉我方成本（CHAIN-2d）

## 1. 纯函数

- [ ] 1.1 新增 `src/lib/tender-intel/memo-pricing.ts`：`buildMemoPricingAnalysis({ model, competitorPriceCad })`（不传成本与目标毛利调 `buildScenarios`，兜底去掉 `floor` / `cost` 情景与「未填我方成本」那句，加 `costExcludedZh`）与 `redactLegacyMemoCost(memo)`；新增 `src/lib/tender-intel/__tests__/memo-pricing.test.ts`，同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts` 的纯函数用例通过；`bash scripts/check-test-registry.sh` 通过）

## 2. 编排与提示词

- [ ] 2.1 `orchestrate.ts` 改用 `buildMemoPricingAnalysis`，不再把 `ourCostCad`、`targetMarginPct` 交给演算（verify：`memo-pricing.test.ts` 源码断言；`bid-strategy-memo.test.ts` 的 MEMO-07 随接线更新后通过）
- [ ] 2.2 `strategy.ts`：提示词第 2 条去掉 margin、新增第 8 条；`BID_STRATEGY_MEMO_PROMPT.version` 3 → 4，`BID_STRATEGY_MEMO_VERSION` → `tender-bid-strategy-memo/v3`（verify：`memo-pricing.test.ts` 用假 invoker 捕获整段输入搜不到成本数字、提示词断言；`bid-strategy-memo.test.ts` 的 MEMO-08 通过）

## 3. 旧版备忘

- [ ] 3.1 `GET …/external-intel/award-history` 返回备忘前调用 `redactLegacyMemoCost`；`org-award-intel-slots.tsx` 在 `legacyCostRedacted` 时写那句话（verify：`memo-pricing.test.ts` 的纯函数用例与两处源码断言）

## 4. 门禁与报告

- [ ] 4.1 既有不改期望（verify：`bid-strategy-memo.test.ts` 只有 MEMO-07 / MEMO-08 的接线字符串随改动更新；`intel-auto-flow.test.ts`、`intel-slots-p1p2.test.ts`、`src/lib/tender-pricing/__tests__/pricing-helper.test.ts` 原样通过）
- [ ] 4.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate strategy-memo-cost-strip --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 4.3 写 `docs/QINGYAN_CHAIN-2d_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、旧版备忘其它段落的残留风险；TASKFLOW 新增 CHAIN-2d 一行为 `[~]`）
