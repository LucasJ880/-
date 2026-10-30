# Design — sales-quote-stats-drilldown（STAT-1）

## Context

动机见 proposal.md。现状（2026-10-30 对 main `28e46ea2` 核对）：

- **期间汇总（KPI-1）**：
  - 口径在 `src/lib/sales/period/summary-pure.ts`：`classify` 把报价行分成成单（signed / accepted 且 `signedAt` 在期间）、报价（`sentAt` 在期间；同商机未签只计最新一份）、定金三组；`byRepOf` 按 `createdById` 汇总成按人行。
  - 取数 `load.ts` 的 `loadPeriodQuoteRows`：排除草稿与归档客户，own 范围只取本人创建的报价，上限 20,000 行。
  - 接口 `GET /api/sales/period-summary`：`resolveSalesScope(user, orgId, "sales.analytics.read")` 决定 ORG / own。
  - Muse `sales_overview` 只取响应里的 `period` 与 `totals`；KPI-2 解读经 `projectNarrativeInput` 只取固定字段。
- **面板** `src/components/sales-command-center/sales-period-panel.tsx`：预设"本月至今 / 上月 / 本季 / 最近 30 天 / 自定义"，用浏览器当地今天计算；按人表只有合计，不能展开。
- **报价列表**：`GET /api/sales/quotes/list` 按 `sales.quote.read` 授权范围取最近 200 份，状态与搜索都在页面端过滤；返回 `createdBy.name`，没有按销售的参数；`/sales/quotes` 支持 `?status=`。
- **报价单号**：`SalesQuote.orderNumber`（可空）；价表版本在 `formDataJson.pricelistVersion`（PRICE-1，`readPricelistVersion`）。
- **判断点（用户 2026-10-29 "都按照推荐的来"）**：Q9 本周从周一起、组织时区；Q10 销售能展开、只看自己。

## Goals / Non-Goals

**Goals:**
- 明细与按人表同一函数分组，小计必然一致。
- 销售（只持本人范围）看不到别人的明细。
- 只加字段与接口，不改既有响应字段的含义。

**Non-Goals:**
- 不改 `summary-pure.ts` 中 `classify` / `totalsOf` / `byRepOf` 的口径逻辑（只把分组结果暴露出来）。
- 不改 `src/lib/muse-bridge/**`、`src/lib/sales/period/narrative*.ts`。
- 不改报价列表的授权（`resolveSalesAuthorizedWhere(... "sales.quote.read")`）与 200 条上限。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 明细复用 `classify`
- 在 `summary-pure.ts` 导出 `periodRepQuotes(rows, period, repId)` → `{ won, quoted }`：先按 `createdById = repId` 过滤，再调用同一个 `classify`，所以计入集合与按人表完全相同（包括同商机未签只算最新一份）。
- 取数复用 `loadPeriodQuoteRows`，范围设为 `{ kind: "own", userId: repId }`（只取该销售的行），期间只取本期。
- 明细行再按 ID 查一次展示字段（报价单号、客户名、`formDataJson` 只读出价表版本），不改口径层的 12 个标量。
- 否决：**另写一份按人 SQL**：两套口径迟早不一致，"合计 = 按人表"就靠同一函数保证。

### D2 授权与参数
- 授权同期间汇总：无 `sales.analytics.read` → 403；只持本人范围时 `repId` 缺省为本人、等于别人 → 403 `FORBIDDEN_REP`；ORG 范围 `repId` 必填，缺 → 400 `INVALID_REP`。
- `from` / `to` 走 `resolvePeriodParams`（缺省本月至今，非法 400 `INVALID_PERIOD`）；`kind ∈ {won, quoted}`，缺省两组都给；其它值 400。
- 每组最多 500 行，按时间倒序；超出带 `truncated: true`，小计仍按全量计。
- 否决：**ORG 不带 repId 时返回全企业明细**：一次可能上万行，面板也只按人展开。

