# Design — calendar-watch-attribution（CAL-1）

## Context

动机见 proposal.md。现状（2026-10-29 对 main `fd95e90` 核对）：

- **Google 日历接入**：`src/lib/google-calendar.ts`。每人各自授权，令牌加密存 `CalendarProvider`（`getGoogleProvider(userId)`:123、`getAuthedClient`:97，令牌刷新自动回写）。scope 已含 `calendar.readonly`。授权失效有 `GoogleTokenExpiredError`:133 与 `markGoogleProviderDisabled`:171。现有读取 `fetchGoogleEventsRange`:272 是按时间窗实时读穿，没有增量同步。写路径默认日历已由 #308 统一为 `primaryWriteCalendarId`（规格 `calendar/google-write-target`）。
- **Google 增量同步规则**（来自已安装的 `node_modules/googleapis/build/src/apis/calendar/v3.d.ts` 中 `events.list` 参数说明）：
  - `syncToken` 不能与 `timeMin`、`timeMax`、`updatedMin` 等同用；其它参数须与首次全量一致。
  - 令牌失效返回 410 GONE，客户端应清空状态、不带令牌重做全量。
  - 带 `syncToken` 时删除的事件总会返回（`status = cancelled`）。
  - 因此首次全量**不能带时间过滤**，基线起点只能在我们这边按事件 `created` 过滤。
- **预约**：`Appointment.googleEventId` / `googleSyncedAt` / `createdById` / `assignedToId` 存在；没有 orgId，企业归属经 `customer.orgId`。
- **定时任务**：`/api/cron/sales-actions`（`*/15`，`maxDuration = 300`）已依次跑两个 `runTrackedAutomation` 步骤（`sales-action-sync`、S3 挂入的 `muse-reminder-scan`）。
- **成员信号**：`loadTradeMemberSignals(orgId)`（`src/lib/trade/recipients.ts`）一次取全企业在职成员的平台角色、企业角色与有效权限键。纯函数 `deriveEffectivePlatformRole`（`src/lib/rbac/effective-platform-role.ts`）据此派生 boss / sales / operations / trade / user。`loadPositionMode` 在 `src/lib/rbac/permission-keys.ts:22`。
- **零 schema 落点**：
  - `Organization.settingsJson`，读写样式同 `muse-bridge/binding-pure.ts`。
  - `AuditLog`：`userId` 必填，`afterData` 为字符串，`writeAuditLog` 接受任意对象；索引有 `(targetType, targetId)`、`(orgId)`、`(action)`、`(createdAt)`。
  - `Notification`：`createNotification` 按唯一 `sourceKey` 幂等，`src/lib/notifications/create.ts:27`。
- **授权**：
  - `sales.settings.manage` 只绑在窗饰 `owner` 岗位，平台 super_admin 经授权引擎视为持有。
  - `tender-rfq-settings` 用的 `requireOrgRole(org_admin)`（`src/lib/auth/guards.ts:156`）不识别岗位模式。
- **KPI-1 接入点**：
  - `src/lib/sales/period/load.ts:135` 写死 `calendar = null`。
  - 洞察 I8 / I9 已按 `calendar` 参数判断（`src/lib/sales/period/insights.ts`）。
  - 类型 `PeriodCalendarStats` 目前只有 `bySource`。

## Goals / Non-Goals

**Goals:**
- 归因、差异、通知文案、统计全部是纯函数，表驱动测试穷举；执行器只做取数与落库。
- 对 Google 只读；对青砚既有数据只追加审计与通知，不改任何业务表。
- 一处出错不连累其它日历与组织；任何时刻中断都能靠游标与幂等续上。

**Non-Goals:**
- 不改 `fetchGoogleEventsRange`、`pushEventToGoogle`、`updateGoogleEvent`、`deleteGoogleEvent`、`getGoogleEventDetail`、`src/lib/sales/appointment-gcal-sync.ts`。
- 不改 `src/app/api/calendar/**` 与 `src/app/(main)/sales/calendar/**`。
- 不改 `sales-action-sync` 与 `muse-reminder-scan` 两个既有步骤的行为。
- 不改 KPI-1 成单 / 报价口径、`summary-pure.ts` 与洞察阈值；只在 `load.ts` 填 `calendar`、在 `types.ts` 给 `PeriodCalendarStats` 加按成员字段。
- 不碰 `src/lib/muse-bridge/**`。

