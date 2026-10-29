# Design — website-booking-intake（CAL-2）

## Context

动机见 proposal.md。现状（2026-10-29 对 main `1c39c9be` 核对）：

- **CAL-1 已交付**：每条观察到的日历变更写一行 AuditLog（`action = calendar.watch.observed`，`targetType = google_calendar_event`，`targetId = {calendarId}/{eventId}`，`afterData` 为 `LedgerAfterData`）。
  - `afterData` 含 `kind`、`attribution.source`、标题（截 120 字）、起止时间、`baseline` 等，不含描述。
  - 配置在 `Organization.settingsJson.calendarWatch`，含读取账号 `readerUserId` 与观察日历；解析函数 `readCalendarWatch`（`src/lib/calendar-watch/pure.ts`）。
- **读取单个事件**：`getGoogleEventDetail(userId, { eventId, calendarId })`（`src/lib/google-calendar.ts:549`）只读，返回标题、起止、地点、描述、`htmlLink`；授权失效抛 `GoogleTokenExpiredError`，其它错误返回 `null`。
- **新建客户**：`POST /api/sales/customers`。
  - 授权：`resolveSalesAuthorizedWhere(user, orgId, "sales.customer.create")`。
  - 查重：只在调用者本人名下按电话比对（路由内局部的 `normalizePhone` 只保留数字）；重复返回 409 `customer_exists`。
  - 另有 `src/lib/revenue-spine/normalize.ts` 的 `normalizePhone` 取末 10 位，能容下 +1 前缀。
- **新建预约**：`POST /api/sales/appointments` 建好后异步 `syncAppointmentToGoogle`，即推一个新的 Google 事件。
  - 预约修改 / 取消 / 删除（`src/app/api/sales/appointments/[id]/route.ts`）也会调用同步：用负责人连接的"写入日历"（`primaryWriteCalendarId`）改 / 删该 `googleEventId`。
- **Sunny 岗位权限**（2026-10-29 在隔离库用授权引擎实测）：
  - `sales.customer.create`：`sales_rep` = PRINCIPAL，`owner` / `ops_lead` / `pricing_lead` = 无；
  - `sales.customer.read`：`owner` / `pricing_lead` = ORG，`sales_rep` = PRINCIPAL，`ops_lead` = 无。
  - 用户选定"销售认领"。
- **并发控制先例**：`pg_advisory_xact_lock(hashtext(key))`（`src/lib/sunny-process/autogen.ts:198`、`src/lib/pending-actions/exec-install-warranty-email.ts:128`）。
- **网站插件**：未知。本会话访问 `sunnyshutter.ca` 被代理拒绝（403），描述格式也就未知，所以预填规则写成通用规则，最终以人工确认的表单为准。

## Goals / Non-Goals

**Goals:**
- 不依赖网站插件：只用 CAL-1 账本与 Google 只读接口。
- 每条转入都经销售确认；同一事件只转入一次，并发安全。
- 描述与联系方式不进账本、不进审计、不进列表；只在销售打开详情时实时读取，提交后进入客户记录。
- 推导、解析、校验全是纯函数，表驱动测试。

**Non-Goals:**
- 不改 `src/lib/calendar-watch/{pure,run,settings,stats,types}.ts` 的观察、归因与统计行为。
- 不改 `src/app/api/sales/customers/route.ts`、`src/app/api/sales/appointments/**`、`src/lib/google-calendar.ts`。
- `src/lib/sales/appointment-gcal-sync.ts` 只加一处保护（D6，apply 中据独立审查增加）：网站预约转入的预约跳过同步与解除同步，其余预约行为不变。
- 不改 `src/lib/authorization/role-defaults.ts` 与任何岗位权限。
- 不碰 `src/lib/muse-bridge/**`、微信推送。

## Decisions

### D1 待转入 = CAL-1 账本推导，不另建状态
- 待转入、已删除、已转入、已忽略都由现有数据推导：
  - 网站新建：账本中该事件按 `createdAt` 最早一条的 `kind = created` 且 `attribution.source = website`；
  - 已删除：该事件最近一条账本 `kind = cancelled`；
  - 已转入：本企业（经 `customer.orgId`）有预约的 `googleEventId` 等于该事件 ID；
  - 已忽略：存在审计 `calendar.website_booking.dismissed`，`targetId = eventId`。
- 时间窗：开始时间不早于组织当地今天前 7 天（全天事件按日期比较）；最多 200 条，按开始时间升序。
- 跨日历去重：同一事件 ID 只列一条，取最近一条账本的日历 ID。
- 取数分两步（apply 中据独立审查修订，原案按全部账本取前 2 万行会截掉最新的行）：
  1. 只取 `createdAt ≥ 时间窗起点 − 366 天` 且 `afterData` 含 `"kind":"created"` 与 `"source":"website"` 的账本行，得到候选事件；
  2. 再取这些事件的全部账本行判断最近是否删除。
  - 列表最多 200 条；单个事件的详情、转入、忽略判断不受 200 条上限影响。
