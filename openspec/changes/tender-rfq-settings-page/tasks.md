# Tasks：组织页上的「询价与落地价设置」（W-2）

## 1. 表单规则

- [ ] 1.1 `settings-form.ts`：表单与请求体互转、只发改过的项、汇率校验、项目增删改；verify：`npx tsx src/lib/tender-rfq/__tests__/settings-form.test.tsx` 全部通过

## 2. 页面

- [ ] 2.1 组织详情页的「询价与落地价设置」一节（只对管理员）：取数、展示、保存、错误提示、说明文字；verify：纯逻辑测试里的呈现与接线断言通过；真实浏览器截图 `docs/acceptance/w-2/*.png`
- [ ] 2.2 走真实接口的往返；verify：`npx tsx src/lib/tender-rfq/__tests__/settings-form-db.isolated.test.ts` 全部通过（本地隔离库），且在改动之前的代码上失败

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-rfq-settings-page --strict` valid
- [ ] 3.3 写 `docs/QINGYAN_W-2_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 W-2 一行状态 `[G]`
