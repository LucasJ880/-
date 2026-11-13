# Tasks：阶段已到、招投标状态落后时，人确认推进就补上状态（FIX-6）

## 1. 实现

- [x] 1.1 `src/lib/tender/stage.ts` 导出 `tenderStatusStageOf`；新增 `src/lib/tender/stage-status-catch-up.ts`（判断是否落后）；`src/lib/tender/stage-transition.ts` 在「无需重复推进」「不允许回退」两处提前返回之前先试补状态；verify：`npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts` 通过；`npm run typecheck` 退出码 0

## 2. 测试

- [x] 2.1 隔离库测试：补状态、回调、只改状态、不补的情形、同时点两次；两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender/__tests__/stage-status-catch-up-db.isolated.test.ts` 在本地隔离库全部通过、在改动之前的代码上失败；`bash scripts/check-test-registry.sh` 输出 OK

## 3. 验收

- [x] 3.1 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-stage-status-catch-up --strict` valid
- [x] 3.2 写 `docs/QINGYAN_FIX-6_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FIX-6 一行，状态 `[G]`
