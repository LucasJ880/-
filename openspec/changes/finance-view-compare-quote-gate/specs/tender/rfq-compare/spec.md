## ADDED Requirements

### Requirement: 比价落地价只给有财务查看权的人
比价矩阵接口与 AI 报价分析接口 SHALL 按当前登录者对本项目有没有财务查看权（平台超级管理员、在项目所属企业持 `ORG` 范围 `project.finance.manage` 或 `project.finance.read`、项目负责人；授权查询出错时只剩平台超级管理员与项目负责人）返回落地价。有财务查看权时 SHALL 与改动前相同。没有时 SHALL 带 `costHidden: true`，排序、最低价与推荐标记、交期 / 有效期 / 强制项 / 起订量检查、缺字段与换算不出的原因 SHALL 照常。

#### Scenario: 有财务查看权
- **WHEN** 项目负责人、持 `accounting` 岗位的成员读比价矩阵
- **THEN** 矩阵与改动前逐字段相同（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 没有财务查看权
- **WHEN** 项目只读成员、`bids` 岗位的项目成员、没有财务键的组织管理员读比价矩阵
- **THEN** 带 `costHidden: true`；排序、推荐与最低价同上一条，换算不出的那家仍写原因（同一隔离库测试）

### Requirement: 无财务查看权时比价不输出什么
对没有财务查看权的人，比价矩阵接口与 AI 报价分析接口（含解读失败时的返回）SHALL NOT 输出落地单价、落地总价、换算说明里的逐项金额与汇率、带金额或百分比的一句话结论；一句话结论 SHALL 换成只写几家、推荐谁、最低价那家为什么没推荐、哪几家换算不出的版本，SHALL NOT 含任何金额与百分比。

#### Scenario: 响应里搜不到
- **WHEN** 只读成员读比价矩阵，某家落地总价是一个少见的数
- **THEN** 响应里搜不到该数与该轮任何逐项金额；结论里没有数字金额与「%」（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

### Requirement: 无权时 AI 解读不看落地价
对没有财务查看权的人，AI 报价分析 SHALL 仍只调用一次模型，交给模型的输入 SHALL NOT 含落地价与带金额的结论，提示词 SHALL 写明本次不提供落地价、不得估算金额；解读里数字的出处 SHALL 是这份输入。报价分析面板在 `costHidden` 时 SHALL 显示一句：「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」

#### Scenario: 模型输入
- **WHEN** 为只读成员组装 AI 报价分析的输入
- **THEN** 输入里搜不到任何一家的落地价，提示词里有「不提供落地价」；为项目负责人组装的输入与改动前相同（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`）

#### Scenario: 面板提示
- **WHEN** 只读成员点「AI 报价分析」
- **THEN** 面板显示那一句提示；`npm run typecheck` 与 `npm run lint:baseline` 通过