## Decisions

### D1 挂在既有 `sales-actions` 定时任务里
- 在 `src/app/api/cron/sales-actions/route.ts` 追加第三个 `runTrackedAutomation("calendar-watch", …)`，调用 `runCalendarWatch()`。前两个步骤不变、顺序不变。
- 预算：每个日历每轮最多读 4 页（每页 `maxResults = 2500`），每个组织最多 3 个观察日历。
- 否决：
  - **新建 `/api/cron/calendar-watch` 路由**（设计稿 §2.6 原案）：纪律第 3 条要求"复用既有 cron"。`sales-actions` 节奏同为 15 分钟，S3 已有挂入先例。
  - **Google 推送通道（`events.watch`）**：需要公网回调、7 天续期和通道注册表，等于新增调度设施。

### D2 增量用 `syncToken`，首次全量不带时间过滤
- 游标存于 `settingsJson.calendarWatch.cursor[calendarId]`，字段为 `{ phase: "full" | "incremental", syncToken?, pageToken?, lastRunAt, lastError, baselineFrom }`。
- 全量阶段：不带 `timeMin`，按 `pageToken` 续读；读完最后一页拿到 `nextSyncToken`，转入增量阶段。
- `singleEvents = false`：重复系列计一次，单次例外作为修改出现。
- `showDeleted` 不设（带令牌时删除总会返回）。
- 410 → 清空该日历游标（回到全量）。
- `GoogleTokenExpiredError` → 写 `lastError = "token_expired"`，给读取账号发一条重连通知（`sourceKey` 含当地日期，当天幂等），跳过该日历。
- 读取函数作为依赖注入执行器，便于隔离库测试不打真 Google。
- 否决：
  - **`updatedMin` 轮询**：免去 410 处理，但删除与边界行为在已安装类型说明里没有足够依据，不在设计里押注。
  - **带 `timeMin` 的全量**：与 `syncToken` 规则冲突，后续增量会是未定义行为。

### D3 归因是查表纯函数
- `attributeCalendarEvent(event, ctx)` 按 R1 → R4 取首个命中，返回 `{ source, userId, bucket, rule }`。
- `ctx` 由执行器一次性准备：
  - 本企业预约的 `googleEventId → { appointmentId, createdById, assignedToId, googleSyncedAt }` 映射，只查本轮涉及的事件 ID；
  - 成员邮箱映射，包括 `User.email`、启用的 `CalendarProvider.accountEmail` 与配置别名，全部小写；
  - 网站账号与标记。
- R3 的标记匹配在标题与描述上做，不区分大小写。描述只在这一步使用，不进入账本。
- 分桶：`deriveEffectivePlatformRole` 的 boss → `management`、sales → `sales`、operations → `ops`，其余 → `other`。成员信号来自 `loadTradeMemberSignals` 一次调用。
- 修改类：R1 命中且 `googleSyncedAt` 与事件 `updated` 相差 ≤ 2 分钟时，标 `editedVia: "qingyan"`；否则 `editedVia: null`，通知写"修改人未知"。
- 否决：
  - **用组织角色或平台角色直接分桶**：岗位模式下平台角色已压扁为 user，会全落到 `other`。
  - **为成员加 Google 邮箱字段**：违反零 schema；别名表放在配置里即可。

### D4 账本 = AuditLog，幂等按"事件 + Google 更新时间"
- 每条变更写一条 `writeAuditLog`：
  - `action = "calendar.watch.observed"`，`targetType = "google_calendar_event"`，`targetId = "{calendarId}/{eventId}"`，`orgId`；
  - `userId = readerUserId`，因为该列必填，实际归因人放在 `afterData.attribution.userId`；
  - `afterData` 见设计稿 §2.2 表，去掉 `description`，标题截 120 字。
