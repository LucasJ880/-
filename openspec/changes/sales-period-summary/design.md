# Design — sales-period-summary（KPI-1）

## Context

动机见 proposal.md。现状与约束：

- 同一"本月成单"有两套算法：`src/app/api/sales/cockpit/route.ts:108-111`（商机 `wonAt` + `estimatedValue`）与 `src/lib/sales/home/build-home.ts:233-247`（报价 `signedAt` + `grandTotal`）；两者都写死 `monthStart`，没有期间参数，没有按人。
- 期间要按组织当地日解释。已有 `resolveOrgTimezone`（`src/lib/automation/registry.ts:93`，默认多伦多）与 `zonedLocalToUtc` / `nextDay`（`src/lib/revenue-spine/business-days.ts:111,171`），不再造日期工具。
- 销售区授权统一走 `authorize()`：`resolveSalesScope(user, orgId, permission)`（`src/lib/sales/org-context.ts:51`）返回 `ownOnly`；`sales.analytics.read` 键已存在（`src/lib/authorization/permissions.ts:61`，范围 PRINCIPAL / ORG），`sales_rep`、`pricing_lead`、`accounting`、`owner` 岗位已绑定。
- Muse 侧 `sales_overview` 的读范围由 `resolveSalesScope(identity)`（`src/lib/muse-bridge/sales-pure.ts:47`）决定，金额可见性由 `amountsVisible` 决定（决定 B）；契约在 `src/lib/muse-bridge/contract.ts:146-153`，zod `.strip()`。
- 报价多版本：`SalesQuote.version` 递增但同一商机可能有多条 `SalesQuote` 行（含已签后改价回 `draft` 的旧版本），所以"按商机取最新一份"必须在口径里写死。
- 设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §3 的判断点已拍板：成单按报价签字 `grandTotal`，按人按报价创建人，多版本只计最新一份，LLM 叙述不在本 change。

## Goals / Non-Goals

**Goals:**
- 一个纯函数产出所有期间数字，看板 API、Muse `sales_overview`、将来的 KPI-2 叙述只调它。
- 期间、范围、对比期、洞察全部确定性、可用表驱动测试穷举。
- 对既有页面零行为变化（首页其余面板、驾驶舱计算）。

**Non-Goals:**
- 不动 `src/lib/sales/home/build-home.ts`、`src/lib/sales/home/priority-score.ts`、`src/app/api/sales/home/route.ts` 的任何计算与响应字段。
- 不动 `src/app/api/sales/cockpit/route.ts`；驾驶舱只改 `src/app/(main)/sales/cockpit/page.tsx:170` 的一个标签字符串。
- 不动 `SalesOpportunity.wonAt` 的写入逻辑（`src/lib/sales/opportunity-lifecycle.ts`）；不做历史回填。
- 不新增 LLM 调用、cron、Notification、PendingAction、Prisma 模型或字段。
- 不改 `src/lib/muse-bridge/router.ts` 的分发（`sales_overview` 仍走 `salesOverview(identity, command)`）；不改 `opportunity_status` 及其它意图。

## Decisions

### D1 口径层是纯函数，取数层只负责捞行
- `src/lib/sales/period/summary-pure.ts`：输入 = 期间（UTC 边界 + 当地日字符串）、`now`、范围（`org | own`，own 时带 `userId`）、报价行数组（`id / opportunityId / createdById / status / sentAt / signedAt / grandTotal / preTaxTotal / depositAmount / depositCollectedAt / updatedAt`），输出 `PeriodSummary`（`totals / byRep / comparison`）。去重、分桶、对比都在这里。
- `src/lib/sales/period/load.ts`：按 `orgId`（own 时再加 `createdById`）一次 `findMany` 捞出 `signedAt`、`sentAt` 或 `depositCollectedAt` 落在 **本期 ∪ 对比期** 内的报价（`OR` 三段 + `status != draft`），再把行交给纯函数分别算本期与对比期。只捞一次，不按期分两次查。
- 否决：直接在 Prisma `aggregate` 里算和 —— 去重规则（按商机取最新一份）在 SQL 里要窗口函数，Prisma 不支持；且 Muse 与看板会各写一遍查询，口径又分叉。

