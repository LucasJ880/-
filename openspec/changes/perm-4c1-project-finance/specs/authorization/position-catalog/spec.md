# Spec Delta

## ADDED Requirements

### Requirement: 项目财务管理权限键
权限目录 SHALL 包含 `project.finance.manage`（中文标签"管理项目财务"，风险 HIGH，`ORG`，只允许人类主体）。`owner` 岗位模板与系统模板 `org_owner`、`org_admin` SHALL 以 `ORG` 范围绑定它；`bids`、`accounting`、`sales_rep`、`pricing_lead`、`ops_staff`、`ops_lead`、`installer` 与出单模板 SHALL NOT 绑定它。

#### Scenario: 老板可管
- **WHEN** 读取窗饰行业包合并后的 `owner` 模板
- **THEN** 包含 `project.finance.manage`（ORG）

#### Scenario: 会计与招投标不可管
- **WHEN** 读取 `accounting` 与 `bids` 模板
- **THEN** 都不包含 `project.finance.manage`

#### Scenario: 数字员工不可持有
- **WHEN** 读取 `project.finance.manage` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`
