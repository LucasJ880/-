# Spec Delta

## Purpose

销售区记录（客户、商机、测量记录、报价的签约 / PDF / 定金出口、销售目标）的访问判定：一律按岗位权限键、数据范围与资源归属决定，平台角色只有 super_admin 通过平台管理员全权获得允许，其他平台角色不带来任何隐含权限。

## ADDED Requirements

### Requirement: 销售区不因平台角色短路
客户、商机、测量记录、报价签约 / PDF / 定金、销售目标的读写判定 SHALL 只依据操作者在当前企业的岗位权限、数据范围与资源归属。平台角色为 `admin`、`boss`、`manager`、`sales` 等非 `super_admin` 的人 SHALL NOT 因平台角色获得这些判定的允许；平台 `super_admin` SHALL 通过平台管理员全权获得允许。

#### Scenario: 平台 admin 读他人客户
- **WHEN** 平台角色为 `admin`、在该企业无岗位绑定且组织角色为 `org_member` 的人读取他人创建的客户详情
- **THEN** 返回 403

#### Scenario: 平台 super_admin 读客户
- **WHEN** 平台 super_admin 带当前企业读取任一客户详情
- **THEN** 返回 200

### Requirement: 商机读写按资源判定
读取商机详情 SHALL 要求对该商机持有 `sales.opportunity.read`，修改商机 SHALL 要求持有 `sales.opportunity.update`；本人范围只覆盖本人创建或分配给本人的商机，全企业范围覆盖企业内全部商机。无权 SHALL 返回 403，跨企业或不存在 SHALL 返回 404。

#### Scenario: 销售改他人商机
- **WHEN** 只持 `sales_rep` 岗位的 Alex 修改他人创建且未分配给他的商机
- **THEN** 返回 403

#### Scenario: 老板改任意商机
- **WHEN** 持 `owner` 岗位的人修改企业内任一商机的阶段
- **THEN** 返回 200

### Requirement: 客户读写按资源判定
读取客户详情 SHALL 要求对该客户持有 `sales.customer.read`，修改客户 SHALL 要求持有 `sales.customer.update`；本人范围的修改 SHALL 继续受"允许修改客户"个人开关约束，全企业范围不受该开关约束。

#### Scenario: 销售读他人客户
- **WHEN** 只持 `sales_rep` 岗位的 Alex 读取他人创建的客户详情
- **THEN** 返回 403

#### Scenario: 老板改他人客户
- **WHEN** 持 `owner` 岗位的人修改销售 Alex 创建的客户电话
- **THEN** 返回 200

### Requirement: 客户归档按归档权
删除客户（软归档）SHALL 要求对该客户持有 `sales.customer.archive`；客户 SHALL 限定在当前企业，跨企业或不存在 SHALL 返回 404，无权 SHALL 返回 403。归档 SHALL NOT 级联删除报价、订单、互动。

#### Scenario: 销售归档客户
- **WHEN** 只持 `sales_rep` 岗位的 Alex 删除本人创建的客户
- **THEN** 返回 403，客户未归档

#### Scenario: 老板归档客户
- **WHEN** 持 `owner` 岗位的人删除企业内一位客户
- **THEN** 返回 200，客户带归档时间，名下报价与互动保留

#### Scenario: 跨企业归档
- **WHEN** 持 `owner` 岗位的人删除另一企业的客户
- **THEN** 返回 404

### Requirement: 测量记录按企业与范围列出
测量记录列表 SHALL 只返回客户属于当前企业的记录；持 `sales.customer.read` 全企业范围的人 SHALL 看到企业内全部记录，只持本人范围的人 SHALL 只看到本人测量的记录，不持该键的人 SHALL 收到 403。

#### Scenario: 销售只看本人测量
- **WHEN** 只持 `sales_rep` 岗位的 Alex 请求测量记录列表
- **THEN** 只返回 Alex 测量的、客户属于当前企业的记录

#### Scenario: 不返回其他企业记录
- **WHEN** 平台 super_admin 以企业 A 为当前企业请求测量记录列表
- **THEN** 不返回客户属于企业 B 的记录

### Requirement: 报价签约、PDF 与定金按报价改权
标记签约、上传报价 PDF、登记定金 SHALL 要求对该报价持有 `sales.quote.update`（本人范围覆盖本人创建的报价，全企业范围覆盖企业内全部报价）；报价 SHALL 限定在当前企业，跨企业或不存在 SHALL 返回 404，无权 SHALL 返回 403。

#### Scenario: 合价人为他人报价登记定金
- **WHEN** 持 `pricing_lead` 岗位的人为销售 Alex 已签约的报价登记定金
- **THEN** 返回 200

#### Scenario: 跨企业登记定金
- **WHEN** 任一非平台管理员对另一企业的报价登记定金
- **THEN** 返回 404，报价未变

### Requirement: 超限未批拦截只对平台 super_admin 放行
标记签约与上传报价 PDF 在超限折扣未批准时 SHALL 返回 409 `PROMOTION_APPROVAL_REQUIRED`；只有平台 super_admin SHALL 被放行，平台 `admin` SHALL NOT 被放行。

#### Scenario: 平台 admin 标记超限未批报价签约
- **WHEN** 平台角色为 `admin`、持 `owner` 岗位的人标记一份超限折扣未批准的报价为已签约
- **THEN** 返回 409 `PROMOTION_APPROVAL_REQUIRED`

### Requirement: 代设他人销售目标
修改本人销售目标 SHALL 不需要额外权限；为他人设置销售目标 SHALL 要求操作者持有全企业范围的 `sales.analytics.read`，且目标人 SHALL 是当前企业的活跃成员，否则 SHALL 返回 403。

#### Scenario: 销售替他人设目标
- **WHEN** 只持 `sales_rep` 岗位的 Alex 为另一位销售设置目标
- **THEN** 返回 403

#### Scenario: 老板替企业外的人设目标
- **WHEN** 持 `owner` 岗位的人为不在本企业的用户设置目标
- **THEN** 返回 403

### Requirement: 销售知识库索引初始化只限平台 super_admin
初始化销售知识库向量索引 SHALL 只允许平台 super_admin；其他人 SHALL 收到 403。

#### Scenario: 平台 admin 初始化索引
- **WHEN** 平台角色为 `admin` 的人请求初始化销售知识库索引
- **THEN** 返回 403
