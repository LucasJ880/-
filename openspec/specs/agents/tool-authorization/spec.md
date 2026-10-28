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
