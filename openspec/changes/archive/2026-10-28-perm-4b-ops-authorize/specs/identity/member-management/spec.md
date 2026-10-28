# Spec Delta

## ADDED Requirements

### Requirement: 平台用户管理仅平台 super_admin
平台用户列表 `GET /api/users`、查看他人 `GET /api/users/{id}`、修改他人或修改任何人的状态 / 平台角色 `PATCH /api/users/{id}`、删除用户 SHALL 只允许平台 super_admin；平台角色 `admin` / `boss` 与任何岗位 SHALL NOT 获得允许，SHALL 收到 403。用户本人查看自己、修改自己的姓名 / 昵称 / 头像 / 电话 SHALL 保持允许。`/admin/users` 页面 SHALL 只对平台 super_admin 展示管理内容。

#### Scenario: 平台 admin 列用户
- **WHEN** 平台角色为 `admin` 的人请求平台用户列表
- **THEN** 返回 403，`code` 为平台管理员要求码

#### Scenario: boss 看他人
- **WHEN** 平台角色为 `boss` 的人查看另一位用户的详情
- **THEN** 返回 403

#### Scenario: 平台 admin 改他人状态
- **WHEN** 平台角色为 `admin` 的人把另一位用户的状态改为停用
- **THEN** 返回 403，状态不变

#### Scenario: 本人改昵称
- **WHEN** 任一用户修改自己的昵称
- **THEN** 返回 200
