# Spec Delta

## MODIFIED Requirements

### Requirement: 非平台管理员不受影响
平台角色为 `admin`、`boss`、`manager` 或其他非 `super_admin` 的人，SHALL NOT 因平台角色获得上述全权；其有效权限 SHALL 只来自岗位绑定或兼容回退，其中兼容回退只在旧模式企业（行业包无岗位模板）发生，岗位模式企业只认岗位绑定。

#### Scenario: 平台 admin 无绑定
- **WHEN** 平台角色为 `admin` 的人在某企业内没有岗位绑定也不是 org_owner / org_admin，请求 `sales.quote.read`
- **THEN** 判定为拒绝，原因为无绑定

#### Scenario: 岗位模式企业平台 boss 无绑定
- **WHEN** 平台角色为 `boss` 的人是窗饰企业的 `org_owner` 但没有岗位绑定，请求 `sales.quote.read`
- **THEN** 判定为拒绝，原因为无绑定
