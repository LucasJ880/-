# projects/handoff-access Specification

## Purpose
招投标中标交接（投标项目转交付项目）的管理者判定：只看管理层、平台 super_admin 与企业系统管理员，不再认平台角色 admin。

## Requirements

### Requirement: 交接管理者不含平台 admin
招投标交接的管理者 SHALL 为管理层工作区用户、平台 super_admin 或企业系统管理员；平台角色 `admin`（非 super_admin）本身 SHALL NOT 使其成为交接管理者。

#### Scenario: 平台 admin 不是管理者
- **WHEN** 平台角色为 `admin`、企业成员角色为 `org_member` 的人发起交接预览且无其他交接权限
- **THEN** 不被当作交接管理者

#### Scenario: 平台 super_admin 仍是管理者
- **WHEN** 平台 super_admin 发起交接预览
- **THEN** 被当作交接管理者

### Requirement: 交接上下文带岗位信号
交接接口（交接记录、预览、执行）构造的访问上下文 SHALL 带上操作者在当前企业的有效权限键与 `positionMode`。岗位模式企业中，管理层工作区用户 SHALL 按 `organization.dashboard.read` 判定；持 `bids.handoff.preview` / `bids.handoff.execute` / `bids.handoff.override` 的人 SHALL 按键放行。

#### Scenario: 招投标岗位预览交接
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `bids` 岗位的成员预览已读项目的交接
- **THEN** 允许

#### Scenario: 平台 operations 无交接键
- **WHEN** 岗位模式企业中平台角色为 `operations`、企业角色 `org_member`、只绑定 `ops_staff` 的成员执行交接
- **THEN** 拒绝
