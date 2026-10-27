# Spec Delta

## ADDED Requirements

### Requirement: 系统模板 org_owner 不含管理面
系统岗位模板 `org_owner` SHALL NOT 绑定 `identity.member.manage`、`identity.role.manage`、`authorization.policy.manage`；成员与岗位管理只属于平台管理员。`org_owner` 其余绑定 SHALL 保持。

#### Scenario: org_owner 模板
- **WHEN** 读取系统模板 `org_owner` 的权限绑定
- **THEN** 不包含上述三个键，仍包含 `sales.customer.read`（ORG）与 `audit.read`（ORG）
