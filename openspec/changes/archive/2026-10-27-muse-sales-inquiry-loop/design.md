# Design

## Context

- S1 已有销售读范围（`resolveSalesScope`）、商机取数与 `opportunity_status`；`employeeConfirmations` 预留为空数组。
- 事件出站：`emitMuseEvent` 把信封写成 `Notification(category=muse_bridge, sourceKey=muse:<eventId>)`，`sourceKey` 唯一即幂等；Bridge 经 `GET /api/bridge/muse/events` 拉取。
- `Task` 有 `assigneeId`、`creatorId`、`dueDate`、`waitingOn`、`sourceType`、`sourceId`、`sourceTemplateKey`（`@@unique([sourceId, sourceTemplateKey])`）、`sourceBatchKey`；`TaskComment(authorId)`、`TaskActivity(actorId, action, detail)`。Task 没有 `orgId`，组织归属通过关联商机的 `orgId` 判定。
- 通知点击在 `src/components/header.tsx` 按 `entityType` 跳转；任务详情是 `/tasks?open=<id>` 的抽屉。

## Goals / Non-Goals

**Goals:** 管理者发问 → 负责人在助理或网页回复 → 发起人收到回复 → 商机状态里看到员工确认；全程幂等、权限由服务端决定、零 schema。

**Non-Goals:**

- `src/app/(main)/tasks/**`、`src/app/api/tasks/**`：不改。
- `src/lib/sales/**`、`src/lib/revenue-spine/**`：只读。
- 逾期扫描与跟进任务：S3。
- `prisma/schema.prisma`：不改。

## Decisions

### D1 询问 = Task，回复 = TaskComment + TaskActivity

- **选择**：复用 `Task`（负责人能在既有任务列表看到）；`sourceTemplateKey=inq:<requestId>` 借既有唯一约束做幂等；结构化问题与答案进 `TaskActivity.detail`（JSON 字符串），人读文本进 `TaskComment.content`。
- **否决 A：写进 `CustomerInteraction`** —— 那是客户互动时间线，员工确认混进去就违背了"CRM 事实与员工确认分开"。
- **否决 B：用 `SalesAction`** —— 它是跟进行动，S3 用；询问和跟进生命周期不同（回复即结束）。

### D2 组织归属通过商机判定

- **选择**：读写询问都先按 `sourceId` 取商机并校验 `orgId = identity.orgId`；不满足即 `INQUIRY_NOT_FOUND`。
- **否决：给 Task 加 orgId** —— 违反零 schema。

### D3 默认问题是规则生成的

- **选择**：`opportunity_status` 给管理者的 `ask_colleague` 下一步带 2–3 条按信号查表生成的问题（客户在等回复 → "客户最近来信说了什么、准备怎么回？"；停滞 → "最近一次和客户联系是什么时候、客户态度如何？"；总有 → "下一步是什么、计划什么时候做？"）。
- **否决：让 LLM 生成问题** —— 违反纪律 7。

### D4 网页回复独立页面

- **选择**：新页面 `/sales/inquiries/[id]` + `GET/POST /api/sales/inquiries/[id]`，服务层与 `reply_inquiry` 共用；通知 `entityType=muse_inquiry` 跳到该页。
- **否决：改任务抽屉** —— 任务看板代码面大、改动方多，冲突风险高；独立页面也能直接从通知进入。

### D5 事件只发一次

- **选择**：`eventId = inquiry.received:<taskId>` / `inquiry.replied:<taskId>`，借 `sourceKey` 唯一约束；回复与事件不在同一事务（`emitMuseEvent` 失败不影响回复成功），与既有出站一致。

## 与八条硬纪律的关系

| #   | 纪律           | 本 change                                                                          |
| --- | -------------- | ---------------------------------------------------------------------------------- |
| 1   | 零 schema      | 遵守：Task / TaskComment / TaskActivity / Notification 均为既有表                  |
| 2   | 出站先审批     | 不涉及对外发送；询问与回复都是内部写，按 PRD 决定 D4 预授权                        |
| 3   | 禁止第三套队列 | 遵守：不加队列与调度；逾期扫描留给 S3 挂既有 cron                                  |
| 4   | 脱敏           | 遵守：事件摘要与回复文本过既有脱敏器；事件摘要不含金额                             |
| 5   | 不爬登录页     | 不涉及                                                                             |
| 6   | 邮箱分离       | 不涉及                                                                             |
| 7   | 确定性优先     | 遵守：默认问题查表生成，无 LLM                                                     |
| 8   | 测试注册       | 遵守：新测试注册进 `scripts/test-all.sh`，纯逻辑同时进 `scripts/test-ci-unit.sh`   |

## 验证方式

- `npx tsx src/lib/muse-bridge/__tests__/inquiry-pure.test.ts`
- 隔离库：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/muse-bridge/__tests__/inquiry-db.isolated.test.ts`
- `tsc --noEmit`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`（main 上既有两条欠账除外）
