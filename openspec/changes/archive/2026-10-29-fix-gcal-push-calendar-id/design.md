# Design: fix-gcal-push-calendar-id

## Context

- `CalendarProvider.calendarId`（`prisma/schema.prisma`）：`String?`，注释"逗号分隔的已选日历 ID 列表（primary,xxx@group.calendar.google.com,...）"。日历选择接口写入，OAuth 重连时保留。
- 读路径 `fetchGoogleEventsRange`：`(raw || "primary").split(",").map(trim).filter(Boolean)`，空列表回落 `["primary"]`。
- 写路径修复前：
  - `pushEventToGoogle`：`calendarId: provider.calendarId || "primary"`（整串，多选必失败）。
  - `updateGoogleEvent` / `deleteGoogleEvent` / `getGoogleEventDetail`：`opts.calendarId || provider.calendarId?.split(",")[0] || "primary"`（不去空格、不跳空项）。
- 调用方 `syncAppointmentToGoogle`（`src/lib/sales/appointment-gcal-sync.ts`）新建时拿 `pushEventToGoogle` 的返回值写 `Appointment.googleEventId`；返回 `null` 即 `{ synced: false }`，没有任何用户可见提示。

## Goals / Non-Goals

**Goals:**
- 多选日历的用户新建预约能写进 Google，并拿到 `googleEventId`。
- 四个写路径的默认目标日历由同一个纯函数决定，规则与读路径的拆分规则一致。

**Non-Goals:**
- 读路径、日历选择接口与 UI；"写入哪个日历"的独立设置；历史预约回填；错误处理方式。

## Decisions

### D1：抽成独立纯模块 `src/lib/google-calendar-id.ts`
- 做法：一个导出函数 `primaryWriteCalendarId(raw: string | null | undefined): string`，`google-calendar.ts` 四处调用。
- 被否决：直接从 `google-calendar.ts` 导出——测试会连带加载 `googleapis` 与 Prisma Client，纯测试变慢且依赖 `prisma generate`，不适合放进 CI 子集。
- 被否决：只改 `pushEventToGoogle` 一行——另外三处仍各写一份，下次改规则还会漂移。

### D2：取"第一个非空项"，而不是严格的"第一项"
- 做法：拆分 → 去空格 → 取第一个非空项 → 否则 `"primary"`。
- 理由：读路径对同一个字段先 `filter(Boolean)`，写路径跟它保持同一个列表视图；`",b"` 这类输入读路径只拉 `b`，写路径也落到 `b`，而不是落到读路径根本不显示的 `primary`。
- 任务书要求的五个用例（`null` / `""` / `"primary"` / `"a@group…,primary"` / `" primary , b "`）两种取法结果相同。

### D3：调用方显式传入的 `opts.calendarId` 仍优先
- 修改 / 删除 / 取详情的调用方可能拿着事件所在日历的 ID（例如从读路径返回的 `GoogleEvent.calendarId`），那才是事件真正所在的日历；helper 只决定"没指定时"的默认值。

## 八条硬纪律

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及：不改 `prisma/`，只按既有字段注释的语义读取 |
| 2 | 出站先审批 | 不涉及：写 Google 日历是用户本人保存预约时的既有同步，不新增出站动作 |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏 | 不涉及 |
| 5 | 不爬登录页 | 不涉及：用的是用户授权的 Google Calendar API |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 符合：目标日历由纯函数决定，无 LLM |
| 8 | 测试注册 | 直接执行：新测试注册进 `scripts/test-all.sh`，并加入 CI 子集 |

## Risks / Trade-offs

- [多选用户的新事件固定写进列表第一项，未必是用户心里的"主日历"] → 与修改 / 删除早已采用的规则一致；列表顺序由日历选择接口决定。需要可选写入目标时另开 change（需要产品决定）。
- [历史上同步失败的预约仍没有 `googleEventId`] → 下次保存时自然补推；是否批量回填留给 CAL-1 决定。

## 验证方式

- `npx tsx src/lib/__tests__/google-calendar-write-id.test.ts` 全部通过（含四处调用的源码断言）。
- `bash scripts/check-test-registry.sh` 退出 0。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` 退出 0。
- `npx -y @fission-ai/openspec@1.15.0 validate fix-gcal-push-calendar-id --strict` 通过。
