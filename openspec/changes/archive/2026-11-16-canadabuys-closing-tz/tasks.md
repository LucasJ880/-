# Tasks：CanadaBuys 截标时间按东部当地时间解析（P2-1b）

## 1. 解析

- [x] 1.1 `canadaBuysInstant` + 截标时间改用它；verify：`npx tsx src/lib/procurement-records/__tests__/closing-tz-pure.test.ts` 通过且在改动之前的代码上失败
- [x] 1.2 已入库的错误截标时间在下一次扫描被改正；verify：`npx tsx src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts` 通过（本地隔离库）

## 2. 测试注册与验收

- [x] 2.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 2.2 变异核对；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate canadabuys-closing-tz --strict` valid
- [x] 2.3 写 `docs/QINGYAN_P2-1b_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 P2-1b 一行状态 `[G]`
