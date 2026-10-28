# QINGYAN S3 报告 — Muse 跟进引擎（muse-sales-followup-loop）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-28 |
| TASKFLOW | S3（Phase S — Sales Pilot） |
| OpenSpec change | `openspec/changes/muse-sales-followup-loop/` |
| 分支 | `feature/muse-sales-followup-loop`（基于 main `d39a8008`，已合入含构建堆修复 #277 的 main） |
| 上位文档 | `LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q3 |

## 1. 做了什么

- `muse-bridge/v1` 只追加：意图 `create_followup`、`update_followup`（默认不开放）；事件 `followup.assigned`、`followup.due`、`followup.overdue`、`followup.updated`；信封可选 `followupId`；错误码 `FOLLOWUP_NOT_FOUND`、`FOLLOWUP_CLOSED`。
- 跟进 = `SalesAction`（`source=category=muse_followup`，`signalKey=activeKey=muse_followup:<requestId>`，`inputContext={workflowId, inquiryTaskId, requestId}`）。`activeKey` 挡并发；结束后 `activeKey` 置空，按 `signalKey` 查重，所以跟进结束后、超过 24 小时账本窗口的重放也不会重复建。
- 权限：管理角色可给本组织有效成员建（缺省商机负责人）；销售只能给自己负责的商机、给自己建（别人的商机按看不到处理）；只有负责人或创建人能更新。完成要证据（`resolutionNote`），搁置要原因；条件更新防并发覆盖。
- 事件：建跟进通知负责人；状态变化通知创建人（Muse 与网页 `PATCH /api/sales/actions/[id]` 两个入口都发，创建人自己改不发）；`inquiry.replied` 的建议动作改为"按回复建跟进"（标题含敏感词时换成通用标题，命令不经过摘要脱敏）。
- 提醒扫描挂在既有 `sales-actions` cron（15 分钟），单独记 `muse-reminder-scan` AutomationRun：24 小时内到期 → `followup.due`（负责人）；逾期 → `followup.overdue`（负责人 + 创建人各一条）；询问过期未回复 → `inquiry.overdue`（发起人 + 收件人各一条）。幂等键 `<事件>:<对象 id>:<期限毫秒>:<收件人>`；只看期限在 30 天内、最多 500 个对象；受总开关与组织白名单约束。
- 事件复合游标：`GET /api/bridge/muse/events` 新增 `cursor` / `nextCursor`（`<ISO>|<通知 id>`，按 `(createdAt, id)` 排序），修复同一毫秒事件落在页缝被跳过；`since` / `nextSince` 不变。
- 链路追溯：请求账本在响应带 `workflowId` 时写 `AuditLog.traceId`（`writeAuditLog` 新增可选 `traceId` 参数，写列，不改 `afterData`）；`reply_inquiry` 响应带回 `workflowId`；`opportunity_status` 新增 `followups`（脱敏同行动标题）。
- 网页：客户页每个商机卡片下的"协作追踪"（点开才拉取 `GET /api/sales/opportunities/[id]/collaboration`），询问 → 回复 → 跟进 → 完成按时间排列；读权限与商机健康度接口同口径。
- 证据导出：`npx tsx scripts/muse-pilot-evidence.ts --workflow <id>`（逻辑在 `src/lib/muse-bridge/evidence.ts`），输出账本（含原话、成败）、询问与回复、跟进与证据、相关事件、提醒扫描运行记录；不含金额字段。

## 2. 怎么验

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/muse-bridge/__tests__/followup-pure.test.ts` | 42 passed |
| `inquiry-pure` / `muse-bridge-pure` / `sales-pure` / `advisory` / `next-step` / `prefs` | 27 / 61 / 73 / 70 / 59 / 30 passed（意图数 16 → 18） |
| `followup-db.isolated.test.ts`（本机隔离库） | 39 passed, 0 failed |
| `inquiry-db.isolated.test.ts` / `sales-db.isolated.test.ts`（回归） | 32 / 27 passed, 0 failed |
| `tsc --noEmit`、`npm run lint:baseline` | 退出 0 / PASS（相对基线减少 14 处 error） |
| `bash scripts/check-test-registry.sh` | OK（已注册 439，基线剩余 72） |

既有的 `src/lib/sales/__tests__/action-loop-contract.test.ts` 在 main 上同样失败（不在注册表、列于历史欠账基线），与本批无关。

## 3. 判断点（请审）

1. **跟进用 SalesAction，类别 `muse_followup`**：避开网页"完成前须设下次跟进时间"那条只针对数字员工提醒的规则；数字员工自动收口只处理 `digital_employee_auto`，不会误关。
2. **升级只一级**（D5）：逾期同时通知负责人和创建人，不做多级链。
3. **复合游标只追加**：旧版 Connector 仍按 `nextSince` 工作；Bridge C3 切到 `nextCursor`。
4. **测试顺序**：纯逻辑测试与隔离库测试是在实现之后写的（未先红）；隔离库测试首跑 39/39 通过。

## 4. 已知限制

- 协作追踪区块与证据脚本没有在浏览器 / 真实数据上跑过；服务层与导出函数由隔离库测试覆盖。
- 扫描单次上限 500 个对象，超过时下一次运行继续（最早期限优先）。
