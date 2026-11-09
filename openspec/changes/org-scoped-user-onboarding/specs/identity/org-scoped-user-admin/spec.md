# Spec Delta

## Purpose

平台用户管理按企业范围列人：在某个企业下只看到该企业的在册员工，全平台用户需要平台超级管理员显式切换才能看到。

## ADDED Requirements

### Requirement: 用户列表按企业范围
`GET /api/users`（权限不变：仅平台 super_admin）SHALL 按范围返回用户：参数 `scope=platform` 时返回全平台用户；否则参数 `orgId` 指定的企业，或未指定时操作者的当前工作企业，SHALL 只返回该企业 active 成员，并为每人返回其企业内角色；指定的企业不存在 SHALL 返回 404；既没有指定企业也没有当前工作企业 SHALL 返回 400，错误码 `ORG_SCOPE_REQUIRED`。响应 SHALL 说明本次范围（企业 id 与名称，或全平台）。

#### Scenario: 在 Sunny 下列用户
- **WHEN** 平台 super_admin 以企业 A 为范围列用户，平台上还有企业 B 的成员和不属于任何企业的用户
- **THEN** 只返回企业 A 的 active 成员，每人带企业内角色；已离开企业 A 的人不在其中

#### Scenario: 显式看全平台
- **WHEN** 平台 super_admin 以 `scope=platform` 列用户
- **THEN** 返回全平台用户（与改动前相同）

#### Scenario: 没有企业范围
- **WHEN** 平台 super_admin 没有当前工作企业，也没有传 `orgId` 或 `scope=platform`
- **THEN** 返回 400，错误码 `ORG_SCOPE_REQUIRED`

#### Scenario: 非平台管理员
- **WHEN** 平台角色 `admin` 或 `boss` 的人以任意范围列用户
- **THEN** 返回 403

### Requirement: 用户管理页默认当前企业
「用户管理」页 SHALL 默认以当前企业为范围，显示企业名称与人数、每人的企业内角色；切到全平台 SHALL 是页面上的显式操作；没有选中企业时 SHALL 提示先选择企业，而不是列出全平台用户。

#### Scenario: 打开用户管理
- **WHEN** 平台 super_admin 当前企业为 A，打开「用户管理」
- **THEN** 页面只列企业 A 的员工，标明「当前企业：A」；点「全平台」后才列全平台用户

### Requirement: 用户详情不提供公司归属选择
「用户管理」的用户详情 SHALL NOT 提供公司归属（联合品牌 logo）选择；左上角显示的公司 logo 由用户当前企业关联的公司决定。

#### Scenario: 打开用户详情
- **WHEN** 平台 super_admin 在「用户管理」打开某位员工的详情
- **THEN** 详情里没有公司归属选择
