# authorization/position-mode-residual-reads Specification

## Purpose
岗位模式企业（行业包有岗位模板）里，导航与 AI 之外仍按平台角色判定的接口、页面、通知与功能开关改按岗位（权限键或岗位派生平台角色）判定，使平台角色压扁前后行为一致；旧模式企业不变。

## Requirements

### Requirement: 自建工作区上下文带岗位信号
在岗位模式企业中，`/api/tasks`、`/api/tasks/[id]`、`/api/ops/projects`、`/api/projects/[id]/handoff`（含 preview / execute）构造的工作区访问上下文 SHALL 带上该人在当前企业的有效权限键与 `positionMode`。团队任务、运营项目、交接的放行 SHALL 由既有判定函数按这些信号得出，平台角色 SHALL NOT 单独带来管理范围。

#### Scenario: 老板岗位看团队任务
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员请求团队任务视图
- **THEN** 允许

#### Scenario: 平台 boss 无老板岗位
- **WHEN** 岗位模式企业中平台角色为 `boss`、企业角色 `org_member`、只绑定 `sales_rep` 的成员请求团队任务视图
- **THEN** 拒绝

#### Scenario: 运营主管看运营项目列表
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `ops_lead` 的成员请求运营项目列表
- **THEN** 允许

### Requirement: 审批决策与执行使用派生角色
在岗位模式企业中，人工审批（PendingAction 网页决策、agent 任务步骤审批、能力中台审批、微信确认）判定审批人能否决策、执行器判定审批人能否看到目标资源时，SHALL 使用岗位派生平台角色；结果 SHALL 与压扁前该人平台角色下的结果一致。

#### Scenario: 压扁后的老板执行销售的报价审批
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员批准一条针对销售所建报价的待审批动作
- **THEN** 执行器视其为全组织可见，动作执行，与压扁前平台角色 `boss` 时相同

### Requirement: 视觉方案范围使用派生角色并按企业过滤
视觉方案的列表、详情与新建校验 SHALL 使用岗位派生平台角色判定"全部"或"本人"范围；"全部"范围 SHALL 限定在当前企业内。

#### Scenario: 压扁后的老板
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员列出视觉方案
- **THEN** 看到本企业全部方案

#### Scenario: 不跨企业
- **WHEN** 平台角色为 `boss` 的人在企业 A 列出视觉方案
- **THEN** 结果不含企业 B 的方案

### Requirement: 前端按派生角色显示业务模块
`/api/auth/me` SHALL 返回 `effectiveRole`（当前企业的岗位派生平台角色；旧模式等于平台角色），`role` 字段 SHALL 保持平台角色不变。管理总览的销售 / 项目 / 外贸模块显示与助手工作台的营销数字员工入口 SHALL 按 `effectiveRole` 判定。

#### Scenario: 压扁后的老板看管理总览
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员打开管理总览
- **THEN** 显示销售模块与每日简报，与压扁前平台角色 `boss` 时相同

#### Scenario: me 接口保留平台角色
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/auth/me`
- **THEN** `role` 为 `user`，`effectiveRole` 为 `sales`

### Requirement: 微信绑定默认推送与入职清单按岗位
在岗位模式企业中，新建或重绑微信 / 企微账号的默认推送设置 SHALL 按岗位派生平台角色决定。管理员入职清单的"业务员"判定 SHALL 按是否持 `sales.quote.create` 或 `sales.quote.pricing_close`。

#### Scenario: 压扁后的销售绑定微信
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员新绑定微信
- **THEN** 默认开启销售推送，与压扁前平台角色 `sales` 时相同

### Requirement: 功能开关角色白名单使用派生角色
在岗位模式企业中，按角色白名单判定的功能开关（agent-supervisor、持久跟进、workforce runtime 等）SHALL 以岗位派生平台角色匹配白名单。

#### Scenario: 白名单含 sales
- **WHEN** 某功能开关白名单为 `sales`，岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员触发该功能
- **THEN** 命中白名单
