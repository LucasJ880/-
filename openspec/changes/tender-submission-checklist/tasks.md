# Tasks：交付前检查清单由已确认的要求确定性生成（FLOW-H4b）

## 1. 判断与读写

- [ ] 1.1 `src/lib/tender-submission-checklist/`：分组规则、进度、文字（纯函数）、开关；verify：`npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts` 全部通过
- [ ] 1.2 取数与标状态的服务；接口 `GET /api/projects/[id]/submission-checklist`、`PUT …/items/[key]`；verify：`npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts` 全部通过（本地隔离库）
- [ ] 1.3 模型清单的接口在开关开启时不调模型；自动触发器在新接口可用时跳过这一项；verify：同上隔离库测试里「没有调用模型」的用例通过；开关关闭时既有行为的用例通过

## 2. 页面

- [ ] 2.1 「提交」页签在开关开启时显示确定性清单、不显示模型清单；verify：组件渲染测试通过；真实浏览器截图 `docs/acceptance/flow-h4b/*.png`

## 3. 测试注册与验收

- [ ] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-submission-checklist --strict` valid
- [ ] 3.3 写 `docs/QINGYAN_FLOW-H4b_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H4b 一行，状态 `[G]`
