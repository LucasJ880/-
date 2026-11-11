# Proposal：组织设置的写入不再互相覆盖

TASKFLOW：FIX-3（Phase F 续）
来源：RFQ-AUTO-3 的独立审查发现；Lucas 2026-11-11「按照你推荐的开始做，并且做下一步的计划，等 434 合并后开始」（计划见交接文档 §0.5b 第 1 项）。

## Why

`Organization.settingsJson` 被 11 处「读出整块、改一个键、把整块写回」的代码共用，其中只有 3 处加了锁：两处写入只要交错几毫秒，后写的就会用它读到的旧内容把先写的冲掉，而且没有任何报错（例如收信定时任务回写游标时，把刚保存的询价发件设置或刚学到的常用供应商恢复成旧值）。三个询价自动流开关打开之后，自动起草靠常用供应商、收信靠游标，都在这一块里。

## What Changes

- 新增一个组织设置的写入入口：在一个短事务里锁住该组织的行、读最新的设置、只改自己那一块、写回。
- 把 8 处独立的写入改为经这个入口：收信游标、Muse 个人偏好（保存与学习）、Muse 绑定、询价设置、投标资料、运营手册执行模式、日历监听的设置与游标。
- 给 3 处已在事务里的写入补上「先锁行、再读」：门店折扣设置、开户向导的新建 / 接管、开户设置更新（后者把「读设置」挪进事务里）。
- 把 Muse `set_preference` 改为在锁内对最新的偏好应用这一次修改（原来是对先前读到的偏好应用后整条写回）。
- 把 3 个会在生产上运行的脚本也改为加锁：`scripts/muse-bridge/bind.ts`、`scripts/seed-org-mengxin-home-textile.ts`、`scripts/set-org-sender-copy.ts`。
- 新增一条源码守卫测试：`src/` 与 `scripts/` 下任何写 `Organization.settingsJson` 的文件必须经这个入口或自己锁行，否则测试失败。

每一处写入「改哪个键、改成什么」都不变；接口的请求与响应、界面都不变。

## 受影响的 Muse 意图

- `set_preference`：结果不变；实现改为在锁内对最新偏好应用修改。同一个人的「设置偏好」与「选定报价后自动学习」同时发生时，两者都保留（原来后写的会覆盖先写的）。
- `preferences`、`rfq`、`chase`、`status` 等其余意图：不变。
- 管理员绑定 / 解绑 Muse 账号（不是 Muse 意图，但在 muse-bridge 里）：写入经新入口，结果不变。

## Out of scope

- 把组织设置拆成多张表或多列：不做（零 schema）。
- 已经自己锁行的 3 处（斑马帘比例、质保设置、能力配额策略）：不动。它们用的锁比需要的强（会与本组织的其它数据写入互相阻塞），换成较弱的那种另开改动。
- 游标类写入的「只进不退」：不做。两次定时任务同时回写同一个游标时仍是后写的生效，与现在相同。
- 用户设置、通知等其它 JSON 位的并发写入：不在本次范围。
- 新的 LLM 调用、schema 变更、定时任务、功能开关：都没有。

## Capabilities

### New Capabilities

- `settings/org-settings-write`：组织设置的并发写入互不覆盖；写入方必须经统一入口或自己锁行。

### Modified Capabilities

无。各写入方「写什么」没有变，它们各自的规格不需要改。

## Impact

- 新增 `src/lib/organizations/settings-write.ts`。
- 改写入方式：`src/lib/tender-rfq/inbound-sync.ts`、`src/lib/muse-bridge/prefs.ts`、`src/lib/muse-bridge/binding.ts`、`src/lib/muse-bridge/router.ts`（仅 `set_preference` 的保存一步）、`src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts`、`src/lib/tender-profile/store.ts`、`src/lib/operations/playbook/enforcement.ts`、`src/lib/calendar-watch/settings.ts`、`src/lib/calendar-watch/run.ts`、`src/lib/blinds/discount-settings.ts`、`src/lib/organizations/onboarding.ts`。
- 不改 `prisma/schema.prisma`、`src/app/api/sunny-process/zebra-ratios/route.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/lib/capabilities/governance/policy.ts`、任何读取方、`openspec/config.yaml`。
