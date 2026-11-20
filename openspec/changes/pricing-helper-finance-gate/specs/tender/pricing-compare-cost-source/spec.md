## MODIFIED Requirements

### Requirement: 来自比价矩阵的成本建议
开关对项目的组织开启、且读取的人对本项目有财务查看权（见 `tender/pricing-helper`「我方成本只给有财务查看权的人」）时，报价表助手的读取接口 SHALL 返回一项成本建议：项目里最近一轮有人工选定（`isSelected`）且已报价、未取消的询价，用比价矩阵同一套换算算出那一家的落地价（CAD），带供应商名、轮次、数量口径、逐项金额与换算假设；之后已取消或草稿的轮次 SHALL NOT 算作「之后还有」。取数出错时 SHALL 只这一项显示暂不可用，SHALL NOT 让整个接口失败。没有选定时 SHALL 返回「还没有选定」的说明；换算不出落地价时 SHALL 返回原因，SHALL NOT 给出数字。SHALL NOT 用推荐或最低价代替选定。

#### Scenario: 最近一轮有选定
- **WHEN** 第 2 轮选定了一家 FOB 报价，汇率、海运、关税率、清关参数齐全
- **THEN** 接口返回这一家的落地价、第 2 轮、按询价单首档数量、逐项金额（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

#### Scenario: 最近一轮没有选定、更早一轮有
- **WHEN** 第 3 轮还没有选定，第 2 轮有
- **THEN** 建议来自第 2 轮，并写明之后还有第 3 轮尚未选定（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 已取消、草稿的轮次
- **WHEN** 第 3 轮有选定但已取消，第 4 轮还是草稿
- **THEN** 建议仍来自之前的选定，不说「之后还有」（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 供应商给了总价
- **WHEN** 选定的那一家报的是总价
- **THEN** 货值按总价，数量口径写明按件估算的费用按询价单首档数量（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 没有选定
- **WHEN** 项目有报价但没有任何一轮选定
- **THEN** 返回「还没有选定」，不给数字，即使矩阵里有推荐或最低价（`compare-cost-source-db.isolated.test.ts`）

#### Scenario: 换算不出落地价
- **WHEN** 选定的那一家缺汇率、缺贸易条款或缺关税率
- **THEN** 返回换算不出的原因，不给数字，卡片上没有填入按钮（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

#### Scenario: 开关关闭
- **WHEN** 开关关闭，或组织不在名单里
- **THEN** 接口不返回这一项，卡片与现在相同（`compare-cost-source-db.isolated.test.ts`；`compare-cost-source.test.tsx`）

#### Scenario: 没有财务查看权
- **WHEN** 开关开着、比价矩阵有选定，没有财务键的只读成员读取
- **THEN** 接口不返回这一项，也不去取数（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`）
