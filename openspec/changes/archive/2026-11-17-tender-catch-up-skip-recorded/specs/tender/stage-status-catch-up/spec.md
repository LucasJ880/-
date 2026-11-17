## MODIFIED Requirements

### Requirement: 不补的情形
以下情形系统 SHALL 与原来一样返回「无需重复推进」或「不允许回退」、SHALL NOT 改任何东西、SHALL NOT 发回调：不是招投标项目；没有人确认；项目不是进行中；招投标状态已是结果或系统认不出；招投标状态不落后于人确认的阶段；写入时招投标状态或项目状态已被别人改了；调用带了发生时间或预期状态（「写入阶段时间」的调用，如 FLOW-H4a 的「记录提交」）。同一次补状态 SHALL 只发生一次。

#### Scenario: 没确认、已放弃、已有结果、状态不落后
- **WHEN** 阶段已到，但没有人确认；或项目已放弃；或不是招投标项目；或状态是未中标；或状态已是「供应商报价」或「投标准备」；或状态已是「供应商报价」时人确认更早的「项目解读」
- **THEN** 返回「无需重复推进」，状态不变，没有审计、没有回调（`stage-status-catch-up-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts`）

#### Scenario: 同时点两次
- **WHEN** 两个确认同时到达
- **THEN** 只补一次：一条审计、一次回调（`stage-status-catch-up-db.isolated.test.ts`）

#### Scenario: 带了发生时间或预期状态的确认推进
- **WHEN** 人确认推进到已记录的阶段、招投标状态落后，但调用带了发生时间或预期状态
- **THEN** 返回「无需重复推进」，招投标状态不变，没有审计、没有回调（`stage-status-catch-up-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts`）
