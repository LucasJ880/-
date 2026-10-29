# Tasks

## 1. 服务端

- [ ] 1.1 `src/lib/notifications/service.ts` 新增 `markAllRead(userId)`：条件更新本人 `unread` → `read` 并写 `readAt`，返回条数；verify：`npm run typecheck` 通过
- [ ] 1.2 新增 `src/app/api/notifications/read-all/route.ts`（`POST`，`requireAuth` 取用户，不读请求体，返回 `{ ok: true, count }`）；verify：`npm run typecheck` 通过，3.2 隔离库测试覆盖 200 / 401

## 2. 前端

- [ ] 2.1 `src/components/header.tsx` 小铃铛"全部已读"改调 `POST /api/notifications/read-all`，完成后刷新列表与角标；按钮显示条件改为本人仍有未读（角标数 > 0），不再只看已加载的 12 条；verify：3.1 纯测试源码断言通过
- [ ] 2.2 `src/app/(main)/notifications/page.tsx`：页头新增"全部已读"（读未读数，> 0 时显示，调同一接口后刷新列表与未读数）；勾选栏原"全部已读"改名"标为已读"；verify：3.1 纯测试源码断言通过

## 3. 测试

- [ ] 3.1 新增纯测试 `src/lib/notifications/__tests__/mark-all-read.test.ts`：源码断言两处"全部已读"调用 `/api/notifications/read-all`、小铃铛不再用已加载条目拼 id 发 batch、勾选栏文字为"标为已读"、路由用 `requireAuth` 且不读请求体；注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/notifications/__tests__/mark-all-read.test.ts` 全过、`bash scripts/check-test-registry.sh` 通过
- [ ] 3.2 新增隔离库测试 `src/lib/notifications/__tests__/mark-all-read-db.isolated.test.ts`（真实路由 + 会话 cookie）：本人 15 条未读 → `count = 15`、未读数 0、`readAt` 已写；已读 / 已完成 / 稍后提醒不变；他人未读不变；请求体塞他人 `userId` 无效；再调一次 `count = 0`；未登录 401；注册进 `scripts/test-all.sh`；verify：隔离库命令全过

## 4. 收尾

- [ ] 4.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate notif-mark-all-read --strict`，写 `docs/QINGYAN_NOTIF-MARK-ALL-READ_REPORT.md`（改动、测试结果、生产验证步骤）；verify：以上命令全绿，报告文件存在

## Workflow follow-up

- 开 PR（一个 change = 一个 PR），合并后 `/opsx:archive notif-mark-all-read --yes`（独立小 PR，specs 增量合入 `openspec/specs/notifications/read-state/`）。
- 合并后生产验证：用 Cathy 登录，小铃铛点"全部已读"，角标归零。
