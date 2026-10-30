# Tasks — sales-quote-stats-drilldown（STAT-1）

## 1. 纯函数

- [x] 1.1 `src/lib/sales/period/summary-pure.ts`：导出 `weekStartYmd`、`weekPresetRange(today, "this_week" | "last_week")`、`periodRepQuotes(rows, period, repId)`（复用 `classify`）。

  写 `src/lib/sales/__tests__/period-drilldown-pure.test.ts`：周一计算（周日 / 周一 / 跨月 / 跨年）、本周 / 上周区间、明细与 `byRep` 合计一致（同商机修订、非 CAD、草稿、跨期、他人行）；同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试退出 0；`period-pure.test.ts` / `period-insights.test.ts` 条数不变；`bash scripts/check-test-registry.sh` 通过。

## 2. 服务端

- [x] 2.1 `src/lib/sales/period/drilldown.ts` + `src/app/api/sales/period-summary/quotes/route.ts`：参数与授权（design D2）、取数、展示字段、500 上限；`load.ts` / `types.ts` 期间汇总响应加 `draftsUnsent`。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0。

- [x] 2.2 `src/app/api/sales/quotes/list/route.ts`：`createdById` 参数、`reps` 名单、`createdBy.id`。

  verify：typecheck 退出 0；`npx eslint` 对改动文件无新错误。

## 3. 页面

- [ ] 3.1 `sales-period-panel.tsx`：本周 / 上周预设、组织时区今天、按人行展开明细、报价列表链接、草稿提醒；`/sales/quotes`：按销售下拉与 `?rep=`。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run build` 退出 0；浏览器走查记录写入报告。

## 4. 端到端

- [x] 4.1 扩 `src/lib/sales/__tests__/period-db.isolated.test.ts`：明细合计 = 按人表、草稿不出现、销售 B 看 A → 403、B 不带 repId → 自己、ORG 缺 repId → 400、非法 kind → 400、`draftsUnsent` 按范围、报价列表 `createdById` 与 `reps`、销售带他人 `createdById` → 空。

  verify：隔离库运行退出 0；无 `DATABASE_URL` 时跳过退出 0；Muse `sales-db.isolated.test.ts`、`period-narrative-db.isolated.test.ts` 通过。

## 5. 门禁与报告

- [ ] 5.1 门禁：`npm run lint:baseline`、`npm run test:ci`、`openspec validate sales-quote-stats-drilldown --strict`、`npm test` 与 main 对比无新增失败；独立只读审查后逐条核实修复。verify：各命令退出码与输出贴进报告。
- [ ] 5.2 写 `docs/QINGYAN_STAT-1_REPORT.md`（做了什么、怎么验、偏离、已知限制、上线步骤、全量对比）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` STAT-1 状态列为 `[G]` + 更新 `docs/QINGYAN_PRICELIST_HANDOFF.md`。verify：三个文件在 PR diff 中；TASKFLOW STAT-1 行含 `[G]`。

## Workflow follow-up

- PR 合并后 `/opsx:archive sales-quote-stats-drilldown --yes`（独立小 PR），TASKFLOW STAT-1 → `[x]`。
