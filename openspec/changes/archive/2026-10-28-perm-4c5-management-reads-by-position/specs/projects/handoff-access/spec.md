# Spec Delta

## ADDED Requirements

### Requirement: 交接上下文带岗位信号
交接接口（交接记录、预览、执行）构造的访问上下文 SHALL 带上操作者在当前企业的有效权限键与 `positionMode`。岗位模式企业中，管理层工作区用户 SHALL 按 `organization.dashboard.read` 判定；持 `bids.handoff.preview` / `bids.handoff.execute` / `bids.handoff.override` 的人 SHALL 按键放行。

#### Scenario: 招投标岗位预览交接
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `bids` 岗位的成员预览已读项目的交接
- **THEN** 允许

#### Scenario: 平台 operations 无交接键
- **WHEN** 岗位模式企业中平台角色为 `operations`、企业角色 `org_member`、只绑定 `ops_staff` 的成员执行交接
- **THEN** 拒绝
