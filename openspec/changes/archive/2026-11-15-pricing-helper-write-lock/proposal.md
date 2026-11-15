# Proposal：报价表助手的写入与报价同步串行

TASKFLOW：FIX-9（Phase F 续，接 FIX-8）
来源：FIX-8（#478）的 design.md Risks 与 proposal Out of scope；Lucas 2026-11-15「start the race-condition fix task」。

## Why

FIX-8 让报价表助手保存时保留报价引擎镜像的我方报价，但保存仍是不加锁的「读整块 → 改 → 写整块」。报价引擎在项目行锁下写 `BidIntelligenceRoom.summaryJson.pricingInputs`；报价同步恰好落在保存的读与写之间时，保存把读到的旧报价写回去，盖掉刚同步的新报价（本机强制交错：每次必现）。「重新推导」更严重：它在调模型之前读整块 `summaryJson`，模型返回后原样写回，窗口是一次模型调用的时长，期间任何报价同步都会被冲掉。

## What Changes

- 保存与推导的写入改在一个事务里做：先拿报价引擎用的同一把项目行锁（`SELECT … FROM "Project" … FOR UPDATE`），再读库里最新的 `summaryJson`，在它上面只改自己的键，同一事务写回。
- 推导的模型调用仍在锁外；写入时按最新值判断「已有人工模型就不覆盖」。
- 报价引擎的锁函数 `lockProject` 从 `src/lib/quote-engine/tender-bid.ts` 导出供路由复用，行为不变。
- 请求、返回、校验（400 / 409 / 429 / 404）、权限都不变。
- 新增隔离库测试：报价同步在项目行锁下写镜像、先不提交，这期间调真实路由保存 / 推导，提交后断言新报价与新输入都在；在改动之前的代码上失败。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- `summaryJson` 的其它写入方（情报、分析等写别的键的地方）：它们不拿项目行锁，本次不改；本次只保证报价表助手与报价引擎之间不互相覆盖。
- 推导的频控（60 秒）在锁外判断：两个推导同时到达仍可能都调一次模型（与改动前相同）。
- 报价引擎本身的写入：不改。
- schema 变更、新的锁表 / 队列、模型调用、对外动作、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/pricing-helper`：新增「写入与报价同步串行」一条要求。
