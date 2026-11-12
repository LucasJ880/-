# Proposal：三处旧的组织行锁换成不与外键检查互斥的那一种

TASKFLOW：FIX-4（Phase F 续）
来源：交接文档 §0.5c 第 3 项（FIX-3 独立审查留下的遗留）；Lucas 2026-11-12「按照你的推荐开始吧」。

## Why

斑马帘比例、质保设置、能力配额策略三处写入用 `FOR UPDATE` 锁组织行，它与「往本组织插入一条关联记录」时数据库自动加的锁互斥：保存会被任何一个没提交的插入卡住，反过来也卡住它们。FIX-3 已把其余写入方换成不互斥的 `FOR NO KEY UPDATE`，这三处是遗留，锁的写法也因此散在四个地方。

## What Changes

- 把斑马帘比例接口、质保设置接口、能力配额策略的新建与修改（共四条语句）改为调用既有的 `lockOrganizationRow`（`FOR NO KEY UPDATE`）。
- 在守卫测试里加一条：`src/` 与 `scripts/` 下不得再出现对组织行取 `FOR UPDATE` 的语句。
- 新增一份隔离库测试：这三处在有人往本组织插入记录时不用等（改动之前要等到对方提交）；彼此之间、与其它设置写入之间仍然串行、互不覆盖；与「先插入、再锁行」的事务并发时没有请求失败。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- 别的表上的 `FOR UPDATE`（项目、报价、预算、AgentRun 等）：不动。其中项目删除的锚锁是有意要与外键检查互斥的。
- 这三处写入的内容、权限、审计、接口的请求与响应：不变。
- 把两个接口改成 `mutateOrgSettings`：不做，只换锁。
- schema 变更、模型调用、定时任务：没有。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `settings/org-settings-write`：「写设置不与本组织的其它数据写入互相阻塞」原来没有覆盖到斑马帘比例与质保设置两处写入；这次补上，并新增一条——借组织行来串行的其它写入（能力配额策略）用同一种锁，以及不得再对组织行取 `FOR UPDATE`。
