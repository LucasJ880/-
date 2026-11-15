# Tasks：阶段记录跟着事实自动前进（FLOW-H1c）

## 1. 实现

- [x] 1.1 开关 `src/lib/tender/stage-auto-flags.ts` 与共用函数 `src/lib/tender/stage-auto.ts`（能不能前进、条件写时间、收建任务、审计）；verify：`npx tsx src/lib/tender/__tests__/stage-auto.test.ts` 通过；`npm run typecheck` 退出码 0
- [x] 1.2 接线：`recordQuote` 带上触发的人（人工录入接口传登录用户，回信解析不传）；`markItemSent` 由标记已发送接口传标记的人；询价发出、分析收尾在原有写入之前调用；审计标签两张表；verify：`stage-auto.test.ts` 的接线断言通过；`src/lib/tender-rfq/__tests__/` 与 `src/lib/tender-auto-analysis/__tests__/` 里读到被改文件的既有测试通过

## 2. 测试

- [x] 2.1 隔离库测试：各个入口、不前进的情形、读之后被放弃、来源系统不发请求、三步各自失败的隔离、只前进一次、任务与负责人、不改招投标状态与不发消息通知、审计、开关关闭；两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender/__tests__/stage-auto-db.isolated.test.ts` 在合并了 #447 的代码上全部通过；`bash scripts/check-test-registry.sh` 输出 OK

## 3. 验收

- [x] 3.1 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-stage-auto-advance --strict` valid
- [x] 3.2 写 `docs/QINGYAN_FLOW-H1c_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H1c 一行，状态 `[G]`
