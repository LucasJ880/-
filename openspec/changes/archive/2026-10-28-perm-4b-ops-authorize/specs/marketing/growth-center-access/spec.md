# Spec Delta

## Purpose

增长中心（营销：品牌事实、活动、渠道账号、指标、实验、MMM、自动化、计划等）的写权限：只有持运营管理权的人能改，企业其他成员只读，平台角色不带来写权。

## ADDED Requirements

### Requirement: 增长中心写操作按 operations.manage
增长中心的全部写接口 SHALL 要求操作者在当前企业持有 `operations.manage`；不持有的人 SHALL 收到 403，响应文案说明当前账号只读。组织角色 `org_member` / `org_admin` 与平台角色 `admin` / `manager` SHALL NOT 因角色获得写权；平台 super_admin SHALL 通过平台管理员全权获得允许。

#### Scenario: 普通成员改活动
- **WHEN** 组织角色为 `org_member`、只持 `sales_rep` 岗位的人新建营销活动
- **THEN** 返回 403

#### Scenario: 运营主管改品牌事实
- **WHEN** 持 `ops_lead` 岗位的 Marty 保存增长中心品牌事实
- **THEN** 返回 200

#### Scenario: 平台 admin 无岗位
- **WHEN** 平台角色为 `admin`、在该企业无 `operations.manage` 的人保存增长中心品牌事实
- **THEN** 返回 403

### Requirement: 增长中心可编辑标记
增长中心品牌事实读取接口返回的 `permissions.canEdit` SHALL 与写接口判定一致：持 `operations.manage` 为 true，否则为 false。

#### Scenario: 运营人员看到只读
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 读取增长中心品牌事实
- **THEN** 响应 `permissions.canEdit` 为 false
