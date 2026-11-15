# Tasks：采购监控里的新标可以「跟这个标」（P2-3a）

## 1. 服务与接口

- [ ] 1.1 纯函数：字段映射、能不能跟、按钮状态；verify：`npx tsx src/lib/procurement-records/__tests__/tender-follow-pure.test.ts` 通过
- [ ] 1.2 服务 + `POST /api/procurement/instruments/{id}/follow`：锁公告行、只建一次、与手工新建相同的建项步骤、关联、改关注、审计；台账静态纪律清单加入新服务；verify：`npx tsx src/lib/procurement-records/__tests__/tender-follow-db.isolated.test.ts` 通过（本地隔离库）且在改动之前的代码上失败；`npx tsx src/lib/project-ledger/__tests__/p1-pure.test.ts` 通过

## 2. 页面

- [ ] 2.1 采购监控候选卡片：「跟这个标」/「已跟进 · 打开项目」；verify：纯函数测试里的呈现断言通过；真实浏览器截图 `docs/acceptance/p2-3a/*.png`

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate tender-notice-follow --strict` valid、本地 `next build --webpack` 退出码 0
- [ ] 3.3 写 `docs/QINGYAN_P2-3a_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 P2-3a 一行状态 `[G]`