- 幂等判断：按 `(targetType, targetId)` 取该事件最近一条账本。若其 `googleUpdated` ≥ 本次 `updated`，跳过（不写账本、不发通知）。
  - 第一次见到的事件记为 `created`（若 `status = cancelled` 记为 `cancelled`）；
  - 之后见到的记为 `updated` 或 `cancelled`。
  - `diff` 取上一条账本的 start / end / summary 与本次比较。
- 基线：全量阶段只对 `created ≥ baselineFrom` 的事件写账本（`kind = created`，`baseline: true`），不发通知。
  - `baselineFrom` 缺省为组织当地今天减 60 天，可在配置里改。
  - 全量阶段的其它事件只在内存里过一遍，不写账本；以后它们若被修改，增量会作为 `updated` 记录。
- 否决：
  - **镜像表**：零 schema。
  - **只用 Notification 当账本**：通知会被已读或清理，也不按来源可查。

### D5 通知
- 收件人 = 配置岗位的持有人 ∪ R1 命中预约的 `assignedToId`；新建类去掉归因到的创建者本人。
  - 持有人查询：`principalRoleBinding` 中 `orgId` 匹配、`status = active`、`principalType = HUMAN`、`roleProfile.key ∈ notifyPositions`。
  - 若查不到任何人，回落到 `Organization.ownerId`。
- `createNotification`：`category = "calendar_watch"`，`sourceKey = "calwatch:{orgId}:{calendarId}:{eventId}:{updated}:{userId}"`，`entityType = "google_calendar_event"`，`metadata` 带归因与 `htmlLink`。
- 文案由纯函数生成，时间按组织时区显示：
  - `【网站预约】10/30 14:00–15:00 量房 — Smith（Google 侧新建）`
  - `【日程改动】10/30 量房 14:00 → 16:00（Google 侧改动，修改人未知）`
  - `【日程取消】10/30 量房 — Smith（Google 侧删除）`
- 否决：**给全员发**——噪音太大，判断点 7 已定为 owner + ops_lead 可配置。

### D6 配置接口
- `GET / PUT /api/organizations/[orgId]/calendar-watch-settings`：`authorize(sales.settings.manage)`。岗位模式下 `org_admin` 不再代表管理者，与 PERM-4c 的方向一致。
- `PUT` 只接受用户字段：`enabled`、`readerUserId`、`calendarIds`（1–3 个）、`websiteBookerEmails`、`websiteMarkers`、`memberEmailAliases`（`{ email: userId }`，userId 须为在职成员）、`notifyPositions`、`baselineFromDays`（1–366）。
- 校验：
  - 读取账号的 `CalendarProvider` 已启用；
  - `listGoogleCalendars(readerUserId)` 的结果包含每个 `calendarIds`。
- 校验通过后用纯函数 `withCalendarWatch` 合并写回，保留 `cursor` 与 `settingsJson` 其它键；写 `writeAuditLog(action = "calendar.watch.settings_updated")`。
- `calendarIds` 变化时，移除日历的游标被删除，新增日历从全量开始。
- 否决：**`requireOrgRole(org_admin)`**——不识别岗位模式，Sunny 的老板未必是 `org_admin`。

### D7 统计与 KPI-1 接入
- 纯函数 `summarizeCalendarAttribution(rows, period, scope, names)` 按 `googleCreated ∈ 期间` 统计：
  - `bySource` 只计 `kind = created`；
  - `byActor` 计每人 created / updated / cancelled，`updated` / `cancelled` 只计有归因人的；
  - `unknownSamples` 取最多 10 条，只在 org 范围给出。
- 取数：`auditLog.findMany({ orgId, action, createdAt ≥ period.start })`，上限 20,000 行，超出标 `truncated`。观察总是晚于创建，所以 `createdAt ≥ period.start` 不漏数据。
- 期间参数解析复用 KPI-1 的 `resolvePeriodParams` 与组织时区；400 `INVALID_PERIOD` 的形态与期间汇总一致。
- `GET /api/sales/calendar/attribution`：`resolveSalesScope(user, orgId, "sales.analytics.read")`，own 范围只给本人一行。
- KPI-1：`buildSalesPeriodResponse` 在 org 范围且观察开启时调用同一纯函数，填 `calendar = { bySource, byActor }`，own 范围仍为 `null`。`PeriodCalendarStats` 加可选 `byActor`，I8 / I9 不改。
- 首页期间面板：`calendar` 非空时多一块"日程来源"，显示四类计数与按成员新建数，为空时不渲染。
- 否决：
  - **另做 `/sales/calendar` 侧栏卡**：重复展示，收窄到一处（proposal Out of scope）。
  - **按日程开始时间统计**：问题是"谁这个月放了多少日程"，按创建时间才对。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：配置与游标在 `settingsJson.calendarWatch`，账本在 AuditLog，通知在 Notification |
