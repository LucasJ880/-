# QINGYAN S2 报告 — Muse 跨助理询问与回复（muse-sales-inquiry-loop）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-28 |
| TASKFLOW | S2（Phase S — Sales Pilot） |
| OpenSpec change | `openspec/changes/muse-sales-inquiry-loop/` |
| 分支 | `feature/muse-sales-inquiry`（基于 S1 `feature/muse-sales-read-intents`） |
| 上位文档 | `LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q2 |

## 1. 做了什么

- `muse-bridge/v1` 只追加：意图 `ask_colleague`、`reply_inquiry`（默认不开放）；事件 `inquiry.received`、`inquiry.replied`、`inquiry.overdue`（后者由 S3 发出）；信封可选 `opportunityId`、`inquiryId`；错误码 `INQUIRY_NOT_FOUND`、`INQUIRY_CLOSED`、`OPPORTUNITY_UNASSIGNED`。
- 询问 = `Task`（`sourceType=muse_inquiry`、`sourceId=商机`、`sourceTemplateKey=inq:<requestId>` 唯一即幂等、状态 `waiting_internal`、默认期限 24 小时）；问题、备注、商机记录版本、workflowId 进 `TaskActivity`。
- 回复 = `TaskComment`（作者 = 回复人）+ `TaskActivity`（结构化答案 + 渠道 `muse` / `web`）；条件更新保证只能回复一次。
- 权限：只有管理角色能发起；收件人由服务端取商机负责人（必须是有效成员且不是发起人）；只有收件人能回复；组织归属通过商机判定；不存在、跨组织、非收件人同一口径 `INQUIRY_NOT_FOUND`。
- 事件：创建时向负责人发 `inquiry.received`，回复后向发起人发 `inquiry.replied`；按询问 ID 固定 eventId，只发一次；摘要不含金额并过脱敏器。站内通知 `entityType=muse_inquiry`，点击打开 `/sales/inquiries/<id>`。
- `opportunity_status`：`employeeConfirmations` 列出已回复的询问（回复人、时间、渠道、答案、原问题），新增 `openInquiries`；管理角色在没有未结束询问时，下一步是带查表默认问题的 `ask_colleague`。
- 网页：`GET/POST /api/sales/inquiries/[id]` 与页面 `/sales/inquiries/[id]`，只给负责人或发起人看，只有负责人可提交。

## 2. 怎么验

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/muse-bridge/__tests__/inquiry-pure.test.ts` | 27 passed |
| `muse-bridge-pure` / `sales-pure` / `advisory` / `next-step` / `prefs` | 61 / 73 / 70 / 59 / 30 passed（意图数 14 → 16；状态视图下一步断言随 S2 更新） |
| `inquiry-db.isolated.test.ts`（本机隔离库） | 32 passed, 0 failed |
| `sales-db.isolated.test.ts`（S1 回归） | 27 passed, 0 failed |
| `tsc --noEmit`（6 GB 堆）、`npx eslint src/lib/muse-bridge …`、`npm run lint:baseline` | 退出 0 / 无输出 / PASS |
| `bash scripts/check-test-registry.sh` | OK（已注册 435，基线剩余 72） |

## 3. 判断点（请审）

1. **询问用 Task、不用 SalesAction**：询问回复即结束，跟进是另一种生命周期（S3 用 SalesAction）。
2. **回复只能一次**：后续补充请发新的询问；避免员工确认被悄悄改写。
3. **网页入口是独立页面**，没有改任务看板抽屉，降低冲突面；页面只在本机类型检查通过，未在浏览器里登录验证。

## 4. 已知限制

- `inquiry.overdue` 已定义但本批次不发出；逾期扫描在 S3 挂既有 cron。
- 网页回复页没有做浏览器内端到端验证（需要本机登录态）；服务层由隔离库测试覆盖。
