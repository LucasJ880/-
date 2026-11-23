# Spec Delta

## Purpose

项目询价接口（询价列表、单轮明细、旧比价、询价写接口的返回、录入供应商报价）与询价明细表里，每家供应商的单价、总价与报价备注给谁、不输出什么、界面写什么。判定与成本核算、报价引擎同一个财务查看权。比价矩阵、AI 报价分析与询价追踪页不在本能力内。

## ADDED Requirements

### Requirement: 询价接口里的供应商报价只给有财务查看权的人
`GET /api/projects/{项目}/inquiries`、`GET …/inquiries/{轮次}`、`GET …/inquiries/{轮次}/compare` SHALL 先过项目读权限，再按与成本核算相同的财务查看权判定（平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；没有组织或授权查询出错时只认负责人与平台超级管理员）。没有的人：每家供应商的 `unitPrice`、`totalPrice`、`quoteNotes` SHALL 为 `null`，每个轮次（旧比价为每一行）SHALL 带 `priceHidden: true`；币种、交期、有效期、状态、是否选定、沟通备注、供应商与顺序 SHALL 照旧。有的人 SHALL 与改动前相同。

#### Scenario: 只读成员、组织管理员与负责人读询价
- **WHEN** 一轮询价里一家供应商报了单价 12.34、总价 4,567.89、报价备注「含运费，四周交货」；只读成员、不是成员也没有财务键的组织管理员、项目负责人分别读列表、单轮明细与旧比价
- **THEN** 前两人三处都拿到这家供应商的币种、交期与状态，单价、总价、报价备注为 `null`，带 `priceHidden: true`；负责人拿到的与改动前逐字段相同、没有 `priceHidden`（`NODE_ENV=test npx tsx src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts`）

#### Scenario: 形状不变
- **WHEN** 有权限与没有权限两种情况各裁剪一次同一轮询价
- **THEN** 有权限时结果与输入 `JSON.stringify` 相同；没有时只多 `priceHidden` 与三个 `null`，其余键与顺序不变（`npx tsx src/lib/inquiry/__tests__/inquiry-price-view.test.ts`）

### Requirement: 询价写接口的返回与录入供应商报价
询价写接口（改轮次、加供应商、标已发 / 已回复 / 已拒绝 / 未回复、选定与取消选定）SHALL 照常执行，对没有财务查看权的人 SHALL 按上一条裁剪返回。录入供应商报价（`POST …/inquiries/{轮次}/items/{条目}/record-quote`）对没有财务查看权的人 SHALL 返回 403「没有录入：供应商报价只给项目负责人和有全企业「查看项目结算」权限的人看和录入；需要的话请找项目负责人。」，SHALL NOT 写库、SHALL NOT 推 Muse 事件、SHALL NOT 推进项目阶段。有财务查看权的人 SHALL 与改动前相同。

#### Scenario: 不是负责人的项目管理员录入与选定
- **WHEN** 不是负责人也没有财务键的项目管理员给一家已报价的供应商录入新报价，再选定这家供应商
- **THEN** 录入得到 403 与那句话，这一条的单价、总价、报价备注与状态与请求前相同，没有新的 Muse 事件；选定成功，返回的条目单价、总价、报价备注为 `null`（`NODE_ENV=test npx tsx src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts`）

### Requirement: 没有财务查看权时询价接口不带出的内容
对没有财务查看权的人，询价列表、单轮明细、旧比价与询价写接口的返回 SHALL NOT 含任何一家供应商的单价、总价与报价备注。

#### Scenario: 响应里搜不到供应商报价
- **WHEN** 只读成员读列表、明细、旧比价，不是负责人的项目管理员标已回复、选定、取消选定
- **THEN** 每个响应的 JSON 里都搜不到 12.34、4567.89 与「含运费，四周交货」（`NODE_ENV=test npx tsx src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts`）

### Requirement: 询价明细表在没有财务查看权时的显示
轮次带 `priceHidden` 时，询价明细表的总价、单价两栏 SHALL 显示「—」，备注栏 SHALL NOT 显示报价备注（沟通备注照旧），表格上方 SHALL 写「供应商报价（单价、总价和报价备注）只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」（项目没有真人负责人、授权查询出错时按报价单同样换句），SHALL NOT 显示「录入报价」「更新报价」按钮。

#### Scenario: 明细表
- **WHEN** 询价明细表收到带 `priceHidden` 的一轮，看的人能编辑项目
- **THEN** 表上方有那句话，总价、单价两栏是「—」，没有报价备注，没有「录入报价」「更新报价」，「添加供应商」照旧（`npx tsx src/lib/inquiry/__tests__/inquiry-price-view.test.ts`）
