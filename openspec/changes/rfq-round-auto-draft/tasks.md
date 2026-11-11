# Tasks

## 1. 判定与起草

- [ ] 1.1 开关与纯函数：`auto-draft-flags.ts`、`auto-draft-pure.ts`（九个原因的判定、供应商选取、响应对象与中文文案）；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts` 全部通过
- [ ] 1.2 服务 `auto-draft-service.ts`：查分析与要求状态、项目是否已有轮次、复用入口状态与个人偏好，调 `prepareRfqRound({ source: "auto" })`，写审计，接住全部异常；`service.ts` 的来源加 `auto`、标题与摘要加标记；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts` 全部通过（本地隔离库）

## 2. 接线

- [ ] 2.1 四个审核路由在动作成功后调用自动起草并把 `rfqAutoDraft` 放进响应（开关关闭时不带这个字段；幂等的重复批准不触发）；verify：`auto-draft-db.isolated.test.ts` 中经路由处理函数的用例通过；`npm run typecheck` 通过
- [ ] 2.2 `web-entry` 的轮次数据带「自动起草」标记；verify：`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 全部通过（含新增断言）

## 3. 界面

- [ ] 3.1 招标分析面板显示自动起草的结果行与去向链接；项目页轮次列表显示「自动起草」标记；verify：本地真实应用截图存 `docs/acceptance/rfq-auto-2/`（结果行、轮次标记各一张）

## 4. 注册、门禁与文档

- [ ] 4.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`.env.example` 加两个变量；verify：`bash scripts/check-test-registry.sh` 通过
- [ ] 4.2 全部门禁；verify：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、`openspec validate rfq-round-auto-draft --strict` 全部通过
- [ ] 4.3 写 docs/QINGYAN_RFQ-AUTO-2_REPORT.md + 更新 TASKFLOW 状态列；verify：报告含测试输出、截图清单与「常用供应商未必适合本项目」这一取舍；TASKFLOW 有 `RFQ-AUTO-2` 一行
