# Tasks — sales-period-summary（KPI-1）

## 1. 口径与洞察（纯函数）

- [x] 1.1 新建 `src/lib/sales/period/summary-pure.ts`（`periodBounds` / `defaultPeriod` / `comparisonPeriod` / `summarizeSalesPeriod`，含 D2 去重、D3 时区边界、own 范围、`truncated`）与 `src/lib/sales/period/types.ts`；写 `src/lib/sales/__tests__/period-pure.test.ts`（同商机两份已签都计、签字后修改回 draft 不计、估值不进成单金额、同商机未签修订版只计最新而已签每份都计、在手未签不重复计旧修订版、expired / rejected 计入报价、USD 报价不汇总且 `nonCadExcludedCount` 计 1、报价数 0 转化率 null、当地 23:30 计入 / 次日 00:10 不计、prev_period / prev_month 含 3 月 31 日→2 月 28 日、sentAt 空的已签报价、own 范围只含本人）并在 `scripts/test-all.sh` 注册。verify：`npx tsx src/lib/sales/__tests__/period-pure.test.ts` 退出 0；`scripts/check-test-registry.sh` 通过。
- [x] 1.2 新建 `src/lib/sales/period/insights.ts`（`INSIGHT_RULES` 九条 + `buildPeriodInsights`，阈值常量集中在文件顶部，I5 / I6 标 `scope: "org"`，I8 / I9 读 `calendar`）；写 `src/lib/sales/__tests__/period-insights.test.ts`（每条规则 触发 / 不触发 / 边界 三例；own 范围不出 I5 / I6；`calendar=null` 不出 I8 / I9；对比期为 0 不出 I1 / I2）并注册。verify：`npx tsx src/lib/sales/__tests__/period-insights.test.ts` 退出 0。

## 2. 取数与 API

- [x] 2.1 新建 `src/lib/sales/period/load.ts`（一次 `findMany` 捞本期 ∪ 对比期、`status != draft`、`customer.archivedAt = null`、12 个标量字段（含 `currency`）、上限 20,000 行；own 范围加 `createdById`；`byRep` 姓名一次补齐）与 `src/app/api/sales/period-summary/route.ts`（`withAuth` → `resolveSalesOrgIdForRequest` → `resolveSalesScope(user, orgId, "sales.analytics.read")`；`from / to / compare` 校验 400 `INVALID_PERIOD`；缺省本月 1 日至当地今天；响应结构按 spec"响应结构"，`calendar` 与 `narrative` 为 `null`）。verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；本地 `curl` 老板账号 `from=2026-10-01&to=2026-10-28` 返回含 `totals.wonAmount` 的 JSON。
- [x] 2.2 写 `src/lib/sales/__tests__/period-db.isolated.test.ts`（虚构两企业：无权限 403；`to<from` / 跨度 367 天 / `compare=x` 均 400 `INVALID_PERIOD`；owner 得 `scope=org` 且 `byRep` 两行按成单金额降序；sales_rep 得 `scope=own` 且响应 JSON 不含他人姓名与金额；另一企业老板看不到本企业数字；归档客户的已签报价不计；字段齐全且 `period.days=28`；`totals.wonAmount` 与直接 SQL `SUM(grandTotal)`（signed / accepted、signedAt 在期间、CAD、客户未归档，不去重）逐分一致）并注册。verify：隔离库下 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/sales/__tests__/period-db.isolated.test.ts` 全部通过；无 `DATABASE_URL` 时打印跳过并退出 0。

## 3. 看板

- [x] 3.1 新建 `src/components/sales-command-center/sales-period-panel.tsx`（期间预设 本月至今 / 上月 / 本季 / 最近 30 天 / 自定义，状态与 URL `from / to / compare` 同步，六个瓦片含对比变化，按人表（own 只一行），洞察列表按 severity，转化率 > 1 显示"同期口径"提示，响应 `period` 回显校正），面板请求 403 时整块不渲染、其它错误只在面板内提示；在 `src/app/(main)/sales/home/page.tsx` 的 `SalesPerformanceHero` 下方用 `<Suspense fallback={null}>` 包裹挂载，金额用 `formatSalesMoney`；`src/app/(main)/sales/cockpit/page.tsx` 第 170 行标签改为 `"本月签约（商机估值）"`。verify：`npm run build` 通过（无 useSearchParams 缺 Suspense 报错）；无 `sales.analytics.read` 的账号打开首页无面板、无错误提示；浏览器打开 `/sales/home?from=2026-09-01&to=2026-09-30` 刷新后仍显示 9 月数据；驾驶舱瓦片显示"本月签约（商机估值）"。

## 4. Muse 只追加

- [x] 4.1 `src/lib/muse-bridge/contract.ts` 给 `sales_overview` 加可选 `period`（`YYYY-MM-DD` 正则 + `superRefine` 跨度 / 先后）；`src/lib/muse-bridge/sales.ts salesOverview` 有 `period` 时经 `load.ts` + `summarizeSalesPeriod` 挂 `data.period`，`amountsVisible(scope)=false` 时剔除全部 `*Amount` / `*PreTax` 键，`advisory.reasons` 追加一句期间汇总（销售范围只有计数）；无 `period` 路径不变。在 `muse-bridge-pure.test.ts`（period 三例校验，意图总数仍为 18）、`sales-pure.test.ts`（不带 period 无 `data.period`；剔除金额键）、`sales-db.isolated.test.ts`（管理者带 period 的数字与 `/api/sales/period-summary` 一致；sales 带 period 响应 JSON 不含 `grandTotal` 数字）各加用例。verify：三个测试分别 `npx tsx …` 退出 0，既有用例数不减（2026-10-28 基线：muse-bridge-pure 61、sales-pure 73，sales-db.isolated 需隔离库）。

## 5. 收口

- [ ] 5.1 全量门禁：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`scripts/check-test-registry.sh`、`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate sales-period-summary --strict` 全部通过；`openspec update` 无 diff；PR 上 CI `validate-lint-typecheck-test-build`（含 `npm run build`）为绿。verify：五条命令退出码均为 0、registry 由 463 变为 466，输出贴进报告；CI 绿。
- [ ] 5.2 写 `docs/QINGYAN_KPI-1_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制：`sentAt` 空的已签报价与转化率 > 100%、重发邮件刷新 `sentAt`、外贸转入报价无 `sentAt` / `signedAt` 不计、非 CAD 排除、归档客户排除、20,000 行上限；附三处签单金额口径差异表：本 change / 驾驶舱折扣统计 / 会计提成）；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase K 的 KPI-1 状态列改为 `[G]`（PR 号待填）。verify：两个文件在 PR diff 中；TASKFLOW KPI-1 行含 `[G]`。

## Workflow follow-up

- PR 合并后 `/opsx:archive sales-period-summary --yes`（独立小 PR），archive 时 TASKFLOW KPI-1 改为 `[x]`，并确认 `openspec list --specs` 出现 `sales/period-summary`。
