# Spec Delta

## MODIFIED Requirements

### Requirement: 会计默认落地
持 `accounting.read`、不是管理层、不是销售 / 运营专职、且不持 `project.create` / `project.update` / `operations.read` / `operations.manage` 的成员，默认工作区 SHALL 为 `/accounting`。旧模式下"销售 / 运营专职"按平台角色判定；岗位模式下按持 `sales.quote.create` / `sales.quote.pricing_close`（销售）与 `operations.*`（运营）判定，平台角色 SHALL NOT 参与。

#### Scenario: 纯会计落地会计页
- **WHEN** 只持 `accounting` 岗位的成员进入首页
- **THEN** 被导向 `/accounting`

#### Scenario: 招投标不落地会计页
- **WHEN** 持 `bids` 岗位（含 `project.finance.read`、`project.update`）的成员进入首页
- **THEN** 不被导向 `/accounting`

#### Scenario: 岗位模式下平台角色 sales 的会计
- **WHEN** 岗位模式下平台角色为 `sales`、只持 `accounting` 岗位的成员进入首页
- **THEN** 被导向 `/accounting`
