# Design：三处旧的组织行锁换成不与外键检查互斥的那一种（FIX-4）

## Context

- PostgreSQL 的行锁有四种强度。别的表插入一行、外键指向组织时，数据库对组织行加最弱的 `FOR KEY SHARE`。`FOR UPDATE` 与它互斥；`FOR NO KEY UPDATE`（普通 UPDATE 改非主键列本来就拿的那把）与它不互斥，但与自己、与 `FOR UPDATE` 互斥。
- FIX-3（#436）把组织设置的写入收到 `src/lib/organizations/settings-write.ts`，入口用 `FOR NO KEY UPDATE`。独立审查当时实测：`FOR UPDATE` 下「开户更新设置 ↔ 用户切换当前组织」120 次里死锁 53 次。
- 还在对组织行用 `FOR UPDATE` 的有三处、四条语句：`src/app/api/sunny-process/zebra-ratios/route.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/lib/capabilities/governance/policy.ts`（新建、修改各一条）。前两处写的是组织设置；第三处写的是配额策略表，只是借组织行来让同一组织的策略写入串行。
- 这三处的写入方都是「先显式锁行，再读，再写」，没有哪一处靠「对方的外键检查被 `FOR UPDATE` 挡住」来保证正确。

## Goals / Non-Goals

**Goals**

- 这三处保存不再被没提交的插入卡住，也不再能与「先插入、再锁行」的事务死锁。
- 它们彼此之间、与其它设置写入之间照样串行。

**Non-Goals（具体到文件）**

- 不动别的表上的锁：`src/lib/project-ledger/history-anchor.ts`（删除锚锁，有意与外键检查互斥）、`src/lib/quote-engine/**`、`src/lib/project-finance/**`、`src/lib/agent-runtime/run.ts`、`src/lib/tender-auto-analysis/enqueue-package.ts`、`src/lib/tender-bid-workspace/store.ts` 等。
- 不改这三处写什么、谁能写、审计记什么。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 三处都调用既有的 `lockOrganizationRow`

- 否决：各自把 SQL 里的 `FOR UPDATE` 改成 `FOR NO KEY UPDATE`。锁的强度就又散在四个地方，下次有人照着旧代码抄会再抄错；统一成一个函数后，守卫只需要盯「不许再有对组织行的 `FOR UPDATE`」。
- 否决：把两个接口改写成 `mutateOrgSettingsInTx`。它们在同一事务里还要用「保存之前」的内容写审计，改写的面比换一句锁大，收益只是形式统一。

### D2 配额策略也换

配额策略写入锁组织行只是为了串行，同样不需要挡住外键检查。

- 否决：留着不动（它不是组织设置）。它与设置写入锁的是同一行，留着 `FOR UPDATE` 就留着同一个死锁的口子：保存配额策略 ↔ 任何「先插入本组织的记录、再锁行写设置」的事务。

### D3 守卫按语句找，不按名单

守卫扫 `src/` 与 `scripts/` 的源码，找「从组织表选行并以 `FOR UPDATE` 结尾」的语句（注释里的不算）。

- 否决：只断言这三个文件。新文件里再写一条就漏了。

### D4 用真实接口做隔离库测试

新测试直接调两个接口的处理函数与配额策略的两个函数，用「有人拿着锁不放 0.9 秒」量等待时间。同一份测试在改动之前的代码上跑要失败（等待超过 0.5 秒），以此证明测的是这次的改动。

- 否决：只做源码断言。锁的强度是否真的不互斥，要让数据库自己说。

## 与八条硬纪律的关系

1. **零 schema**：遵守。不新增表、列、迁移。
2. **出站先审批**：不涉及。没有任何对外动作。
3. **禁止第三套队列**：遵守。没有后台执行。
4. **脱敏**：不涉及。不新增任何输出。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（无隔离库时自动跳过）。

## 验证方式

- `npx tsx src/lib/organizations/__tests__/org-row-lock-db.isolated.test.ts`（新，本地隔离库）：不被插入卡住、仍然串行、互不覆盖、不死锁；同一份测试在改动之前的代码上失败。
- `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts`（既有，补断言）：没有对组织行的 `FOR UPDATE`；三处都在读之前调用 `lockOrganizationRow`。
- 既有的隔离库测试不改断言重跑：`settings-write-db.isolated.test.ts`、`src/lib/install/__tests__/warranty-db.isolated.test.ts`、`src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts`、`src/lib/capabilities/__tests__/governance-hygiene-concurrency-gate.test.ts`。
- 变异核对：把三处的锁逐一改回 `FOR UPDATE`、逐一删掉，每一处都要有测试失败。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`。
- `openspec validate org-row-lock-no-key-update --strict`。

## Risks / Trade-offs

- **有没有人依赖「保存时挡住插入」**：逐处读过，三处都是先显式锁行再读写，没有；配额策略的唯一写入方就是这两个函数。
- **上线顺序**：新旧代码并存时（滚动发布的几秒）`FOR UPDATE` 与 `FOR NO KEY UPDATE` 互斥，写入方之间照样串行，不需要协调。
- **隔离库测试 CI 里不跑**（CI 没有数据库）：CI 上靠守卫测试；隔离库测试的结果写在报告里。

## Migration Plan

无数据迁移。回滚 = 回滚代码。

## Open Questions

无。