- 否决：
  - **在 settingsJson 里存待转入清单**：会与账本双写不一致，且清单会无限增长。
  - **新建表**：零 schema。

### D2 详情实时读取，预填用通用规则
- 详情接口用 `readCalendarWatch(settingsJson).readerUserId` 调 `getGoogleEventDetail(reader, { eventId, calendarId })`；读取函数可注入，测试不打真 Google。
- 预填纯函数 `parseBookingDescription(description, location, summary)`：
  - 标签行，不区分大小写，分隔符为 `:` 或 `：`：姓名（name / full name / customer / 姓名 / 客户）、电话（phone / tel / mobile / cell / 电话 / 手机）、邮箱（email / e-mail / 邮箱）、地址（address / location / 地址）；
  - 没有标签时：第一个邮箱正则命中作邮箱；第一个北美电话（10 位，可带 +1、括号、空格、横线、点）作电话；
  - 地址缺失时用事件地点；
  - 姓名缺失时不猜（标题格式未知），留空让销售填。
  - 描述里的 HTML 标签与实体先去掉再解析。Google 描述常含 `<br>`。
- 已有客户提示：调用者本人名下（`createdById = 调用者`）、未归档、电话末 10 位相同的客户，最多 3 个；用 `revenue-spine/normalize.ts` 的 `normalizePhone`。网站表单常带 +1，只保留数字的比对会漏。
- 否决：
  - **用 LLM 解析描述**：违反第 7 条；格式未知时模型也会猜错，人工表单兜底更可靠。
  - **把描述存进账本供列表展示**：CAL-1 已明确不存描述。

### D3 转入：一个事务、按事件加锁、不推 Google
- 授权：`authorize(sales.customer.create)` 任意范围。客户 `createdById = 调用者`，预约 `createdById = 调用者`，`assignedToId` 缺省为调用者，指定时须为本企业在职成员。
- 待转入判断在事务外做（读账本较重，放在事务里会占两个连接且拉长事务）；事务（超时 15 秒、等待 10 秒）内按顺序执行：
  1. `pg_advisory_xact_lock(hashtext('website-booking:' + orgId + ':' + eventId))`；
  2. 锁下复查已转入 → 409 `ALREADY_CONVERTED`（不在待转入时事务外已返回 404 `NOT_PENDING` 或 409）；
  3. 客户：关联时须是调用者名下未归档客户，否则 404；新建时先按电话末 10 位查调用者名下重复，命中 → 409 `CUSTOMER_EXISTS`；否则新建（`source = "website_booking"`，邮箱与地址可选）；
  4. 预约：`type` 缺省 `measure`，`googleEventId = eventId`，`googleSyncedAt = now`，起止取请求体（须带时区），请求体缺省取事件；全天事件的 `endAt` 取最后一天（Google `end.date` 不含，青砚全天预约推送时会再加一天）；
  5. 审计 `calendar.website_booking.converted`（`targetType = google_calendar_event`，`targetId = eventId`，`afterData = { calendarId, customerId, appointmentId, linkedExisting }`）。
- 不调用 `syncAppointmentToGoogle`：事件已在共享日历里，再推就会重复。
- 转入的客户落在调用者名下，商机不自动建，与现有"新建预约"接口一致：预约可不挂商机。
- 否决：
  - **复用 `POST /api/sales/appointments`**：它会推一个新 Google 事件，造成重复。
  - **不记 `googleEventId`**：无法防重复转入，CAL-1 也无法把后续变更归到这条预约。
  - **自动转入**：描述格式未知，自动建客户会造出脏数据；用户要的是"不用手抄"，不是"无人确认"。

### D6 转入的预约以 Google 为准（apply 中据独立审查增加）
- 既有同步在预约修改（非取消）时用青砚模板覆盖 Google 事件的标题与描述，取消 / 删除时删掉 Google 事件并清空 `googleEventId`（删除用的是操作人的写入日历）。对网站预约，这会抹掉客户填写的原文、把共享日历里的预约删掉，清空 ID 后还会让该事件重新出现在待转入列表、被二次转入。
- 做法：`appointment-gcal-sync` 的同步与解除同步先查是否存在 `calendar.website_booking.converted` 审计（`targetId = googleEventId`），存在则跳过（同步返回 `skipped: "website_booking"`，解除同步返回成功且不清 ID）。覆盖所有调用方（预约修改 / 删除接口、手动同步接口、智能体工具）。
- 代价：在青砚改这类预约的时间不会同步到 Google；以 Google 为准，Google 侧的修改由 CAL-1 通知。
- 否决：
  - **转入时不记 `googleEventId`**：既有同步会把它当成新预约再推一个事件，共享日历里出现重复。
  - **只在文档里提示"写入日历不要选共享日历"**：无法强制，误配一次就丢数据。

