# Tasks — calendar-watch-attribution（CAL-1）

## 1. 纯函数核心

- [x] 1.1 新建 `src/lib/calendar-watch/types.ts` 与 `pure.ts`：
  - `readCalendarWatch` / `withCalendarWatch` / `validateCalendarWatchInput`，缺省为关闭，通知岗位缺省 `owner` + `ops_lead`；
  - `attributeCalendarEvent`（R1 青砚 → R2 网站 → R3 成员 → R4 不明、别名、分桶）、`diffEvent`、`shouldRecord`；
  - `buildNotification`（三种文案、收件人去重、新建排除创建者本人）、`summarizeCalendarAttribution`（bySource 按 eventId 跨日历去重、byActor、样例只给 org、截断透传）、`toLedgerAfterData`（不含描述，标题截 120 字）。

  写 `src/lib/calendar-watch/__tests__/calendar-watch-pure.test.ts`，覆盖上述每个函数的规则与边界，并在同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过。

## 2. Google 只读增量

- [x] 2.1 在 `src/lib/google-calendar.ts` 新增只读函数 `listCalendarChanges(userId, { calendarId, syncToken?, pageToken? })`，现有函数不动：
  - 用 `singleEvents: false`、`maxResults: 2500`；
  - 返回映射后的变更（id / status / created / updated / creator.email / organizer.email / summary / description / start / end / allDay / htmlLink）与 `nextPageToken` / `nextSyncToken`；
  - 410 抛出可识别的 `GoogleSyncTokenExpiredError`；授权失效沿用 `GoogleTokenExpiredError`。

  映射逻辑抽成纯函数，在 1.1 的纯测试里补用例。verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；纯测试含全天与定时事件、已删除事件的映射用例并通过。

## 3. 执行器与定时任务

- [x] 3.1 新建 `src/lib/calendar-watch/run.ts`，导出 `runCalendarWatch(deps?)`，读取函数可注入：
  - 遍历开启的组织与日历；全量 / 增量与每轮页数预算；410 重置；授权失效当天一次重连通知；
  - 一次准备成员信号（`loadTradeMemberSignals`）、成员邮箱 / 别名映射与本轮涉及事件的预约映射；
  - 写账本（`writeAuditLog`，`userId` = 读取账号）、按岗位找收件人（回落 `Organization.ownerId`）、`createNotification`（`category = calendar_watch`）、回写游标；单个组织出错时记录并继续。

  在 `src/app/api/cron/sales-actions/route.ts` 末尾追加 `runTrackedAutomation("calendar-watch", …)`，前两个步骤不改。verify：typecheck 退出 0；`git diff` 中前两个步骤无改动。

## 4. 接口

- [x] 4.1 新建 `src/app/api/organizations/[orgId]/calendar-watch-settings/route.ts`：
  - `GET` / `PUT` 按 `sales.settings.manage` 授权；
  - `PUT` 校验读取账号已连接、日历在 `listGoogleCalendars` 结果中、邮箱与岗位键合法，错误码为 `READER_NOT_CONNECTED` / `CALENDAR_NOT_ACCESSIBLE` / `INVALID_SETTINGS`；合并写回且不覆盖游标，日历变化时清理或新建游标，并写审计；
  - `GET` 不返回令牌。

  新建 `src/app/api/sales/calendar/attribution/route.ts`：`sales.analytics.read`，期间解析复用 `resolvePeriodParams`，400 `INVALID_PERIOD`，own 范围只给本人一行。verify：typecheck 与 `npx eslint` 对新文件无输出。

## 5. KPI-1 接入与面板

- [x] 5.1 接入 KPI-1：
  - `src/lib/sales/period/types.ts` 的 `PeriodCalendarStats` 加可选 `byActor`；
  - `src/lib/sales/period/load.ts` 在 org 范围且观察开启时调用 `summarizeCalendarAttribution` 填 `calendar`，own 范围保持 `null`；
  - `src/components/sales-command-center/sales-period-panel.tsx` 在 `calendar` 非空时显示"日程来源"一块，为空时不渲染。

  在 `src/lib/sales/__tests__/period-db.isolated.test.ts` 补"开启观察后 `calendar.bySource` 有值且出现 `I9_CAL_WEBSITE_SHARE`、销售范围为 `null`、未开启为 `null`"。verify：该隔离库测试全过；`npm run build` 通过；浏览器打开首页，未开启时无该块、开启后有该块，记录写入报告。

## 6. 端到端

- [x] 6.1 写 `src/lib/calendar-watch/__tests__/calendar-watch-db.isolated.test.ts`，用注入的假读取函数覆盖：
  - 设置接口 403 / 400（两种）/ 200 且 `GET` 无令牌；
  - 首次全量零通知、只记基线起点后的新建；增量新建 / 修改 / 删除的账本、归因与通知收件人（新建不发给创建者本人、修改含"修改人未知"）；
  - 重放幂等；410 重置游标；授权失效当天只通知一次；一个组织抛错不影响另一个；
  - 统计接口 org / own 形态；Google 写接口零调用。

  在同一 task 注册进 `scripts/test-all.sh`。verify：隔离库下 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx …` 全过；无 `DATABASE_URL` 时跳过并退出 0。

## 7. 收口

- [x] 7.1 全量门禁全部通过：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `npm run test:ci`
  - `bash scripts/check-test-registry.sh`
  - `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate calendar-watch-attribution --strict`
  - 隔离库全量 `npm test` 的失败项逐一与 main 对比
  - PR 上 CI `validate-lint-typecheck-test-build` 为绿

  verify：上述命令退出码与输出贴进报告；registry 由当前 main 的数目增加 2；CI 绿。

- [x] 7.2 写 `docs/QINGYAN_CAL-1_REPORT.md`：
  - 做了什么、怎么验、对设计稿 §2 的偏离（D1 挂既有定时任务、D6 授权键、D2 全量不带时间过滤、账本不存描述、别名表、展示只在期间面板）；
  - 已知限制：修改人未知、私人邮箱需别名、基线前创建的日程无 created、上线需真实日历人工验收；
  - 运维上线步骤：`PUT` body 示例与三项前置信息。

  更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 CAL-1 状态列为 `[G]`，并更新 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md`。verify：三个文件在 PR diff 中；TASKFLOW CAL-1 行含 `[G]`。

## Workflow follow-up

- PR 合并后 `/opsx:archive calendar-watch-attribution --yes`（独立小 PR），TASKFLOW CAL-1 → `[x]`，确认 `openspec list --specs` 出现 `calendar/change-attribution`。
- 上线：老板按报告步骤 `PUT` 配置并开启，基线完成后用真实共享日历建 / 改 / 删各一条做人工验收。
