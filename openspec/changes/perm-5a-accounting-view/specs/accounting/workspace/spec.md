## Purpose

会计页面 `/accounting` 的入口：谁能看到导航、谁默认落地在这里、页签怎样按权限显示。

## ADDED Requirements

### Requirement: 会计入口可见性
导航入口"会计视图"（`/accounting`）SHALL 只对在当前企业持有 `accounting.read` 或 `project.finance.read` 的成员可见；不持这两个键的人 SHALL NOT 看到该入口。

#### Scenario: 会计可见
- **WHEN** 持 `accounting` 岗位的成员加载导航
- **THEN** 导航含"会计视图"

#### Scenario: 销售不可见
- **WHEN** 只持 `sales_rep` 岗位的成员加载导航
- **THEN** 导航不含"会计视图"

### Requirement: 会计默认落地
持 `accounting.read`、不是管理层、不是平台角色销售 / 运营专职、且不持 `project.create` / `project.update` / `operations.read` / `operations.manage` 的成员，默认工作区 SHALL 为 `/accounting`。

#### Scenario: 纯会计落地会计页
- **WHEN** 只持 `accounting` 岗位的成员进入首页
- **THEN** 被导向 `/accounting`

#### Scenario: 招投标不落地会计页
- **WHEN** 持 `bids` 岗位（含 `project.finance.read`、`project.update`）的成员进入首页
- **THEN** 不被导向 `/accounting`

### Requirement: 页签按权限显示
`/accounting` 页面 SHALL 有"成交与提成""报价过程""项目结算"三个页签；接口对当前用户返回 403 的页签 SHALL NOT 显示。

#### Scenario: 招投标只见项目结算
- **WHEN** 只持 `bids` 岗位的成员打开 `/accounting`
- **THEN** 只显示"项目结算"页签
