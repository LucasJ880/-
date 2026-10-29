# Spec Delta

## MODIFIED Requirements

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
