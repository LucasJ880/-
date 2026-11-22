# Spec Delta

## MODIFIED Requirements

### Requirement: 项目卡片显示原因
项目页「AI 数字员工 · 投标分析」卡片在最近一次分析为「AI 分析未完成」且记有原因时 SHALL 显示该原因（用户主动取消的不显示），此时 SHALL NOT 再另外显示「需要你处理」的说明；对能用卡片发起的人（组织开了一键分析且过了用户级开关），按钮 SHALL 仍为「重新分析」（既有的重新发起），对过不了用户级开关的人 SHALL NOT 显示发起按钮（见 `tender/analysis-single-entry`）。项目卡片接口的最近分析 SHALL 带这个原因字段，且 SHALL NOT 带原始错误文本以外的内部字段。

#### Scenario: 卡片上的原因
- **WHEN** 最近一次分析为「AI 分析未完成」，原因为「卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析」
- **THEN** 项目卡片接口的最近分析带这句原因，卡片显示它与「重新分析」按钮（`job-failure-surfacing-db.isolated.test.ts` 读接口；卡片渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 源码断言）

#### Scenario: 过不了用户级开关的人看到原因但没有按钮
- **WHEN** 同上，但当前用户过不了用户级开关
- **THEN** 卡片显示这句原因，不显示「重新分析」（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts` 纯函数）
