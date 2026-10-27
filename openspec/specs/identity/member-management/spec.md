# identity/member-management Specification

## Purpose
企业成员管理：成员的加入、角色 / 状态修改与移除只属于平台管理员；企业内任何岗位或成员角色都不能自助管理成员。

## Requirements

### Requirement: 成员增删改仅平台管理员
`POST /api/organizations/{orgId}/members`、`PATCH /api/organizations/{orgId}/members/{memberId}`、`DELETE /api/organizations/{orgId}/members/{memberId}` SHALL 要求操作者为平台 super_admin；其他人 SHALL 收到 403 且响应 `code` 为平台管理员要求码。唯一 org_owner 保护 SHALL 保持。

#### Scenario: org_admin 改角色
- **WHEN** 企业角色 org_admin 的人 PATCH 某成员角色
- **THEN** 返回 403

#### Scenario: 老板岗位移除成员
- **WHEN** 持 `owner` 岗位（非 super_admin）的人 DELETE 某成员
- **THEN** 返回 403

#### Scenario: 平台管理员操作
- **WHEN** super_admin PATCH 某成员角色为 org_member
- **THEN** 返回 200，审计记录含该操作

#### Scenario: 不能移除最后一个 org_owner
- **WHEN** super_admin 尝试把唯一 org_owner 改为 org_member
- **THEN** 返回 400 或 409，角色不变

### Requirement: 成员目录读取不变
`GET /api/organizations/{orgId}/members` 的读取权限 SHALL 保持现状（企业 active 成员可读）。

#### Scenario: 成员读目录
- **WHEN** 企业 active 成员 GET 成员列表
- **THEN** 返回 200
