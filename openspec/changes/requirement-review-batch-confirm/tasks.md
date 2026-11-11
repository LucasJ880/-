# Tasks

## 1. 纯函数与接口

- [x] 1.1 纯函数 `requirement-batch-confirm.ts`（计数、全选待确认的、按 200 条分批、结果与提示文案）；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts` 全部通过
- [x] 1.2 批量确认路由成功后写审计（请求与响应结构不变，审计失败不影响结果）；verify：`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm-db.isolated.test.ts` 全部通过（本地隔离库）

## 2. 界面

- [x] 2.1 面板的要求列表：勾选框、全选 / 取消全选、「确认选中的 N 条」（分批提交、显示实际确认数）、计数行、批准按钮旁的提示；verify：`requirement-batch-confirm.test.ts` 的面板源码断言通过；本地真实应用截图存 `docs/acceptance/rfq-auto-4/`（勾选与工具条、确认后的计数、批准前的提示）

## 3. 注册、审查、门禁与文档

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；请独立审查并处理其发现；verify：`bash scripts/check-test-registry.sh` 通过；审查发现逐条写进报告
- [x] 3.2 全部门禁；verify：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、`openspec validate requirement-review-batch-confirm --strict` 全部通过
- [x] 3.3 写 docs/QINGYAN_RFQ-AUTO-4_REPORT.md + 更新 TASKFLOW 状态列；verify：报告含测试输出、截图清单与「更容易不看就确认」这一取舍；TASKFLOW 有 `RFQ-AUTO-4` 一行
