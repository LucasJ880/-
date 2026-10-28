# Design

## Context

S2 已有询问 Task（`sourceType=muse_inquiry`、`sourceBatchKey=workflowId`、TaskActivity 记问题与回复）与事件 outbox（`Notification`，`sourceKey = muse:<eventId>` 唯一）。`SalesAction` 是既有跟进实体，`canTransitionSalesAction` / `validateSalesActionResolution` 是既有状态规则；网页 PATCH 完成 / 搁置时把 `activeKey` 置空。`sales-actions` cron 每 15 分钟跑一次，只自动收口 `source=digital_employee_auto`。

## Decisions

1. **幂等用两把钥匙。** `activeKey` 唯一约束挡住同一 requestId 的并发创建；但结束后它被置空，所以先按 `source + signalKey` 查重，查到就返回原跟进。两者都是 `muse_followup:<requestId>`。并发撞唯一约束（P2002）时按 signalKey 取回。
2. **`category=muse_followup`。** 避开网页 PATCH 对 `contact` / `record_followup` 类"必须先设下次跟进时间"的限制（那条规则针对数字员工提醒，不适用于人布置的跟进）。
3. **workflowId 沿链传递。** 来自询问的跟进用询问的 workflowId（读询问创建活动里的 `workflowId`），否则 `wf_<requestId>`。账本在响应带 workflowId 时写 `traceId`，证据脚本按它把账本与对象连起来。
4. **提醒扫描是一个纯函数 + 一个薄 IO 层。** `planReminders(rows, now)` 只算"该给谁发哪条"，IO 层查候选对象（期限在 30 天内、最多 500 个）、批量查已存在的 sourceKey、只发缺的。逐条 `emitMuseEvent`，它本身幂等、失败只记日志。只在 `MUSE_BRIDGE_ENABLED` 且组织在白名单时扫描对应组织。
5. **幂等键带期限和收件人。** eventId = `<事件>:<对象 id>:<期限毫秒>:<收件人>`，所以两个收件人各一条、改期限会再提醒一次。`followup.assigned` 的 eventId 用跟进 id；`followup.updated` 用跟进 id + 状态 + 落库时间 + 收件人，同一次变化重复调用只发一次，而网页"退回 open 再开始"这样的第二次变化也会发。状态变化通知操作者之外的一方（负责人改 → 创建人；创建人改 → 负责人）。
6. **复合游标只追加。** 事件路由保留 `since` / `nextSince`，另加 `cursor` / `nextCursor`。查询条件 `createdAt > t OR (createdAt = t AND id > id)`，排序 `[createdAt, id]`。旧版 Connector（只认 `nextSince`）继续工作，C3 切到 `nextCursor`。
7. **网页更新发事件放在事务之后、best-effort。** 与 S2 一样，事件失败不影响业务写入。

## Risks / Trade-offs

- 扫描分"临近到期"与"已逾期"两段各取 500：已提醒过的逾期项每次都会被扫到，分段避免它们挤掉新的提醒；逾期段按期限倒序，刚逾期的先处理。
- `followup.due` 只在"到期前 24 小时内"发；15 分钟的 cron 间隔意味着最多晚 15 分钟。
- 商机详情页区块是只读展示，不在本批做交互。