### D3 周预设与组织今天
- `summary-pure.ts` 加 `weekStartYmd(day)`（周一）；面板预设"本周" = 本周一至今天，"上周" = 上周一至上周日。
- 面板的"今天"在拿到服务端响应后改用 `getLocalTimeParts(now, data.period.timezone).date`（组织时区），首屏仍用浏览器今天。
- 否决：**新增服务端 `preset=` 参数**：URL 已用 from / to 表达期间，多一种表达会让刷新保留逻辑分叉。

### D4 草稿提醒放进期间汇总响应
- `draftsUnsent = { count }`：本企业、调用者范围内（own 只算本人）、客户未归档、`status = draft`、`createdAt` 在期间内的报价数；不计入任何金额与 `totals`。
- 面板在 `count > 0` 时显示"本期草稿未发送 N 份"，链到 `/sales/quotes?status=draft`；只持本人范围时链接另带 `&rep=<本人>`。
- 否决：**单开接口**：面板多一次请求；**放进 `totals`**：`totals` 进 Muse 与对比期 delta，会改 Muse 契约。

### D5 报价列表按销售筛选
- `GET /api/sales/quotes/list?createdById=` 在既有授权范围内再加 `createdById` 条件（服务端筛，避免只在最近 200 份里筛）；响应加 `reps: [{ id, name }]`（授权范围内出现过的报价创建人，按名字排序）与每份报价的 `createdBy.id`。
- `/sales/quotes` 在 `reps` 多于一人时显示"按销售"下拉，选择写入 `?rep=`，从期间面板链接进来时直接生效。
- 否决：**页面端在 200 份里筛**：老板选一位销售时可能只剩很少几份，误以为对方没报价。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：只读既有字段（`orderNumber`、`formDataJson`、`createdAt`）；`git diff --stat prisma/` 为空 |
| 2 | 出站先审批 | 不涉及：只读接口与页面 |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏 | 不涉及 Muse 通道；明细只给本企业、按范围授权的报价；本人范围看不到他人姓名与数字 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：纯函数分组，无 LLM；KPI-2 输入不变 |
| 8 | 测试注册 | 遵守：新增纯测试同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；隔离库测试扩既有已注册文件 |

## Risks / Trade-offs

- **周预设首屏可能差一天**：首屏用浏览器今天，跨时区时与组织今天差一天；响应回来后以组织今天为准（与既有预设同样的限制，现在一并改善）。
- **明细只看创建人**：与 KPI-1 按人口径一致（报价创建人），不是商机负责人；面板表头已写"报价创建人"。
- **报价列表上限仍是 200**：按销售筛选后是"该销售最近 200 份"，足够日常使用。

## Migration Plan

无 schema、无数据迁移；纯增量。回滚：revert 本 PR。

## 验证方式

- 纯函数：`npx tsx src/lib/sales/__tests__/period-drilldown-pure.test.ts`——`weekStartYmd`（跨月 / 跨年 / 周日 / 周一）、本周 / 上周区间、`periodRepQuotes` 与 `byRepOf` 合计一致（含同商机修订、非 CAD、草稿、跨期）。
- 隔离库：`src/lib/sales/__tests__/period-db.isolated.test.ts` 扩——两位销售各 2 份已发送 + 1 份已签 + 1 份草稿：老板展开 A 的明细条数与金额等于按人表、草稿不出现；销售 B 展开 A → 403；销售 B 不带 repId → 自己；ORG 不带 repId → 400；`draftsUnsent` 老板 = 2、销售 A = 1；报价列表 `createdById` 筛选与 `reps`。
- 回归：`period-pure.test.ts`、`period-insights.test.ts`、`period-narrative-pure.test.ts`、`period-narrative-db.isolated.test.ts`、Muse `sales-pure.test.ts` / `sales-db.isolated.test.ts` 条数不变。
- 门禁：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate sales-quote-stats-drilldown --strict`、`NODE_OPTIONS=--max-old-space-size=8192 npm run build`；`npm test` 与 main 对比；浏览器走查面板展开与报价列表筛选。
