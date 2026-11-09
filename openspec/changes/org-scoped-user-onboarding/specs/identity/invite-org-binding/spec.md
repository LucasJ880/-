# Spec Delta

## Purpose

平台邀请码可以指定企业与企业内角色：用这样的码注册的人直接加入该企业、当前企业设为该企业、按既有规则绑定默认岗位，不再落进个人工作区。

## ADDED Requirements

### Requirement: 创建邀请码时可指定企业
平台 super_admin 创建邀请码（`POST /api/admin/invite-codes`）时 MAY 指定企业 `orgId` 与企业内角色 `orgRole`（`org_member` 或 `org_admin`，缺省 `org_member`）。指定企业时，平台角色 SHALL 为 `sales` 或 `trade`，企业 SHALL 存在且状态为 active，企业内角色 SHALL 在允许值内，否则 SHALL 返回 400 且不建码。不指定企业时 SHALL 与改动前一致（`orgId`、`orgRole` 为空）。

#### Scenario: 建绑定企业的销售码
- **WHEN** 平台 super_admin 用角色 `sales`、某启用企业创建邀请码，不填企业内角色
- **THEN** 返回 201，码的 `orgId` 为该企业、`orgRole` 为 `org_member`

#### Scenario: 角色或企业不合规
- **WHEN** 用角色 `operations` 绑定企业建码，或绑定一个已停用的企业，或企业内角色为 `org_owner`
- **THEN** 均返回 400，不建码

#### Scenario: 不绑定企业
- **WHEN** 不填企业创建角色为 `user` 的邀请码
- **THEN** 返回 201，`orgId` 与 `orgRole` 为空

### Requirement: 已有邀请码可补绑、改绑或解绑企业
`PATCH /api/admin/invite-codes/{id}` SHALL 接受 `orgId`（字符串或 `null`）与 `orgRole`。补绑或改绑 SHALL 按该码的平台角色做与创建相同的校验，不合规返回 400 且码不变；`orgId: null` SHALL 同时清空 `orgRole`。修改 SHALL NOT 影响已经用该码注册的用户。

#### Scenario: 给已有销售码补绑企业
- **WHEN** 平台 super_admin 给一张已有、未绑定企业的 `sales` 码补绑某启用企业
- **THEN** 返回 200；此后用该码注册的人直接加入该企业

#### Scenario: 给普通用户码补绑企业
- **WHEN** 给一张角色为 `user` 的码补绑企业
- **THEN** 返回 400，码不变

### Requirement: 邀请码列表显示所属企业
`GET /api/admin/invite-codes` SHALL 为每个码返回所属企业（id、名称、状态），未绑定为 `null`。邀请码页 SHALL 在列表显示企业，并在新建表单提供「加入企业」与「企业内角色」，选了企业时「绑定角色」只提供销售与外贸。

#### Scenario: 列表带企业名
- **WHEN** 平台 super_admin 打开邀请码列表，其中一张码绑定了企业
- **THEN** 该码的 `org.name` 为企业名称，未绑定的码 `org` 为 `null`

### Requirement: 用绑定企业的码注册直接加入企业
用绑定企业的邀请码注册 SHALL 加入该企业（按码上的企业内角色）、把当前工作企业设为该企业，SHALL NOT 建个人工作区；岗位模式企业 SHALL 按既有自动绑定规则绑定默认岗位（平台 `sales` → `sales_rep`）。有使用上限的码 SHALL 在上限内允许多人先后注册，达到上限后 SHALL 返回 400 且不建用户；不限次数的码 SHALL NOT 因已用次数被拒。

#### Scenario: 销售用企业码注册
- **WHEN** 新销售用一张绑定岗位模式企业、角色 `sales` 的码注册
- **THEN** 该用户是该企业的 `org_member`，当前企业为该企业，绑定了 `sales_rep` 岗位，没有个人工作区

#### Scenario: 多次使用的码
- **WHEN** 一张上限为 2 的企业码先后被三个人使用
- **THEN** 前两人加入企业，第三人返回 400 且没有建用户
