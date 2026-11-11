# Spec Delta

## Purpose

顶栏全局搜索只搜当前用户本来就看得到的任务与打得开的项目：任务不越出本人可见的项目与本人的无项目任务，项目只列本人负责、本人管理的企业里的或本人参与的项目。

## ADDED Requirements

### Requirement: 任务结果的范围
`GET /api/search` 的任务结果 SHALL 只含：当前用户可见项目里的任务，以及本人创建的无项目任务；可见范围与关键词条件 SHALL 同时满足。平台 super_admin 不受范围限制。响应 SHALL NOT 含其他企业的任务或他人的无项目任务。

#### Scenario: 不搜到其他企业的任务
- **WHEN** 运行 `npx tsx src/lib/search/__tests__/search-where.test.ts`，样例里有本企业、其他企业与他人无项目的同名任务
- **THEN** 只返回本企业那条与本人的无项目任务，测试通过

### Requirement: 项目结果的范围
项目结果 SHALL 只在项目详情页对当前用户经路由门放行时返回，否则为空。返回的项目 SHALL 已分发，且当前用户可读：本人负责、本人在该项目所属企业为 org_admin 或 org_owner，或本人是项目 active 成员。平台 super_admin 不受限制。响应 SHALL NOT 含当前用户打不开的项目。响应形状保持 `{ tasks, projects }`。

#### Scenario: 销售搜不到项目
- **WHEN** 运行同一测试，以只持 `sales_rep` 岗位的输入计算是否搜项目
- **THEN** 不搜项目，项目结果为空，测试通过

#### Scenario: 普通成员只搜到自己参与的项目
- **WHEN** 企业里有三个项目，当前用户是 org_member、只是其中一个的 active 成员，且项目详情页对其放行
- **THEN** 项目结果只有那一个（同一测试覆盖）
