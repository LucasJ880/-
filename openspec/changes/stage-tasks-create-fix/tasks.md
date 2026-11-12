# Tasks：修好阶段推进之后的自动任务（FIX-5）

## 1. 修

- [x] 1.1 `src/lib/tender/stage-tasks.ts`：去掉不存在的列；模板调整；到期日；关掉之前所有阶段的；加锁查重；已放弃不建；把「算出要建哪些任务」抽成纯函数；放弃项目接口撤掉自动任务（`src/app/api/projects/[id]/abandon/route.ts`）；verify：`npx tsx src/lib/tender/__tests__/stage-tasks.test.ts` 全部通过；`npm run typecheck` 退出码 0

## 2. 测试

- [x] 2.1 隔离库测试：逐阶段、到期日、关掉之前阶段的（含绕过写入与跳级）、不重复（含并发）、只关不建、已放弃、放弃接口、阶段推进入口、建任务失败；verify：`npx tsx src/lib/tender/__tests__/stage-tasks-db.isolated.test.ts` 在本地隔离库全部通过，在改动之前的代码上失败
- [x] 2.2 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK

## 3. 验收

- [x] 3.1 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate stage-tasks-create-fix --strict` valid
- [x] 3.2 写 `docs/QINGYAN_FIX-5_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FIX-5 一行，状态 `[G]`
