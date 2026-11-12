# Tasks：项目页的阶段与进度条跟着实际进度显示（FLOW-H1b）

## 1. 判断

- [x] 1.1 `src/lib/tender-next-step/`：实际进度与显示的阶段两个纯函数、接口响应多三个字段、取数时看所有读出来的没取消的轮次并读阶段记录；`src/lib/tender/stage.ts`：靠后的那个、进度条与百分比可按指定阶段算（不传时不变）；verify：`npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts` 全部通过；`npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts` 全部通过（本地隔离库）；读到 `stage.ts` 的既有测试不改断言通过

## 2. 页面

- [x] 2.1 项目页：用接口给出的显示的阶段（决策摘要、右侧上下文、项目进度区）、不一致时的说明、三步卡让位；verify：截图 `docs/acceptance/flow-h1b/*.png`（真实浏览器里页面能渲染）；`npx tsx src/components/tender/__tests__/project-progress-section.test.tsx` 全部通过；`web-progress.test.ts` 的接线断言通过

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-web-progress-from-facts --strict` valid
- [x] 3.3 写 `docs/QINGYAN_FLOW-H1b_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H1b 一行，状态 `[G]`
