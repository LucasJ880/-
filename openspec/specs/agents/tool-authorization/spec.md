# agents/tool-authorization Specification

## Purpose
Agent 工具调用的授权口径：工具可声明所需权限键，按调用主体（人或数字员工）的岗位权限判定；数字员工的回退与审批规则；助手模式的主体不变。

## Requirements

### Requirement: 工具声明所需权限
工具定义 SHALL 可以声明一个所需权限键。调用方提供了主体的权限键集合且工具声明了所需权限键时，工具授权 SHALL 以"主体是否持有该键"为准：不持有即拒绝（拒绝码 `permission_denied`），持有即不再看企业角色白名单。

#### Scenario: 持有所需权限
- **WHEN** 声明所需权限 `sales.customer.read` 的工具被持有该键的主体调用
- **THEN** 授权允许

#### Scenario: 缺所需权限
- **WHEN** 声明所需权限 `sales.customer.read` 的工具被不持有该键的主体调用
- **THEN** 授权拒绝，拒绝码为 `permission_denied`

### Requirement: 人类调用的过渡回退
人类主体调用未声明所需权限的工具时，工具授权 SHALL 维持原有企业角色白名单、工作区角色、模块与风险规则；调用方不提供主体时 SHALL 视为人类，结果与本次改动前一致。

#### Scenario: 不传主体行为不变
- **WHEN** 以 org_member、未声明所需权限、白名单含 `sales` 的工具调用且不传主体
- **THEN** 授权结果与本次改动前相同（允许）

### Requirement: 数字员工调用只认所需权限
数字员工主体调用未声明所需权限的工具时，工具授权 SHALL 拒绝（拒绝码 `permission_required`），SHALL NOT 回退到企业角色白名单。

#### Scenario: 未声明所需权限的工具
- **WHEN** 数字员工调用一个只有角色白名单、未声明所需权限的工具
- **THEN** 授权拒绝，拒绝码为 `permission_required`

### Requirement: 数字员工中高风险必审
数字员工主体调用风险等级为 `l2_soft` 或 `l3_strong` 的工具且授权允许时，结果 SHALL 标记需要审批；`l0_read`、`l1_internal_write` 按原规则。

#### Scenario: 软副作用工具
- **WHEN** 持有所需权限的数字员工调用风险 `l2_soft` 的工具
- **THEN** 授权允许且需要审批

#### Scenario: 只读工具
- **WHEN** 持有所需权限的数字员工调用风险 `l0_read` 的工具
- **THEN** 授权允许且不需要审批

### Requirement: 助手模式主体为操作者
主助手与运行时 v2 的执行主体 SHALL 是发起操作的人（人类主体，id 为发起人 user id），SHALL NOT 以数字员工主体执行。

#### Scenario: 运行时 v2 主体
- **WHEN** 运行时 v2 恢复一次由用户 U 发起的运行
- **THEN** 执行主体是用户 U 本人

### Requirement: 工具列表角色过滤取派生角色
智能体运行按平台角色过滤可用工具列表、并把角色放进工具执行上下文时，在岗位模式企业 SHALL 使用岗位派生平台角色（见 `agents/position-derived-role`），在旧模式企业 SHALL 使用原平台角色。工具策略表的 `allowRoles` 声明 SHALL NOT 因此改变。

#### Scenario: 岗位模式
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员启动智能体运行
- **THEN** 工具列表按 `sales` 过滤，工具执行上下文的角色为 `sales`

#### Scenario: 旧模式
- **WHEN** 无岗位模板企业中平台角色为 `sales` 的成员启动智能体运行
- **THEN** 工具列表按 `sales` 过滤，与本次改动前相同

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
