# Tasks — calendar-change-push（CAL-3）

## 1. 纯函数与契约

- [x] 1.1 `src/lib/muse-bridge/contract.ts` 的 `MUSE_EVENT_TYPES` 末尾追加 `calendar.changed`；`src/lib/muse-bridge/events.ts` 的 `notificationTypeFor` 把它映射为 `calendar_event`、`titleFor` 取摘要第一行。

  verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0；既有 Muse 纯测试（`src/lib/muse-bridge/__tests__/*-pure.test.ts`）全部通过。

- [x] 1.2 新建 `src/lib/calendar-watch/push-pure.ts`：`chooseChannel`、`pushText`（去创建者邮箱、邮箱串替换为 `[邮箱]`）、`calendarChangedEventInput`（`eventId` = 通知键，不带 `action`）、`museSourceKey`、`museEnvelopeClean`（信封成立且摘要不会被脱敏整段替换）、`occurredAtOf`、`MAX_WECHAT_PUSHES_PER_RUN`。

  写 `src/lib/calendar-watch/__tests__/calendar-change-push-pure.test.ts`：渠道选择矩阵、文案不含邮箱（含截断邮箱与标题改动前后值）、信封经 `buildMuseEvent` 通过校验、超长 `eventId` 与敏感词不走 Muse、事件时间；同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：该测试 `npx tsx …` 退出 0；`bash scripts/check-test-registry.sh` 通过。

## 2. 挂钩 CAL-1 执行器

- [x] 2.1 `src/lib/calendar-watch/run.ts`：
  - `CalendarWatchDeps.pushWechat`（缺省 `pushSalesReminder`）；
  - `prepareOrg` 算 Muse 开关、放行与绑定集合；
  - `processPage` 双键去重 → 选渠道 → Muse（先试构造信封；`duplicate` 跳过；其它失败再查两个键后回落站内）或站内 → 新建成功后推微信（每轮额度 + 截止；非生产禁用计跳过、其它失败计失败）；
  - 授权失效提醒新建时推读取账号微信；
  - 运行结果与汇总加 `muse` / `wechatSent` / `wechatFailed` / `wechatSkipped` / `wechatCapped`；cron 步骤 `metadata` 带汇总。

  verify：typecheck 退出 0；`npx eslint` 对改动文件无新错误；CAL-1 回归 `calendar-watch-pure.test.ts` 与 `calendar-watch-db.isolated.test.ts`、CAL-2 两个测试通过且条数不变。

## 3. 端到端

- [x] 3.1 写 `src/lib/calendar-watch/__tests__/calendar-change-push-db.isolated.test.ts`（注入读取与推送函数），覆盖：
  - 首次全量零推送；
  - Muse 关：全部 `calendar_watch`，每位收件人推一次，正文无邮箱；
  - Muse 开 + 老板已绑定：老板只有 `muse_bridge`（类型 `calendar_event`，`listMuseEvents` 拉到 `calendar.changed`），运营主管 `calendar_watch`；
  - 企业不在放行名单 → 站内；
  - 重放、中断后重跑且渠道切换（Muse 关 / 开）：零新增、零推送；
  - 推送抛错与返回失败：其它收件人照推，账本照记，计失败；非生产禁用错误计跳过；
  - 超长事件 ID、标题含出站敏感词 → 回落站内；
  - 同一事件在两个观察日历：每人一条、一次推送；
  - 每轮额度：超出计超额、通知照建；
  - 缺省推送函数在测试环境计跳过；
  - 授权失效同一天两次只推一次，且不走 Muse。

  注册进 `scripts/test-all.sh`。verify：隔离库（127.0.0.1:5433）运行退出 0；无 `DATABASE_URL` 时打印跳过退出 0；变异检查（临时）：去掉双键去重 / 回落 / 安全推送 / 敏感词检查 / 额度 → 对应用例变红。

## 4. 门禁与审查

- [ ] 4.1 门禁：`npm run lint:baseline`、`npm run test:ci`、`openspec validate calendar-change-push --strict`、`npm run build` 通过；`npm test` 全量与 main 对比无新增失败。verify：各命令退出码与输出贴进报告。
- [ ] 4.2 独立只读审查（不给结论），逐条核实并修复，修复后重跑 4.1 涉及的测试。verify：审查结论与处理写进报告 §3。

## 5. 报告与状态

- [ ] 5.1 写 `docs/QINGYAN_CAL-3_REPORT.md`（做了什么、怎么验、偏离、已知限制、上线步骤、全量对比）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` CAL-3 状态列为 `[G]` + 更新 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md`。verify：三个文件在 PR diff 中；TASKFLOW CAL-3 行含 `[G]`。

## Workflow follow-up

- PR 合并后 `/opsx:archive calendar-change-push --yes`（独立小 PR），TASKFLOW CAL-3 → `[x]`，确认 `openspec list --specs` 出现 `calendar/change-push`。
- 上线：CAL-1 开启后，在 Google 改一条测试日程，核对站内一条、微信一条、正文无邮箱；需要 Muse 时先升级 Bridge 再开 `MUSE_BRIDGE_ENABLED`。
