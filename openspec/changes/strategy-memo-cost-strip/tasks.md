# Tasks：投标策略备忘送进模型前去掉我方成本（CHAIN-2d）

## 1. 纯函数

- [x] 1.1 新增 `src/lib/tender-intel/memo-pricing.ts`：`buildMemoPricingAnalysis({ model, roomSummary, vendorPriceBenchmark })`（只取对手价，不传成本与目标毛利调 `buildScenarios`，兜底去掉 `floor` / `cost` 情景与「未填我方成本」那句，加 `costExcludedZh`）、「输入里没有成本」的版本集合、`redactLegacyMemo(memo)`；新增 `src/lib/tender-intel/__tests__/memo-pricing.test.ts`，同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts` 的纯函数与对照组用例通过；`bash scripts/check-test-registry.sh` 通过）

## 2. 编排与提示词

- [x] 2.1 `orchestrate.ts` 改用 `buildMemoPricingAnalysis`，不再读 `pricingInputs` 里的成本类字段、不再自己调 `buildScenarios`（verify：`memo-pricing.test.ts` 源码断言；`bid-strategy-memo.test.ts` 的 MEMO-07 通过）
- [x] 2.2 `strategy.ts`：提示词第 2 条去掉 margin、新增第 8 条；提示词版本 3 → 4，备忘版本取自 `BID_STRATEGY_MEMO_NO_COST_VERSION`（v3），类型名 `BidStrategyMemoV3`；`scripts/bid-strategy-memo-e2e.ts` 认 v3（verify：`memo-pricing.test.ts` 用假 invoker 捕获每一次请求、只调用一次、整段输入搜不到成本数字、提示词断言、E2E 脚本源码断言；`bid-strategy-memo.test.ts` 的 MEMO-08 通过）

## 3. 旧版备忘

- [x] 3.1 情报页签、工作台摘要、投标文件草稿的输入（`gather.ts`，被隐藏的段落送空值，`contract.ts` 放宽 `basisZh`）、澄清问题文件（`generate-docs.ts` + `rfi-export.ts` 提交表外的内部说明）读备忘先过 `redactLegacyMemo`；卡片第一行说明、报价策略一行、新版的成本指引；工作台摘要的固定说明；新增隔离库 `memo-legacy-db.isolated.test.ts` 并登记（verify：`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/memo-legacy-db.isolated.test.ts` 通过；`memo-pricing.test.ts` 的探针、澄清问题文件渲染、源码断言与遍历 src 核对读备忘的文件）

## 4. 门禁与报告

- [x] 4.1 既有不改期望（verify：`bid-strategy-memo.test.ts`、`intel-auto-flow.test.ts`、`intel-slots-p1p2.test.ts`、`obs-p5-intel-loop.test.ts`、`intel-ops.test.ts`、`tender-detail-ia.test.ts`、`rfi-export.test.ts`、`import-leads.test.ts`、`pricing-helper.test.ts`、`bid-draft.test.ts`、隔离库 `room-summary-writers-db.isolated.test.ts` 原样通过）
- [x] 4.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate strategy-memo-cost-strip --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 4.3 写 `docs/QINGYAN_CHAIN-2d_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、有财务查看权的人失去「改成本 → 重跑 → 备忘更新」、旧版裁剪按字眼匹配的取舍、TASKFLOW 与 #532 同一位置各加一行；TASKFLOW 新增 CHAIN-2d 一行为 `[~]`）
