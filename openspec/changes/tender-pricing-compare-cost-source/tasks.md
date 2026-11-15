# Tasks：比价矩阵里选定的供应商落地价，作为报价表助手的成本来源（FLOW-H2）

> Lucas 2026-11-15「都按推荐，继续实施」。

## 1. 换算与规则

- [x] 1.1 `normalizeQuote` 多返回逐项金额；比价矩阵结论措辞改为「含关税，不含 GST/HST」；verify：`npx tsx src/lib/tender-rfq/__tests__/landed-cost.test.ts`、`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts` 通过，逐项之和等于总价、总价与排序不变
- [x] 1.2 成本建议、来源核对、过时提示、成本加成换算（纯函数）与开关；verify：`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx` 全部通过

## 2. 接口

- [x] 2.1 报价表助手 GET 返回建议与过时提示，POST 核对并记来源（只认服务端鉴权的项目与组织）；verify：`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts` 全部通过（本地隔离库），且在改动之前的代码上失败

## 3. 页面

- [x] 3.1 卡片显示「来自比价矩阵」一行（逐项、不含 GST/HST、数量口径）、填入按钮、来源与过时提示、「毛利率（按售价）」与成本加成换算；verify：纯逻辑测试里的呈现断言通过；真实浏览器截图 `docs/acceptance/flow-h2/*.png`

## 4. 测试注册与验收

- [x] 4.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`.env.example` 写开关；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 4.2 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate tender-pricing-compare-cost-source --strict` valid
- [ ] 4.3 写 `docs/QINGYAN_FLOW-H2_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FLOW-H2 一行，状态 `[G]`
