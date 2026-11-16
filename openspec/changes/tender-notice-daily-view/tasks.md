# Tasks：采购监控的「新标」视图与每天排期（P2-1 收尾）

## 1. 规则与接口

- [ ] 1.1 纯函数：排期快捷预设、只发改过的排期、时刻解析、说明文字（每天 / 工作日）、挑公告链接（与跟标共用）；verify：`npx tsx src/lib/procurement-records/__tests__/new-notices-pure.test.ts` 通过
- [ ] 1.2 `listCandidates` 支持新标视图并返回 `publishedAt` / `noticeUrl`；候选接口收 `view=new`；verify：`npx tsx src/lib/procurement-records/__tests__/new-notices-db.isolated.test.ts` 通过且在改动之前的代码上失败

## 2. 页面

- [ ] 2.1 设置页「扫描时间」与快捷按钮；候选页「新标」筛选、发布日期、「看公告」；verify：纯函数测试里的呈现与接线断言通过；真实浏览器截图 `docs/acceptance/p2-1/*.png`

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate tender-notice-daily-view --strict` valid、本地 `next build --webpack` 退出码 0
- [ ] 3.3 写 `docs/QINGYAN_P2-1_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 P2-1 一行状态 `[G]`
