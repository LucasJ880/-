# Design：组织设置的写入加锁（FIX-3）

## Context

读代码确认的现状（`grep` 全仓 `organization.update` 且写 `settingsJson` 的位置：`src/` 下 14 处；独立审查另找出 `scripts/` 下 3 个会在生产上运行的脚本——`scripts/muse-bridge/bind.ts`、`scripts/seed-org-mengxin-home-textile.ts`、`scripts/set-org-sender-copy.ts`，也一并改了）：

| 位置 | 写什么 | 现在怎么写 |
|---|---|---|
| `tender-rfq/inbound-sync.ts` `saveCursor` | 收信游标（定时任务，每 10 分钟） | 读整块 → 立刻整块写回，无锁 |
| `muse-bridge/prefs.ts` `saveUserPrefs` / `updatePrefs` | 个人偏好（设置、学习供应商、学习贸易条款） | 同上 |
| `muse-bridge/binding.ts` `setMuseBinding` | Muse 账号绑定 | 读整块 → 查成员 → 整块写回，无锁 |
| `api/organizations/[orgId]/tender-rfq-settings` | 询价设置 | 读整块 → 校验 → 整块写回，无锁 |
| `tender-profile/store.ts` `saveTenderProfile` | 投标资料 | 读整块 → 整块写回，无锁 |
| `operations/playbook/enforcement.ts` | 运营手册执行模式 | 同上 |
| `calendar-watch/settings.ts`、`run.ts` | 日历监听的设置、游标（定时任务） | 同上（注释里写着「减少竞争窗口」） |
| `blinds/discount-settings.ts` | 门店折扣 | 在事务里读整块 → 写回，没有锁行 |
| `organizations/onboarding.ts`（两处） | 开户向导 | 一处在事务里读写、没有锁行；一处在事务外读、事务里写 |
| 斑马帘比例、质保设置、能力配额策略 | — | **已经**先 `SELECT … FOR UPDATE` 锁行再读写 |

关键事实：**只把一部分写入方改成加锁是不够的。** 加锁的写入方只会互相等待；一个不加锁的写入方照样可以先读到旧的整块，等加锁的那一方提交之后再把旧的整块写回去。所以要么全部改，要么等于没改。

窗口有多大：多数位置是「读完立刻写」，窗口是毫秒级；开户设置更新是在事务外读、做几次查询之后才写，窗口是几十毫秒。发生的概率低，但后果是无声的（设置被悄悄恢复成旧值），而两个定时任务让「有人在写」成了常态。

## Goals / Non-Goals

**Goals**

- 任意两处写入并发时互不覆盖。
- 同一项的并发修改在最新内容上依次生效。
- 以后新增的写入方绕不开（守卫测试）。

**Non-Goals（具体到文件）**

- 不改 `prisma/schema.prisma`；不把设置拆表拆列。
- 不改已经锁行的三处：`src/app/api/sunny-process/zebra-ratios/route.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/lib/capabilities/governance/policy.ts`。
- 不改任何读取方（`readUserPrefs`、`readTenderRfqSettings`、`readCalendarWatch` 等）与各 `with…` 纯函数。
- 不改 `src/lib/tender-rfq/chase-service.ts`、`service.ts`、`auto-draft-service.ts`、`supplier-groups-service.ts`、`auto-followup-optin-service.ts`（它们不写组织设置）。
- 不改接口的请求与响应、界面、`openspec/config.yaml`。

## Decisions

### D1 一个入口：锁行 → 读最新 → 纯函数算出新的整块 → 写回

`src/lib/organizations/settings-write.ts`：

- `lockOrganizationRow(tx, orgId)`：`SELECT id FROM "Organization" WHERE id = … FOR NO KEY UPDATE`。与已有的三处（它们用 `FOR UPDATE`）互斥，所以新旧写入方互相也是串行的。
- `mutateOrgSettings(orgId, fn)`：开一个短事务，锁行，读 `settingsJson`，调用 `fn(最新的整块)`，`fn` 返回 `{ next, result }`；`next` 没给就不写。`fn` 必须是同步的纯函数——锁里不做任何别的查询或网络调用。
- `mutateOrgSettingsInTx(tx, orgId, fn)`：给已经在事务里的调用方用。

