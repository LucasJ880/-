# Design — calendar-change-push（CAL-3）

## Context

动机见 proposal.md。现状（2026-10-29 对 main 核对）：

- **CAL-1 通知点**：`src/lib/calendar-watch/run.ts` 的 `processPage`：
  - 对每条应通知的变更（`shouldNotify`）算收件人（`notificationRecipients`）；
  - 按 `notificationSourceKey` = `calwatch:{orgId}:{eventId}:{版本}:{userId}` 先查 `Notification.sourceKey`，已存在就跳过；
  - 否则 `createNotification`（`type = calendar_event`、`category = calendar_watch`、标题 / 摘要来自 `buildNotification`）。
  - 摘要含 `创建者 {邮箱}`（站内可见，见 CAL-1 spec）。
- **授权失效提醒**：`runCalendar` 捕获 `GoogleTokenExpiredError` 时给读取账号发 `calwatch:reconnect:{orgId}:{reader}:{当地日期}` 通知；`createNotification` 按 `sourceKey` 幂等，已存在时返回旧行。
- **Muse 出站**：`emitMuseEvent`（`src/lib/muse-bridge/events.ts`）：
  - 开关 `isMuseBridgeEnabled()` 关时直接返回 `bridge_disabled`；
  - 信封经 `buildMuseEvent` 校验（`eventId` 8–200 字、摘要 ≤ 300 字、`sanitizeOutbound` 脱敏）；
  - 落一条 `Notification`（`category = muse_bridge`、`sourceKey = muse:{eventId}`、`metadata.museEvent`），Bridge 按游标拉取；站内类型由 `notificationTypeFor` 决定，标题由 `titleFor` 决定；
  - 返回 `{ emitted, reason }`，不上抛。
- **Muse 绑定**：`Organization.settingsJson.museBridge.bindings`，`readMuseBindings`（纯函数）；企业放行名单 `isMuseOrgAllowed(orgId)`（名单为空 = 全部放行）。
- **微信推送**：`pushSalesReminder(userId, title, content)`（`src/lib/messaging/push-service.ts`）：
  - 只发给 `status = active`、`pushSales = true`、推送域含 `sales` 或 `all`、不在静默时段的绑定；
  - 非生产环境 `assertSideEffectOrThrow("wechat")` 抛 `NonProdSideEffectDisabledError`；
  - 晨报（`src/lib/secretary/briefing.ts`）直接调用、失败只打日志——用户 2026-10-29 拍板 CAL-3 按晨报同口径发。

## Goals / Non-Goals

**Goals:**
- 收件人、通知时机、通知条数与 CAL-1 一致；只换渠道、加微信。
- 同一变更同一收件人只有一条站内记录、最多一次微信推送；重放与渠道切换都不重发。
- 推送失败不影响 CAL-1 的账本、游标与其它收件人。
- 推送内容不含邮箱。
- 渠道选择与文案是纯函数，表驱动测试。

**Non-Goals:**
- 不改 `src/lib/calendar-watch/{types,settings,stats,intake*}.ts`、`src/lib/messaging/**`、Bridge 拉取接口；`pure.ts` 只把来源中文名 `SOURCE_LABEL` 改为导出（推送正文复用）。
- 不改 CAL-1 站内通知的标题、摘要与元数据。

## Decisions

### D1 渠道：已绑定 Muse 的收件人走 Muse 事件，替代 `calendar_watch` 通知
- 纯函数 `chooseChannel({ museEnabled, orgAllowed, boundUserIds, userId })`：三项都成立 → `muse`，否则 `site`。
- `boundUserIds` 在 `prepareOrg` 里由 `readMuseBindings(settingsJson)` 的 `userId` 集合一次算好。
- 走 Muse 时：`emitMuseEvent({ eventId: CAL-1 sourceKey, type: "calendar.changed", orgId, userId, summary })`。
  - 站内通知类型映射为 `calendar_event`（与 CAL-1 一致，图标与"日程"筛选不变）；
  - 标题取摘要第一行（即 CAL-1 通知标题去掉邮箱）。
- `emitMuseEvent` 返回：
  - `emitted` → 计 Muse 1 条；
  - `duplicate` → 视为已送达，不再发站内、不推微信；
  - 其它（`invalid_envelope`、`persist_failed`、`bridge_disabled`）→ 回落为照旧的 `calendar_watch` 通知。
