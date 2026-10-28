# Spec Delta

## Purpose

运营配置（品牌档案、内容计划、矩阵账号、postiz 集成、视频资产、投标档案、发布任务列表）与运营中心入口的读写权限：运营自己维护，老板与其他持读权的岗位看过程和结果；平台角色不带来任何隐含权限。

## ADDED Requirements

### Requirement: 运营配置读取按 operations.read
读取品牌档案、内容计划、矩阵账号、postiz 集成列表、视频资产列表与发布任务列表 SHALL 要求操作者在当前企业持有 `operations.read`（或 `operations.manage`）；不持有的人 SHALL 收到 403。平台 super_admin SHALL 通过平台管理员全权获得允许。

#### Scenario: 销售读品牌档案
- **WHEN** 只持 `sales_rep` 岗位的 Alex 请求品牌档案
- **THEN** 返回 403

#### Scenario: 老板读内容计划
- **WHEN** 持 `owner` 岗位的人请求内容计划列表
- **THEN** 返回 200

### Requirement: 运营配置写入按 operations.manage
创建或修改品牌档案、矩阵账号（新增 / 修改 / 删除）、postiz 集成、视频资产（新增、同步），以及派发选题与视频扇出 SHALL 要求操作者持有 `operations.manage`；不持有的人 SHALL 收到 403。平台角色 `boss` / `admin` SHALL NOT 因平台角色获得允许。

#### Scenario: 运营主管改品牌档案
- **WHEN** 持 `ops_lead` 岗位的 Marty 保存品牌档案
- **THEN** 返回 200

#### Scenario: 老板改品牌档案
- **WHEN** 只持 `owner` 岗位、平台角色为 `boss` 的人保存品牌档案
- **THEN** 返回 403

#### Scenario: 运营人员扇出视频
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 对视频发起扇出
- **THEN** 返回 403

### Requirement: 投标档案对招投标岗开放
读取投标档案 SHALL 允许持 `operations.read` 或 `project.read` 的人；保存投标档案 SHALL 允许持 `operations.manage` 或 `project.update` 的人；其余 SHALL 收到 403。

#### Scenario: 招投标岗维护投标档案
- **WHEN** 只持 `bids` 岗位的人保存投标档案
- **THEN** 返回 200

#### Scenario: 销售读投标档案
- **WHEN** 只持 `sales_rep` 岗位的人请求投标档案
- **THEN** 返回 403

### Requirement: 运营中心入口按权限
运营中心 `/ops` 的页面与接口 SHALL 对管理层（平台管理员、企业负责人 / 管理员、高管）与持任一 `operations.read` / `operations.manage` 的人开放；平台角色 `operations` SHALL NOT 单独构成放行条件。

#### Scenario: 平台角色 operations 无岗位
- **WHEN** 平台角色为 `operations`、在该企业无任何 `operations.*` 权限的普通成员访问运营中心首页接口
- **THEN** 返回 403

#### Scenario: 运营人员进入运营中心
- **WHEN** 持 `ops_staff` 岗位（含 `operations.read`）的人访问运营中心首页接口
- **THEN** 返回 200
