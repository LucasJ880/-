## ADDED Requirements

### Requirement: 比价落地价只给有财务查看权的人
比价矩阵接口与 AI 报价分析接口 SHALL 按当前登录者对本项目有没有财务查看权（平台超级管理员、在项目所属企业持 `ORG` 范围 `project.finance.manage` 或 `project.finance.read`、项目负责人；项目没有组织或授权查询出错时只剩平台超级管理员与项目负责人）返回落地价。有财务查看权时 SHALL 与改动前相同。没有时矩阵与响应顶层 SHALL 带 `costHidden: true`；排序、最低价与推荐标记、交期 / 有效期 / 强制项 / 起订量检查与检查说明、缺字段、换算不出的原因、供应商报价原价 SHALL 照常（供应商报 DDP 且币种为 CAD 时，原价与落地价相同）。

#### Scenario: 有财务查看权
- **WHEN** 项目负责人、持 `accounting` 岗位的成员、平台超级管理员读比价矩阵
- **THEN** 矩阵与改动前逐字段相同（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 没有财务查看权
- **WHEN** 项目只读成员、`bids` 岗位的项目成员、没有财务键的组织管理员读比价矩阵
- **THEN** 带 `costHidden: true`；排序、推荐与最低价同上一条，换算不出的那家仍写原因，供应商报价原价照常（同一隔离库测试）

#### Scenario: 判定出错与项目没有组织
- **WHEN** 授权查询抛错，或项目不属于任何组织
- **THEN** 两条接口用带兜底的判定：持组织键的人看不到落地价、项目负责人照常，接口不返回 500（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts` 的源码断言核对两条接口用的是带兜底的判定；`npx tsx src/lib/project-finance/__tests__/finance-access.test.ts`）

### Requirement: 无财务查看权时比价不输出什么
对没有财务查看权的人，比价矩阵接口与 AI 报价分析接口（含解读失败时的返回）SHALL NOT 输出落地单价、落地总价、换算说明里带金额或汇率的各条、带金额或百分比的一句话结论。一句话结论 SHALL 以「共 N 家报价（落地价金额不显示）。」开头，只写推荐谁、最低价那家为什么没推荐、哪几家换算不出；没有推荐时 SHALL 列前 3 家各自的问题；SHALL NOT 含任何金额与百分比。

#### Scenario: 响应里搜不到
- **WHEN** 只读成员读比价矩阵，一家 FOB 报价算出了一个少见的落地价与运费 / 保险 / 关税 / 汇率
- **THEN** 响应里搜不到这些数（DDP 且币种为 CAD 的报价，落地价就是供应商原价，不在此列）；结论里没有数字金额与「%」（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`；`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 检查说明照常
- **WHEN** 项目没设交付截止，只读成员读比价矩阵
- **THEN** 每行仍有「未设交付截止，按截标日 +30 天……判断交期」，带金额 / 汇率的换算说明都没有（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`）

#### Scenario: 没有推荐
- **WHEN** 没有一家检查全部通过
- **THEN** 结论写暂不推荐，列前 3 家各自的问题，不带金额（同一测试）

### Requirement: 无权时 AI 解读不看落地价
对没有财务查看权的人，AI 报价分析 SHALL 仍只调用一次模型；交给模型的输入 SHALL 带 `costHidden: true`，SHALL NOT 含落地价与带金额的结论；提示词 SHALL 写明本次不提供落地价、不得估算金额；解读里数字的出处 SHALL 是这份输入。报价分析面板在 `costHidden` 时 SHALL 显示：「落地价只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」（没有真人负责人、暂时无法确认时按 `projects/finance-access`「没有真人负责人与暂时无法确认时的提示」换句。）

#### Scenario: 模型输入
- **WHEN** 为只读成员组装 AI 报价分析的输入
- **THEN** 输入带 `costHidden: true`，搜不到任何一家的落地价，提示词里有「不提供落地价」；为项目负责人组装的输入与改动前逐字相同（`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`；隔离库测试用本机假模型服务核对实际发出的请求）

#### Scenario: 模型写出了落地价
- **WHEN** 模型给只读成员的解读里写了一家的落地价
- **THEN** 数字校验标出这个数（`numberCheck.ok` 为 false），正文就地标注；同一句解读给负责人时照常通过（`NODE_ENV=test npx tsx src/lib/project-finance/__tests__/finance-view-compare-quote-db.isolated.test.ts`）

#### Scenario: 面板提示
- **WHEN** 只读成员点「AI 报价分析」
- **THEN** 面板显示那一句（`compare.test.ts` 源码断言；`npm run typecheck`）

## MODIFIED Requirements

### Requirement: 落地价写明含什么、不含什么
以下只对有财务查看权的人（见本能力「比价落地价只给有财务查看权的人」）成立。落地价换算 SHALL 在返回里带逐项金额（货值、内陆、海运、保险、关税、清关；按贸易条款不加的项为空；DDP 写明已含在报价里），逐项各自到分、之和 SHALL 正好等于落地总价。比价矩阵结论与 Muse 比价理由 SHALL 写「到目的地，含关税，不含 GST/HST；DDP 以供应商报价为准」，SHALL NOT 写「含税」。落地价 SHALL NOT 计入 GST/HST。落地总价、排序、推荐与最低价 SHALL 与改动前相同。

#### Scenario: FOB 报价
- **WHEN** 一家 FOB 报价，海运、保险、关税、清关参数齐全
- **THEN** 逐项金额（各自到分）加起来正好等于落地总价（随机 3000 例也是）；总价与改动前相同（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`；`npx tsx src/lib/tender-rfq/__tests__/landed-cost.test.ts`）

#### Scenario: 结论措辞
- **WHEN** 生成比价矩阵结论
- **THEN** 结论里有「含关税，不含 GST/HST」，没有「含税」；Muse 比价理由里的同一句也改了（`compare-cost-source.test.tsx`）

#### Scenario: 没有财务查看权时的结论
- **WHEN** 为没有财务查看权的人生成结论
- **THEN** 以「共 N 家报价（落地价金额不显示）。」开头，不写落地价口径与金额（见「无财务查看权时比价不输出什么」；`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts`）
