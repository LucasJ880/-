# Tasks：早上 7 点的「今日新标」通知（P2-3b）

## 1. 早报

- [ ] 1.1 纯函数：时间窗口、排版、去重键；`href.ts` 加 `procurement_new_notices`；verify：`npx tsx src/lib/procurement-records/__tests__/notice-brief-pure.test.ts` 通过
- [ ] 1.2 `sendNoticeBrief` + 挂进 `daily-brief`；verify：`npx tsx src/lib/procurement-records/__tests__/notice-brief-db.isolated.test.ts` 通过（本地隔离库）且在改动之前的代码上失败

## 2. 页面

- [ ] 2.1 采购监控页读 `?view=new`；verify：纯函数测试接线断言通过；真实浏览器截图 `docs/acceptance/p2-3b/*.png`

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate tender-notice-brief --strict` valid、本地 `next build --webpack` 退出码 0
- [ ] 3.3 写 `docs/QINGYAN_P2-3b_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 P2-3b 一行状态 `[G]`
