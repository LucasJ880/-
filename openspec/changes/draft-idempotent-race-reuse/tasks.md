# Tasks：并发建审批草稿时复用已有行（FIX-5）

## 1. 先写测试，证明测得到问题

- [x] 1.1 新增 `src/lib/pending-actions/__tests__/draft-idempotency.test.ts`（纯函数，假事务注入 `createOrReuseDraftRow`：直接插入成功、先查命中、插入撞键后复用、撞键后读不到即抛错、不带企业或不带幂等键走普通插入；源码断言 `defaultCreateAllInTransaction` 经它建行、带键的插入用 `skipDuplicates`）与 `src/lib/pending-actions/__tests__/draft-idempotency-db.isolated.test.ts`（本机隔离库：顺序重复两次；同键并发两次 10 轮；一批两条与一个单条并发；全程拦截 `console.error` 检查没有 `[createDraftBatch] failed`），注册进 `scripts/test-all.sh`，纯函数测试另进 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK；隔离库测试在改动前的代码上跑，并发两个场景失败、顺序重复通过，失败数记进报告

## 2. 修复

- [x] 2.1 在 `src/lib/pending-actions/drafts.ts` 抽出导出的 `createOrReuseDraftRow(tx, input)`：先按 `(orgId, idempotencyKey)` 查已有行（保留现状）；带企业与幂等键时用 `createManyAndReturn({ data: [row], skipDuplicates: true, select })`，返回空即在同一事务里按键读已有行复用，读不到抛错；其余照旧 `create`。`defaultCreateAllInTransaction` 逐条调它，删掉原来 `catch` 里的「复用已有行」分支；verify：`npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts` 全部通过；隔离库测试在改动后连跑三次全部通过、结果相同

## 3. 回归

- [x] 3.1 经建草稿路径的既有隔离库测试在 origin/main 与本分支各跑一遍逐个对比：`tender-rfq/followup-auto-db`、`pending-actions/b2-approval-cas`、`assistant/durable-followup-m1`、workforce `phase2c1-pause-resume` / `phase2c1-expiry-races` / `p0-execution-alignment`、`install/warranty-db`、`install/repair-visit-email-db`、`messaging/wechat-binding-confirm-db`、`approval/audience-db`、`revenue-spine/owner-today-db`、`capabilities/phase3a3-approvals-smoke`；verify：断言结果逐个相同；`followup-auto-db` 的输出里不再有 `[createDraftBatch] failed … 25P02`

## 4. 验收与收尾

- [x] 4.1 开 PR 前请一个不带结论的独立审查（只给 diff 与 spec 增量）并处理其发现；跑全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`；`npm test` 的失败与 origin/main 逐条相同；`npm run typecheck` 退出码 0；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`npx next build --webpack` 通过；`openspec validate draft-idempotent-race-reuse --strict` valid
- [x] 4.2 写 `docs/QINGYAN_FIX-5_REPORT.md` + 更新 TASKFLOW 状态列；verify：报告里每个数字来自本次真实输出（改动前后的隔离库结果、门禁、审查处理）；TASKFLOW 里有 FIX-5 一行，状态 `[G]（PR 待审）`

## Workflow follow-up

- PR 合并后另开小 PR：`/opsx:archive draft-idempotent-race-reuse --yes`，TASKFLOW FIX-5 状态改为 `[x]`。
