# Spec Delta

## MODIFIED Requirements

### Requirement: 不放行时 302 到落地页
不放行的页面请求 SHALL 以 HTTP 302 重定向，页面 SHALL NOT 渲染。重定向目标 SHALL 为该用户进入首页后最终停留的页面：管理层为 `/`，但当前企业一张可见岗位卡片都没有时为 `/tasks`（见 `cockpit/post-registry`「岗位卡片的可见条件」）；其余按首页落地规则取第一个满足的，没有则为 `/tasks`。路由门与首页 SHALL 用同一个落地页函数计算这一目标。目标本身不放行，或与被请求路径相同时，SHALL 改落 `/tasks`。`Location` SHALL NOT 带原请求的查询串。系统 SHALL NOT 为此新增 403 页面，也 SHALL NOT 在客户端判定后再跳。

#### Scenario: 销售敲外贸与招投标
- **WHEN** 岗位模式下只持 `sales_rep` 岗位的成员依次请求以下路径：`/trade/prospects`、`/revenue`、`/projects`、`/projects/intelligence`、`/bids`、`/capabilities`、`/knowledge`、`/suppliers`、`/service-inbox`、`/reports`、`/marketing/employee`、`/operations/growth`、`/accounting`、`/install`、`/inventory`、`/blinds-orders`
- **THEN** 每一个都返回 302，`Location` 为 `/sales/home`（`route-gate.test.ts` 覆盖）

#### Scenario: 安装工敲营销与库存
- **WHEN** 只持 `installer` 岗位的成员请求 `/marketing/employee`、`/operations/growth`、`/inventory`
- **THEN** 每一个都返回 302，`Location` 为 `/install`（同一测试覆盖）

#### Scenario: 老板敲营收中心
- **WHEN** Sunny 持 `owner` 岗位的成员请求 `/revenue` 或 `/revenue/today`
- **THEN** 返回 302，`Location` 为 `/`（同一测试覆盖）

#### Scenario: 无工作区落地的岗位直接落任务页
- **WHEN** 只持 `fulfillment_vinyl` 岗位的成员请求 `/bids?tab=rfq`
- **THEN** 返回 302，`Location` 为 `/tasks`；不先到 `/`，也不带 `?tab=rfq`（同一测试覆盖）

#### Scenario: 没有可见岗位卡的管理层直接落任务页
- **WHEN** 一家只启用 `sales` 模块的岗位模式企业里持 `owner` 岗位、微信入口开关关闭的成员请求 `/bids`
- **THEN** 返回 302，`Location` 为 `/tasks`，不先到 `/`（同一测试覆盖）

#### Scenario: 落地页必放行且无环
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 对测试里的每一种身份，重定向目标都是放行的路径；从任一已登记路径出发，一次重定向就停在放行页面，测试通过
