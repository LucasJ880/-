# Design：三处旧的组织行锁换成不与外键检查互斥的那一种（FIX-4）

## Context

- PostgreSQL 的行锁有四种强度。别的表插入一行、外键指向组织时，数据库对组织行加最弱的 `FOR KEY SHARE`。`FOR UPDATE` 与它互斥；`FOR NO KEY UPDATE`（普通 UPDATE 改非主键列本来就拿的那把）与它不互斥，但与自己、与 `FOR UPDATE` 互斥。
- FIX-3（#436）把组织设置的写入收到 `src/lib/organizations/settings-write.ts`，入口用 `FOR NO KEY UPDATE`。当时入口若用 `FOR UPDATE`，「开户更新设置 ↔ 用户切换当前组织」会死锁（独立审查实测 120 次里 53 次）——那是因为开户的事务之后还要更新用户那一行，两边拿锁的顺序是颠倒的。
- 这三处旧代码没有那种颠倒：锁住组织行之后只再插入审计或写策略行。本次的独立审查在旧代码上定向试了 98 轮，没有造出死锁。所以这三处的实际问题是**互相卡住**，不是死锁。
- 还在对组织行用 `FOR UPDATE` 的有三处、四条语句：`src/app/api/sunny-process/zebra-ratios/route.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/lib/capabilities/governance/policy.ts`（新建、修改各一条）。前两处写的是组织设置；第三处写的是配额策略表，只是借组织行来让同一组织的策略写入串行。
- 这三处的写入方都是「先显式锁行，再读，再写」，没有哪一处靠「对方的外键检查被 `FOR UPDATE` 挡住」来保证正确。

## Goals / Non-Goals

**Goals**

- 这三处保存不再被没提交的「往本组织插入一条记录」卡住，也不再卡住它们。
- 它们彼此之间、与其它设置写入之间照样串行。
- 锁组织行的写法只剩一处（外加开户按 code 找行的那一条），不再散在四个地方。

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

- 否决：留着不动（它不是组织设置）。它与设置写入锁的是同一行，留着 `FOR UPDATE` 就留着同样的互相卡住；而且代码里只要还有一处对组织行的 `FOR UPDATE`，守卫就没法写成「一处都不许有」。

### D3 守卫按语句找，不按名单

守卫扫 `src/`、`scripts/`、`prisma/`、`deploy/` 下可能带 SQL 的源文件，找「出现带引号的组织表名、到语句结束之前有 `FOR UPDATE`」的语句（注释里的不算）。同时钉住入口那一条语句的原文，并核对直接写「锁组织行」SQL 的文件只有入口与开户两个。

- 否决：只断言这三个文件。新文件里再写一条就漏了。
- 否决：只认 `FROM "Organization" … FOR UPDATE` 这一种写法（第一版就是这样，独立审查指出带 schema、JOIN 进来、写在普通字符串里的都漏）。
- 做不到的：表名或锁子句由变量拼出来时守卫认不出。CI 没有数据库，这种情形只能靠本地的隔离库测试发现——写在规格里。

### D4 用真实接口做隔离库测试

新测试直接调两个接口的处理函数与配额策略的两个函数，用「有人拿着锁不放 0.9 秒」量等待时间。同一份测试在改动之前的代码上跑，「不用等」的四条要失败（等了 0.9 秒以上），以此证明测的是这次的改动。「与先插入再锁行的事务同时进行」那一段在改动前后都通过，只是回归检查。

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

- `npx tsx src/lib/organizations/__tests__/org-row-lock-db.isolated.test.ts`（新，本地隔离库）：不被插入卡住（改动之前失败）、仍然串行、互不覆盖、并发时没有请求失败。
- `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts`（既有，补断言）：没有对组织行的 `FOR UPDATE`；入口那条语句原样在；三处都在读之前调用 `lockOrganizationRow`，写回的内容取自锁里读到的那一份。
- 既有的隔离库测试不改断言重跑：`settings-write-db.isolated.test.ts`、`src/lib/install/__tests__/warranty-db.isolated.test.ts`、`src/lib/capabilities/__tests__/governance-hygiene-concurrency-gate.test.ts`。`src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts` 里有斑马帘比例接口的用例，但它在 main 上第一步就失败（与本次无关，见报告），跑不到那一段。
- 变异核对：把三处的锁逐一改回 `FOR UPDATE`、逐一删掉，每一处都要有测试失败。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`。
- `openspec validate org-row-lock-no-key-update --strict`。

## Risks / Trade-offs

- **有没有人依赖「保存时挡住插入」**：逐处读过，三处都是先显式锁行再读写，没有。配额策略的写入方是这两个函数，另有一个运维脚本 `scripts/governance-hygiene-supersede.ts` 把旧版本批量置为停用——它本来就不锁组织行，改动前后对它没有区别。配额的执行（判断够不够）读的是不加锁的快照，也不依赖这把锁。
- **与删除组织、改组织的唯一键**：`FOR NO KEY UPDATE` 与 `DELETE`、与改 `code` 的 UPDATE 都互斥（独立审查用 psql 逐项核过），没有新的竞态。
- **上线顺序**：新旧代码并存时（滚动发布的几秒）`FOR UPDATE` 与 `FOR NO KEY UPDATE` 互斥，写入方之间照样串行，不需要协调。
- **隔离库测试 CI 里不跑**（CI 没有数据库）：CI 上靠守卫测试；隔离库测试的结果写在报告里。守卫认不出变量拼出来的 SQL。
- **工作区一级的配额策略没有隔离库用例**（要先建工作区）：靠守卫核对两个事务都以锁行开头。

## Migration Plan

无数据迁移。回滚 = 回滚代码。

## Open Questions

无。
