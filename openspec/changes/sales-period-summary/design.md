# Design — sales-period-summary（KPI-1）

## Context

动机见 proposal.md。现状与约束：

- 首页英雄区（"本月已签 / 本月签单"，`src/components/sales-command-center/sales-performance-hero.tsx:45,58`）与驾驶舱"本月签约"（`src/app/(main)/sales/cockpit/page.tsx:170`）同一口径：商机 `wonAt` + `estimatedValue`（`src/lib/sales/home/build-home.ts:94-104,261-262`；`src/app/api/sales/cockpit/route.ts:108-111`），写死 `monthStart`。驾驶舱有按负责人的 `teamPerformance`（`route.ts:86-102`），同为估值。首页其它位置已用"本月签约（商机估值）"标注估值（`sales-payment-summary.tsx:44`、`sales/performance/page.tsx:269`）。
- 已有两处按签字金额的统计，各带过滤条件，都不是本需求的口径：驾驶舱折扣统计（`src/app/api/sales/cockpit/discount-stats/route.ts:53-95`：可选 from/to、`signedAt`、`grandTotal`、上一期对比、按 `createdById`，但只计 `finalDiscountPct` 非空的报价、按服务器时区、不排除归档客户）；会计提成（`src/lib/accounting/service.ts:16-28` `loadSalesSummary`：按月、只计 `status = "signed"`、按 `createdById`、不排除归档客户）。本 change 不改它们，见 D9。
- 期间要按组织当地日解释。已有 `resolveOrgTimezone`（`src/lib/automation/registry.ts:93`，默认多伦多）与 `zonedLocalToUtc` / `nextDay`（`src/lib/revenue-spine/business-days.ts:111,171`），不再造日期工具。
- 销售区授权统一走 `authorize()`：`resolveSalesScope(user, orgId, permission)`（`src/lib/sales/org-context.ts:51`）返回 `ownOnly`；`sales.analytics.read` 键已存在（`src/lib/authorization/permissions.ts:61`，范围 PRINCIPAL / ORG），`sales_rep`、`pricing_lead`、`accounting`、`owner` 岗位已绑定。
- Muse 侧 `sales_overview` 的读范围由 `resolveSalesScope(identity)`（`src/lib/muse-bridge/sales-pure.ts:47`）决定，金额可见性由 `amountsVisible` 决定（决定 B）；契约在 `src/lib/muse-bridge/contract.ts:146-153`，zod `.strip()`。
- 报价版本：`SalesQuote.version` = 该**客户**已有报价数 + 1（`src/app/api/sales/quotes/route.ts:213,222`、`measurements/[id]/generate-quote/route.ts:81,97`），不是按商机的版本号。客户要求修改时销售新建一行报价，旧行保持 sent / viewed；已签报价被修改时是**同一行**清签字回 `draft`（`src/lib/sales/quote-update.ts:298-302`），仓库里没有复制报价的路径。所以：同一商机下多份**已签**报价 = 多张合同（每份各自走签字后工艺单生成，有可生产行时各生成一张，`openspec/specs/sunny/process-order-autogen`）；多份**未签**报价 = 同一提案的修订版。
- `sentAt` 语义不纯：`mark-sent` 保留首次 `sentAt`（`mark-sent/route.ts:63`），邮件发送与邮件撰写会覆盖为当下（`send-email/route.ts:126`、`src/app/api/sales/email-compose/route.ts:158`）；已签报价被修改回 draft 时 `sentAt` 保留（`quote-update.ts` 不写 `sentAt`）。外贸转入的销售报价复制外贸状态与币种、不写 `sentAt` / `signedAt`（`src/lib/trade/trade-quote-sales-quote.ts:403,435,446`），币种可能不是 CAD。
- 销售首页与统计排除已归档客户（`customer.archivedAt = null`），由 `src/lib/sales/__tests__/archived-customer-visibility.test.ts` 强制；本口径跟随。
- 设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §7 的判断点已拍板：成单按报价签字 `grandTotal`，按人按报价创建人，LLM 叙述不在本 change；判断点 5 经交叉核对更正为 D2 的规则，2026-10-28 用户确认。

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
- `src/lib/sales/period/summary-pure.ts`：输入 = 期间（UTC 边界 + 当地日字符串）、`now`、范围（`org | own`，own 时带 `userId`）、报价行数组（`id / opportunityId / createdById / status / currency / sentAt / signedAt / grandTotal / preTaxTotal / depositAmount / depositCollectedAt / updatedAt`，12 个标量），输出 `PeriodSummary`（`totals / byRep / comparison`）。币种过滤、去重、分桶、对比都在这里：只汇总 `currency = "CAD"` 的行，其余行数计入 `totals.nonCadExcludedCount`。
- `src/lib/sales/period/load.ts`：按 `orgId` + `customer: { archivedAt: null }`（own 时再加 `createdById`）一次 `findMany` 捞出 `signedAt`、`sentAt` 或 `depositCollectedAt` 落在 **本期 ∪ 对比期** 内的报价（`OR` 三段 + `status != draft`），再把行交给纯函数分别算本期与对比期。只捞一次，不按期分两次查。
- 否决：直接在 Prisma `aggregate` 里算和 —— 报价侧"未签只取每商机最新一份"在 SQL 里要窗口函数，Prisma `aggregate` 不支持；且 Muse 与看板会各写一遍查询，口径又分叉。

