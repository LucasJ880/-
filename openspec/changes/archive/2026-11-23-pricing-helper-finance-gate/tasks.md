# Tasks：报价表助手的我方成本只给有财务查看权的人（CHAIN-2b）

## 1. 纯函数

- [x] 1.1 新增 `src/lib/tender-pricing/finance-view.ts`（`buildPricingHelperView`、`buildSavedInputsView`、`touchesCost`、`redactRoomSummaryCost`、`resolvePricingCostVisibility`、固定文字）与 `src/lib/tender-pricing/__tests__/finance-view.test.ts`，测试同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 通过；有权限时与直接 `buildScenarios` 的结果 `JSON.stringify` 相同；`bash scripts/check-test-registry.sh` 通过）

## 2. 接口

- [x] 2.1 新增 `src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`（七种身份、开关开关、保存、房间 JSON 两个接口）并登记；`GET` 接财务判定（出错只按负责人与超级管理员）、无权时不取比价建议、用 `buildPricingHelperView`（verify：`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts` 的读取用例通过）
- [x] 2.2 `POST save`：锁外判定，顺序 409 → 403 → 400；无权且 `touchesCost` → 403 不写库；否则照常保存（`compareEnabled` 照旧按开关算）并用 `buildSavedInputsView` 裁剪返回（verify：同一隔离库测试的保存用例与「响应里搜不到成本数字」通过）
- [x] 2.3 `GET /api/projects` 与 `GET /api/projects/[id]/bid-intelligence` 用 `redactRoomSummaryCost`；`compare-cost-source.test.tsx` 里随接线改动的接线断言更新（只有卡片的两条：成本加成提示改按 `compareOn`、目标毛利写法改按 `compareOn`；路由的接线字符串全部保留——只改接线字符串，行为断言不改）（verify：隔离库「两个接口」用例；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx` 通过）

## 3. 卡片

- [x] 3.1 `pricing-helper-card.tsx`：`costHidden` 时成本输入框换成那句话、保存不带 `ourCostCad`、情景表不显示毛利一栏、假设说明不重复那句；开关开着时（`compareCost` 或 `compareCostHidden`）目标毛利写法与成本加成提示照旧（verify：`finance-view.test.ts` 的卡片源码断言）

## 4. 门禁与报告

- [x] 4.1 既有不改期望（verify：`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`compare-cost-source-db.isolated.test.ts` 原样通过；`compare-cost-source.test.tsx` 只有 2.3 列出的接线断言改动）
- [x] 4.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate pricing-helper-finance-gate --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 4.3 写 `docs/QINGYAN_CHAIN-2b_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、口径不同的三处（比价矩阵、报价引擎卡、投标策略备忘及其显示路径）与「投标同事看不到成本」的 GATE 问题；TASKFLOW 新增 CHAIN-2b 一行为 `[~]`）
