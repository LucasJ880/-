# Tasks

每条带验证方式；真实输出写进报告。前置：`tender-price-schedule-lines`（TI-1）已 apply。

## 1. 计算

- [ ] 1.1 `contract.ts` 与 `line-cost.ts`：输入输出类型、采购类型、货值折加元、关税依据分级、进口 GST 两种去向、采购数量与起订量、缺参数不出数；新建 `line-cost.test.ts`（进口与本地两条金标、本地行带关税被拒、未核实税率标记、缺税率不按零、可抵扣与不可抵扣、起订量与整箱取整、缺汇率日期）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-bid-cost/__tests__/line-cost.test.ts` 全部通过
- [ ] 1.2 `freight.ts`：运费方案互斥与混合声明、四种分摊方法、余数归最后一行、缺依据拒绝、本地行不参与国际段分摊；新建 `freight.test.ts` 并登记；verify：该测试全部通过，含 333.33 / 333.33 / 333.34 用例
- [ ] 1.3 `pricing.ts`：两种定价口径、预备金两种口径与重复检查、毛利率与加成率、合计等于逐行之和；新建 `pricing.test.ts`（22.48 / 513.70 / 224.80 / 1,027.40 / 1,252.20 / 914.12、合计利润 313.03 并注明与 Skill 样例 313.04 的差别）并登记；verify：该测试全部通过
- [ ] 1.4 `reconcile.ts`：两套情景的逐分项差额、报价差额、口径差异说明，无胜出者字段；新建 `reconcile.test.ts` 并登记；verify：该测试全部通过

## 2. 核算表

- [ ] 2.1 `sheet-view.ts` 与 `render-markdown.ts`：行项块（进口 / 本地分组与小计）、合计块（含三种标记与「不含 HST」）、假设与出处块、阻断与提示块；Markdown 渲染；新建 `sheet-view.test.ts`（四块齐全、Markdown 金额全部出自视图、含平台标价的标记、本目录无数据库 / 网络 / 模型调用引用的源码断言）并登记；verify：该测试全部通过
- [ ] 2.2 用渥太华夹具的 18 行加一组**合成**成本输入生成一张完整核算表，Markdown 存到 `docs/acceptance/ti-2/ottawa-sample-cost-sheet.md`，文件头注明「合成数据，不是报价」；verify：文件存在，行项块 18 行，合计块各项等于逐行之和

## 3. 收尾

- [ ] 3.1 门禁：五个新测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-cost-sheet --strict`；verify：全部通过，真实输出写进报告
- [ ] 3.2 写 `docs/QINGYAN_TI-2_REPORT.md`（交付清单、验收项 A10–A14 逐项对应的测试、金标数字来源、与 Skill 样例的一分钱差别、未做事项）+ 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-2 行并更新状态列；verify：报告存在，`grep -n 'TI-2' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-bid-cost-sheet --yes`（独立小 PR）。
