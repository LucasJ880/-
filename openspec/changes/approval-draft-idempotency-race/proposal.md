# Proposal：审批草稿并发幂等复用

TASKFLOW：无（基础设施）。来源：跑 `src/lib/tender-rfq/__tests__/followup-auto-db.isolated.test.ts`（「并发两次扫描：只发出一封，只有一条审批记录」）时，本地隔离库 PostgreSQL 16 上每次都打出 `[createDraftBatch] failed: … 25P02`。

## Why

两个调用方带同一组织、同一幂等键同时建审批草稿时，后到的一方本应复用先到的那张卡，实际却得到「创建待确认草稿失败」：唯一键冲突让 PostgreSQL 中止了整个事务，而复用查询仍在这个已中止的事务里执行，必然报 `25P02 current transaction is aborted`。

## What Changes

- 改为：同组织、同幂等键的唯一键冲突发生后，在一个新事务里重跑整批创建；重跑时前置查询找到先到的那张卡并复用，后到的调用方拿到与先到方相同的审批 id，不再报错、不再打错误日志。
- 只把落在「组织 + 幂等键」唯一索引上的冲突当作复用信号；其它错误（别的唯一索引、外键、连接错误等）照旧抛出，调用方照旧收到 `DRAFT_CREATION_FAILED`。
- 重跑次数设上限；超过上限仍冲突时按失败返回，不无限重试。
- 删除事务内那段在已中止事务里再查一次的死代码。
- 新增一份隔离库回归测试：同组织、同幂等键并发调用两次批量建卡，断言两边拿到同一个审批 id、库里只有一行、没有错误日志；在改动前的代码上这份测试失败。
- 新增一份纯逻辑测试（CI 无库也跑）：冲突判定只认「组织 + 幂等键」、重跑有上限、其它错误不重跑。
- 两份测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

不改的行为：批次「全部成功或没有可操作的待审批残留」的语义；事务外统一写 `APPROVAL_CREATED` 审计（复用的卡也照旧写一条）；失败时把已建的卡标为 failed 的补偿；测试注入的「第 N 张之后失败」路径；成功后只标记一次智能体运行等待审批；Muse 审批卡推送（按事件 id 幂等）；不带组织或不带幂等键的草稿每次都新建。

## 受影响的 Muse 意图

- 不改 `src/lib/muse-bridge/**`。所有经审批端口建卡的入口（含 Muse 发起的 `rfq` / `chase` 等草稿）共用这一层，并发时由「后到方失败」变为「后到方复用同一张卡」；意图的响应结构不变。

## Out of scope

- 不改数据库结构：不新增字段、索引或迁移；唯一索引 `PendingAction(orgId, idempotencyKey)` 保持原样。
- 不改审批执行器（`src/lib/pending-actions/executor.ts`）与审批端口（`src/lib/approval/**`）的任何判定；同一张卡被两方同时自动执行时仍由执行器既有的状态抢占保证只执行一次。
- 不改复用时「对复用的卡也写一条 APPROVAL_CREATED 审计、也推一次 Muse 卡」的既有做法。
- 不改调用方（`src/lib/tender-rfq/chase-service.ts` 等）的任何逻辑。
- 不处理其它模块里同类「在事务内吞唯一冲突」的写法；本次只修审批草稿这一处。
- 不新增模型调用、出站动作、审批类型、定时任务、队列。

## Capabilities

### New Capabilities

- `approvals/draft-idempotency`：审批草稿按「组织 + 幂等键」去重——已存在时复用、并发时后到方复用先到方的卡、哪些错误不算复用。

### Modified Capabilities

无。`tender/rfq-followup-preapproval` 的「并发与重试不重复发」场景照旧成立（只发一封、只有一条审批记录），要求文本不变。

## Impact

- 代码：`src/lib/pending-actions/drafts.ts`（默认的事务内批量创建）；新增 `src/lib/pending-actions/draft-idempotency.ts`（冲突判定与有上限的重跑，纯函数，不引数据库）。
- 测试：新增 `src/lib/pending-actions/__tests__/draft-idempotency.test.ts`（纯逻辑）与 `src/lib/pending-actions/__tests__/draft-idempotency-race-db.isolated.test.ts`（隔离库）；`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加两行。
- 调用方：`src/lib/approval/request.ts`（`requestApproval`）、`createDraft` 的全部调用方——都不需要改；并发时后到方从 `DRAFT_CREATION_FAILED` 变为拿到既有审批 id。
- 数据库、接口结构、环境变量、依赖：无变化。
