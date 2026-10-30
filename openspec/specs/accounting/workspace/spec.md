# accounting/workspace Specification

## Purpose
会计页面 `/accounting` 的入口：谁能看到导航、谁默认落地在这里、页签怎样按权限显示。

## Requirements

### Requirement: 会计入口可见性
导航入口"会计视图"（`/accounting`）SHALL 只对在当前企业持有 `accounting.read` 或 `project.finance.read` 的成员可见；不持这两个键的人 SHALL NOT 看到该入口。

#### Scenario: 会计可见
- **WHEN** 持 `accounting` 岗位的成员加载导航
- **THEN** 导航含"会计视图"

#### Scenario: 销售不可见
- **WHEN** 只持 `sales_rep` 岗位的成员加载导航
- **THEN** 导航不含"会计视图"

### Requirement: 会计默认落地
持 `accounting.read`、不是管理层、不是销售 / 运营专职、且不持 `project.create` / `project.update` / `operations.read` / `operations.manage` 的成员，默认工作区 SHALL 为 `/accounting`。旧模式下"销售 / 运营专职"按平台角色判定；岗位模式下按持 `sales.quote.create` / `sales.quote.pricing_close`（销售）与 `operations.*`（运营）判定，平台角色 SHALL NOT 参与。

#### Scenario: 纯会计落地会计页
- **WHEN** 只持 `accounting` 岗位的成员进入首页
- **THEN** 被导向 `/accounting`

#### Scenario: 招投标不落地会计页
- **WHEN** 持 `bids` 岗位（含 `project.finance.read`、`project.update`）的成员进入首页
- **THEN** 不被导向 `/accounting`

#### Scenario: 岗位模式下平台角色 sales 的会计
- **WHEN** 岗位模式下平台角色为 `sales`、只持 `accounting` 岗位的成员进入首页
- **THEN** 被导向 `/accounting`

### Requirement: 页签按权限显示
`/accounting` 页面 SHALL 有"成交与提成""报价过程""项目结算""待收尾款"四个页签；接口对当前用户返回 403 的页签 SHALL NOT 显示。URL 参数 `tab`（`sales` / `quotes` / `projects` / `balance`）指向当前用户可见的页签时 SHALL 直接打开该页签；切换页签 SHALL 同步更新 URL。

#### Scenario: 招投标只见项目结算
- **WHEN** 只持 `bids` 岗位的成员打开 `/accounting`
- **THEN** 只显示"项目结算"页签

#### Scenario: 会计从通知直达待收尾款
- **WHEN** 会计打开 `/accounting?tab=balance&order=<id>`
- **THEN** 显示"待收尾款"页签，且该单所在行被展开高亮（本地浏览器走查）

#### Scenario: 无权页签的 URL 参数
- **WHEN** 只持 `bids` 岗位的成员打开 `/accounting?tab=balance`
- **THEN** 显示"项目结算"页签，不显示"待收尾款"