### D2 去重规则写进口径
- 成单：**不去重**，每份 `signedAt` 落在期间的已签报价各计一份（见 Context：同商机多份已签 = 多张合同）。
- 报价：`sentAt` 落在期间的非 draft 报价按 `opportunityId` 分组；组内已签的每份都计，未签的只取 `sentAt` 最大的一份（并列取 `updatedAt` 最大，再并列取 `id` 字典序最大）；`opportunityId` 为空的每行各计。
- 在手未签：取上一步"报价"所计集合中 `signedAt` 为空、状态 sent / viewed 的，避免同一提案的旧修订版重复计入在手金额。
- 定金：按行，不去重（每笔是真实收款）。
- 否决 1：成单也按商机只取最新一份（设计稿初版推荐） —— 前提错误，会把同一客户分两次签的两张合同算成一张，少算真实签单额。
- 否决 2：按 `SalesQuote.version` 最大去重 —— `version` 是按客户计数的序号，一个客户可有多个商机，不能代表某商机内的新旧。

### D3 期间边界用既有时区工具
- `periodBounds(from, to, timeZone)` = `[zonedLocalToUtc(from, 0, tz), zonedLocalToUtc(nextDay(to), 0, tz))`；`days` = 当地日数差 + 1。
- 缺省期间：`getLocalTimeParts(now, tz).date` 取当地今天，`from` = 当月 1 日。
- 对比期：`prev_period` = `[from − days, from − 1]`；`prev_month` = 上月同日号，日号超出截到月末。两者都是当地日字符串运算，再各自转 UTC（夏令时切换日按实际时长，与 `localDayBounds` 一致）。
- 仓库里**没有**时区安全的 `prevDay` / `addDays(字符串, n)` / 月初月末 / 当月天数工具（2026-10-28 核对：`src/lib/accounting/period.ts:13,30` 的 `parseMonth` / `parseQuarter` 用服务器本地 `Date`；`src/lib/tender-rfq/inbound-parse.ts:226` 的 `addDaysYmd` 收 `Date`）。本 change 在 `summary-pure.ts` 内新增 `addDaysYmd(day, n)` / `monthStartYmd` / `daysInMonth`，照 `nextDay` 的 `Date.UTC` 写法，只做日历日运算，时区只在最后 `zonedLocalToUtc` 一步介入。
- 否决：复用 `startOfDayToronto` —— 写死多伦多，梦馨（上海时区）会错；复用 `accounting/period.ts` —— 服务器本地时区。

