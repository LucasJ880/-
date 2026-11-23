## MODIFIED Requirements

### Requirement: 毛利率与成本加成写清楚
开关开着时，有财务查看权的人看卡片，卡片 SHALL 把毛利列与目标毛利写作「毛利率（按售价）」，并在目标毛利旁显示等价的成本加成率（m ÷ (1 − m)）。没有财务查看权的人 SHALL NOT 看到目标毛利、毛利列与成本加成提示（按 `tender/pricing-helper`「卡片上没有财务查看权时的显示」）。计算 SHALL NOT 改变。

#### Scenario: 目标毛利 20%
- **WHEN** 有财务查看权的人目标毛利填 20
- **THEN** 旁边显示「相当于成本加成 25%」，情景表数字与改动前相同（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

#### Scenario: 没有财务查看权、开关开着
- **WHEN** 读取结果带 `costHidden` 与 `compareCostHidden`
- **THEN** 卡片不渲染目标毛利输入框与成本加成提示（`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts` 源码断言）
