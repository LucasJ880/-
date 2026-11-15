## MODIFIED Requirements

### Requirement: 平台管理员在企业内全权
对平台角色为 `super_admin` 的人类主体，系统 SHALL 把权限目录中的全部权限键以 `ORG` 数据范围作为其有效权限，不依赖该企业内是否存在岗位绑定或成员记录。以岗位预览期间（见 `authorization/position-preview`）SHALL NOT 适用本条：有效权限只取所选岗位在预览企业的权限，其他企业无权限。

#### Scenario: 无绑定也允许
- **WHEN** super_admin 在某企业内没有任何岗位绑定，对该企业资源请求 `sales.quote.read`
- **THEN** 判定为允许，匹配范围为 `ORG`

#### Scenario: 企业上下文不一致仍拒绝
- **WHEN** super_admin 的主体企业与请求企业不同
- **THEN** 判定为拒绝，原因为企业上下文不一致

#### Scenario: 预览期间只取所选岗位
- **WHEN** 运行 `npx tsx src/lib/preview/__tests__/preview-db.isolated.test.ts`（本机隔离库），super_admin 以 Sunny `accounting` 预览后，在 Sunny 请求 `sales.quote.discount.over_limit.approve` 与会计岗位持有的键，并在另一企业请求任一键
- **THEN** 前者拒绝、会计的键允许，另一企业拒绝；不带预览 cookie 的同一用户照旧全部允许（同一测试覆盖）
