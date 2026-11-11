# Tasks

每条带验证方式；真实输出写进报告。前置：`tender-price-schedule-lines`（TI-1）已 apply（复用其时区校验）。

## 1. 契约与规则

- [ ] 1.1 `document-holders.ts` 与 `company-identity.ts`：快照校验与汇总（领取方数、投标人数未知、我方排除）、名称三档比对、建议的确认与否决；新建 `document-holders.test.ts`（九家不是九份投标、开标记录、缺时区、我方排除、只差后缀、Pest 与 Pet、大小写标点、否决后不再建议）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-competition/__tests__/document-holders.test.ts` 全部通过
- [ ] 1.2 `import-leads.ts` 与 `source-status.ts`：线索状态与 12 个月时效、当期证据确认、来源四种状态、未接通不带记录、登录门户恒为按纪律禁用；新建 `leads-and-sources.test.ts` 并登记；verify：该测试全部通过
- [ ] 1.3 `amount-measures.ts`：九个口径、同口径同币种求和、按口径分别汇总、未识别不参与；新建 `amount-measures.test.ts`（含「本目录无数据库 / 网络 / 模型 / 发信引用」的源码断言）并登记；verify：该测试全部通过

## 2. 收尾

- [ ] 2.1 门禁：三个新测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-competition-leads --strict`；verify：全部通过，真实输出写进报告
- [ ] 2.2 写 `docs/QINGYAN_TI-3a_REPORT.md`（交付清单、验收项 A3 / A4 / A5 / A6 / A15 逐项对应的测试、测试输出、未做事项）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-3a 行并更新状态列；verify：报告存在，`grep -n 'TI-3a' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-competition-leads --yes`（独立小 PR）。
