# Tasks

每条带验证方式；真实输出写进 PR 正文（本 change 没有 TASKFLOW ID，不写报告文件）。隔离库环境变量记作 `ISO_ENV` = `DATABASE_URL=postgresql://…localhost…/qy_isolated DIRECT_URL=同上 NODE_ENV=test DATABASE_ENVIRONMENT=isolated`。

## 1. 复现与回归测试（先写，必须在旧代码上失败）

- [x] 1.1 开工前记基线：`ISO_ENV npx tsx src/lib/tender-rfq/__tests__/followup-auto-db.isolated.test.ts`、`ISO_ENV npx tsx src/lib/pending-actions/__tests__/b2-approval-cas.isolated.test.ts`、`npx tsx src/lib/pending-actions/__tests__/b2-approval-cas-static.test.ts`、`npx tsx src/lib/assistant/__tests__/customer-followup-scenario.test.ts`；verify：记下各自通过数，followup-auto 为 28 passed 且输出里有 1 条 `25P02`
- [x] 1.2 新增 `src/lib/pending-actions/__tests__/draft-idempotency-race-db.isolated.test.ts`（无隔离库跳过、`assertSafeTestDatabase` 守门；覆盖 spec 的先后复用、不带幂等键、两个请求都卡在写入上、一批里只有一张撞上并发、引用的用户不存在），并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在未改的 `drafts.ts` 上 `ISO_ENV npx tsx …draft-idempotency-race-db.isolated.test.ts` 退出码非 0，失败项是并发两条、日志有 `25P02`；`bash scripts/check-test-registry.sh` 通过

## 2. 修复

- [x] 2.1 新增 `src/lib/pending-actions/draft-idempotency.ts`（冲突判定只认 P2002 + 组织 + 幂等键；有上限的整段重跑，最多 3 次，非冲突错误立即抛出）与纯逻辑测试 `src/lib/pending-actions/__tests__/draft-idempotency.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts` 全部通过，`bash scripts/check-test-registry.sh` 通过
- [x] 2.2 改 `src/lib/pending-actions/drafts.ts`：删掉事务内接错再查的那段，默认批量创建改为经 2.1 的重跑包住整个 `$transaction`；审计、补偿、`__failAfterCreateIndex` 路径不动；verify：`ISO_ENV npx tsx …draft-idempotency-race-db.isolated.test.ts` 全部通过；`ISO_ENV npx tsx src/lib/tender-rfq/__tests__/followup-auto-db.isolated.test.ts` 28 passed，`grep -c 25P02` 为 0、没有 `[createDraftBatch] failed`

## 3. 收尾

- [x] 3.1 门禁：1.1 的四份测试按同样方式重跑且通过数不低于基线；另跑 `npx tsx src/lib/cockpit/__tests__/workload.test.ts`、`npx tsx src/lib/cockpit/__tests__/audit-labels.test.ts`、`npx tsx src/lib/runtime-architecture/__tests__/guards-negative.test.ts` 与 `src/lib/workforce-runtime/__tests__/` 下引用 `createDraft` 的测试；`npm run typecheck`；`npm run lint:baseline`；`bash scripts/check-test-registry.sh`；`openspec validate approval-draft-idempotency-race --strict`；verify：全部通过
- [x] 3.2 开 PR 前请一个不带结论的独立审查（只给 `drafts.ts`、`draft-idempotency.ts` 与两份测试，问：后到方能否拿到不属于本组织的卡、批量语义是否被破坏、哪些错误会被误判为复用、重跑是否可能重复建卡或重复执行、测试是否可能在旧代码上也通过）；verify：审查结论与处理写进 PR 正文，确认的问题已修且 3.1 重跑通过

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive approval-draft-idempotency-race --yes`（独立小 PR）。本 change 没有 TASKFLOW ID，archive 时不改 TASKFLOW 状态列。
