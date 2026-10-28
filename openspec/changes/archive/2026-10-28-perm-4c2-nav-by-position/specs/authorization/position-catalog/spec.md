# Spec Delta

## ADDED Requirements

### Requirement: 企业经营总览权限键
权限目录 SHALL 包含 `organization.dashboard.read`（中文标签"查看企业经营总览"，风险 MEDIUM，`ORG`，只允许人类主体）。窗饰行业包 `owner` 模板 SHALL 以 `ORG` 范围绑定它；其余窗饰岗位模板与所有系统模板 SHALL NOT 绑定它。

#### Scenario: 只有老板
- **WHEN** 读取窗饰行业包全部岗位模板
- **THEN** 只有 `owner` 含 `organization.dashboard.read`

#### Scenario: 系统模板不含
- **WHEN** 读取系统模板 `org_owner` 与 `org_admin`
- **THEN** 都不含 `organization.dashboard.read`
