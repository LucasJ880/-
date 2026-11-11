# Spec Delta

## ADDED Requirements

### Requirement: 工具列表按模块过滤且与执行同一映射
智能体运行给模型的工具列表与 `GET /api/agent-core/tools` 返回的工具列表 SHALL 只含当前企业模块满足其所需模块的工具。所需模块的映射与企业模块输入 SHALL 与执行期授权相同（同一映射、同一份企业模块配置）；列表 SHALL NOT 出现执行期会以 `module_disabled` 拒绝的工具。企业未配置模块时不按模块限制，与执行期相同。

#### Scenario: 列表不多于执行期
- **WHEN** 运行 `npx tsx src/lib/agent-core/__tests__/tool-list-modules.test.ts`，对每个已注册工具与若干企业模块组合比较列表过滤与执行期模块判定
- **THEN** 结果逐一相同；只启用 `sales` 时列表没有 `trade_*`、`marketing_*`、`project_*`，测试通过

### Requirement: 营销工具随营销模块与品牌增长入口
`marketing_*` 工具的所需模块 SHALL 为 `marketing`（列表与执行期同一映射）。人类对话入口（助手对话、Agent Core 对话、微信对话）给模型的工具列表与 `GET /api/agent-core/tools` SHALL 另要求「品牌增长」入口对当前用户放行（平台 super_admin 视为放行）。数字员工、提及网关与后台运行的工具列表不加这道门。执行期授权不因此改变（人类调用仍按「人类调用的过渡回退」）。

#### Scenario: 销售的工具列表
- **WHEN** 运行同一测试，以 Sunny 只持 `sales_rep` 岗位的输入计算人类对话的工具列表
- **THEN** 没有 `marketing_*`、`trade_*`；只持 `ops_staff` 时有 `marketing_*`，测试通过

#### Scenario: 未启用营销模块
- **WHEN** 企业模块里没有 `marketing`，执行期授权 `marketing_get_growth_summary`
- **THEN** 拒绝，拒绝码为 `module_disabled`（同一测试覆盖）

#### Scenario: 只有人类入口传入入口门
- **WHEN** 运行同一测试
- **THEN** 源码断言助手对话、Agent Core 对话、微信对话（`agent-runtime/process.ts`）与工具列表接口传入入口门，提及网关不传（同一测试覆盖）
