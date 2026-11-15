# Tasks：提交记录接进可投标判定（FLOW-H4c）

## 1. 规则与取数

- [ ] 1.1 把提交记录卡片「与项目当前提交时间对得上的那条」的取法抽成纯函数，卡片改用它；verify：`npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts` 全部通过，`submission-record-db.isolated.test.ts` 不变地通过
- [ ] 1.2 可投标判定在有提交时间、没有回执编号时换文字；verify：`npx tsx src/lib/tender-bid-readiness/__tests__/readiness.test.ts` 全部通过
- [ ] 1.3 投标工作区的上下文带上那条记录，判定用它；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts` 全部通过（本地隔离库），且在改动之前的代码上失败

## 2. 测试注册与验收

- [ ] 2.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 2.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-readiness-submission-record --strict` valid
- [ ] 2.3 写 `docs/QINGYAN_FLOW-H4c_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H4c 一行，状态 `[G]`
