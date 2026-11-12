# Tasks：项目页的「下一步」（FLOW-H1）

## 1. 判断与接口

- [x] 1.1 新增 `src/lib/tender-next-step/`：开关、纯函数（前置状态 → 调既有查表 → 细化 → 位置与文案；截标提醒单算；位置换算成网址）；verify：`npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts` 全部通过；`npx tsx src/lib/muse-bridge/__tests__/next-step.test.ts` 不改断言通过
- [x] 1.2 读取函数与路由 `GET /api/projects/[id]/next-step`（项目读权限；开关关闭或非招投标项目 404；待批按项目与可见范围查；催单天数按扫描的口径；工作区开启时带阻断项；不写库）；verify：`npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts` 全部通过（本地隔离库）

## 2. 页面

- [x] 2.1 工作台页签顶部的「下一步」卡片、页面取数与导航（切页签并滚到位置、开文件抽屉、跳审批中心）、「标书与报价」页签的两个锚点、决策摘要跟随；verify：截图 `docs/acceptance/flow-h1/*.png`；`web-next-step.test.ts` 的接线断言通过；读到被改文件的既有测试不改断言通过

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 变异核对；开 PR 前请一个不带结论的独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-web-next-step --strict` valid
- [x] 3.3 写 `docs/QINGYAN_FLOW-H1_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H1 一行，状态 `[G]`