- 否决：乐观并发（加版本号、写时比对）。要新增一列（违反零 schema），或者拿整块内容做比对（大而慢），还要给 11 处都写重试。
- 否决：用数据库的 JSON 局部更新（`jsonb_set`）只改自己的键。能让加了的那几处互不覆盖，但挡不住任何一处还在整块写回的写入方；而且每处的「改法」是 TypeScript 纯函数（合并、校验、去重），搬进 SQL 会重写一遍逻辑。
- 否决：咨询锁（`pg_advisory_xact_lock`）。已有的三处用的是行锁；换一种锁，新旧写入方之间就不互斥了。
- 否决：`FOR UPDATE`（第一版就是这么写的，独立审查后改掉）。有 35 张表的外键指向组织；往这些表插入一行时，数据库会对组织行加一把很弱的锁（`FOR KEY SHARE`），`FOR UPDATE` 与它互斥。后果是三个：写设置会被任何还没提交的「插入一条本组织的记录」的事务卡住（审查实测：对方持有 7 秒时写设置超时失败）；反过来也卡住它们；还会造出死锁——开户更新设置先锁组织行、后改用户行，用户切换当前组织先锁用户行、后做外键检查，审查实测 120 次里 53 次死锁，旧代码 0 次。`FOR NO KEY UPDATE` 正好是普通的 `UPDATE` 改非主键列本来就会拿的锁：与外键检查不冲突，与另一个 `FOR NO KEY UPDATE` / `FOR UPDATE` 互斥。

### D2 全部 11 处都改，而不是只改询价与 Muse 相关的几处

交接文档 §0.5b 的计划写的是「范围只含询价与 Muse 相关的这几处」。读完代码后这个范围不成立（见 Context 的关键事实）：留下任何一处不加锁的整块写入，它就能冲掉别人的修改——日历监听的游标也是定时任务在写。

- 否决：按原计划只改 5 处。等于没有修好，却让人以为修好了。
- 代价：改动落到了销售（门店折扣）、开户、日历、运营手册这几个本任务之外的模块。每处都只改「怎么写」，不改「写什么」；门店折扣只在既有事务里加一句锁行。

### D3 「先读、做别的查询、再写」的几处，把修改挪进锁里

- `setMuseBinding`：成员校验留在锁外（与设置无关），绑定的写入进锁。
- 询价设置接口：项目归属校验留在锁外；`applyTenderRfqSettingsUpdate` 在锁内对最新内容执行，不合规时不写并照旧返回 400；审计里的「保存前」取锁内读到的内容。
- 日历监听设置：既有的「写回前重读」挪进锁里，成为真正的原子操作。
- 开户设置更新：设置的合并挪进既有事务，事务开头先锁行再读。事务外读到的 `org` 仍用于权限与交接的判断（与设置无关）。
- Muse `set_preference`：校验（键、值、供应商属于本组织）留在锁外；锁内对最新偏好再调用一次 `applyPreference` 得到要写的内容。

- 否决：把校验也放进锁里。校验要查库，会拉长持锁时间；它们查的东西（成员、项目、供应商）不在这一行上。

### D4 守卫测试用源码扫描

扫 `src/` 与 `scripts/` 下所有非测试文件：出现「`organization.update(…)` 且 `data` 里有 `settingsJson`」的文件，必须引用了统一入口，或自己有 `FOR UPDATE` / `FOR NO KEY UPDATE`。不满足就失败并列出文件。另有一份「直接写这一列的文件」名单（现在 6 个），扫描结果必须与名单一致——「文件里某处有锁」并不能说明每一处写入都在锁里，新增的直接写入必须先过一遍审查再加进名单。在自己事务里锁行的几处，另有断言核对「锁在读设置之前」。

- 否决：只靠评审。这次的 11 处就是这样一处一处长出来的。
- 代价：源码扫描认的是写法。扫描里把 `updateMany` 与 `upsert` 也算上；认不出来的有：`data` 是一个变量或展开（`data: { ...patch }`）、经关联的嵌套写入、原生 SQL。这几种写法仓库里现在都没有（独立审查逐一搜过）。

