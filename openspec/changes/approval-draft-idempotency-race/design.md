# Design

## Context

动机见 proposal.md「Why」。现状（`src/lib/pending-actions/drafts.ts` 的默认批量创建）：

- 整批在一个交互式事务里逐张处理：带组织与幂等键的先查已有记录，有就复用；没有就写入。
- 写入抛错时，事务内的 `catch` 再查一次已有记录，想复用并发方建的卡。但在 PostgreSQL 上，唯一冲突一发生整个事务就进入中止状态，这次查询必然报 `25P02`，于是整批失败、打 `[createDraftBatch] failed` 日志，调用方收到 `DRAFT_CREATION_FAILED`。
- 本地隔离库（PostgreSQL 16）上复现：`followup-auto-db.isolated.test.ts` 连跑 3 次，每次都有 1 条 `25P02`（`drafts.ts:210`），测试本身仍全绿，因为后到方失败后不发信。
- 唯一约束只有一个：`PendingAction_orgId_idempotencyKey_key`（`orgId`, `idempotencyKey`）。实测 Prisma 6.19 对它报的错是 `P2002`，`meta = { modelName: "PendingAction", target: ["orgId", "idempotencyKey"] }`，事务内外相同；`$transaction` 回滚后原样抛出这个错误。
- 仓库里已有同类问题的既定做法：`src/lib/agent-runtime/run.ts` 的 `withAgentRunEventSequenceRetry`——唯一冲突后用新事务重跑整段，不在已中止的事务里接着查。
- 默认隔离级别是 READ COMMITTED：唯一冲突只在先到方提交后才报出来，所以新事务里的前置查询一定能看到那张卡。

## Goals / Non-Goals

**Goals:**

- 后到方在新事务里复用先到方的卡，整批语义（全部成功或没有待审批残留）不变。
- 只认「组织 + 幂等键」上的冲突；别的错误一律照旧失败。
- 用一份能在旧代码上稳定失败的隔离库测试锁住这条路径，另用一份纯逻辑测试让 CI（无库）也能覆盖冲突判定与重跑上限。

**Non-Goals:**

- 不改 `createDraftBatch` 的对外签名、返回结构、适配器注入点（`createAllInTransaction` / `auditCreated` / `markAwaitingApproval` / `compensate` / `__failAfterCreateIndex`）。注入了 `createAllInTransaction` 的调用方不经过本次的重跑。
- 不改复用时的审计与推送：复用的卡照旧写一条 `APPROVAL_CREATED`（`batch: true`）、照旧推一次 Muse 审批卡（`emitApprovalRequested` 按事件 id 幂等）；后续失败的补偿照旧会把复用的卡标 failed——这三点与「先后两次建卡」的既有复用路径一致，本次不动。
- 不改 `src/lib/pending-actions/executor.ts`、`src/lib/approval/request.ts`、`src/lib/approval/port.ts`、`src/lib/tender-rfq/chase-service.ts`。
- 不改其它模块里同类「事务内吞唯一冲突」的写法。

## Decisions

### D1：唯一冲突后用新事务重跑整批

事务内的写入不再自己接错；`$transaction` 抛出「组织 + 幂等键」冲突时，在事务外开一个新事务把整批重跑一遍。重跑时那张卡已提交，前置查询直接复用它；同批里其它卡因上一次事务回滚，会重新建一次（只留一条）。

- 否决：在 `$transaction` 外只对出错那一张用 `db` 再查一次。批量里其它已写入的卡随事务回滚了，只补一张会让返回结果和库里对不上；要正确就得重跑整批，等价于 D1。
- 否决：写入前开 `SAVEPOINT`、冲突后 `ROLLBACK TO SAVEPOINT`。要在 Prisma 交互式事务里手写原生 SQL，每次写入多两次往返；仓库已有「重跑整段」的既定做法（`run.ts`），不另起一套。
- 否决：改用 `INSERT … ON CONFLICT DO NOTHING`（`createManyAndReturn` + `skipDuplicates`）。它会吞掉任何唯一冲突、不只幂等键，冲突时也不报是哪个约束，违背 D2。

### D2：冲突判定只认 P2002 + 目标恰为「组织 + 幂等键」

判定为复用信号的条件：错误码 `P2002`，且满足其一——`meta.target` 是恰好由 `orgId`、`idempotencyKey` 组成的字段数组并且 `meta.modelName` 为 `PendingAction`；或 `meta.target` 是约束名 `PendingAction_orgId_idempotencyKey_key`（`meta.modelName` 缺省或为 `PendingAction`）。其它一律不算。字段数组必须带表名，因为 `AgentRunStep`、`ApprovalDecisionIdempotency` 也有同名字段的唯一约束。判定与重跑放在独立的纯函数模块 `src/lib/pending-actions/draft-idempotency.ts`，不引 `@/lib/db`，用鸭子类型读 `code` / `meta`（与 `run.ts` 一致），纯逻辑测试不必连库。

- 否决：任何 `P2002` 都重跑。别的唯一冲突（今后加的约束、别的表经触发器写入）会被误当成复用，重跑后再撞、最终报错时已经丢了第一现场。
- 否决：解析错误消息文本。消息是给人看的，Prisma 版本间会变。
- 否决：判定写在 `drafts.ts` 里导出。`drafts.ts` 顶层引 `@/lib/db`，纯逻辑测试要带上数据库客户端；独立模块更干净。

