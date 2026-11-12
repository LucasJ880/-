# Design

## Context

动机见 proposal.md「Why」。现状（`src/lib/pending-actions/drafts.ts` 的 `defaultCreateAllInTransaction`）：

- 整批草稿在一个交互式事务（`db.$transaction(async (tx) => …)`）里逐条建。带企业与幂等键的条目先按 `(orgId, idempotencyKey)` 查已有行，查到就复用，查不到再 `create`。
- 两个请求同时查不到、同时 `create` 时：先到的插入成功；后到的插入在唯一索引 `@@unique([orgId, idempotencyKey])` 上等先到的提交，然后报唯一冲突。Postgres 此时已把后到者的整个事务标为中止，之后同一事务里的任何语句都报 `25P02 current transaction is aborted`。`catch` 里的「复用已有行」查询因此必然失败，再抛出，整批返回 `DRAFT_CREATION_FAILED`。
- 本机隔离库复现（同一企业、同一键并发两次，10 轮）：10 轮都是一边成功一边失败，库里每个键一行，失败的一边打出 `[createDraftBatch] failed … 25P02`。VIS-1d 跑 `tender-rfq/followup-auto-db` 时多出来的那行日志就是它。
- 约束：零 schema；审批存储只能在 `src/lib/pending-actions/` 与 `src/lib/approval/` 里写（运行时架构守卫 `NEW_APPROVAL_BYPASS_FORBIDDEN`）；事务隔离级别沿用库默认 READ COMMITTED（`drafts.ts` 不设 `isolationLevel`）。

## Goals / Non-Goals

**Goals:**
- 唯一冲突不再中止事务：后到者在同一事务里读出先到者的行并复用（spec「并发请求恰好建一张」）。
- 一批里撞键的那一条复用、其他条目照常建（spec「撞键的条目不连累同一批的其他条目」）。
- 冲突后读不到已有行仍按失败处理（spec「冲突后找不到已有草稿即失败」）。
- 测试在 CI 无库时也有覆盖：建行逻辑可以注入假事务测。

**Non-Goals:**
- 不动 `createDraftBatch` 里事务之后的步骤：审计（`APPROVAL_CREATED`）、`markAgentRunAwaitingApproval`、`notifyMuseApprovalRequested`、失败补偿 `compensateBatchPrepareFailure`。
- 不动 `src/lib/pending-actions/executor.ts`、`src/lib/approval/port.ts`、`src/lib/approval/request.ts`、`src/lib/agent-runtime-v2/adapters.ts`、`src/lib/agent-core/skills/pending-action-bridge.ts`。
- 不动 `scripts/wave15-seed-staging.ts` 等脚本里的直接建行，不动 `src/lib/runtime-architecture/runtime-architecture-baseline.json`。
- 不改 Prisma schema、不加索引。

## Decisions

### D1 冲突时「什么都不做」，而不是让它报错再补救

带企业与幂等键的条目改用 `tx.pendingAction.createManyAndReturn({ data: [row], skipDuplicates: true, select })`，即 `INSERT … ON CONFLICT DO NOTHING RETURNING`。返回一行就是新建的；返回空就是撞键，接着在同一事务里按 `(orgId, idempotencyKey)` 读出已有行复用。事务里没有语句报错，后面的条目照常执行。

`ON CONFLICT DO NOTHING` 遇到别的事务刚插入、还没提交的同键行时，会等那个事务结束：提交了就什么都不做；回滚了就照常插入。接下来的读取语句在 READ COMMITTED 下看得到已提交的行，所以「返回空 → 读得到」在正常并发下总成立。

被否决：
- **SAVEPOINT 包住 `create`**（`$executeRaw` 发 `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`）：Prisma 交互式事务没有保存点 API，要在审批存储里混写原生 SQL；出错时的回滚点管理散在业务代码里，比一条带 `skipDuplicates` 的插入难读难审。
- **在事务外捕获唯一冲突、整批重跑一次**：同一批的其他条目在第一次里建了又回滚、第二次再建，数据库多做一倍的事；还要区分「哪类错误可以重跑」，重跑逻辑本身也要测。
- **`upsert`（`update: {}`）**：Prisma 只在满足条件时生成原生 `ON CONFLICT DO UPDATE`，否则退回「先查再插」，仍可能报唯一冲突；走原生路径时还会改写已有行（`updatedAt` 被刷新），等于修改了别人那张审批。
- **按 `(orgId, idempotencyKey)` 取咨询锁（`pg_advisory_xact_lock`）把同键请求串行化**：要原生 SQL；锁只是让后到者排队，排到之后仍要先查再插，比直接「冲突什么都不做」多一层。

### D2 留着事务开头的「先查已有行」

现有的「先按键查，查到就复用」保留不动。顺序重复请求（最常见的情况）仍在这里命中，不发插入；`ON CONFLICT DO NOTHING` 只兜并发的那一小段窗口。行为与改动前一致，改动面最小。

被否决：
- **删掉先查，全部靠 `ON CONFLICT`**：结果相同，但每次重复请求都多发一条插入语句，且改动了一条与本缺陷无关、现在工作正常的路径。