### D2 去重规则写进口径
- 成单：按 `opportunityId` 分组，组内取 `signedAt` 最大（并列取 `updatedAt` 最大，再并列取 `id` 字典序最大）；`opportunityId` 为空的每行一组。
- 报价：同样分组，组内取 `sentAt` 最大。
- 在手未签与定金不去重（它们本来就是按行的事实）。
- 否决：按 `SalesQuote.version` 最大 —— `version` 是报价自身版本号，同一商机的两条 `SalesQuote` 行各自从 1 起，不可比。

### D3 期间边界用既有时区工具
- `periodBounds(from, to, timeZone)` = `[zonedLocalToUtc(from, 0, tz), zonedLocalToUtc(nextDay(to), 0, tz))`；`days` = 当地日数差 + 1。
- 缺省期间：`getLocalTimeParts(now, tz).date` 取当地今天，`from` = 当月 1 日。
- 对比期：`prev_period` = `[from − days, from − 1]`；`prev_month` = 上月同日号，日号超出截到月末。两者都是当地日字符串运算，再各自转 UTC（夏令时切换日按实际时长，与 `localDayBounds` 一致）。
- 否决：复用 `startOfDayToronto` —— 写死多伦多，梦馨（上海时区）会错。

### D4 洞察是规则表
- `src/lib/sales/period/insights.ts` 导出 `INSIGHT_RULES: InsightRule[]`，每条 `{ code, scope: "org" | "any", when(summary, calendar) => evidence | null, text(evidence) => string, severity(evidence) }`；`buildPeriodInsights(summary, calendar, scope)` 顺序遍历、过滤 `scope`。阈值（20% / 14 天 / 30% / 10 / 60% / 5 / 3 / 40%）作为常量放在同一文件顶部。
- I5 / I6 标 `scope: "org"`，PRINCIPAL 范围永不出现；I3 / I4 / I7 在 own 范围只用本人数字。
- I8 / I9 读 `calendar` 参数，本 change 传 `null` → 永不触发；CAL-1 接入时只改调用方传参。
- 否决：把洞察写在 React 组件里 —— Muse 与 KPI-2 拿不到。

### D5 API 路由与授权
- `GET /api/sales/period-summary`：`withAuth` → `resolveSalesOrgIdForRequest` → `resolveSalesScope(user, orgId, "sales.analytics.read")`；`allowed=false` → 403（沿用 `/api/sales/home` 的错误体风格）；`ownOnly` → `scope: "own"` 且取数加 `createdById = user.id`。
- 参数：`from` / `to` 正则 `^\d{4}-\d{2}-\d{2}$` 且能构造有效日期；`to < from` 或跨度 > 366 天 → 400 `{ code: "INVALID_PERIOD" }`；`compare` ∈ {`prev_period`, `prev_month`}，缺省 `prev_period`。
- `byRep` 的姓名用 `db.user.findMany({ where: { id: { in: ids } }, select: { id, name } })` 一次补齐；own 范围只查本人。
- 否决：把期间参数塞进 `/api/sales/home` —— 首页一次算 20 多块面板，期间切换会拖慢整页，且该接口响应字段被多个组件消费。

### D6 Muse 只追加
- `contract.ts` 在 `sales_overview` 对象上加 `period: z.object({ from: localDate, to: localDate }).strip().optional()`，`localDate` = `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`；`to < from` 或跨度 > 366 天用 `.superRefine` 判为校验失败（与 web 一致）。
- `sales.ts salesOverview`：有 `period` 时调 `load.ts` 的同一取数（scope own → `createdById = identity.userId`），`summary-pure` 算出 `totals`，再按 `amountsVisible(scope)` 决定是否剔除所有 `*Amount` / `*PreTax` 键，挂到 `data.period`；`advisory.reasons` 在管理范围追加一句"期间 X–Y 成单 N 单 / 金额 M，报出 K 份 / 金额 L"，销售范围只有计数句。
- 没有 `period` 时代码路径不变（不查、不挂键）。
- 否决：给 Muse 新开 `sales_period` 意图 —— 要改意图总数断言、意图门、`availableInPhase`，契约面扩大；而期间只是 overview 的一个切面。

