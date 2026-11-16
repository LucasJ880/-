# Tasks：新标的匹配度（P2-2）

## 1. 规则

- [x] 1.1 纯函数 `fit-score-pure.ts`：四项规则、PSPC 例外、原因、总分、排序比较器（`similarity.ts` 的分词导出复用）；verify：`npx tsx src/lib/procurement-records/__tests__/fit-score-pure.test.ts` 通过

## 2. 接口与页面

- [x] 2.1 `listCandidates` 新标视图算匹配度（可见范围内的招投标项目），`sort=fit` 排序；候选接口传 `sort` 与看的人；verify：`npx tsx src/lib/procurement-records/__tests__/fit-score-db.isolated.test.ts` 通过（本地隔离库）且在改动之前的代码上失败
- [x] 2.2 采购监控页：新标视图卡片显示匹配度与原因、「排序」选择；verify：真实浏览器截图 `docs/acceptance/p2-2/*.png`

## 3. 召回与验收

- [x] 3.1 召回脚本 `scripts/p22-fit-recall.ts`（只读）；verify：隔离库造 10 个历史项目跑一次，输出每项得分
- [x] 3.2 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.3 变异核对；独立审查并处理其发现；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate tender-notice-fit-score --strict` valid、本地 `next build --webpack` 退出码 0
- [x] 3.4 写 `docs/QINGYAN_P2-2_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 P2-2 一行状态 `[G]`（真实召回待 Lucas 名单，报告写明）
