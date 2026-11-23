## MODIFIED Requirements

### Requirement: 报价引擎特权
报价引擎接口 SHALL 把平台 super_admin、在项目所属企业持 `ORG` 范围 `project.finance.manage` 的人、项目负责人视为特权（可看内部成本、编辑、批准）。看内部数字 SHALL 只给有财务查看权的人：特权，或在项目所属企业持 `ORG` 范围 `project.finance.read`；项目角色的成本读权限与 `ASSIGNED` 范围的 `project.finance.read` SHALL NOT 算。编辑与批准 SHALL 同时要求财务查看权与项目角色的成本写 / 审权限（特权直通）。企业成员角色 `org_admin` 本身 SHALL NOT 构成报价引擎特权。授权查询出错时 SHALL 只剩平台 super_admin 与项目负责人。

#### Scenario: org_admin 不再直通
- **WHEN** 企业成员角色为 `org_admin`、不持 `project.finance.manage`、项目角色为只读的项目成员请求报价内部成本
- **THEN** 不允许

#### Scenario: 老板直通
- **WHEN** 持 `owner` 岗位的项目成员请求批准报价
- **THEN** 允许

#### Scenario: 只读成员看不到内部数字
- **WHEN** 项目角色为 `viewer`（带项目成本读权限）、没有财务键的项目成员读报价列表与单个报价
- **THEN** 列表没有估算成本与毛利率，单个报价只返回客户视图，内部成本接口返回 403（`npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 会计只读看内部数字
- **WHEN** 持 `accounting` 岗位（组织范围 `project.finance.read`）、项目角色为 `viewer` 的成员读单个报价并尝试编辑
- **THEN** 读到内部视图，编辑返回 403（同一隔离库测试）

#### Scenario: 投标同事不能编辑
- **WHEN** 持 `bids` 岗位（`ASSIGNED` 范围 `project.finance.read`）、项目角色为 `operator` 的成员新建报价、编辑报价
- **THEN** 都返回 403；读列表没有估算成本与毛利率（同一隔离库测试）

#### Scenario: 判定出错
- **WHEN** 授权查询抛错
- **THEN** 项目负责人照旧有特权，持 `accounting` 岗位的成员看不到内部数字，请求不返回 500（`npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`）

## ADDED Requirements

### Requirement: 无财务查看权时报价引擎不输出什么
对没有财务查看权的人，报价引擎接口 SHALL NOT 返回估算成本、毛利、毛利率、加价率、定价比例、成本行、供应商、内部备注、成本导入与内部分析：报价列表不带估算成本与毛利率两项，「我方报价」这几项为空，单个报价只返回客户视图；返回的权限位 `canViewInternal`、`canEdit`、`canApprove` SHALL 都为 false。

#### Scenario: 响应里搜不到
- **WHEN** 只读成员读报价列表、「我方报价」与单个报价，报价成本行里放了一个少见的金额
- **THEN** 三个响应里都搜不到该金额；列表没有 `estimatedCost`、`grossMarginPct` 键，「我方报价」这两项为 null（`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

### Requirement: 报价引擎无权时的提示
「报价与成本」卡、投标页报价区列表、「我方报价」卡在没有财务查看权时 SHALL 不显示估算成本与毛利率，并 SHALL 显示一句：「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」投标页报价区在不能新建报价时 SHALL 不显示新建按钮，并 SHALL 显示一句：「你不是本项目负责人，不能新建、修改或批准报价；需要的话请找项目负责人。」单个报价页在没有财务查看权时 SHALL 显示第一句提示与客户视图（只含公开字段），SHALL NOT 显示成本行、情景表与任何编辑 / 批准按钮；读取失败时 SHALL 显示「打不开这个报价：」加接口给的原因；这两种情况 SHALL NOT 停在「加载报价引擎…」。能看内部数字的人看到的数字与按钮 SHALL 与改动前相同。

#### Scenario: 卡片提示
- **WHEN** 只读成员打开项目工作台
- **THEN** 「报价与成本」卡只显示 Bid、版本与状态，下面是第一句提示（`npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` 的源码断言；`npm run typecheck` 与 `npm run lint:baseline` 通过）

#### Scenario: 投标同事打开投标页报价区
- **WHEN** 持 `bids` 岗位、项目角色为 `operator`、不是负责人的成员打开投标页报价区
- **THEN** 没有新建按钮、没有估算成本与毛利率两列，显示上面两句提示（同一源码断言；接口侧 `NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts` 核对列表的 `canEdit`、`canViewInternal` 都为 false）

#### Scenario: 单个报价页
- **WHEN** 只读成员从卡片点进一个报价
- **THEN** 页面显示第一句提示和客户视图表格，没有成本行、情景表与编辑按钮（同一源码断言；`npm run typecheck`）

#### Scenario: 单个报价页读取失败
- **WHEN** 单个报价接口返回 403 或 404（报价引擎未启用、报价不存在、不是项目读者）
- **THEN** 页面显示「打不开这个报价：」加接口给的原因，不再显示「加载报价引擎…」（同一源码断言）
