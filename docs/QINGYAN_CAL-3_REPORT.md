# QINGYAN CAL-3 报告 — 日历变更推送到 Muse / 微信（calendar-change-push）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-29 |
| TASKFLOW | CAL-3（Phase K — Sunny 日程归因与期间看板） |
| OpenSpec change | `openspec/changes/calendar-change-push/` |
| 分支 | `claude/magical-shannon-keegzr` |
| 设计稿 / 交接 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §1（第 125 行）；`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` |
| 拍板 | 用户 2026-10-29："不算出站，按照晨报发"（推给本企业员工的微信 / Muse 不建 PendingAction）；"你自己审批，做完通知我" |

## 1. 做了什么

| 部分 | 文件 | 说明 |
|---|---|---|
| 纯函数 | `src/lib/calendar-watch/push-pure.ts` | 渠道选择（Muse 开 + 企业放行 + 已绑定 → Muse）、推送文案（CAL-1 标题 + 来源与规则，邮箱一律替换为 `[邮箱]`）、`calendar.changed` 事件输入 |
| 执行器 | `src/lib/calendar-watch/run.ts` | 发通知前同时查 `calwatch:…` 与 `muse:calwatch:…` 两个键；走 Muse 未发出（信封不成立 / 落库失败）回落站内；新建后推销售域微信（可注入，失败只计数，非生产禁用计跳过）；授权失效提醒当天第一次建时推读取账号微信；结果加 `muse` / `wechatSent` / `wechatFailed` / `wechatSkipped` |
| 契约 | `src/lib/muse-bridge/contract.ts`、`events.ts` | `muse-bridge/v1` 只追加 `calendar.changed`；站内类型映射 `calendar_event`、标题取摘要第一行 |
| 其它 | `src/lib/calendar-watch/pure.ts`、`src/app/api/cron/sales-actions/route.ts` | 只导出 `SOURCE_LABEL`；cron 步骤 `metadata` 带推送汇总 |
| 测试 | `calendar-change-push-pure.test.ts`（test-all + test-ci-unit）、`calendar-change-push-db.isolated.test.ts`（test-all） | 见 §2 |

无 schema、无新 cron / 队列、无 LLM；对 Google 仍只读；CAL-1 收件人、时机、站内文案不变。

## 2. 怎么验

