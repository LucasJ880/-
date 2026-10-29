# Design

## Context

- 通知存在 `Notification` 表，按 `userId` 归属，状态有 `unread / read / done / snoozed / archived`。
- 未读角标来自 `GET /api/notifications/unread-count`：先同步提醒 / 审计 / 低分评估生成的通知，再数本人 `unread`（偏好"只看高优先级"时只数高优先级）。
- 小铃铛面板（`src/components/header.tsx` 的 `NotificationPanel`）拉 `GET /api/notifications?pageSize=12&status=active`；"全部已读"把这 12 条里未读的 id 交给 `POST /api/notifications/batch`（`mark_read`）。角标与按钮的作用范围不一致，见 proposal.md 的 Why。
- 通知页（`src/app/(main)/notifications/page.tsx`）每页 20 条；勾选后的批量栏里有"全部已读 / 全部完成 / 稍后提醒"，三者都只作用于勾选项。
- 单条已读 `PATCH /api/notifications/[id]/read` 与批量 `POST /api/notifications/batch` 都已存在，都用 `requireAuth` 取登录用户并以 `userId` 限定范围。

## Goals / Non-Goals

**Goals:**
- 一次请求把本人全部未读标为已读，小铃铛与通知页共用。
- 通知页按钮名与实际作用范围一致。

**Non-Goals:**
- `src/lib/notifications/create.ts`、`src/lib/trade/inquiry-sla.ts`、`src/lib/notifications/delivery-gate.ts`：通知生成、收件人与发送闸门不改。
- `getUnreadCount` 的统计口径、`listNotifications` 的分页与筛选、`POST /api/notifications/batch` 的入参与行为不改。
- 通知页"全部完成""稍后提醒"两个勾选批量按钮不改。
- 不处理生产上已存在的未读数据（需要时用 SQL 单独处理）。

## Decisions

1. **新接口 `POST /api/notifications/read-all`，不扩展 batch。**
   - 被否决：给 `batch` 加 `scope: "all_unread"`（`ids` 可省）。那样 batch 的入参校验变成两套，"ids 不能为空"的现有 400 要加例外，调用方传错参数时更难发现。
   - 被否决：前端循环翻页收集全部未读 id 再调 batch。请求数随未读数增长，且翻页期间有新通知到达时仍会漏标。
2. **服务端一条条件更新：`userId = 登录用户 AND status = 'unread'` → `status = 'read'`, `readAt = now()`，返回受影响条数。**
   - 被否决：按偏好（只看高优先级）只标高优先级。用户点的是"全部已读"，隐藏的低优先级未读留着会在关闭偏好后重新冒出来，违背按钮含义；角标在两种口径下都会归零。
   - 被否决：同时把 `snoozed` 改成已读。稍后提醒是用户主动推迟，到期回到未读是既有约定，不应被"全部已读"吞掉。
3. **用户 id 只来自 `requireAuth` 的登录身份；接口不读请求体。** 与单条、批量接口同一做法；请求体里的任何字段都被忽略（spec 有对应场景）。
4. **通知页：页头新增"全部已读"，勾选栏原按钮改名"标为已读"。** 页面加载时读一次未读数决定是否显示页头按钮，操作后刷新列表和未读数。
   - 被否决：保留勾选栏"全部已读"名称、只改它的行为为全量。勾选后点按钮却作用于未勾选的通知，比现在更让人误解。
5. **测试分两层。**
   - 隔离库测试走真实路由：建用户、建各状态通知、带会话 cookie 调 `read-all`，断言条数、状态、他人不受影响、401；做法与 `src/lib/rbac/__tests__/platform-admin-scope-db.isolated.test.ts` 相同（`createSession` 签会话 cookie）。
   - 纯测试读源码：小铃铛与通知页的"全部已读"调用 `/api/notifications/read-all`，小铃铛不再用 `unreadItems.map` 拼 id 发 batch；路由用 `requireAuth` 且不读请求体。
   - 被否决：只写纯测试。条件更新的范围（他人、其他状态）只有真实库能证明。

## 硬纪律

1. 零 schema：只用 `Notification` 既有的 `status`、`readAt` 字段；无 model、字段、迁移。
2. 出站先审批：不涉及（站内状态更新，无对外发送）。
3. 禁止第三套队列：不涉及（同步请求内一条更新，无 scheduler / queue / worker）。
4. 脱敏：不涉及（不输出任何业务金额或报价；响应只有条数）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及（不碰 EmailProvider 与发件设置）。
7. 确定性优先：遵守——纯条件更新，无 LLM 调用。
8. 测试注册：两个新测试文件注册进 `scripts/test-all.sh`；纯测试同时进 `scripts/test-ci-unit.sh`；`scripts/check-test-registry.sh` 通过，基线文件不新增条目。

## Risks / Trade-offs

- [点完后刚好有新通知到达，角标显示 1] → 预期行为：只标点击时已存在的未读；spec 写明"除非期间有新通知到达"。
- [未读很多时一次更新的行数大] → 单表按 `userId`、`status` 条件更新；生产单人未读量级在百条，`Notification` 已有 `(userId, status)` 索引。
- [通知页按钮改名，用户习惯变化] → 只改勾选栏一个按钮的文字，行为不变；页头新增按钮承担"全部"的含义。

## 验证

- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`。
- 纯测试：`npx tsx src/lib/notifications/__tests__/mark-all-read.test.ts`。
- 隔离库测试：`DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/notifications/__tests__/mark-all-read-db.isolated.test.ts`。
- `openspec validate notif-mark-all-read --strict`。

## Migration Plan

- 合并即生效，无数据迁移。回滚：回退本 PR 即恢复旧按钮行为，数据不受影响（已标的已读不回退）。
