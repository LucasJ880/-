# Tasks

## 1. 写路径目标日历

- [x] 1.1 新建 `src/lib/google-calendar-id.ts`，导出纯函数 `primaryWriteCalendarId(raw)`：逗号拆分 → 去空格 → 第一个非空项，否则 `"primary"`。verify：`npx tsx src/lib/__tests__/google-calendar-write-id.test.ts` 中取值用例通过。
- [x] 1.2 `src/lib/google-calendar.ts`：`pushEventToGoogle` 插入目标改为 `primaryWriteCalendarId(provider.calendarId)`；`updateGoogleEvent` / `deleteGoogleEvent` / `getGoogleEventDetail` 默认目标改为 `opts.calendarId || primaryWriteCalendarId(provider.calendarId)`；读路径 `fetchGoogleEventsRange` 不动。verify：`grep -c "primaryWriteCalendarId(provider.calendarId)" src/lib/google-calendar.ts` 输出 4；`grep -n 'calendarId: provider.calendarId ||' src/lib/google-calendar.ts` 无输出。

## 2. 测试

- [x] 2.1 新建 `src/lib/__tests__/google-calendar-write-id.test.ts`：`null` / `undefined` / `""` / `" , ,"` → `"primary"`；`"primary"` → `"primary"`；`"a@group.calendar.google.com,primary"` → `"a@group.calendar.google.com"`；`" primary , b "` → `"primary"`；`",b@group.calendar.google.com"` → `"b@group.calendar.google.com"`；源码断言四处写路径都调用 helper。verify：单文件运行退出 0。
- [x] 2.2 注册：`scripts/test-all.sh` 在"通用对话日历工具权限"之后追加 1 条 `run_test`；`scripts/test-ci-unit.sh` 在 R1 架构守卫之前追加 1 行。verify：`bash scripts/check-test-registry.sh` 退出 0。

## 3. 收尾

- [x] 3.1 回归与规格校验。verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci` 均退出 0；`npx -y @fission-ai/openspec@1.15.0 validate fix-gcal-push-calendar-id --strict` 通过。

## Workflow follow-up

- PR 合并到 main 后再 `/opsx:archive fix-gcal-push-calendar-id --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `calendar/google-write-target`。
