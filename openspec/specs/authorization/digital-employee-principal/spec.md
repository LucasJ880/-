# authorization/digital-employee-principal Specification

## Purpose
数字员工作为独立授权主体：怎样被解析、权限从哪来、数据范围落在谁名下、哪些权限永远不给，以及四类数字员工默认对应的岗位。

## Requirements

### Requirement: 数字员工主体解析
数字员工 SHALL 以既有 Agent 记录为主体身份。解析数字员工主体时，系统 SHALL 在以下任一情况下拒绝：Agent 不存在；Agent 状态不是 `active`；Agent 所属项目不在当前企业；Agent 的 sponsor（创建人）不是当前企业 active 成员。拒绝时该主体的任何授权判定都 SHALL 为不允许。

#### Scenario: 正常解析
- **WHEN** 解析一个 active、属于当前企业项目、创建人是当前企业 active 成员的 Agent
- **THEN** 得到类型为 `DIGITAL_EMPLOYEE` 的主体，sponsor 为该 Agent 的创建人

#### Scenario: 停用的 Agent
- **WHEN** 解析一个 `status = disabled` 的 Agent
- **THEN** 解析失败，不返回主体

#### Scenario: 跨企业
- **WHEN** 以企业 A 解析一个属于企业 B 项目的 Agent
- **THEN** 解析失败

#### Scenario: 无 sponsor
- **WHEN** 以 `DIGITAL_EMPLOYEE` 类型构造主体引用但不提供 sponsor
- **THEN** 构造失败，原因码为 `SPONSOR_REQUIRED`

### Requirement: 数字员工有效权限来源
数字员工的有效权限 SHALL 只来自主体类型为 `DIGITAL_EMPLOYEE`、主体 id 为该 Agent id 的 active 岗位绑定。系统 SHALL NOT 对数字员工做企业成员角色兼容回退，SHALL NOT 给数字员工平台管理员全权，SHALL NOT 继承 sponsor 的岗位。

#### Scenario: 无绑定全拒
- **WHEN** 一个没有任何岗位绑定的数字员工请求 `sales.customer.read`
- **THEN** 判定不允许，原因码为 `NO_BINDING`

#### Scenario: 按绑定岗位放行
- **WHEN** 绑定了 `sales_rep` 的数字员工请求 `sales.quote.read`（不带资源）
- **THEN** 判定允许

#### Scenario: 不继承 sponsor
- **WHEN** sponsor 是 `owner` 岗位、数字员工只绑定 `sales_rep`，数字员工请求 `sales.quote.read` 读取他人报价
- **THEN** 判定不允许

### Requirement: 数字员工的数据范围落在 sponsor 名下
对数字员工，`PRINCIPAL` 范围 SHALL 在资源所有人等于 sponsor 时命中，`ASSIGNED` 范围 SHALL 在资源被分配人等于 sponsor 时命中；资源所有人等于 Agent id 本身 SHALL NOT 命中。`ORG` 范围与人类相同。

#### Scenario: sponsor 的客户
- **WHEN** sponsor 为 Alex 的销售数字员工读取 ownerId = Alex 的客户
- **THEN** 判定允许，命中范围为 `PRINCIPAL`

#### Scenario: 其他销售的客户
- **WHEN** sponsor 为 Alex 的销售数字员工读取 ownerId = Lynn 的客户
- **THEN** 判定不允许，原因码为 `RESOURCE_OUT_OF_SCOPE`

### Requirement: 数字员工禁区
对不在某权限键允许主体类型内的主体（禁区键清单见 `authorization/position-catalog`"数字员工禁区键登记"），授权判定 SHALL 为不允许（原因码 `PRINCIPAL_TYPE_NOT_ALLOWED`），即使该主体绑定了含该键的岗位。人类主体 SHALL 不受禁区影响。

#### Scenario: 绑定了也拒绝
- **WHEN** 绑定了 `accounting` 岗位（含 `install.task.assign`）的数字员工请求 `install.task.assign`
- **THEN** 判定不允许，原因码为 `PRINCIPAL_TYPE_NOT_ALLOWED`

#### Scenario: 数字员工永不审批
- **WHEN** 任意数字员工请求任一以 `.approve` 结尾的权限
- **THEN** 判定不允许

#### Scenario: 人类不受禁区影响
- **WHEN** 绑定了 `accounting` 岗位的人类请求 `install.task.assign`
- **THEN** 判定允许

### Requirement: 数字员工角色的默认岗位
四类数字员工角色 SHALL 各有一个默认岗位：销售数字员工 → `sales_rep`，营销增长数字员工 → `ops_staff`，投标数字员工 → `bids`，数据分析数字员工 → `accounting`。

#### Scenario: 映射完整
- **WHEN** 读取全部数字员工角色
- **THEN** 每个角色都有默认岗位，且岗位集合恰为 `sales_rep`、`ops_staff`、`bids`、`accounting`
