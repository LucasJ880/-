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

（门禁完成后填写）

## 3. 对设计稿原案的偏离

1. **按绑定选渠道，不是"开关开就一律走 Muse"**：S3 跟进事件是开关开就发 Muse；这里只对已绑定的人走 Muse，未绑定的人继续 `calendar_watch`，CAL-1 的查看口径不因开关变化。
2. **加了微信**：设计稿只提 Muse；用户拍板按晨报口径推员工微信，复用 `pushSalesReminder` 与已有的销售提醒开关和推送域，不新增偏好项。
3. **授权失效提醒只推微信**：不是日程变更，不为它加 Muse 事件类型。

## 4. 已知限制

- **已绑定 Muse 的人站内分类变为 `muse_bridge`**：铃铛与"日程"筛选按类型 `calendar_event`，不受影响；代码里没有按 `calendar_watch` 分类读取的地方。
- **Muse 站内记录不带 CAL-1 元数据**（`kind`、`htmlLink` 等）：点开不跳 Google 事件；Muse 侧只看信封。
- **静默时段内跳过微信、不补发**：站内 / Muse 照常。
- **至多一次**：建好站内记录后、推微信前进程中断，这一条不再补推（不会多推）。
- **推送同步执行**：微信适配器慢时占用 cron 时间；cron 步骤有 240 秒截止。

## 5. 上线步骤

1. 先完成 CAL-1 上线（`docs/QINGYAN_CAL-1_REPORT.md` §5）。
2. 让老板 / 运营主管在青砚绑定微信，确认绑定的"销售提醒"开着、推送域含销售（或全部）。
3. 在 Google 共享日历改一条测试日程的时间，15 分钟内：站内铃铛一条、微信一条，微信正文无邮箱。
4. 需要 Muse 时：生产设 `MUSE_BRIDGE_ENABLED=1`（可配 `MUSE_BRIDGE_ORG_ALLOWLIST`），在 Muse 绑定该成员；再改一次，Muse 收到 `calendar.changed`，铃铛仍只有一条。

## 6. 全量测试

（4.1 完成后填写）