### D4 洞察是规则表
- `src/lib/sales/period/insights.ts` 导出 `INSIGHT_RULES: InsightRule[]`，每条 `{ code, scope: "org" | "any", when(summary, calendar) => evidence | null, text(evidence) => string, severity(evidence) }`；`buildPeriodInsights(summary, calendar, scope)` 顺序遍历、过滤 `scope`。阈值（20% / 14 天 / 30% / 10 / 60% / 5 / 3 / 40%）作为常量放在同一文件顶部。
- I5 / I6 标 `scope: "org"`，PRINCIPAL 范围永不出现；I3 / I4 / I7 在 own 范围只用本人数字。I8 / I9 也标 `org`：日程来源是企业级数据（I8 的证据含他人创建者邮箱），CAL-1 接入时再评估销售范围是否开放。
- I5 需要上一期的按人数据：口径层内部同时算出上一期 byRep 供洞察使用，不进入 API 响应。
- I7 读 `totals.wonWithoutDepositCount` / `wonWithoutDepositAmount`（spec"在手未签与定金"要求）。
- I8 / I9 读 `calendar` 参数，本 change 传 `null` → 永不触发；CAL-1 接入时只改调用方传参。
- 否决：把洞察写在 React 组件里 —— Muse 与 KPI-2 拿不到。

### D5 API 路由与授权
- `GET /api/sales/period-summary`：`withAuth` → `resolveSalesOrgIdForRequest` → `resolveSalesScope(user, orgId, "sales.analytics.read")`；`allowed=false` → 403（沿用 `/api/sales/home` 的错误体风格）；`ownOnly` → `scope: "own"` 且取数加 `createdById = user.id`。
- 参数：`from` / `to` 正则 `^\d{4}-\d{2}-\d{2}$` 且能构造有效日期；`to < from` 或跨度 > 366 天 → 400 `{ code: "INVALID_PERIOD" }`；`compare` ∈ {`prev_period`, `prev_month`}，缺省 `prev_period`。
- `byRep` 的姓名用 `db.user.findMany({ where: { id: { in: ids } }, select: { id, name } })` 一次补齐；own 范围只查本人。
- 否决：把期间参数塞进 `/api/sales/home` —— 首页一次算 20 多块面板，期间切换会拖慢整页，且该接口响应字段被多个组件消费。

### D6 Muse 只追加
- `contract.ts` 在 `sales_overview` 对象上加 `period: z.object({ from: localDate, to: localDate }).strip().optional()`，`localDate` = `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`；`to < from` 或跨度 > 366 天用 `.superRefine` 判为校验失败（与 web 一致）；`superRefine` 挂在 `period` 子对象上，`discriminatedUnion` 成员保持普通对象（实施时定，`src/lib/muse-bridge/contract.ts:99-104`）。
- `sales.ts salesOverview`：有 `period` 时调 `load.ts` 的同一取数（scope own → `createdById = identity.userId`），`summary-pure` 算出 `totals`，再按 `amountsVisible(scope)` 决定是否剔除所有 `*Amount` / `*PreTax` 键，挂到 `data.period`；`advisory.reasons` 第一条放期间汇总句（管理范围"期间 X 至 Y：成单 N 单 M，报出 K 份 L"，销售范围只有计数），商机理由保留前两条——建议式回复契约限制理由 ≤ 3 条（`src/lib/muse-bridge/advisory.ts:23`），追加在末尾会被截掉。
- 没有 `period` 时代码路径不变（不查、不挂键）。
- 范围沿用 S1：Muse 的读范围来自平台角色或岗位派生角色（`sales-pure.ts:47-58`、`src/lib/rbac/effective-platform-role.ts:15,34`），**不**来自 `sales.analytics.read`。因此与网页只在老板（两边都是全企业）与销售（两边都是本人）上一致；合价岗在 Muse 派生为销售 → 本人范围且无金额，会计岗派生为 user → Muse 拒绝，而网页两者都是全企业。本 change 不改 S1 的范围规则，spec 只承诺老板与销售两种一致。
- 否决：给 Muse 新开 `sales_period` 意图 —— 要改意图总数断言、意图门、`availableInPhase`，契约面扩大；而期间只是 overview 的一个切面。

