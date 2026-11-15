# Tasks：询价发出之后招标分析更新过，在那一轮上标出来（FLOW-H3）

## 1. 判断与接口

- [x] 1.1 判断规则与文字（纯函数）、开关；verify：`npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.tsx` 全部通过
- [x] 1.2 询价入口接口在开关开启时按轮次返回提示；verify：`npx tsx src/lib/tender-rfq/__tests__/analysis-update-note-db.isolated.test.ts` 全部通过（本地隔离库），且在改动之前的代码上失败

## 2. 页面

- [x] 2.1 询价区在那一轮的状态行下显示提示；verify：纯逻辑测试里的接线断言通过；真实浏览器截图 `docs/acceptance/flow-h3/*.png`

## 3. 测试注册与验收

- [x] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-rfq-round-analysis-update-note --strict` valid
- [x] 3.3 写 `docs/QINGYAN_FLOW-H3_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H3 一行，状态 `[G]`
