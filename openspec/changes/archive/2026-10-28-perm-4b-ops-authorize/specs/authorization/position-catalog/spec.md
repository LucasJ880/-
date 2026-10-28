# Spec Delta

## ADDED Requirements

### Requirement: 运营内容权限键
权限目录 SHALL 包含 `operations.content.draft`（中文标签"起草运营内容"，风险 MEDIUM，`ORG`）与 `operations.content.approve`（中文标签"批准运营内容"，风险 HIGH，`ORG`，只允许人类主体）。

#### Scenario: 权限键可识别
- **WHEN** `operations.content.draft` 或 `operations.content.approve` 用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

#### Scenario: 批准键不开放给数字员工
- **WHEN** 读取 `operations.content.approve` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`

### Requirement: 运营岗位的内容分权
`ops_staff` 模板 SHALL 以 `ORG` 范围追加 `operations.content.draft`，SHALL NOT 绑定 `operations.content.approve` 或 `operations.manage`；`ops_lead` 模板 SHALL 追加 `operations.content.draft` 与 `operations.content.approve`；`owner` 模板 SHALL 追加 `operations.content.approve`，SHALL NOT 绑定 `operations.manage` 或 `operations.content.draft`。其余模板 SHALL NOT 绑定这两个键。

#### Scenario: 运营人员只起草
- **WHEN** 读取 `ops_staff` 模板（含系统模板并集）
- **THEN** 包含 `operations.content.draft` 与 `operations.read`，不包含 `operations.content.approve`、`operations.manage`

#### Scenario: 老板只批不改
- **WHEN** 读取 `owner` 模板
- **THEN** 包含 `operations.content.approve` 与 `operations.read`，不包含 `operations.manage`、`operations.content.draft`

#### Scenario: 销售无运营内容权
- **WHEN** 读取 `sales_rep` 模板
- **THEN** 不包含 `operations.content.draft`、`operations.content.approve`
