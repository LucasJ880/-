# Spec Delta

## ADDED Requirements

### Requirement: 岗位模式企业不做成员角色兼容回退
对岗位模式企业（行业包有岗位模板，如窗饰 `window_covering_services_v1`）的人类主体，有效权限 SHALL 只来自其在该企业的 active 岗位绑定；没有任何 active 绑定时 SHALL 为空，SHALL NOT 按 `OrganizationMember.role`（`org_owner` / `org_admin` / `org_viewer`）或平台角色 `sales` 回退到系统模板。旧模式企业（无岗位模板）SHALL 保持原兼容回退。平台 `super_admin` 的全权 SHALL NOT 受影响。

#### Scenario: 岗位模式企业无绑定的 org_owner
- **WHEN** 窗饰企业的 `org_owner` 成员没有任何 active 岗位绑定，请求 `sales.quote.read`
- **THEN** 判定为拒绝，原因为无绑定

#### Scenario: 岗位模式企业无绑定的平台 sales
- **WHEN** 窗饰企业平台角色为 `sales` 的 `org_member` 没有任何 active 岗位绑定
- **THEN** 有效权限为空（不回退到 `sales_rep`）

#### Scenario: 有绑定照常
- **WHEN** 窗饰企业成员绑定了 `sales_rep` 岗位
- **THEN** 有效权限为该岗位（系统模板 + 行业包并集）的绑定，来源为 `binding:*`

#### Scenario: 旧模式企业照旧回退
- **WHEN** 无岗位模板企业的 `org_owner` 成员没有岗位绑定
- **THEN** 有效权限为系统模板 `org_owner` 的绑定，来源为 `compat:*`
