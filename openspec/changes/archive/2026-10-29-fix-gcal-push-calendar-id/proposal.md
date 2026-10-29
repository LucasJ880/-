# Proposal: fix-gcal-push-calendar-id

**TASKFLOW：** 无（缺陷修复）。CAL-1（Google 日历变更归因，`docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §2.3 规则 R1、`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` §4 第 ⑰ 项）的前置：R1 依赖 Appointment 带 `googleEventId`。
**受影响的 Muse 意图：** 无。

## Why

`CalendarProvider.calendarId` 存的是逗号分隔的已选日历 ID 列表（`prisma/schema.prisma` 字段注释；读路径 `fetchGoogleEventsRange` 按逗号拆开逐个拉取）。`pushEventToGoogle` 却把整串直接当成一个日历 ID 传给 `calendar.events.insert`：用户勾选了不止一个日历时，`"primary,xxx@group.calendar.google.com"` 不是合法日历 ID，Google 报错，函数吞掉异常、打印 `Google Calendar push error` 并返回 `null`。调用方 `syncAppointmentToGoogle` 于是静默返回 `{ synced: false }`，预约永远拿不到 `googleEventId`，之后的改 / 删同步也随之全部跳过。

另外三个写路径（`updateGoogleEvent` / `deleteGoogleEvent` / `getGoogleEventDetail`）已经用 `provider.calendarId?.split(",")[0] || "primary"`，只有新建这一处漏了；四处各写一份表达式，本身就是这次漂移的原因。

## What Changes

- 新增纯函数 `primaryWriteCalendarId(raw)`（`src/lib/google-calendar-id.ts`）：按逗号拆分、逐项去空格、取第一个非空项；没有非空项时返回 `"primary"`。
- `pushEventToGoogle` 的插入目标改为 `primaryWriteCalendarId(provider.calendarId)`。
- `updateGoogleEvent` / `deleteGoogleEvent` / `getGoogleEventDetail` 的默认目标改为同一个 helper（调用方显式传入的 `opts.calendarId` 仍然优先），四处不再各自拼表达式。
- 新增纯测试 `src/lib/__tests__/google-calendar-write-id.test.ts`，注册进 `scripts/test-all.sh`，并加入 CI 子集 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `calendar/google-write-target`：Google 日历写路径（新建 / 修改 / 删除 / 取单个事件）在调用方未指定日历时，落在用户已选日历列表的第一项。

### Modified Capabilities
- 无。

## Impact

- `src/lib/google-calendar.ts`：4 处目标日历表达式 + 1 行 import。
- `src/lib/google-calendar-id.ts`：新文件，一个纯函数。
- `src/lib/__tests__/google-calendar-write-id.test.ts`：新测试；`scripts/test-all.sh` / `scripts/test-ci-unit.sh` 各加 1 条。
- 行为差异只在两类输入上：①多选日历时新建事件从"必失败"变为写入第一项；②第一项带空格或为空（如 `" primary , b "`、`",b"`）时，修改 / 删除 / 取详情的默认目标从带空格或空串的非法 ID 变为去空格后的第一个非空项（与读路径的拆分规则一致）。单选或未选日历的用户行为不变。

## Out of scope

- 读路径 `fetchGoogleEventsRange` 与日历选择接口 `src/app/api/calendar/google/calendars/route.ts`、日历选择 UI。
- 让用户单独指定"写入哪个日历"（需要新设置项，属于产品决定）。
- 回填历史上同步失败、没有 `googleEventId` 的预约（下一次保存该预约时 `syncAppointmentToGoogle` 会自然补推）。
- `pushEventToGoogle` 吞异常返回 `null` 的错误处理方式；`syncAppointmentToGoogle` 的返回结构。
- Prisma schema（零 schema）。
