# Spec Delta

## MODIFIED Requirements

### Requirement: 营收中心导航与接口一致
旧模式企业中，营收中心与"今日询盘"导航入口 SHALL NOT 因平台角色 `sales` 可见（与接口口径一致）。岗位模式企业按外贸入口规则判定。两种模式下，这两个入口 SHALL 只在企业启用 `trade` 模块时出现，SHALL NOT 因企业启用 `sales` 模块而出现；入口不可见时，直接访问 `/revenue/**` SHALL 被路由门 302 到落地页（见 `navigation/route-gate`）。

#### Scenario: 旧模式销售看不到营收入口
- **WHEN** 旧模式企业中平台角色 `sales` 的成员加载导航（企业启用销售模块）
- **THEN** 不可见营收中心与今日询盘

#### Scenario: 未开外贸的岗位模式企业
- **WHEN** Sunny（启用 `sales`、未启用 `trade`）持 `owner` 岗位的成员加载导航，并直接请求 `/revenue`
- **THEN** 导航里没有营收中心与今日询盘；请求返回 302，`Location` 为 `/`（`npx tsx src/lib/navigation/__tests__/route-gate.test.ts` 覆盖）