### D4 忽略写审计
- `calendar.website_booking.dismissed`：`targetId = eventId`，`afterData = { calendarId, reason }`，原因 ≤ 200 字。
- 重复忽略：查到已有审计直接返回 200，不重复写。
- 不提供"撤销忽略"：误忽略的事件仍在 Google 里，销售可走现有手工新建。报告写明。
- 否决：**删除账本行**：账本是只追加的观察记录，不能为界面状态改它。

### D5 页面与首页入口
- `/sales/website-bookings`：
  - 列表：标题、日期时间；
  - 有转入权时每行有"转入"与"忽略"；转入打开抽屉，先请求详情（显示描述原文与预填），销售确认或修改后提交；
  - 409 `CUSTOMER_EXISTS` 时切到"关联已有客户"。
- 首页：在现有销售首页加一个只在待转入数 > 0 时出现的入口条，链到该页面；数据来自列表接口的条数。
- 否决：**放进 `/sales/calendar` 侧栏**：日历页组件多且没有表单抽屉的先例，首页入口加独立页面改动面更小。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：客户与预约用既有模型与字段（`Appointment.googleEventId` / `googleSyncedAt`）；忽略与转入记在 AuditLog |
| 2 | 出站先审批 | 不涉及：不发邮件、不发 Muse 消息、不写 Google；只在青砚内建客户与预约 |
| 3 | 禁止第三套队列 | 遵守：同步接口；并发用事务级 advisory lock（既有先例），不是队列或租约 |
| 4 | 脱敏 | 不涉及 Muse 通道；另行约束列表与审计不含联系方式（spec"不留存与不外泄联系方式"） |
| 5 | 不爬登录页 | 遵守：只用已授权的 Google Calendar API；不访问网站 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：推导、解析、校验都是规则；无 LLM；是否转入由人决定 |
| 8 | 测试注册 | 遵守：纯测试进 test-all + test-ci-unit，隔离库测试进 test-all，同一 task 注册 |

## Risks / Trade-offs

- **[描述格式未知，预填可能是空的]** → 表单可编辑；地点与时间一定能带出；上线验收时拿一条真实 book-now 事件核对规则，必要时另开小 change 加格式专用规则。
- **[转入后在青砚改预约]** → D6：这类预约不回写 Google，以 Google 为准；在青砚改时间只改青砚记录，需要改约时在 Google 里改（CAL-1 会通知）。报告写明。
- **[两个销售抢同一条]** → 事务内加锁并复查，后到者 409；页面提示"已被同事转入"。
- **[老板想分派]** → 本 change 不做（用户选定销售认领）；需要时另开 change 给老板岗位加新建客户权限。
- **[只提示本人名下重复]** → 其他销售名下的同一客户不会提示（与新建客户接口一致，不跨人泄露客户）；报告写明。

## Migration Plan

- 部署即可用，但只在 CAL-1 日历观察开启后才有数据；未开启时页面显示"未开启日历观察"、首页不显示入口。
- 回滚：revert PR；已转入的客户与预约是正常业务数据，保留。

## 验证方式

- `npx tsx src/lib/calendar-watch/__tests__/website-booking-intake-pure.test.ts`：
  - 待转入推导（网站 / 非网站、删除、已转入、已忽略、时间窗、跨日历去重、条数上限、排序）；
  - 描述解析（标签中英文、HTML 清理、无标签正则、+1 / 括号 / 点号电话、地点回落、姓名不猜）；
  - 电话末 10 位比对；
  - 转入请求体校验。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/calendar-watch/__tests__/website-booking-intake-db.isolated.test.ts`（注入读取函数）：
  - 授权：ops_lead 403、owner 只读、rep 可转入；
  - 列表过滤；详情预填与已有客户提示、`READER_NOT_CONNECTED`、`EVENT_NOT_FOUND`、`NOT_PENDING`；
  - 转入新建 / 关联 / `CUSTOMER_EXISTS` 零写入；
  - 并发两请求一成一 409 且只有一条预约；
  - 忽略幂等；审计不含联系方式；
  - Google 写接口零调用（源码断言 + 注入）；
  - 转入后该事件不在列表。
- 回归：`calendar-watch-pure`、`calendar-watch-db.isolated`（CAL-1 行为不变）。
- 门禁：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `npm run test:ci`
  - `bash scripts/check-test-registry.sh`
  - `openspec validate website-booking-intake --strict`
  - `npm run build`
- 浏览器：无待转入时首页无入口；有待转入时入口与列表出现；销售打开表单看到预填并转入成功；老板看到列表但无转入按钮。
