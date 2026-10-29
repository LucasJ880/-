# Tasks — website-booking-intake（CAL-2）

## 1. 纯函数核心

- [x] 1.1 新建 `src/lib/calendar-watch/intake-pure.ts`：
  - 待转入推导：从账本行、已转入事件 ID 集合、已忽略事件 ID 集合、当地今天与时区算出列表（网站新建、删除、已转入、已忽略、7 天时间窗、跨日历去重、200 条上限、按开始时间排序）；
  - `parseBookingDescription`：HTML 清理、中英文标签行、无标签时的邮箱与北美电话正则、地点回落、姓名不猜；
  - 电话末 10 位比对；
  - 转入请求体校验（客户二选一、预约类型与时间、负责人）。

  写 `src/lib/calendar-watch/__tests__/website-booking-intake-pure.test.ts` 覆盖上述每条规则与 spec 中的纯函数场景，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过。

## 2. 服务

- [x] 2.1 新建 `src/lib/calendar-watch/intake.ts`：
  - `listWebsiteBookings(orgId, now)`；
  - `getWebsiteBookingDetail(params, deps?)`：读取函数可注入，缺省 `getGoogleEventDetail`；
  - `convertWebsiteBooking(params)`：事务 + `pg_advisory_xact_lock`、复查待转入、客户关联 / 新建 / 重复 409、预约记 `googleEventId` 与 `googleSyncedAt`、审计，不调用 `syncAppointmentToGoogle`；
  - `dismissWebsiteBooking(params)`：幂等审计。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；`git diff` 中 `src/lib/calendar-watch/{pure,run,settings,stats,types}.ts`、`src/app/api/sales/customers/route.ts`、`src/app/api/sales/appointments/**`、`src/lib/google-calendar.ts` 无改动（`src/lib/sales/appointment-gcal-sync.ts` 只有 design D6 的一处保护，apply 中据独立审查增加）。

## 3. 接口

- [x] 3.1 新建 `src/app/api/sales/website-bookings/route.ts`（GET 列表）、`[eventId]/route.ts`（GET 详情）、`[eventId]/convert/route.ts`（POST）、`[eventId]/dismiss/route.ts`（POST）：
  - 查看授权：`sales.customer.create` 任意范围或 `sales.customer.read` ORG，否则 403；
  - 转入授权：`sales.customer.create`，否则 403；
  - 错误码：`NOT_PENDING` / `EVENT_NOT_FOUND` / `READER_NOT_CONNECTED` / `ALREADY_CONVERTED` / `CUSTOMER_EXISTS`。

  verify：typecheck 退出 0；`npx eslint` 对新文件无输出。

## 4. 页面

- [x] 4.1 新建 `src/app/(main)/sales/website-bookings/page.tsx`（列表、转入抽屉、忽略、409 时切到关联已有客户、只读成员无按钮），并在销售首页加"网站预约待转入 N 条"入口（待转入数 > 0 才显示）。

  verify：`npm run build` 通过；浏览器检查记录写入报告：无待转入无入口；有待转入时入口与列表出现；销售转入成功；老板无转入按钮。

## 5. 端到端

- [x] 5.1 写 `src/lib/calendar-watch/__tests__/website-booking-intake-db.isolated.test.ts`（注入读取函数），覆盖：
  - 授权：ops_lead 403、owner 只读、rep 可转入；
  - 列表过滤；
  - 详情预填与已有客户提示、`READER_NOT_CONNECTED`、`EVENT_NOT_FOUND`、`NOT_PENDING`；
  - 转入新建 / 关联 / `CUSTOMER_EXISTS` 零写入；
  - 并发一成一 409 且只有一条预约；
  - 忽略幂等；
  - 审计不含联系方式；
  - Google 写接口零调用；
  - 转入后不在列表，CAL-1 下一轮对该事件的修改归因为 R1。

  同一 task 注册进 `scripts/test-all.sh`。verify：隔离库下全过；无 `DATABASE_URL` 时跳过并退出 0；`calendar-watch-pure` 与 `calendar-watch-db.isolated` 仍全过。

## 6. 收口

- [ ] 6.1 全量门禁全部通过：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `npm run test:ci`
  - `bash scripts/check-test-registry.sh`
  - `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 validate website-booking-intake --strict`
  - 隔离库全量 `npm test` 的失败项逐一与 main 对比
  - PR 上 CI `validate-lint-typecheck-test-build` 为绿

  verify：上述命令退出码与输出贴进报告；registry 比当前 main 增加 2；CI 绿。

- [ ] 6.2 写 `docs/QINGYAN_CAL-2_REPORT.md`：
  - 做了什么、怎么验、对设计稿 §2 原案（webhook）的偏离与原因；
  - 已知限制：预填依赖描述格式、转入后同步走负责人写入日历、只提示本人名下重复、忽略不可撤销、老板不能分派；
  - 上线步骤：先开 CAL-1，拿一条真实 book-now 事件核对预填。

  更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：CAL-2 行描述改为本方案、状态 `[G]`，新增 CAL-3 行（Muse / 微信变更推送，`[ ]`）；更新 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md`。verify：三个文件在 PR diff 中；TASKFLOW CAL-2 行含 `[G]`，CAL-3 行存在。

## Workflow follow-up

- PR 合并后 `/opsx:archive website-booking-intake --yes`（独立小 PR），TASKFLOW CAL-2 → `[x]`，确认 `openspec list --specs` 出现 `calendar/website-booking-intake`。
- 上线：CAL-1 开启后，用一条真实 book-now 预约走一遍"打开详情 → 核对预填 → 转入"。
