# Spec Delta

## Purpose

面料库存的读写权限：运营主管管库存，其他岗位只读；每次码数变动可追溯。

## ADDED Requirements

### Requirement: 库存改动权
新增面料、调整码数、修改安全线 / 成本 / 基础信息 SHALL 要求 `inventory.manage`；不持该键的人 SHALL 收到 403。平台角色字符串 SHALL NOT 再作为放行条件（平台管理员通过岗位解析获得权限）。

#### Scenario: 运营主管调整
- **WHEN** 持 `inventory.manage` 的 Marty 对某面料提交 `adjustYards: -12`
- **THEN** 返回 200，总码数减少 12

#### Scenario: 运营人员调整
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 提交码数调整
- **THEN** 返回 403

### Requirement: 库存只读
库存列表 SHALL 对持 `inventory.read` 或 `inventory.manage` 的人开放；其余已登录用户 SHALL 收到 403。

#### Scenario: 出单人查库存
- **WHEN** 持 `fulfillment_shades` 岗位（含 `inventory.read`）的小叶请求库存列表
- **THEN** 返回 200

### Requirement: 调整留痕
每次码数调整 SHALL 写一条库存流水（类型、码数、原因、操作人）与一条审计记录（动作 `inventory.adjusted`，含调整前后总码数、原因）。响应 SHALL NOT 包含其他操作人的个人资料。

#### Scenario: 流水与审计
- **WHEN** Marty 调整码数 +50 原因"到货"
- **THEN** 新增一条库存流水 `restock +50 到货`，审计 `inventory.adjusted` 的内容含 `before`、`after`、`reason`
