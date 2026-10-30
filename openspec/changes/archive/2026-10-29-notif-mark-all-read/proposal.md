# Proposal：通知"全部已读"标记本人全部未读

TASKFLOW：无（基础设施：通知中心缺陷修复）

## Why

右上角小铃铛的数字统计本人全部未读，但"全部已读"只把面板里加载的 12 条标成已读，生产上 Cathy 93 条未读点完仍剩 81 条；通知页的"全部已读"也只作用于当前勾选项，按钮名与行为不符。

## What Changes

- 新增服务端操作：把当前登录用户名下全部未读通知（`status = 'unread'`）标为已读，返回标记条数；不看分页、不看筛选、不碰别人的通知，不改已读 / 已完成 / 稍后提醒的通知。
- 新增接口 `POST /api/notifications/read-all`：只认登录身份，用户 id 不从请求体取。
- 小铃铛面板"全部已读"改调该接口：点完角标归零，面板刷新。
- 通知页：
  - 页头新增"全部已读"按钮，只在本人还有未读时显示，调用同一接口；
  - 勾选栏里原"全部已读"改名"标为已读"（仍只作用于勾选项，行为不变）。
- 补测试：
  - 隔离库测试：本人未读全部变已读、条数正确、其他状态与他人通知不变、未登录 401；
  - 纯测试：源码断言两处"全部已读"调用新接口、不再用面板已加载的 id 列表；
  - 两个测试在 `scripts/test-all.sh` 注册，纯测试同时进 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities

- `notifications/read-state`：站内通知已读状态——单条已读、勾选批量已读、本人全部已读三种操作的范围，以及未读角标与"全部已读"的一致性。

### Modified Capabilities

（无）

## Impact

- 代码：
  - `src/lib/notifications/service.ts`：新增 `markAllRead(userId)`；
  - `src/app/api/notifications/read-all/route.ts`：新增；
  - `src/components/header.tsx`：小铃铛面板；
  - `src/app/(main)/notifications/page.tsx`：通知页。
- 测试：
  - `src/lib/notifications/__tests__/mark-all-read-db.isolated.test.ts`；
  - `src/lib/notifications/__tests__/mark-all-read.test.ts`。
- 零 schema；无新权限键；不碰 muse-bridge；不新增 LLM 调用、队列或出站动作。

## Out of scope

- 不改通知生成规则：询盘提醒 / 升级的频率与收件人不动。
- 不改未读角标的统计口径（仍为本人全部未读，"只看高优先级"偏好下只计高优先级）。
- 不做"全部完成""全部稍后提醒"的全量版；勾选栏这两个按钮行为不变。
- 不清理生产上已有的未读通知（需要时另给 SQL）。
