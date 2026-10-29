# Proposal — sales-period-summary（KPI-1：期间看板一套口径）

TASKFLOW：**KPI-1**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §3、§5）。

## Why

管理者问"10 月 1 日到今天 28 日一共成了多少单、报了多少钱出去"，青砚现在答不出：首页与驾驶舱的"本月签约 / 本月已签"都按商机估值（`estimatedValue`）、固定从本月 1 日起算，而已有的两处签字金额统计（驾驶舱折扣统计只计带折扣率的报价，会计提成只计 signed 且按月）都不含"报出去的金额"。

## What Changes

- 新增期间统计的唯一口径（纯函数）：成单 = 报价签字金额（`signedAt` 落在期间、状态 signed / accepted，每份已签报价各计一份）；报价 = 发送日落在期间、状态非 draft 的报价（按商机分组，已签的每份都计，未签的只计最新发送的一份）；全部指标排除已归档客户、只汇总 CAD 报价（非 CAD 行数单独给出）；另给转化率、在手未签（含超 14 天子集）、定金、按报价创建人拆分、上一期与上月同期对比。
- 新增 `GET /api/sales/period-summary?from&to&compare`：按 `sales.analytics.read` 授权，ORG 范围看全企业与按人，PRINCIPAL 范围只看本人；期间按组织时区的当地日解释；缺省为本月 1 日至今天；最长 366 天。
- 新增表驱动的确定性洞察（九条规则，零 LLM）：环比变化、超 14 天未签、转化率偏低、某销售本期零报价、成单集中、已签未登记定金、日程不明来源、网站预约占比；每条洞察带 `code / severity / text / evidence`。
- 在 `/sales/home` 增加期间面板：期间选择器（本月至今 / 上月 / 本季 / 最近 30 天 / 自定义）、六个指标瓦片、按人表、洞察列表；无 `sales.analytics.read` 的用户首页不显示该面板、其余首页内容不变。
- 销售驾驶舱"本月签约"瓦片标签改为"本月签约（商机估值）"，不改其计算。
- `sales_overview` Muse 意图增加可选 `period: { from, to }` 参数（契约只追加）；给出时 `data.period` 附同一口径的期间汇总；决定 B：只有管理范围输出金额，销售范围只输出计数。
- 不改任何 Prisma 模型；不新增 LLM 调用。

## Capabilities

### New Capabilities
- `sales/period-summary`：销售期间汇总——成单 / 报价 / 转化 / 在手 / 定金的统一口径、期间与范围规则、按人拆分、对比期、确定性洞察，以及 `GET /api/sales/period-summary` 的契约。

### Modified Capabilities
- `muse-bridge/sales-intents`："契约只追加"要求扩为接受 `sales_overview` 的可选 `period`，并把该要求场景里过时的"意图总数为 14"更正为现状 18（S2、S3 各加 2 个意图后未同步）；新增"期间汇总随 `sales_overview` 输出"与"期间汇总遵守决定 B"两条要求。

受影响的 Muse 意图：`sales_overview`（只追加可选参数与附加数据；其余意图不变）。

## Impact

- 新增：`src/lib/sales/period/`（纯函数口径、洞察规则、取数）、`src/app/api/sales/period-summary/route.ts`、`src/components/sales-command-center/sales-period-panel.tsx`。
- 修改：`src/app/(main)/sales/home/page.tsx`（挂面板）、`src/app/(main)/sales/cockpit/page.tsx`（一处标签文案）、`src/lib/muse-bridge/contract.ts` / `sales.ts` / `sales-pure.ts`（`period` 参数与附加数据）。
- 测试：`src/lib/sales/__tests__/period-pure.test.ts`、`period-insights.test.ts`、`period-db.isolated.test.ts`；`muse-bridge-pure.test.ts`、`sales-pure.test.ts`、`sales-db.isolated.test.ts` 增加用例；全部在 `scripts/test-all.sh` 注册。
- 依赖：`authorize(sales.analytics.read)`（PERM-4a 已有）、`resolveOrgTimezone`、`zonedLocalToUtc`（既有）。无新依赖、无 schema 变更、无 cron、无出站。

## Out of scope

- 不改 `src/lib/sales/home/build-home.ts` 既有面板与首页其他组件。
- 不改驾驶舱 `/api/sales/cockpit` 的计算（只改一处标签）；不改首页英雄区"本月已签 / 本月签单"的标签与计算。
- 不改驾驶舱折扣统计（`/api/sales/cockpit/discount-stats`）与会计提成（`loadSalesSummary`）的口径；三处差异写进报告，是否统一另开 change。
- 不改 Muse 销售意图的读范围规则（S1）；合价岗、会计岗在 Muse 与网页的范围差异保持现状。
- 不改报价发送路由对 `sentAt` 的写法（重发邮件会刷新 `sentAt`）。
- 不做 LLM 叙述（KPI-2，独立 change，需 `openspec/config.yaml` 第 7 条例外拍板）。
- 不做日程来源统计的数据源（CAL-1）；本 change 的洞察 I8 / I9 只在 CAL-1 提供数据后才会触发，本次响应 `calendar` 固定为 `null`。
- 不做导出（CSV / PDF）、不做邮件推送、不做微信推送。
- 不改成单的"商机 wonAt"写入逻辑，不回填历史数据。
