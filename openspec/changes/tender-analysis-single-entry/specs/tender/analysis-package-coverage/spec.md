# Spec Delta

## MODIFIED Requirements

### Requirement: 分析面板提醒还没纳入的能读文件

投标包 AI 体验开启时，能读的文件数（上传里格式支持、没有解析失败、没有超出页数上限的）比这次纳入分析的多 N 个时，分析面板 SHALL 在覆盖清单下面加一句「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；不多时 SHALL NOT 显示。当前用户能用一键分析卡片发起时（组织开了一键分析且过了用户级开关），这句 SHALL 只显示在卡片上，面板 SHALL NOT 重复；组织开了一键分析、卡片还没有回报能否发起时，面板 SHALL NOT 显示这句（见 `tender/analysis-single-entry`）。

#### Scenario: 能读的文件比纳入的多
- **WHEN** 能读的文件有 6 个、这次分析纳入了 4 个（不论另外有没有被排除的文件），当前用户不能用卡片发起
- **THEN** 面板清单下面写「有 2 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」；能读的不比纳入的多时不出现这句
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过（含分析面板接线的断言）

#### Scenario: 能用卡片发起的人只在卡片上看到
- **WHEN** 同上，但当前用户能用卡片发起
- **THEN** 面板清单下面没有这句，卡片上有同一句、同一个 N（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`）
