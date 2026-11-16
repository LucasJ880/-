# Tasks：分析投影与开始调查不再整块替换调查室 summaryJson（FIX-10）

## 1. 测试先行

- [x] 1.1 隔离库测试 `src/lib/tender-room/__tests__/room-summary-merge-db.isolated.test.ts`（重新分析、已被替代、与报价同步交错、开始调查沿用已有房间、没有房间）；verify：在改动之前的代码上失败（15 项里 5 项失败）

## 2. 修复

- [x] 2.1 写入入口 `src/lib/tender-room/summary-json.ts`（`applyRoomSummaryPatch` / `patchRoomSummaryTx` / `patchRoomSummary`）；verify：`npx tsx src/lib/tender-room/__tests__/summary-json.test.ts` 通过
- [x] 2.2 分析投影改走入口，记 `projectedKeys`，只去掉上一次投影独有的键（`projectionPatch`）；verify：隔离库测试的投影用例通过
- [x] 2.3 开始调查在已有房间、没有摘要时改走入口；verify：隔离库测试的开始调查用例通过
- [x] 2.4 隔离库测试 15 项全部通过（连跑 3 次）；附近的 bid-workflow 与 tender-auto-analysis 测试照旧通过；verify：报告里列出

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 全部门禁；verify：`npm test` 无新增失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate room-summary-merge-write --strict` valid
- [x] 3.3 TASKFLOW 加 FIX-10 一行；verify：状态 `[~]`