## 与八条硬纪律的关系

1. **零 schema**：遵守。不新增表、列、迁移；这正是不采用乐观并发版本号的原因。
2. **出站先审批**：不涉及出站路径。间接有关：询价设置里的发件人、收信游标不再被悄悄恢复成旧值。
3. **禁止第三套队列**：遵守。行锁随事务结束释放，不是队列；没有新增任何后台执行。
4. **脱敏**：不涉及。没有新的响应字段。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及（`fromEmail` / `mailboxEmail` 的读写内容不变，只是不会再被并发写入冲掉）。
7. **确定性优先**：遵守。没有模型调用；偏好里仍只有那四个字段。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/organizations/__tests__/settings-write-db.isolated.test.ts`（新，本地隔离库）：对照用例（不加锁的写法并发写 12 个键会丢）；入口并发写 12 个键全保留；七种真实写入方同时进行 12 轮，七项都在；开户更新设置、门店折扣与另外三种写入同时进行 10 轮；有人拿着锁时外键插入不用等、另一处设置写入要等；先插入再锁行的 8 个事务不死锁；同一个人的设置偏好与自动学习同时发生都保留；同时学习 4 家供应商都在；询价设置接口的 400 / 200 与审计；组织不存在时各写入方的既有处理。
- 同一份测试在 `main` 的旧代码上跑：真实写入方并发的用例应当失败（丢键）。
- 变异检查：把入口的锁换回 `FOR UPDATE` → 「外键插入不用等」「不死锁」两条失败；把门店折扣与开户更新设置里的锁删掉 → 隔离库测试与守卫测试都失败。
- `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts`（新）：现有代码通过；对一段「不经入口整块写回」的示例源码判为不通过。
- 各写入方既有的测试不改断言即通过：`npm run test:ci`（含 muse-bridge、calendar-watch、blinds、onboarding、tender-rfq 的全部已注册测试）；本地隔离库的 `auto-draft-db`、`supplier-groups-db`、`followup-auto-db`。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`。
- 开 PR 前请一个不带结论的独立审查（重点：有没有漏掉的写入方；持锁期间有没有别的查询；死锁的可能）。
- `openspec validate org-settings-locked-write --strict`。

## Risks / Trade-offs

- **写入现在会互相等待。** 每次持锁只有「读一行、算、写一行」，毫秒级；定时任务与人的操作撞上时，后到的多等几毫秒。
- **死锁。** 第一版用 `FOR UPDATE` 时这一条判断错了（漏了外键检查隐含的那把锁），见 D1。改成 `FOR NO KEY UPDATE` 之后，「先插入本组织的记录、再锁行写设置」的事务同时进行也不会死锁（有测试）。
- **已有的三处（斑马帘比例、质保设置、能力配额策略）仍用 `FOR UPDATE`**，它们自己仍会与外键插入互相阻塞——这是既有行为，本次没有动。其中能力配额策略在持锁期间还会用另一个数据库连接做查询；现在排在这把锁后面的写入方多了（两个定时任务、Muse），连接池很小时它更容易等不到连接。建议另开一个小改动把这三处也换成 `FOR NO KEY UPDATE`。
- **开户的两处会把锁一直拿到事务结束**（锁之后还有工作区、成员、用户几条语句），这期间别的设置写入要等；不影响外键插入。
- **事务超时。** Prisma 交互式事务默认等连接 2 秒、执行 5 秒；极端并发下可能有写入失败并报错（而不是悄悄丢）。收信游标写失败的后果是下一轮多扫一些邮件，既有的去重会挡住重复处理。
- **改到了本任务之外的模块**（销售、开户、日历、运营手册）。见 D2。
- **隔离库测试在 CI 里跳过**（仓库现状）：并发的证据只在本地跑得出来，报告里写明。

## Migration Plan

无数据迁移。回滚 = 回滚代码。新旧版本并存的滚动发布期间，旧实例仍是不加锁的整块写回，保护在全部实例换新之后才完整。

## Open Questions

无。
