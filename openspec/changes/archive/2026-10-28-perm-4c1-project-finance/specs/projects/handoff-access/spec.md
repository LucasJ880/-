## Purpose

招投标中标交接（投标项目转交付项目）的管理者判定：只看管理层、平台 super_admin 与企业系统管理员，不再认平台角色 admin。

## ADDED Requirements

### Requirement: 交接管理者不含平台 admin
招投标交接的管理者 SHALL 为管理层工作区用户、平台 super_admin 或企业系统管理员；平台角色 `admin`（非 super_admin）本身 SHALL NOT 使其成为交接管理者。

#### Scenario: 平台 admin 不是管理者
- **WHEN** 平台角色为 `admin`、企业成员角色为 `org_member` 的人发起交接预览且无其他交接权限
- **THEN** 不被当作交接管理者

#### Scenario: 平台 super_admin 仍是管理者
- **WHEN** 平台 super_admin 发起交接预览
- **THEN** 被当作交接管理者
