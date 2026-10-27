# Spec Delta

## Purpose

平台管理员权限：平台 super_admin 在任何企业内的有效权限如何产生，以及这种权限如何被标记以便审计区分。

## ADDED Requirements

### Requirement: 平台管理员在企业内全权
对平台角色为 `super_admin` 的人类主体，系统 SHALL 把权限目录中的全部权限键以 `ORG` 数据范围作为其有效权限，不依赖该企业内是否存在岗位绑定或成员记录。

#### Scenario: 无绑定也允许
- **WHEN** super_admin 在某企业内没有任何岗位绑定，对该企业资源请求 `sales.quote.read`
- **THEN** 判定为允许，匹配范围为 `ORG`

#### Scenario: 企业上下文不一致仍拒绝
- **WHEN** super_admin 的主体企业与请求企业不同
- **THEN** 判定为拒绝，原因为企业上下文不一致

### Requirement: 平台管理员权限来源标记
平台管理员的每条有效权限 SHALL 带来源标记 `platform_admin`，与岗位绑定来源（`binding:*`）和兼容回退来源（`compat:*`）可区分。

#### Scenario: 来源可区分
- **WHEN** 读取 super_admin 的有效权限列表
- **THEN** 每条的来源以 `platform_admin` 开头

### Requirement: 非平台管理员不受影响
平台角色为 `admin`、`boss`、`manager` 或其他非 `super_admin` 的人，SHALL NOT 因平台角色获得上述全权；其有效权限 SHALL 只来自岗位绑定或兼容回退。

#### Scenario: 平台 admin 无绑定
- **WHEN** 平台角色为 `admin` 的人在某企业内没有岗位绑定也不是 org_owner / org_admin，请求 `sales.quote.read`
- **THEN** 判定为拒绝，原因为无绑定
