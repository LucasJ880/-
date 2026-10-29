# Proposal — calendar-change-push（CAL-3：日历变更推送到 Muse / 微信）

TASKFLOW：**CAL-3**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §1 第 125 行留的口子："若要，以 `category=muse_bridge` 事件 `calendar.changed` 接入既有 outbox"；原属 CAL-2，CAL-2 报告 §3 第 4 条拆出）。

## Why

CAL-1 的日历变更通知只进青砚站内铃铛，Sunny 的老板与运营主管要等下次打开青砚才知道 Google 侧有人改了量房、删了安装。员工已在微信与 Muse 收晨报与跟进提醒，用户 2026-10-29 拍板变更通知按晨报口径推给本企业员工（"不算出站，按照晨报发"）。

## What Changes

- 改发 Muse 事件：Muse Bridge 开启、企业在 Muse 放行名单内、且收件人在该企业 Muse 绑定表里时，CAL-1 的变更通知改为一条 `calendar.changed` 事件（同时是一条站内通知，站内类型仍为 `calendar_event`），不再另发 `calendar_watch` 通知。
- 回落站内：信封不成立、摘要会被出站脱敏整段替换、或落库失败时，照旧发 `calendar_watch` 通知。
- 去重：同一变更同一收件人无论走哪个渠道只有一条站内记录；重放、中断后重跑、两个观察日历、两次运行之间绑定 / 解绑 / 开关变化，都不重发。
- 推微信：每新建一条变更通知，用既有销售域微信推送发给该收件人；每轮最多 30 条且不过 cron 截止时间，超出只计数；推送失败只计数，不影响账本、游标与其它收件人。
- 推授权失效提醒：CAL-1 的"Google 授权失效，请重新连接"提醒当天第一次建立时推给读取账号的微信（不走 Muse）。
- 去邮箱：微信正文与 Muse 摘要只含 CAL-1 通知标题与来源说明，任何形如邮箱的串（含被截断的半个邮箱）替换为 `[邮箱]`。
- 追加契约：`muse-bridge/v1` 只追加事件类型 `calendar.changed`，不带动作。
- 扩运行结果：按日历与汇总新增 Muse 条数与微信成功 / 失败 / 跳过 / 超额条数，cron 步骤 `metadata` 带上汇总。

## Capabilities

### New Capabilities
- `calendar/change-push`：CAL-1 变更通知的渠道选择（Muse / 站内）、去重、微信推送、推送内容脱敏与契约追加。

### Modified Capabilities
- 无。CAL-1 `calendar/change-attribution` 的"变更通知"要求（谁收、何时发、同一变更同一收件人一次）不变；绑定 Muse 的收件人收到的 Muse 事件本身也是一条站内通知，仍满足该要求。

受影响的 Muse 意图：无（只新增一个上行事件类型；Bridge 侧拉取接口不变）。

## Impact

- 新增：`src/lib/calendar-watch/push-pure.ts`（渠道选择、Muse 事件输入、推送文案）。
- 修改：`src/lib/calendar-watch/run.ts`（`processPage` 与授权失效提醒处挂钩；推送函数可注入）、`src/lib/calendar-watch/pure.ts`（只导出 `SOURCE_LABEL`）、`src/app/api/cron/sales-actions/route.ts`（步骤 `metadata` 带推送汇总）、`src/lib/muse-bridge/contract.ts`（`MUSE_EVENT_TYPES` 追加）、`src/lib/muse-bridge/events.ts`（新类型的站内通知类型与标题）。
- 依赖：`emitMuseEvent`、`readMuseBindings`、`isMuseBridgeEnabled` / `isMuseOrgAllowed`、`pushSalesReminder`。
- 无 schema、无新 cron / 队列（仍在 `/api/cron/sales-actions` 的 `calendar-watch` 步骤里同步执行）、无 LLM、对 Google 仍只读。

## Out of scope

- 不推给外部客户或任何非本企业成员。
- 不做静默时段延后补发（静默时段内跳过微信，站内 / Muse 照常）。
- 不新增推送开关或偏好项（沿用微信绑定已有的 `pushSales` 与推送域）。
- 不给 Muse 事件带可回复的动作；不改 Bridge 拉取接口。
- 不改 CAL-1 的收件人、通知时机与文案；不改 CAL-2。
- 不改微信推送服务（静默时段按服务器时区判断的既有行为不动，记入报告已知限制）。
- 不做超额时的合并摘要消息、不做补推。