### D7 看板面板独立组件
- `src/components/sales-command-center/sales-period-panel.tsx`：自管 `from / to / compare` 状态，初始值来自 URL 查询参数（`useSearchParams`），变化时 `router.replace` 写回；自己 `apiFetch("/api/sales/period-summary?…")`；预设按钮用组织时区的当地今天由服务端 `period` 回显校正（首屏用浏览器日期，响应回来后以 `period.from/to` 为准）。
- `page.tsx` 只在 `SalesPerformanceHero` 下方插入 `<Suspense fallback={null}><SalesPeriodPanel /></Suspense>`（`useSearchParams` 需要 Suspense 边界，否则 `next build` 报错；先例 `src/app/(main)/sales/quotes/page.tsx:80`），不改其它组件 props。首页响应里没有范围信息，面板以接口返回的 `scope` 决定是否显示按人表。
- 面板请求返回 403 时**整块不渲染**、不弹错误：首页按 `sales.customer.read` 放行，而面板按 `sales.analytics.read`，持前者不持后者的人打开首页必须与改动前一致（2026-10-28 枚举 `role-defaults.ts` 全部 20 个默认模板，没有这种组合；只可能来自自定义岗位，属防御性要求）。其它错误显示面板内一行"期间数据暂不可用"，不影响首页其余部分。
- 金额展示复用首页已有的 `formatSalesMoney`（`src/lib/sales/home/formatters.ts:3`），与英雄区格式一致。
- 否决：改 `SalesPerformanceHero` 加期间 —— 它绑定 `/api/sales/home` 的月度目标与 `monthStart`，改它会改首页既有行为。

### D8 驾驶舱标签
- `src/app/(main)/sales/cockpit/page.tsx:170` 的 `label: "本月签约"` 改为 `"本月签约（商机估值）"`；`sub` 不变。只改字符串。

### D9 与既有两处签单金额统计的关系
- 不改驾驶舱折扣统计与会计提成：前者是"折扣分析"（只看带折扣率的单），后者是"提成"（只看 signed，按会计月）；口径服务于各自目的。
- 报告列出三处口径差异表，供 Evan 决定是否另开 change 统一（例如让会计提成也计 `accepted`、也排除归档客户）。
- 否决：本 change 内把三处收成一个函数 —— 会改动会计提成金额（PERM-5a 已归档规格 `accounting/sales-commission-view`），超出 KPI-1 范围。

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

- [转化率可能 > 100%：`sentAt` 为空的已签报价（线下签字、从未"发送"）计入成单不计入报价；上期发出、本期签字的也一样] → 口径文档写明；页面上转化率 > 1 时显示"同期口径"提示而不截断；`period-pure.test.ts` 有该用例。
- [`sentAt` 会被邮件重发覆盖：9 月发出、10 月重发邮件的报价计入 10 月报价] → 报告"已知限制"写明；不改发送路由。
- [外贸转入的报价没有 `sentAt` / `signedAt`，不进入任何指标；非 CAD 报价不汇总] → `totals.nonCadExcludedCount` 显示被排除的行数；报告写明。
- [排除已归档客户后，历史期间的成单额会随归档操作变小] → 与首页约定一致，报告"已知限制"写明；若老板要"财务口径不随归档变化"，另开 change。
- [同一商机"最新一份"规则与首页 `recentSigned` 列表（逐行）数字不一致] → 首页列表是明细不是汇总，报告 §判断点写明；驾驶舱标签已标"商机估值"。
- [`OR` 三段取数在大企业可能捞出数千行] → 单次查询只选 12 个标量字段；Sunny 年报价量在千级，内存聚合可接受；上限 20,000 行，超出返回 `truncated: true`，面板显示"数据量超过上限，结果不完整"（不静默；不另加洞察码，洞察只按 spec 的九条规则）。
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
