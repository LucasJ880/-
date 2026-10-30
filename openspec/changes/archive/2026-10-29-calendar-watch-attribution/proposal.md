# Proposal — calendar-watch-attribution（CAL-1：Google 日历变更归因）

TASKFLOW：**CAL-1**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §2）。

## Why

Sunny 的销售与运营直接在 Google 共享日历里新建、改、删日程，网站 book-now 的客户自主预约也写进同一个日历，其他人不知道发生了什么，也没法按账号统计"这个月谁放了多少日程"。青砚目前只把自己建的预约单向推给 Google，从不读回 Google 侧的变化。

## What Changes

- 新增组织级"日历观察"配置（存 `Organization.settingsJson.calendarWatch`）：开关、读取账号、要观察的共享日历、网站预约识别规则、成员邮箱别名、通知收件岗位；新增 `GET / PUT /api/organizations/{orgId}/calendar-watch-settings`，按 `sales.settings.manage` 授权，保存时校验日历确实可被读取账号访问，并写审计。
- 新增增量读取：每 15 分钟（挂在既有 `sales-actions` 定时任务里，不新建 cron）按 Google `syncToken` 拉取观察日历的新增 / 修改 / 删除；令牌过期（410）自动重做全量；读取账号授权失效时记录错误并通知该账号重连。
- 新增确定性归因（查表，按序首个命中）：青砚推送的预约 → 网站预约（指定账号或标题 / 描述标记）→ 成员本人（创建者邮箱或别名命中，并按岗位分销售 / 运营 / 管理）→ 不明。
- 新增账本：每条观察到的变更写一行审计记录（含 Google 时间戳、归因、改了什么），同一事件同一版本只记一次；首次全量只建基线、不发通知。
- 新增站内变更通知：Google 侧新建 / 修改 / 删除日程时，通知配置岗位的持有人与相关预约负责人；修改类明确写"修改人未知"。
- 新增统计接口 `GET /api/sales/calendar/attribution?from&to`：按来源与按成员统计期间内新建 / 修改 / 删除数；按 `sales.analytics.read` 授权，销售只看本人一行。
- 修改 KPI-1 期间汇总：日历观察开启时，全企业范围响应的 `calendar` 字段给出期间日程来源统计（原先固定为 `null`），既有洞察 I8 / I9 随之生效；首页期间面板显示"日程来源"一块。
- 只读 Google：不写、不改、不删任何 Google 日历事件。

## Capabilities

### New Capabilities
- `calendar/change-attribution`：观察 Google 共享日历的变更，确定性归因到青砚 / 成员 / 网站 / 不明，记账本、发站内通知、按来源与成员统计，以及其配置接口。

### Modified Capabilities
- `sales/period-summary`："响应结构"中 `calendar` 字段从固定 `null` 改为"日历观察开启且为全企业范围时给出期间日程来源统计"；新增"看板展示日程来源"要求。

受影响的 Muse 意图：无（不触碰 `muse-bridge`；Muse `sales_overview` 的 `data.period` 不含日程统计）。

## Impact

- 新增：`src/lib/calendar-watch/`（纯函数：配置读写与校验、归因、差异、通知文案、统计；取数与执行器）、`src/app/api/organizations/[orgId]/calendar-watch-settings/route.ts`、`src/app/api/sales/calendar/attribution/route.ts`。
- 修改：`src/lib/google-calendar.ts`（新增只读的增量拉取函数，现有函数不动）、`src/app/api/cron/sales-actions/route.ts`（追加一个受跟踪的自动化步骤）、`src/lib/sales/period/load.ts`（填 `calendar`）、`src/components/sales-command-center/sales-period-panel.tsx`（日程来源一块）。
- 测试：`src/lib/calendar-watch/__tests__/` 纯测试与隔离库端到端，注册进 `scripts/test-all.sh`（纯测试同时进 CI 子集）；`period-db.isolated.test.ts` 补日程字段用例。
- 依赖：读取账号已在青砚连接 Google 日历（`CalendarProvider`，scope 已含 `calendar.readonly`）。无 schema 变更、无新 cron、无新队列、无出站、无 LLM。
- 上线前置（运维，不阻塞开发）：共享日历 ID、读取账号、book-now 写日历的身份或标题标记（设计稿 §6）。

## Out of scope

- 不写 Google（不做双向同步、不回填历史预约的 `googleEventId`）。
- 不做 Muse / 微信推送（CAL-2）；不做网站 book-now 直连青砚 webhook（CAL-2）。
- 不做设置页面：配置走接口（与 `tender-rfq-settings` 一致），运维按交接文档调用。
- 不做 `/sales/calendar` 日历页的侧栏统计卡，不做"按日程开始时间"统计口径：统计只按 Google 事件创建时间，展示只在首页期间面板。
- 不识别"谁修改了日程"：Google 接口不提供最后修改人。
- 不逐实例展开重复日程：一个重复系列计一次。
- 不改 KPI-1 的成单 / 报价口径与其它洞察规则。