若将来 Prisma 改了 `meta` 形状，判定返回否，行为退回到改动前的「后到方失败」，不会更糟；隔离库测试会因此失败而被发现。

### D3：最多跑 3 次

首次加最多 2 次重跑。每次「组织 + 幂等键」冲突都意味着那张卡已提交，下一次一定能复用它；只有同一批里另一张卡又恰好撞上并发才会再冲突。3 次之后仍冲突，抛出最后一次的错误，整批按 `DRAFT_CREATION_FAILED` 返回（与改动前同一结果）。

- 否决：不设上限。违背「失败要可见」，也可能在异常数据下空转。
- 否决：按本批带幂等键的张数 + 1 设上限。实际调用方的批大多是 1 张，多出的灵活性没有用处，常数更好测。

### D4：隔离库测试用行锁把两个请求稳定地卡在写入上

`Promise.all` 两次调用、看运气撞上，在本地几乎总是先到方先提交、后到方走前置查询复用，测不到这条路径。测试改为：先在一个单独的事务里对提交人那一行 `User` 加 `FOR UPDATE`；两次建卡都会越过前置查询，先写入的那一方在外键检查上等这把锁，后到方在唯一索引上等先到方；测试在 `pg_stat_activity` 里看到两条写 `PendingAction` 的会话都在等锁后才放锁。看不到就判失败，不放过。

- 否决：注入 `createAllInTransaction` 适配器模拟冲突。这样绕过了真正出错的那段事务代码，测不出 `25P02`。
- 否决：建测试专用触发器拖慢写入。这是对库结构的改动，即使只在测试库也不做。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不加字段、索引、迁移；只依赖已有的唯一约束。
2. 出站先审批：触碰（审批卡的创建）。本次只改「建卡」，不改任何发送或执行入口；并发时两方拿到同一张卡后，若都去自动执行，仍由执行器既有的状态抢占保证只执行一次——`followup-auto-db.isolated.test.ts`「并发两次扫描：只发出一封，只有一条审批记录」继续守这一点。批准前零出站不变。
3. 禁止第三套队列：不涉及。重跑是同一次调用里有上限的同步循环，不落库、不调度、不是队列。
4. 脱敏：不涉及。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不涉及。不增加模型调用。
8. 测试注册：触碰。两份新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过，基线不增。

## 验证方式

- 纯逻辑：`npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts`。
- 隔离库：`DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/pending-actions/__tests__/draft-idempotency-race-db.isolated.test.ts`；在改动前的 `drafts.ts` 上跑同一份测试，必须失败（后到方 `DRAFT_CREATION_FAILED`、日志里有 `25P02`）。
- 复现源：同样环境变量跑 `followup-auto-db.isolated.test.ts`，28 项全过，输出里没有 `25P02`、没有 `[createDraftBatch] failed`。
- 读到 `drafts.ts` 的既有测试全部重跑：`b2-approval-cas-static`、`b2-approval-cas.isolated`、`customer-followup-scenario`、`cockpit/workload`、`cockpit/audit-labels`、`runtime-architecture/guards-negative`，以及 `workforce-runtime` 下引用 `createDraft` 的测试。
- `npm run typecheck`；`npm run lint:baseline`；`bash scripts/check-test-registry.sh`；`openspec validate approval-draft-idempotency-race --strict`。

## Risks / Trade-offs

- [后到方从「失败退出」变成「拿到同一张卡继续往下走」，调用方的后续逻辑（如催单的自动执行）会对同一张卡再跑一遍] → 这与「先后两次建卡」的既有复用路径是同一处理；执行器的状态抢占保证只执行一次，`followup-auto-db` 断言只发一封。
- [复用的卡被后到方再写一条 `APPROVAL_CREATED` 审计、再推一次 Muse 卡] → 与既有复用路径一致（见 Non-Goals）；Muse 推送按事件 id 幂等。
- [重跑会把同批里已写入的其它卡回滚后重建一次，多花一次事务] → 只在真的撞上并发时发生；批量通常 1 张。
- [Prisma 升级后 `meta.target` 形状变化，判定失效] → 退回改动前的行为；纯逻辑测试固定了判定规则，隔离库测试会在真实库上失败报警。
- [独立审查指出（既有问题，本次不改）：复用方若在建卡之后的审计或「标记智能体运行等待审批」上抛错，补偿会把复用到的那张卡——先到方的卡——标成 failed，而先到方已被告知成功。改动前只有「先后两次建卡」能走到这里；改动后并发的后到方也能走到] → 默认审计（`logAudit` 内部吞错）不会抛；`markAwaitingApproval` 只在带智能体运行 id 时调用。返回结果里没有「这张是复用的」标记，要区分需改 `CreatedDraftAction` 的形状与补偿规则，属于另一个 change；本次按任务要求保持补偿不变。
- [独立审查的三处小问题（既有，本次不改）] → 两批多幂等键按相反顺序并发会死锁（40P01，不重跑，现有多张一批的调用方都不带幂等键）；后到方等先到方超过 5 秒会得到事务超时 P2028（不重跑）；幂等键为空字符串时跳过前置查询却仍写入空字符串，冲突时现在会白跑 3 次再失败（结果与改动前相同；`requestApproval` 已拒绝空幂等键）。
