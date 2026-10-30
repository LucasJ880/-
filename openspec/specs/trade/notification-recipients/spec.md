# trade/notification-recipients Specification

## Purpose
外贸提醒与默认询盘负责人的选人规则：工作提醒发给持外贸读写键的人，管理层提醒发给持外贸键的管理层，默认负责人按岗位派生平台角色选外贸 / 销售人员；旧模式与岗位模式（压扁前后）结果一致。

## Requirements

### Requirement: 外贸工作收件人按外贸键
询盘首次待回复提醒、网站 / 邮件 / 通道询盘到达通知 SHALL 发给本企业中持 `trade.read` 或 `trade.manage` 的 active 成员（有效权限含岗位绑定、旧模式企业的兼容回退与平台 super_admin 全权）。平台角色 `boss`、`manager`、`admin` SHALL NOT 单独构成收件资格。

#### Scenario: 梦馨两人照常收到
- **WHEN** 旧模式企业有平台 `admin` + `org_owner` 的老板与平台 `trade` + `org_member` 的业务员，新询盘到达
- **THEN** 两人都收到询盘通知

#### Scenario: 不是企业负责人的平台 boss
- **WHEN** 旧模式企业中平台角色 `boss`、企业角色 `org_member`、无外贸岗位的成员，新询盘到达
- **THEN** 不收到通知

#### Scenario: 压扁后的外贸业务员
- **WHEN** 岗位模式企业中平台角色 `user`、绑定 `trade_rep` 的成员，新询盘到达
- **THEN** 收到通知

### Requirement: 外贸管理层收件人
老板询盘早报、展会小结、新询盘首响 SLA 分级升级与草稿逾期提醒、询盘超 24 小时升级 SHALL 发给本企业中同时满足以下两条的 active 成员：
- 是管理层：岗位模式企业为持管理层信号 `organization.dashboard.read` 的成员或平台 super_admin；旧模式企业为企业角色 `org_owner` / `org_admin` 或平台角色 `boss` / `manager` / `admin` / `super_admin`；
- 持 `trade.read` 或 `trade.manage`。

没有符合条件的成员时，SLA 分级提醒 SHALL 回退到企业 owner（本次之前已有的兜底）。

#### Scenario: 旧模式老板收早报
- **WHEN** 旧模式企业中平台 `admin` + `org_owner` 的老板，生成老板询盘早报
- **THEN** 老板收到早报

#### Scenario: 业务员不收升级
- **WHEN** 只持 `trade_rep` 的成员，询盘超过 24 小时未回复
- **THEN** 该成员不收到升级提醒（收到的是首次提醒）

#### Scenario: 只管设置的企业管理员
- **WHEN** 旧模式企业中企业角色 `org_admin`、平台角色 `user` 的成员（只持外贸设置键），生成展会小结
- **THEN** 该成员不收到展会小结

#### Scenario: 压扁后的老板
- **WHEN** 岗位模式企业中平台角色 `user`、绑定 `owner` 的成员，SLA 升级档到期
- **THEN** 该成员收到升级提醒

### Requirement: 默认询盘负责人按派生角色
新询盘未命中既有客户的商机负责人时，默认负责人 SHALL 是本企业最早加入的、岗位派生平台角色为 `trade` 或 `sales` 的 active 成员；没有则 SHALL 是企业 owner。旧模式企业的派生角色即平台角色，选人结果 SHALL 与本次之前一致；岗位模式企业中平台角色压扁前后 SHALL 选到同一人。

#### Scenario: 旧模式默认给业务员
- **WHEN** 旧模式企业有平台 `admin` + `org_owner` 的老板（先加入）与平台 `trade` 的业务员，新客户询盘到达
- **THEN** 默认负责人是业务员

#### Scenario: 压扁后仍选到业务员
- **WHEN** 岗位模式企业中平台角色 `user`、绑定 `trade_rep` 的成员是唯一外贸人员，新客户询盘到达
- **THEN** 默认负责人是该成员

#### Scenario: 老板岗位不当默认负责人
- **WHEN** 岗位模式企业只有绑定 `owner` 的老板与绑定 `sales_rep` 的销售员，新客户询盘到达
- **THEN** 默认负责人是销售员