### D3 把「建或复用一行」抽成可注入事务的函数

在 `drafts.ts` 里抽出 `createOrReuseDraftRow(tx, input)`（导出，供测试用），参数 `tx` 只要求本函数用到的三个方法：`pendingAction.findFirst`、`pendingAction.create`、`pendingAction.createManyAndReturn`。`defaultCreateAllInTransaction` 在事务里逐条调它。纯函数测试注入假事务，覆盖：直接插入成功、先查命中、插入撞键后复用、撞键后读不到即抛错、不带企业或不带幂等键走普通 `create`。

被否决：
- **只写隔离库测试**：CI 没有数据库，隔离库测试在 CI 里跳过，`test:ci` 里就没有任何覆盖。
- **把假事务注入挂到 `createDraftBatch` 的 adapters 上**：adapters 替换的是整个 `createAllInTransaction`，测不到要改的那段逻辑。

### D4 读不到已有行时照旧抛错

插入返回空、按键又读不到时（只可能是别的唯一约束冲突；现在表上另一个唯一约束是主键 `id`，每行新生成），抛出明确的错误。`createDraftBatch` 照现在的路径返回失败并补偿。不静默跳过这一条。

被否决：
- **读不到就当作没有这一条、继续**：调用方拿到的草稿数少于请求数，下游按位置对应输入与输出（审计、Muse 推送都按下标取输入）会错位。

## Risks / Trade-offs

- [`skipDuplicates` 跳过任何唯一约束的冲突，不只 `(orgId, idempotencyKey)`] → 冲突后按键读不到即抛错（D4），不会把别的冲突误当复用；以后表上加唯一约束时，这条路径照样按失败处理。
- [隔离级别被改成 REPEATABLE READ / SERIALIZABLE 时，读取看不到先到者刚提交的行] → `drafts.ts` 不设 `isolationLevel`；隔离库测试在默认级别下跑并发，看得出回归。
- [复用的那张可能是别的批次建的（不同 AgentRun、不同载荷）] → 幂等键的既有语义，本次不改（proposal「Out of scope」）。
- [复用时也会写一条 `APPROVAL_CREATED`、也推一次 Muse] → 与现在「先查命中」的路径相同；Muse 推送按事件 id 幂等。本次不改。

## Migration Plan

- 合并后照常部署。零 schema，无回填、无开关。
- 回滚：回退 `drafts.ts` 即可，库里数据不受影响。

## 与八条硬纪律的关系

1. **零 schema**：不加 model、字段、索引或迁移；用既有的 `@@unique([orgId, idempotencyKey])`。
2. **出站先审批**：不涉及出站本身。只改建草稿；草稿照旧是待批，批准与执行不变。并发重复请求从「一边失败」变为「两边拿到同一张待批卡」，不会多出第二张卡。
3. **禁止第三套队列**：不涉及。不新增队列、调度或注册表。
4. **脱敏**：不涉及。不改任何输出字段。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：不涉及 LLM；零新增模型调用。
8. **测试注册**：新增的纯函数测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；新增的隔离库测试注册进 `scripts/test-all.sh`（无库时跳过、退出码 0）。

## 验证方式

- 纯函数：`npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts`（假事务，覆盖 D3 列的五种情形，另加源码断言：`defaultCreateAllInTransaction` 经 `createOrReuseDraftRow` 建行、带键的插入用 `skipDuplicates`）。
- 隔离库：`npx tsx src/lib/pending-actions/__tests__/draft-idempotency-db.isolated.test.ts`，在本机 Postgres 16 上实跑：
  - 顺序重复两次；
  - 并发两次多轮，每轮两边都成功、同一个 id、库里一行，全程 `console.error` 里没有 `[createDraftBatch] failed`；
  - 一批两条与一个单条并发，批里撞键的复用、新键新建。
  - 同一份测试先在改动前的代码上跑一遍，记下失败数（预期并发场景失败），再在改动后跑。
- 既有隔离库测试（经建草稿路径的）：`tender-rfq/followup-auto-db`（多出的 `25P02` 日志行应消失）、`pending-actions/b2-approval-cas`、`assistant/durable-followup-m1`、workforce `phase2c1-pause-resume` / `phase2c1-expiry-races` / `p0-execution-alignment`、`install/warranty-db`、`install/repair-visit-email-db`、`messaging/wechat-binding-confirm-db`、`approval/audience-db`、`revenue-spine/owner-today-db`、`capabilities/phase3a3-approvals-smoke`，与 origin/main 逐个对比。
- 门禁：`npm run test:ci`、`npm test`（与 origin/main 对比环境类失败）、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`、`openspec validate draft-idempotent-race-reuse --strict`。

## 审核关注点（待拍板）

- **Q1 修法**：推荐 D1（冲突什么都不做，再读已有行）。备选是事务外整批重跑一次。
- **Q2 复用时的审计与推送**：推荐不改（与现在「先查命中」的路径一致：复用也写 `APPROVAL_CREATED`、也推 Muse）。备选是复用的条目不写审计、不推送，但这会同时改变现有的顺序重复路径，超出本缺陷。
