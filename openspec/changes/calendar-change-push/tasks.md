# Tasks — calendar-change-push（CAL-3）

## 1. 纯函数与契约

- [x] 1.1 `src/lib/muse-bridge/contract.ts` 的 `MUSE_EVENT_TYPES` 末尾追加 `calendar.changed`；`src/lib/muse-bridge/events.ts` 的 `notificationTypeFor` 把它映射为 `calendar_event`、`titleFor` 取摘要第一行。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；既有 Muse 纯测试（`src/lib/muse-bridge/__tests__/*-pure.test.ts`）全部通过。

- [x] 1.2 新建 `src/lib/calendar-watch/push-pure.ts`：`chooseChannel`、`pushText`（去创建者邮箱、邮箱串替换为 `[邮箱]`）、`calendarChangedEventInput`（`eventId` = 通知键，不带 `action`）、`museSourceKey`。

  写 `src/lib/calendar-watch/__tests__/calendar-change-push-pure.test.ts`：渠道选择矩阵、文案不含邮箱、信封经 `buildMuseEvent` 通过校验、超长 `eventId` 不成立；同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过。

## 2. 挂钩 CAL-1 执行器

- [x] 2.1 `src/lib/calendar-watch/run.ts`：
  - `CalendarWatchDeps.pushWechat`（缺省 `pushSalesReminder`）；
  - `prepareOrg` 算 Muse 开关、放行与绑定集合；
  - `processPage` 双键去重 → 选渠道 → Muse（`duplicate` 跳过、其它失败回落站内）或站内 → 新建成功后推微信（非生产禁用计跳过、其它失败计失败）；
  - 授权失效提醒新建时推读取账号微信；
  - 运行结果与汇总加 `muse` / `wechatSent` / `wechatFailed` / `wechatSkipped`；cron 步骤 `metadata` 带汇总。

  verify：typecheck 退出 0；`npx eslint` 对改动文件无新错误；CAL-1 回归 `calendar-watch-pure.test.ts` 与 `calendar-watch-db.isolated.test.ts`、CAL-2 两个测试通过且条数不变。

## 3. 端到端

- [x] 3.1 写 `src/lib/calendar-watch/__tests__/calendar-change-push-db.isolated.test.ts`（注入读取与推送函数），覆盖：
  - Muse 关：全部 `calendar_watch`，每位收件人推一次，正文无邮箱；
  - Muse 开 + 老板已绑定：老板只有 `muse_bridge`（类型 `calendar_event`，`listMuseEvents` 拉到 `calendar.changed`），运营主管 `calendar_watch`；
  - 企业不在放行名单 → 站内；
  - 重放：零新增、零推送；
  - 运行之间刚绑定后重放：零新增、零推送；
  - 推送抛错：其它收件人照推，账本照记，失败数 1；非生产禁用错误计跳过；
  - 超长事件 ID 回落站内；
  - 首次全量零推送；
  - 授权失效同一天两次只推一次，且不走 Muse。

  注册进 `scripts/test-all.sh`。verify：隔离库（127.0.0.1:5433）运行退出 0；无 `DATABASE_URL` 时打印跳过退出 0；变异检查（临时）：去掉双键去重 / 去掉回落 → 对应用例变红。

## 4. 门禁与文档

- [ ] 4.1 `npm run lint:baseline`、`npm run test:ci`、`openspec validate calendar-change-push --strict`、`npm run build` 通过；`npm test` 全量与 main 对比无新增失败。
- [ ] 4.2 写 `docs/QINGYAN_CAL-3_REPORT.md`（做了什么、怎么验、偏离、已知限制、上线步骤）；TASKFLOW CAL-3 行标 `[G]`。
- [ ] 4.3 独立只读审查（不给结论），逐条核实并修复；开 PR。

## 5. 归档（合并后，独立小 PR）

- [ ] 5.1 `/opsx:archive calendar-change-push --yes`；TASKFLOW CAL-3 → `[x]`；更新交接文档。
