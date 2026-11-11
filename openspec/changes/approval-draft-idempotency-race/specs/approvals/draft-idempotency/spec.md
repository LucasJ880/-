# Spec Delta

## Purpose

规定审批草稿（待审批卡）按「组织 + 幂等键」去重的行为：已存在时复用、并发建卡时后到的一方复用先到的那张卡，以及哪些失败不当作复用、照旧按建卡失败返回。

## ADDED Requirements

### Requirement: 同组织同幂等键复用已有的卡
带组织与幂等键建审批草稿时，若本组织已有同一幂等键的审批记录，系统 SHALL 复用它、返回它的审批 id，SHALL NOT 再建一条。不带组织或不带幂等键的草稿 SHALL 每次新建。

#### Scenario: 先后两次建卡
- **WHEN** 同一组织、同一幂等键先后两次请求建卡
- **THEN** 两次都成功、返回同一个审批 id，库里这个组织 + 幂等键只有一条记录（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/pending-actions/__tests__/draft-idempotency-race-db.isolated.test.ts`）

#### Scenario: 不带幂等键
- **WHEN** 同一组织两次请求建卡，都不带幂等键
- **THEN** 两次都成功，返回两个不同的审批 id（同一测试）

### Requirement: 并发建卡时后到方复用先到方的卡
同一组织、同一幂等键的两个建卡请求同时进行、都没看到已有记录并都尝试写入时，系统 SHALL 让先写入的一方建成这张卡，并 SHALL 让后到的一方也成功返回同一个审批 id，SHALL NOT 向后到方返回建卡失败，SHALL NOT 记录建卡失败的错误日志。这组请求结束后，库里这个组织 + 幂等键 SHALL 只有一条记录。

#### Scenario: 两个请求都卡在写入上
- **WHEN** 同一组织、同一幂等键的两个建卡请求都已越过「查已有记录」、都在写入时被挡住，随后放行
- **THEN** 两个请求都成功、返回同一个审批 id；库里只有一条记录；没有建卡失败的错误日志（同一测试）

#### Scenario: 一批里只有一张撞上并发
- **WHEN** 一次批量建卡含两张卡：一张用新的幂等键，另一张的幂等键正被另一个请求同时写入
- **THEN** 这一批成功返回两张卡；撞上并发的那张返回另一个请求建成的审批 id；新幂等键的那张在库里只有一条记录（同一测试）

### Requirement: 只有幂等键冲突才算复用
只有落在「组织 + 幂等键」唯一约束上的写入冲突 SHALL 被当作复用信号。其它写入失败（引用的用户不存在、别的约束冲突、连接错误等）SHALL 照旧让整批建卡返回失败（`DRAFT_CREATION_FAILED`），这一批 SHALL NOT 留下任何待审批记录。幂等键冲突在有限次重试后仍未消解时，系统 SHALL 按建卡失败返回，SHALL NOT 无限重试。

#### Scenario: 引用的用户不存在
- **WHEN** 一次批量建卡含两张卡，第一张正常，第二张的提交人在库里不存在
- **THEN** 这一批返回 `DRAFT_CREATION_FAILED`；两张卡的幂等键在库里都没有记录（同一测试）

#### Scenario: 冲突判定只认组织 + 幂等键
- **WHEN** 分别给出：落在组织 + 幂等键上的唯一冲突、落在别的字段或别的表上的唯一冲突、外键错误、普通错误
- **THEN** 只有第一种被判为复用信号并触发重跑；其余立即原样抛出、不重跑；一直冲突时重跑次数达到上限后抛出最后一次的错误（`npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts`）
