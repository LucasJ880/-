# Spec Delta

## ADDED Requirements

### Requirement: 项目结算权限键
权限目录 SHALL 包含 `project.finance.read`（中文标签"查看项目结算"，风险 HIGH，支持 `ASSIGNED` 与 `ORG`）。`accounting` 与 `owner` 模板 SHALL 以 `ORG` 范围绑定它，`bids` 模板 SHALL 以 `ASSIGNED` 范围绑定它；`sales_rep`、`pricing_lead`、`ops_staff`、`ops_lead`、`installer` 与出单模板 SHALL NOT 绑定它。

#### Scenario: 会计与老板全企业
- **WHEN** 读取 `accounting` 与 `owner` 模板
- **THEN** 都包含 `project.finance.read`（ORG）

#### Scenario: 招投标只看参与的
- **WHEN** 读取 `bids` 模板
- **THEN** 包含 `project.finance.read`（ASSIGNED），不包含 `project.finance.read`（ORG）

#### Scenario: 销售没有
- **WHEN** 读取 `sales_rep` 模板
- **THEN** 不包含 `project.finance.read`
