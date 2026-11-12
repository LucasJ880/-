# Proposal

TASKFLOW：FIX-5（Phase F 续；来源：`docs/QINGYAN_VIS-1d_REPORT.md` §9 的最后一条）

## Why

同一企业、同一幂等键的两次建审批草稿并发到达时，后到的那次在事务里撞上唯一约束，Postgres 随即中止整个事务，`drafts.ts` 里「复用已有行」的分支必然报 `25P02`，调用方收到「创建待确认草稿失败」。本机隔离库上并发 10 对，10 对都是一边成功、一边失败（库里各只有一行），所以这条分支从来没有成功过。

## What Changes

- 改 `src/lib/pending-actions/drafts.ts` 的事务内建行：带企业与幂等键的草稿改用「插入，遇唯一冲突什么都不做」（`createManyAndReturn` + `skipDuplicates`，即 `INSERT … ON CONFLICT DO NOTHING RETURNING`）。没插进去就在同一事务里按企业与幂等键读出已有行并复用。事务不再因唯一冲突中止。
- 冲突后仍读不到已有行时（理论上只有别的唯一约束冲突），照旧抛错，整批失败、补偿，与现在相同。
- 不带幂等键或不带企业的草稿照旧普通插入，行为不变。
- 并发的后到者拿到与先到者相同的审批 id，`createDraftBatch` 返回成功；同一批里其他条目照常创建，不再被这一条连累回滚。
- 新增纯函数测试（假事务注入，覆盖插入成功、冲突后复用、冲突后读不到即抛错、不带幂等键照旧插入），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 新增隔离库测试：同一键并发多轮，两边都成功、id 相同、库里一行、不打 `[createDraftBatch] failed`；一批两条里一条与并发请求撞键、另一条是新键时整批成功。注册进 `scripts/test-all.sh`。
- 写报告 `docs/QINGYAN_FIX-5_REPORT.md`，TASKFLOW 加 FIX-5 一行。

## Capabilities

### New Capabilities
- `approvals/draft-idempotency`：待审批草稿按「企业 + 幂等键」只建一张；重复请求与并发请求都复用已有的那张并按成功返回。

### Modified Capabilities

（无）

## Impact

- 代码：只改 `src/lib/pending-actions/drafts.ts` 的 `defaultCreateAllInTransaction`。`createDraftBatch` / `createDraft` 的签名与返回形状不变。
- 受益的调用方（都经 `createDraftBatch`，都带幂等键）：审批端口 `requestApproval`（`src/lib/approval/request.ts`，审批的规范入口，幂等键必填）、`src/lib/agent-runtime-v2/adapters.ts`、`src/lib/agent-core/skills/pending-action-bridge.ts`。典型的并发来源是网页上连点两次提交审批、两次扫描同时为同一封催单建卡。
- 数据库：零 schema。用的是既有的 `@@unique([orgId, idempotencyKey])`；`skipDuplicates` 在项目里已有先例（通知建行）。
- 运行时架构守卫：写入仍在 `src/lib/pending-actions/` 里（规范的审批存储所有者），不新增绕行。
- 出站：不涉及。只改建草稿；批准、执行与出站不变。
- Muse：不新增或改变意图。审批卡推送照旧经 `drafts.ts` 的挂钩（按事件 id 幂等）。

## Out of scope

- 复用已有草稿时也写一条 `APPROVAL_CREATED` 审计、也调一次标记 AgentRun 待审批、也推一次 Muse 审批卡：这是现在「事务开头先查到已有行」那条路径就有的行为，本次让并发后到者与它一致，不改。
- 同一幂等键、不同载荷的请求仍复用先到的那张（幂等键的既有语义），不比对载荷。
- 其他地方的 `PendingAction` 建行（`scripts/` 里的种子脚本、运行时架构基线里登记的旧路径）。
- 事务隔离级别：沿用库默认的 READ COMMITTED，不改。
