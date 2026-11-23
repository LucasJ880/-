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

#### Scenario: 组织管理员兼会计岗位
- **WHEN** 企业成员角色为 `org_admin`、持 `accounting` 岗位、不是项目成员的人读报价列表与单个报价，并尝试新建、编辑
- **THEN** 读到估算成本、毛利率与内部视图；新建、编辑返回 403（`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 判定出错
- **WHEN** 授权查询抛错
- **THEN** 项目负责人照旧有特权，持 `accounting` 岗位的成员看不到内部数字、结果标为暂时无法确认，请求不返回 500；判定本来就返回没有权限时不标（`npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`）

## ADDED Requirements

### Requirement: 无财务查看权时报价引擎不输出什么
对没有财务查看权的人，报价引擎接口 SHALL NOT 返回估算成本、毛利、毛利率、加价率、定价比例、成本行、供应商、内部备注、成本导入与内部分析：报价列表不带估算成本与毛利率两项，「我方报价」这几项为空，单个报价只返回客户视图；返回的权限位 `canViewInternal`、`canEdit`、`canApprove` SHALL 都为 false。

#### Scenario: 响应里搜不到
- **WHEN** 只读成员读报价列表、「我方报价」与单个报价，报价成本行里放了一个少见的金额
- **THEN** 三个响应里都搜不到该金额；列表没有 `estimatedCost`、`grossMarginPct` 键，「我方报价」这两项为 null（`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

### Requirement: 报价引擎看不到内部数字时的提示
没有财务查看权时，「报价与成本」卡（有报价时）、投标页报价区（有报价时）、「我方报价」卡（有我方报价时）、单个报价页 SHALL 不显示估算成本与毛利率，并 SHALL 显示：「估算成本和毛利率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」（没有真人负责人、暂时无法确认时按「没有真人负责人与暂时无法确认时的提示」换句。）能看内部数字的人看到的数字与按钮 SHALL 与改动前相同。

#### Scenario: 卡片提示
- **WHEN** 只读成员打开项目工作台，项目里有报价
- **THEN** 「报价与成本」卡只显示 Bid、版本与状态，下面是那一句（`npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` 的 QE-13 逐字与源码断言；`npm run typecheck`）

#### Scenario: 我方报价卡
- **WHEN** 只读成员打开项目工作台，项目有已选定的我方报价
- **THEN** 卡上有卖价与版本，没有估算成本、毛利、毛利率与定价方式，下面是那一句（同一测试；接口侧隔离库测试核对这几项为 null）

### Requirement: 报价引擎不能新建时的说明
不能新建报价的人打开投标页报价区时 SHALL NOT 看到新建按钮，SHALL 看到：「你不是本项目负责人，不能新建、修改或批准报价。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」报价区还没有报价时 SHALL NOT 再写「新建后进入…」。「报价与成本」卡在还没有报价、看的人不能新建时 SHALL NOT 显示「去创建报价」按钮与「在「投标」tab 新建…」那句，SHALL 显示同一句说明。

#### Scenario: 投标同事打开投标页报价区
- **WHEN** 持 `bids` 岗位、项目角色为 `operator`、不是负责人的成员打开投标页报价区
- **THEN** 没有新建按钮、没有估算成本与毛利率两列，显示上面那句与成本那句（QE-13 源码断言；接口侧 `NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts` 核对列表的 `canEdit`、`canViewInternal` 都为 false）

#### Scenario: 还没有报价
- **WHEN** 不能新建的人打开还没有报价的项目工作台
- **THEN** 「报价与成本」卡没有「去创建报价」按钮，也没有「在「投标」tab 新建…」，只写那一句说明（QE-13 源码断言）

### Requirement: 单个报价页没有权限时
单个报价页在没有财务查看权时 SHALL 只显示报价名称、状态、版本、上面两条要求里的两句与客户视图表格（只含公开字段），SHALL NOT 显示 KPI、成本行、情景表与任何编辑 / 批准按钮。读取失败时 SHALL 显示「打不开这个报价：」加接口给的原因。这两种情况 SHALL NOT 停在「加载报价引擎…」。保存遇到 403 时 SHALL NOT 重新读取页面（会切成客户视图、丢掉没保存的成本行），SHALL 写明没有保存、填的内容还留在页面上。

#### Scenario: 只读成员点进一个报价
- **WHEN** 只读成员从卡片点进一个报价
- **THEN** 页面显示两句提示和客户视图表格，没有成本行、情景表与编辑按钮（QE-13 源码断言；`npm run typecheck`）

#### Scenario: 读取失败
- **WHEN** 单个报价接口返回 403 或 404（报价引擎未启用、报价不存在、不是项目读者）
- **THEN** 页面显示「打不开这个报价：」加接口给的原因，不再显示「加载报价引擎…」（QE-13 源码断言）

#### Scenario: 保存被拒
- **WHEN** 正在编辑的人保存时接口返回 403
- **THEN** 页面不重新读取，写「没有保存：……填的内容还留在页面上……」，编辑中的成本行还在（QE-13 源码断言）

### Requirement: 没有真人负责人与暂时无法确认时的提示
项目负责人是导入建项目用的系统账号、或负责人账号不存在时，报价引擎、比价面板、询价追踪页的提示 SHALL 把「需要的话请找项目负责人。」换成「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。」，不能新建那句同样接这一句。授权查询出错、按兜底收紧时提示 SHALL 只写「暂时无法确认你的查看权限，请稍后刷新。」，SHALL NOT 写成没有权限，并 SHALL 记一条带固定标签、只含原因的错误日志。接口 SHALL 用 `hintReason`（`no_owner` / `unconfirmed`；追踪页另有 `mixed`）告诉界面用哪一句；默认那句时 SHALL NOT 带这个键。

#### Scenario: 负责人是系统账号
- **WHEN** 只读成员、投标同事读负责人是 `system@qingyan.internal` 的项目的报价列表、单个报价、比价矩阵、AI 报价分析
- **THEN** 都带 `hintReason: "no_owner"`；有真人负责人的项目不带（`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 四种说法
- **WHEN** 生成「落地价」「估算成本和毛利率」的提示
- **THEN** 默认那句与 CHAIN-2b 的「谁能看、找谁」逐字相同；没有真人负责人、混合、暂时无法确认各自一句；暂时无法确认时编辑与成本两句只出一次（`npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`；QE-13）
