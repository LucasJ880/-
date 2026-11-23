# Tasks：比价落地价与报价引擎内部数字统一只给有财务查看权的人（CHAIN-2e）

开工前跑一遍要触碰模块的已注册测试并记下基线通过数（`quote-engine-contract`、`quote-ops-contract`、`finance-access`、`compare`、`interpretation-guard`、`tracker-pure`，隔离库 `finance-access-db`、`tracker-db`），写进报告。2026-11-23 在 main `451bb0d3` 上：29 / 75 / 27 / 47 / 29 / 89，隔离库 18 / 46，全部通过。开工前核实见 design「开工前核实（2026-11-23）」。

## 1. 判定与报价引擎

- [x] 1.1 `src/lib/project-finance/access.ts` 加 `resolveFinanceViewSafe`（D1）；`src/lib/quote-engine/access.ts` 的 `resolveQuoteCapabilities` 改收 `finance`、`requireQuoteAccess` 改调它（D2）；提示常量放新的纯模块 `src/lib/quote-engine/finance-hint.ts`（D6、D8）；`finance-access.test.ts`（PERM-4c1 报价引擎特权与源码断言）与 `quote-engine-contract.test.ts` 的 QE-02 / QE-07b 改用真实项目角色名并加财务查看权组合、兜底与「编辑要求先能看」；verify：`npx tsx src/lib/project-finance/__tests__/finance-access.test.ts` 与 `npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` 通过，`quote-ops-contract.test.ts` 不改期望通过
- [x] 1.2 `quote-budget-card.tsx`、`quote-engine-section.tsx`、`tender-our-bid.tsx` 无权时加提示（D6），`quote-engine-section.tsx` 不能新建时加说明（D8）；`pricing-control-center.tsx` 接住 `customerView` 与读取失败（D7）；`quote-engine-contract.test.ts` 加源码断言（四处提示、单个报价页认 `customerView`、读取失败写原因）；verify：该测试通过，`npm run typecheck` 与 `npm run lint:baseline` 通过

## 2. 比价矩阵与 AI 报价分析

- [x] 2.1 `src/lib/tender-rfq/compare.ts` 加 `compareMatrixFinanceView`、`summarizeMatrixZh` 的 `hideAmounts`、模型输入与提示词的 `costHidden` 分支与提示常量（D3、D4）；`compare.test.ts` 加：有权逐字段相同、无权搜不到落地价与逐项金额、无金额结论没有数字金额与「%」、模型输入搜不到落地价且提示词有「不提供落地价」、有权输入逐字相同；verify：`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts` 与 `interpretation-guard.test.ts` 通过
- [x] 2.2 `…/compare/matrix/route.ts` 与 `…/compare/analysis/route.ts` 按 D1 裁剪（解读失败的 502 返回也裁）；`quote-analysis-panel.tsx` 在 `costHidden` 时显示提示；verify：`npm run typecheck` 与 `npm run lint:baseline` 通过

## 3. 询价追踪页

- [x] 3.1 `src/lib/tender-rfq/tracker.ts` 按项目判定并在组装前裁掉矩阵行的落地价、`tracker-pure.ts` 的 `quoteCellView` 加 `canViewCost`（D5）；`tracker-pure.test.tsx` 加无权四种格子（换算出了、换算不出、超过上限没取、没有矩阵行），`tracker-db.isolated.test.ts` 加组织管理员看本人负责 / 别人负责的项目；verify：两个测试通过（隔离库本机执行）

## 4. 端到端与收尾

- [ ] 4.1 新增 `src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`（七种身份：只读成员、`bids` 岗位 operator、没有财务键的组织管理员、项目负责人、`accounting` 岗位、`owner` 岗位、平台超级管理员 × 比价矩阵 / AI 分析的模型输入（本机假模型服务记下请求，不打真模型）/ 报价列表 / 单个报价 / 「我方报价」/ 新建 / 编辑；少见数字搜索；在改动前的源文件上跑一次记下失败数），同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：本机隔离库全部通过，`bash scripts/check-test-registry.sh` 通过
- [ ] 4.2 多维审查：并行派四个子 agent（正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案），每个只管一个维度，各审一遍 diff，逐条核实后修，超出范围的另开任务；全量门禁：`npm test`（与 main 对照失败名单）、`npm run test:ci`（不带数据库）、`npm run typecheck`、`npm run lint:baseline`、`openspec validate finance-view-compare-quote-gate --strict`，`git diff origin/main -- prisma/ vercel.json` 为空；verify：报告「多维审查」一节逐条写明处理，门禁输出写进报告
- [ ] 4.3 写 `docs/QINGYAN_CHAIN-2e_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 状态列（CHAIN-2e 一行 `[~]`，放在 CHAIN-2b 之后；CHAIN-2c / 2d 两行在各自分支上，合并时保留全部；另加「编号待定」的兜底整理一行）；verify：两个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify` → Draft PR → 合并 → `/opsx:archive finance-view-compare-quote-gate --yes`（独立小 PR）。
- 本 change 合并后，另开整理把 CHAIN-2b 与本 change 两份同口径兜底收成一份（编号待定，TASKFLOW 已加行）。