| 2 | 出站先审批 | 不涉及：只读 Google，只发站内通知，无邮件、无 Muse 动作 |
| 3 | 禁止第三套队列 | 遵守：挂在既有 `sales-actions` 定时任务里（D1），无新 cron、队列、租约或调度器 |
| 4 | 脱敏 | 不涉及 Muse 通道；另行约束账本不存描述、销售范围不返回邮箱（spec"不留存描述与不外泄邮箱"） |
| 5 | 不爬登录页 | 遵守：只用已授权的 Google Calendar API |
| 6 | 邮箱分离 | 不涉及：不用 Gmail，日历读取用配置的读取账号的 `CalendarProvider` |
| 7 | 确定性优先 | 遵守：归因、分桶、通知文案、统计都是查表纯函数，无 LLM |
| 8 | 测试注册 | 遵守：新测试在同一 task 注册进 `scripts/test-all.sh`，纯测试同时进 `scripts/test-ci-unit.sh` |

## Risks / Trade-offs

- **[销售用私人 Google 账号写日历，R2 认不出]** → 配置 `memberEmailAliases`；统计接口给出不明来源样例，洞察 I8 提示补规则。
- **[读取账号离职或撤销授权，观察中断]** → `lastError` 加当天一次的重连通知；`GET` 显示每个日历的上次错误。
- **[首次全量很大（多年日程）]** → 每轮每日历最多 4 页、按页续读；全量阶段不写不相关的旧事件。
- **[`sales-actions` 一轮超时（300 秒）]** → 日历步骤排在最后，有页数预算；中断后游标与幂等保证下一轮续上，不重复记账或通知。
- **[两个日历出现同一事件（邀请）]** → `targetId` 带日历 ID，按日历分别记账；统计时按 `eventId` 跨日历去重计新建，同一事件出现在多个观察日历只计一次。
- **[审计表没有 `(orgId, action, createdAt)` 复合索引]** → 统计按单列索引加 2 万行上限；Sunny 每月日程量在百到千级。若将来变慢再评估，零 schema 下不加索引。
- **[基线之前创建、之后被修改的日程会记为 `updated`，没有对应的 `created`]** → 统计"新建数"只认 `created`，不受影响；报告写明。

## Migration Plan

- 部署后默认关闭（未配置即 `enabled = false`），对现有行为零影响。
- 上线顺序：
  1. 老板调用 `PUT` 配置读取账号与共享日历，开启；
  2. 下一轮 `sales-actions` 开始全量建基线；
  3. 基线完成后转增量，开始发通知。
- 回滚：`PUT { enabled: false }` 即停；revert PR 不留数据问题（账本与通知是只追加记录）。

## 验证方式

- `npx tsx src/lib/calendar-watch/__tests__/calendar-watch-pure.test.ts`：配置缺省与校验、R1–R4 与优先级、别名、分桶、diff、幂等判定、通知文案与收件人去重、统计与截断、账本不含描述。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/calendar-watch/__tests__/calendar-watch-db.isolated.test.ts`：
  - 注入假的 Google 读取函数；
  - 覆盖：设置接口 403 / 400 / 200、基线零通知、增量三种变更、重放幂等、410 重置、授权失效当天一次通知、一个组织出错不影响另一个、统计接口 org / own、Google 写接口零调用。
- `period-db.isolated.test.ts` 补"开启观察后 `calendar` 有值、销售范围为 `null`"。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate calendar-watch-attribution --strict`。
- 上线前用真实共享日历做一次人工验收（建 / 改 / 删各一条，15 分钟内通知到达、账本三条、重跑不增），记入报告。