| 检查 | 结果 |
|---|---|
| apply 前基线 | calendar-watch-pure 175、calendar-watch-db.isolated 80、website-booking-intake-pure 62、website-booking-intake-db.isolated 44、Muse 纯测试 / 隔离库测试全过 |
| `npx tsx src/lib/calendar-watch/__tests__/calendar-change-push-pure.test.ts` | 36 通过 0 失败 |
| `calendar-change-push-db.isolated.test.ts`（隔离库 127.0.0.1:5433，注入读取与推送） | 32 通过 0 失败：首次全量零推送；Muse 关全站内 + 每人一推、正文无邮箱；Muse 开 + 已绑定只有 Muse（Bridge 拉得到 `calendar.changed`、无动作）；未放行企业走站内；重放 / 中断重跑 + 渠道切换零新增零推送；推送抛错与返回失败计失败、其它人照推、账本照记；非生产禁用计跳过；超长键与敏感词标题回落站内；两个观察日历每人一条一推；每轮额度；缺省推送接线；授权失效当天一推、不走 Muse |
| 变异检查（临时副本，已还原） | 去双键去重 → 2 项红；去回落 → 1 项红；去安全推送 → 5 项红；去敏感词检查 → 1 项红；去额度 → 1 项红；换回只认完整邮箱的正则 → 纯测试 3 项红 |
| 无 `DATABASE_URL` 跑端到端 | 打印跳过，退出 0 |
| 回归 | CAL-1 175 / 80、CAL-2 62 / 44、`src/lib/muse-bridge/__tests__/*` 10 个文件全过，条数不变 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/check-test-registry.sh` | 通过；已注册 493 |
| `npm run test:ci`（无 `DATABASE_URL`） | 退出 0，`CI unit subset PASS` |
| `openspec validate calendar-change-push --strict` | valid |
| `npm run build` | 缺省堆第一次 V8 堆耗尽（134，与代码无关）；`NODE_OPTIONS=--max-old-space-size=8192` 重跑退出 0 |

## 3. 对设计稿原案的偏离

1. **按绑定选渠道，不是"开关开就一律走 Muse"**：S3 跟进事件是开关开就发 Muse；这里只对已绑定的人走 Muse，未绑定的人继续 `calendar_watch`，CAL-1 的查看口径不因开关变化。
2. **加了微信**：设计稿只提 Muse；用户拍板按晨报口径推员工微信，复用 `pushSalesReminder` 与已有的销售提醒开关和推送域，不新增偏好项。
3. **授权失效提醒只推微信**：不是日程变更，不为它加 Muse 事件类型。

**独立审查后修订**（一个只读审查代理没有看我的结论；逐条核实后修复，纯测试 26 → 36，隔离库 26 → 32）：

4. **截断的邮箱漏网（中）**：账本标题截到 120 字，可能截在邮箱中间（`jo@acmecorp`），只认完整邮箱的正则放过去。改为"本地部分 + @ + 可空域名"一律替换；标题改动的前后值同样覆盖。
5. **推送拖垮 cron（中）**：截止只在页间检查，批量导入 / 删除时逐条同步推送会超过 300 秒被杀（游标不落、运行记录卡住），也会刷屏。加每轮 30 条额度与截止时间，超出计 `wechatCapped`，通知照建。
6. **敏感词让已绑定的人看不到改了什么（中低）**：Muse 摘要命中出站敏感词（如英文标题里的 `margin`）会被整段替换，铃铛里只剩脱敏提示。改为先试构造信封，会被替换就走站内。
7. **并发两轮双发（低）**：Muse 落库撞唯一键返回失败时，回落前再查一次两个键。
8. **事件时间**：Muse 事件的发生时间改为 Google 更新时间。
9. **其它**：汇总与 cron 记录补 `wechatSkipped` / `wechatCapped`；design 补八条纪律与验证方式；tasks 末条改为报告；补测推送返回失败、两个日历、缺省推送接线；spec 写明至多一次推送。

## 4. 已知限制

- **已绑定 Muse 的人站内分类变为 `muse_bridge`**：铃铛与"日程"筛选按类型 `calendar_event`，不受影响；代码里没有按 `calendar_watch` 分类读取的地方。
- **Muse 站内记录不带 CAL-1 元数据**（`kind`、`htmlLink` 等）：点开不跳 Google 事件；Muse 侧只看信封。
- **静默时段内跳过微信、不补发**：站内 / Muse 照常。
- **静默时段按服务器时区判断**：既有推送服务的行为（Vercel 为 UTC），多伦多用户设的 22:00–08:00 实际落在当地 18:00–04:00；本次不改推送服务。
- **每轮最多推 30 条**：批量改动时超出的只在站内 / Muse，不补推、不合并成摘要。
- **老版本 Bridge**：仍按旧事件类型表校验的 Bridge 会拒收 `calendar.changed`；开 Muse 前先升级 Bridge。
- **至多一次**：建好站内记录后、推微信前进程中断，这一条不再补推（不会多推）。
- **推送同步执行**：微信适配器慢时占用 cron 时间；cron 步骤有 240 秒截止。

## 5. 上线步骤

1. 先完成 CAL-1 上线（`docs/QINGYAN_CAL-1_REPORT.md` §5）。
2. 让老板 / 运营主管在青砚绑定微信，确认绑定的"销售提醒"开着、推送域含销售（或全部）。
3. 在 Google 共享日历改一条测试日程的时间，15 分钟内：站内铃铛一条、微信一条，微信正文无邮箱。
4. 需要 Muse 时：先把 Bridge 升级到认 `calendar.changed` 的版本，再在生产设 `MUSE_BRIDGE_ENABLED=1`（可配 `MUSE_BRIDGE_ORG_ALLOWLIST`），在 Muse 绑定该成员；再改一次，Muse 收到 `calendar.changed`，铃铛仍只有一条。

## 6. 全量测试

| 检查 | 结果 |
|---|---|
| `npm test`（隔离库，分支 `e772c021`） | 500/512 通过，12 失败 |
| `npm test`（同一隔离库，main `d1cc92d8` worktree） | 498/510 通过，12 失败 |
| 失败清单对比 | 两边 12 项逐字相同，均为 main 既有：TypeScript 类型检查（test-all 内 OOM，独立 `npm run typecheck` 退出 0）、Phase3A-3 / 3A-4 ×2 / 3A-5 / 3B-A、Gmail Draft OAuth、Mention Gateway M2-A、Sunny 工艺单、T4 授标、报价 PDF、招标询价催单；新增 2 个测试均通过 |
