# notif-mark-all-read 报告：通知"全部已读"标记本人全部未读

TASKFLOW：无（基础设施：通知中心缺陷修复）。OpenSpec change：`notif-mark-all-read`（proposal / specs / design / tasks 在 `openspec/changes/notif-mark-all-read/`）。

## 1. 问题

生产上 Cathy 有 93 条未读通知，在小铃铛面板点"全部已读"后，角标仍显示 81。原因：

- 面板一次只拉最新 12 条，"全部已读"只把这 12 条里未读的 id 交给批量接口；
- 角标统计的是本人全部未读。

通知页勾选栏的"全部已读"也只作用于勾选项，按钮名与行为不符。

## 2. 改动

| 位置 | 改动 |
|---|---|
| `src/lib/notifications/service.ts` | 新增 `markAllRead(userId)`：条件更新本人 `unread` → `read`，写 `readAt`，返回条数；已读 / 已完成 / 稍后提醒不动 |
| `src/app/api/notifications/read-all/route.ts`（新） | `POST`：`requireAuth` 取登录用户，不读请求体，返回 `{ ok: true, count }`；未登录 401 |
| `src/components/header.tsx` | 小铃铛"全部已读"改调 `read-all`；按钮按本人未读总数（> 0）显示，不再只看已加载的 12 条 |
| `src/app/(main)/notifications/page.tsx` | 页头新增"全部已读"（本人有未读时显示，调 `read-all` 后刷新列表与未读数）；勾选栏原"全部已读"改名"标为已读"（行为不变） |

零 schema，无新权限键，不碰通知生成、收件人、发送闸门与角标统计口径。

## 3. 测试

- 纯测试 `src/lib/notifications/__tests__/mark-all-read.test.ts`：18/18。
  - 内容：源码断言两处"全部已读"走 `read-all`，小铃铛不再用已加载条目拼 id、不走 batch，勾选栏文字为"标为已读"，接口只认登录身份、不读请求体，服务端条件只更新本人未读。
  - 有效性：把两个前端文件换回 main 的版本后，9 条失败。
  - 注册：已注册进 `test-all.sh` 与 `test-ci-unit.sh`。
- 隔离库测试 `src/lib/notifications/__tests__/mark-all-read-db.isolated.test.ts`：10/10，走真实路由。
  - 内容：未登录 401；本人 15 条未读返回 `count = 15`，未读数为 0，均写了已读时间；已读 / 已完成 / 稍后提醒的状态与时间不变；他人 3 条未读不变（请求体塞他人 `userId` 无效）；角标接口本人为 0、他人为 3；再调一次 `count = 0`。
  - 注册：已注册进 `test-all.sh`。
- 通知模块既有测试 `delivery-gate.test.ts` 改动前后均通过。
- 检查：
  - `npm run typecheck` ✓；
  - `npm run lint:baseline` ✓（无新增 error 指纹）；
  - `npm run test:ci` ✓（CI unit subset PASS，含新纯测试 18/18）；
  - `scripts/check-test-registry.sh` ✓（已注册 486，基线 72 条不增）；
  - `openspec validate notif-mark-all-read --strict` ✓。

## 4. 上线与验证

合并即生效，无数据迁移。

验证：用 Cathy 登录，打开小铃铛点"全部已读"，角标归零；通知页页头"全部已读"同效果，勾选栏按钮显示"标为已读"。

已有的大量未读不用等上线：在 Neon SQL Editor（`production`）执行下面这条，可以先把 Cathy 的未读清零：

```sql
UPDATE "Notification" SET status = 'read', "readAt" = now()
WHERE "userId" = (SELECT id FROM "User" WHERE lower(email) = 'cathy@hlmbedding.com')
  AND status = 'unread';
```

## 5. 全量检查结果（2026-10-29）

- `npm run typecheck`：通过。
- `npm run lint:baseline`：PASS（当前 error 39 / 基线 53，无新增 error 指纹、无计数上升）。
- `npm run test:ci`：CI unit subset PASS；测试注册 486 个、基线 72 条不增。
- `openspec validate notif-mark-all-read --strict`：valid。
