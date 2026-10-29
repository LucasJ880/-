# Proposal — calendar-change-push（CAL-3：日历变更推送到 Muse / 微信）

TASKFLOW：**CAL-3**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §1 第 125 行留的口子："若要，以 `category=muse_bridge` 事件 `calendar.changed` 接入既有 outbox"；原属 CAL-2，CAL-2 报告 §3 第 4 条拆出）。

## Why

CAL-1 的日历变更通知只进青砚站内铃铛。Sunny 的老板与运营主管多数时间不在青砚页面里：Google 侧有人改了量房时间、删了安装，要等下次打开青砚才看到。员工在微信（个人号 / 企业微信绑定）与 Muse 里已经收晨报与跟进提醒，变更通知应走同样的渠道。

用户 2026-10-29 拍板："不算出站，按照晨报发"——推给本企业员工自己的微信与 Muse 不属于"对外发送"，与晨报、跟进提醒同口径直接发，不建 PendingAction。

## What Changes

- CAL-1 每发出一条新的变更通知（新建 / 修改 / 删除），按收件人选渠道：
  - **Muse**：Muse Bridge 开启（`MUSE_BRIDGE_ENABLED`）、企业在 Muse 放行名单内、且收件人在该企业的 Muse 绑定表里 → 改为发 Muse 事件 `calendar.changed`（同时就是一条站内通知，类型仍为 `calendar_event`，分类为 `muse_bridge`），不再另发 `calendar_watch` 通知；
  - **其余**：照旧发 `calendar_watch` 站内通知。
  - Muse 事件不成立（信封校验失败、落库失败、开关关闭）时回落为 `calendar_watch` 通知，不丢。
- 同一变更同一收件人无论走哪个渠道都只有一条；重放、或两次运行之间收件人刚绑定 Muse，都不重发。
- 新通知建好后，再给收件人推一条销售域微信消息（既有 `pushSalesReminder`：绑定启用、`pushSales` 开、域含销售、静默时段跳过）。推送失败只计数，不影响账本、游标与其它收件人。
- CAL-1 的"Google 授权失效，请重新连接"提醒在当天第一次建立时也推给读取账号的微信（不走 Muse）。
- 推送内容（微信正文、Muse 摘要）只有 CAL-1 通知标题与来源说明，不含创建者邮箱或任何邮箱地址。
- `muse-bridge/v1` 契约只追加事件类型 `calendar.changed`，不改其它字段；不带动作（`action`），因此不涉及出站审批。
- 运行结果按日历新增 Muse 条数与微信成功 / 失败条数。

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
