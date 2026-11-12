## MODIFIED Requirements

### Requirement: 平台 super_admin 不受路由门限制
平台 super_admin 的页面请求 SHALL 一律放行，与改动前一致，包括他不是当前企业 active 成员的情况。各页面既有的平台管理员门与 Autopilot 门照旧生效。侧栏等价断言对 super_admin 不适用。以岗位预览期间（见 `authorization/position-preview`）SHALL NOT 适用本条：路由门按预览身份判定，与持所选岗位的企业成员相同。

#### Scenario: 平台管理员照旧
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以平台 super_admin 身份请求每一条已登记路径，包括当前企业里他不是成员、模块未开的路径
- **THEN** 全部放行，测试通过

#### Scenario: 预览期间按预览身份判定
- **WHEN** 同一测试中，平台 super_admin 带有效的预览（Sunny `accounting`）请求 `/bids` 与 `/accounting`
- **THEN** `/bids` 302 到落地页，`/accounting` 放行，与只持 `accounting` 的成员相同（同一测试覆盖）
