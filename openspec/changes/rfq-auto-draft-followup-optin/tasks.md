# Tasks

## 1. 个人开关

- [x] 1.1 读写的纯函数 `auto-followup-optin.ts`（严格解析、只动本人的键、关闭即删键）与服务（读、设置并写审计）；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts` 全部通过
- [x] 1.2 设置接口 `PUT /api/projects/{id}/tender-rfq/auto-follow-up`（项目写权限；跟进授权的功能开关关闭时 404；状态变化才写审计）；verify：`auto-draft-db.isolated.test.ts` 中经路由处理函数的用例通过

## 2. 接线

- [x] 2.1 自动起草的服务读操作者的开关并传入；`service.ts` 写授权的条件接受来源 `auto`；结果对象加 `withFollowUp` 与一句说明；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts` 与 `auto-draft-pure.test.ts` 全部通过（含批准后自动催单、批准前零出站）
- [x] 2.2 询价入口返回 `autoDraftFollowUp`（两个功能开关都开时才有）；verify：`npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts` 全部通过（含新增的接线断言）

## 3. 界面

- [x] 3.1 项目页询价区块顶部的开关：状态、范围说明、三段模板预览、开启前二次确认、关闭；verify：本地真实应用截图存 `docs/acceptance/rfq-auto-3/`（开关展开模板、开启后自动起草出的带授权的卡各一张）

## 4. 注册、审查、门禁与文档

- [ ] 4.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；请独立审查并处理其发现；verify：`bash scripts/check-test-registry.sh` 通过；审查发现逐条写进报告
- [ ] 4.2 全部门禁；verify：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、`openspec validate rfq-auto-draft-followup-optin --strict` 全部通过
- [ ] 4.3 写 docs/QINGYAN_RFQ-AUTO-3_REPORT.md + 更新 TASKFLOW 状态列；verify：报告含测试输出、截图清单、三个开关的组合说明；TASKFLOW 有 `RFQ-AUTO-3` 一行
