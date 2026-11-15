# Tasks：两道闸生效（FLOW-H5）

## 1. 规则与接口

- [ ] 1.1 文字、开关、草稿横幅（纯函数）；verify：`npx tsx src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx` 全部通过
- [ ] 1.2 询价入口在 No-Go 时多一条提醒；起草元信息返回 No-Go 提醒与当前分析是否已批准；起草时记下所用分析与是否已批准、草稿文件加横幅；verify：`npx tsx src/lib/tender-decision-gates/__tests__/decision-gates-db.isolated.test.ts` 全部通过（本地隔离库），且在改动之前的代码上失败

## 2. 页面

- [ ] 2.1 起草卡片显示提醒与标注；verify：卡片呈现测试通过；真实浏览器截图 `docs/acceptance/flow-h5/*.png`

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-decision-gates --strict` valid
- [ ] 3.3 写 `docs/QINGYAN_FLOW-H5_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H5 一行，状态 `[G]`