- 否决：
  - **两条都发**：已绑定的人在铃铛里看到两条一样的提醒。
  - **不看绑定、开关开就一律走 Muse**（S3 跟进事件的做法）：未绑定的人在 Muse 收不到，站内分类却从 `calendar_watch` 变了，CAL-1 的老板 / 运营主管查看口径无故变化；按绑定选更保守。

### D2 去重同时看两个键
- 发之前查 `Notification.sourceKey in [key, "muse:" + key]`，任一存在就跳过（不发、不推、不计数）。
- 覆盖：重放；上一轮走站内、这一轮收件人刚绑定 Muse；上一轮走 Muse、这一轮开关被关。

### D3 微信推送跟在新建之后
- 只有这一次真的新建了站内记录（`calendar_watch` 或 Muse）才推，所以重放不会再推；先建记录再推，进程在两者之间中断时少推一次，不会多推。
- 推送函数可注入：`CalendarWatchDeps.pushWechat`，缺省 `pushSalesReminder`；测试不打真微信。
- 失败处理：
  - 推送函数抛 `NonProdSideEffectDisabledError` → 计"跳过"，不算失败（预发 / 测试环境每轮都会这样）；
  - 其它异常或返回 `failed > 0` → 计失败，继续下一个收件人；
  - 一律不影响账本写入与游标。
- 同步等待推送：推送条数等于新通知条数，每轮很少；`runCalendar` 已有页数与时间预算。

### D4 推送内容
- 纯函数 `pushText(draft, entry)`：
  - 标题 = CAL-1 通知标题；
  - 正文 = `来源：{来源}（{规则}）`，不带 `创建者 {邮箱}`；
  - 标题与正文里任何形如邮箱的串替换为 `[邮箱]`（日程标题可能被人手写进邮箱）。
- Muse 摘要 = `标题\n正文`，再经 `buildMuseEvent` 的 `sanitizeOutbound` 与 300 字截断。
- 授权失效提醒的微信正文用 `reconnectNotification` 原有标题与摘要（本来就不含邮箱）。

### D5 授权失效提醒推微信、不走 Muse
- 先查 `sourceKey` 是否已存在，不存在才新建并推读取账号的微信；当天第二次失败不再推。
- 不走 Muse：这是给读取账号的运维提醒，不是日程变更，`calendar.changed` 语义不符；为它再加事件类型不值得。

### D6 契约只追加
- `MUSE_EVENT_TYPES` 末尾追加 `calendar.changed`；信封其它字段不变；不带 `action`。
- 出站审批：用户拍板推给本企业员工不算出站；Muse 事件无动作，不触发 `config.yaml` 第 2 条。

### D7 运行结果
- `CalendarRunResult` 增加 `muse`、`wechatSent`、`wechatFailed`、`wechatSkipped`；`CalendarWatchRunSummary` 汇总前三项；cron 步骤的 `metadata` 带上汇总。
- 原有 `notified` 口径不变：新建的站内记录条数（含走 Muse 的）。

## Risks / Trade-offs

- **已绑定的人站内分类变为 `muse_bridge`**：按 `calendar_watch` 分类筛的地方会少这些人的条目。代码里没有按该分类读取的地方（`rg calendar_watch src` 只有 CAL-1 写入处）；记入报告。
- **Muse 站内通知丢了 CAL-1 元数据**（`kind`、`htmlLink` 等）：铃铛不使用这些字段；Muse 侧只看信封。
- **事件 ID 过长**：Google 事件 ID 可到 1024 字，`sourceKey` 超过 200 字时 Muse 信封不成立 → 回落站内，测试覆盖。
- **静默时段内的变更不补发微信**：站内 / Muse 仍在；记入已知限制。
- **推送阻塞**：微信适配器慢时占用 cron 时间；每轮新通知很少，且有 240 秒截止，可接受。

## Migration Plan

无 schema、无数据迁移。上线即生效：
- Muse 开关关（生产默认）→ 只多了微信推送；
- 微信没有 `pushSales` 绑定的人 → 无变化。
回滚：revert 本 PR；已发的 Muse 站内记录保留。