### D7 看板面板独立组件
- `src/components/sales-command-center/sales-period-panel.tsx`：自管 `from / to / compare` 状态，初始值来自 URL 查询参数（`useSearchParams`），变化时 `router.replace` 写回；自己 `apiFetch("/api/sales/period-summary?…")`；预设按钮用组织时区的当地今天由服务端 `period` 回显校正（首屏用浏览器日期，响应回来后以 `period.from/to` 为准）。
- `page.tsx` 只在 `SalesPerformanceHero` 下方插入 `<SalesPeriodPanel ownOnly={...} />`，不改其它组件 props。
- 金额展示复用现有 `quote-display-amounts.ts` 的格式化（若其导出不适用，组件内用 `Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" })`）。
- 否决：改 `SalesPerformanceHero` 加期间 —— 它绑定 `/api/sales/home` 的月度目标与 `monthStart`，改它会改首页既有行为。

### D8 驾驶舱标签
- `src/app/(main)/sales/cockpit/page.tsx:170` 的 `label: "本月签约"` 改为 `"本月签约（商机估值）"`；`sub` 不变。只改字符串。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及新增：纯查询，无模型、字段、migration |
| 2 | 出站先审批 | 不涉及：无邮件、无 Muse 动作、无改价 |
| 3 | 禁止第三套队列 | 不涉及：无 cron、无队列 |
| 4 | 脱敏 / 决定 B | 触碰：Muse `data.period` 的金额键只在管理范围输出（D6），销售范围剔除全部 `*Amount` / `*PreTax` 键；招投标三样不出现 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：口径、对比、洞察全为纯函数与规则表；不增加 LLM 调用 |
| 8 | 测试注册 | 遵守：三个新测试文件在同一 task 内注册进 `scripts/test-all.sh`；既有三份 Muse 测试只加用例 |

## Risks / Trade-offs

- [`sentAt` 为空的非 draft 报价（线下签字、从未"发送"）不计入报价数，但若已签会计入成单，转化率可能 > 100%] → 口径文档写明；页面上转化率 > 1 时显示"同期口径"提示而不截断；`period-pure.test.ts` 有该用例。
- [同一商机"最新一份"规则与首页 `recentSigned` 列表（逐行）数字不一致] → 首页列表是明细不是汇总，报告 §判断点写明；驾驶舱标签已标"商机估值"。
- [`OR` 三段取数在大企业可能捞出数千行] → 单次查询只选 11 个标量字段；Sunny 年报价量在千级，内存聚合可接受；上限 20,000 行，超出返回 `truncated: true` 并在 `insights` 加一条 warn（不静默）。
- [浏览器日期与组织时区不同（出差）导致预设"本月至今"首屏差一天] → 以服务端返回的 `period` 为准回显（D7）。
- [Muse 契约加 `superRefine` 可能影响既有 `VALIDATION_FAILED` 错误文案] → 只在 `period` 存在时触发；`muse-bridge-pure.test.ts` 既有 61 条用例须全部不变。

## Migration Plan

- 纯新增路由与组件，无数据迁移；部署后立即可用。
- 回滚：revert 本 PR 即可，无残留数据。

## 验证方式

- `npx tsx src/lib/sales/__tests__/period-pure.test.ts`：去重、边界日、时区、对比期、own 范围、`sentAt` 空、`truncated`。
- `npx tsx src/lib/sales/__tests__/period-insights.test.ts`：九条规则各"触发 / 不触发 / 边界"三例 + own 范围过滤。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/sales/__tests__/period-db.isolated.test.ts`：403、400 `INVALID_PERIOD`、ORG vs PRINCIPAL、跨企业、字段齐全、与手工 SQL 逐分一致。
- `npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` / `sales-pure.test.ts` / `sales-db.isolated.test.ts`：`period` 校验、不带 `period` 不变、决定 B 剔除金额键。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`scripts/check-test-registry.sh`、`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate sales-period-summary --strict`。
