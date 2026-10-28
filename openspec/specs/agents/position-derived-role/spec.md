# agents/position-derived-role Specification

## Purpose
岗位模式企业（行业包有岗位模板）里，AI / 智能体一侧（工具、能力、微信域、晨报、Muse、AI 上下文、营销数字员工、功能开关白名单）用"岗位派生平台角色"代替 `User.role`，使行为由岗位决定，且平台角色压扁（4c3）前后一致；旧模式企业不变。

## Requirements

### Requirement: 岗位派生平台角色规则
系统 SHALL 提供岗位派生平台角色：
- 企业不是岗位模式时，SHALL 等于原平台角色；
- 原平台角色为 `super_admin`、`admin` 或 `trade` 时，SHALL 等于原平台角色；
- 否则按该人在该企业的有效权限键依次取第一个满足的：
  - 持 `organization.dashboard.read` → `boss`；
  - 持 `sales.quote.create` 或 `sales.quote.pricing_close` → `sales`；
  - 持 `operations.read` 或 `operations.manage` → `operations`；
  - 其余 → `user`。

派生角色 SHALL NOT 写回 `User.role`；有效权限键解析失败时 SHALL 按无权限键处理（派生为 `user`）。

#### Scenario: 压扁后的销售
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员
- **THEN** 派生角色为 `sales`

#### Scenario: 平台角色不决定派生
- **WHEN** 岗位模式企业中平台角色为 `boss`、只绑定 `ops_staff` 的成员
- **THEN** 派生角色为 `operations`

#### Scenario: 老板岗位
- **WHEN** 岗位模式企业中绑定 `owner` 与 `pricing_lead` 的成员
- **THEN** 派生角色为 `boss`

#### Scenario: 外贸与平台管理员保留
- **WHEN** 岗位模式企业中平台角色为 `trade` 或 `admin` 的成员
- **THEN** 派生角色等于原平台角色

#### Scenario: 旧模式企业不变
- **WHEN** 无岗位模板企业中平台角色为 `sales` 的成员
- **THEN** 派生角色为 `sales`，与岗位绑定无关

### Requirement: AI 入口使用派生角色
在岗位模式企业中，下列 AI 入口凡是按平台角色判定的地方 SHALL 使用派生角色：
- 智能体运行（`runAgent` / `runAgentStream`）的工具列表过滤与工具执行上下文；
- AI 线程消息路由的能力矩阵、系统提示词、工作上下文、路由器与功能开关白名单；
- 线程重试、`/api/ai/chat`、`/api/agent-core/chat`、`/api/agent-core/tools`；
- 微信会话的工具域选择、@提及网关策略、运行时 v2 主体、agent-supervisor 发起入口。

#### Scenario: 压扁后的销售仍有销售工具
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员在 AI 线程里对话
- **THEN** 可用工具包含 `sales_*` 与 `secretary_*` 工具，与压扁前平台角色为 `sales` 时相同

#### Scenario: 平台角色 sales 但不是销售岗位
- **WHEN** 岗位模式企业中平台角色为 `sales`、只绑定 `ops_staff` 的成员在 AI 线程里对话
- **THEN** 可用工具不含 `sales_*` 工具

#### Scenario: 微信入口
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `pricing_lead` 的成员从微信发起对话
- **THEN** 工具域包含 `sales`

### Requirement: 岗位模式下的 Muse 销售查询范围
岗位模式企业中，Muse 销售查询 SHALL 按派生角色判定范围：
- 派生角色为管理层（`boss`，即持 `organization.dashboard.read`）→ 全组织并输出金额（决定 B）；
- 派生角色为 `sales` → 仅本人、不输出金额；
- 其余 → 拒绝。

企业成员角色 `org_owner` / `org_admin` 在岗位模式下 SHALL NOT 单独带来全组织范围。旧模式企业 SHALL 保持原规则。

#### Scenario: 老板岗位看金额
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员通过 Muse 查询销售数据
- **THEN** 范围为全组织，输出商机金额

#### Scenario: org_owner 无老板岗位
- **WHEN** 岗位模式企业中企业角色为 `org_owner`、只绑定 `ops_lead` 的成员通过 Muse 查询销售数据
- **THEN** 拒绝

#### Scenario: 压扁后的销售
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员通过 Muse 查询销售数据
- **THEN** 范围为本人，不输出金额

### Requirement: 晨报、AI 上下文与营销数字员工使用派生角色
岗位模式企业中，下列判定 SHALL 使用派生角色：
- 晨报扫描域；
- AI 上下文挂客户时"销售只能挂自己创建的客户"的限制；
- 营销数字员工的可用性（接口与微信入口）。

#### Scenario: 压扁后销售晨报
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员生成晨报
- **THEN** 扫描销售域，与压扁前相同

#### Scenario: 压扁后销售不被放宽
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员把他人创建的客户挂进 AI 上下文
- **THEN** 拒绝（`customer_access_denied`）

#### Scenario: 压扁后销售仍不能用营销数字员工
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员调用营销数字员工接口
- **THEN** 拒绝，与压扁前相同
