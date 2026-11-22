# Spec Delta

## Purpose

规定数字员工队列在一次带时间预算的调用里怎样使用时间：综合汇总、规划、风险分析旧分支、核验四类模型请求带上不越过整次调用截止时间的超时，可用时间不够时不发请求；被截止中止的工作交还队列、下一次调用接着做，累计次数有上限、中间的让出不清零；临近截止时不再认领任务、不再开新一轮；处理结果报告留下的工作并按既有的链式自触发接续。PERSIST 落库、模型 SDK 按限流应答的等待、费用预检、收尾步骤的外部情报不在本能力的保证之内。

## ADDED Requirements

### Requirement: 综合汇总的模型请求不越过整次调用的截止时间

带时间预算时，综合汇总步骤（现行一键分析的第 8 步）发起模型请求之前，系统 SHALL 算出可用时间「整次调用截止 − 15 秒 − 现在」：可用时间不足开工门槛时 SHALL NOT 发出请求；否则请求的超时 SHALL 取可用时间与 180 秒中较小的一个。开工门槛 SHALL 为 60 秒；时间预算本身减 15 秒小于 60 秒时，开工门槛 SHALL 为 10 秒。请求因 180 秒上限到点被中止、模型返回错误、或输出不合格时，SHALL 按既有失败规则计一次尝试。模型服务以限流应答并给出等待时长时，模型 SDK 内部的那一次等待不受本方计时器约束，不在本要求的保证之内。

#### Scenario: 时间预算本身很小
- **WHEN** 时间预算只有 50 秒，轮到综合汇总时还剩 40 秒
- **THEN** 开工门槛按 10 秒算，请求照常发出，超时是 25 秒
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 调用刚开始不久，模型 180 秒仍不返回
- **WHEN** 整次调用还剩 230 秒时开始综合，模型 180 秒仍不返回
- **THEN** 这次请求的超时是 180 秒，到点被中止后按既有失败规则计一次尝试：第一次这一步回到待执行并记下错误，尝试用尽后这一步以 `synthesis_failed` 失败
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过（综合返回错误、不返回 continuation）

#### Scenario: 模型返回 400
- **WHEN** 综合汇总的模型请求返回 400
- **THEN** 按既有失败规则计一次尝试，与没有时间预算时相同

#### Scenario: 模型账户余额不足
- **WHEN** 整次调用还剩 100 秒时开始综合，模型请求因模型账户余额不足返回 429（2026-11-22「12-3」那次的情形）
- **THEN** 按既有失败规则计一次尝试，与没有时间预算时相同；不算被截止中止，不写理由为 `INVOCATION_DEADLINE` 的让出事件
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过（综合返回错误、不返回 continuation）

### Requirement: 综合汇总被截止中止或没有发出时交还队列

综合汇总的请求因可用时间（而不是 180 秒上限）到点被中止、或因可用时间不足开工门槛没有发出时，系统 SHALL 把这一步放回待执行，SHALL NOT 增加这一步的尝试次数，SHALL NOT 把它记为失败或写失败事件，SHALL 写一条理由为 `INVOCATION_DEADLINE` 的工具让出事件（阶段为 `deadline_cut` 表示被中止、`deadline_skip` 表示没有发出），SHALL 把任务交还队列（任务尝试次数置 0）；下一次调用 SHALL 从这一步继续。「被中止」SHALL 只按错误的类型判定（模型 SDK 的中止错误，或读响应时被中止抛出的中止错误），SHALL NOT 按错误文案判定。

#### Scenario: 剩余 100 秒时开始综合，模型一直不返回
- **WHEN** 整次调用还剩 100 秒时轮到综合汇总，模型一直不返回
- **THEN** 这次请求的超时是 85 秒，到点后被中止；这一步回到待执行、尝试次数不变，任务回到队列、任务尝试次数为 0，有一条理由为 `INVOCATION_DEADLINE`、阶段为 `deadline_cut` 的工具让出事件，没有工具失败或任务失败事件
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过；隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

#### Scenario: 下一次调用接着做完综合
- **WHEN** 上一次调用里综合被截止中止，下一次调用认领这个任务时还剩 240 秒，模型返回合格的结果
- **THEN** 综合从这一步重新发出请求并完成，任务继续后面的步骤
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

#### Scenario: 剩余时间不够开工
- **WHEN** 时间预算为 240 秒，整次调用还剩 70 秒时轮到综合汇总
- **THEN** 不发出模型请求；这一步回到待执行、尝试次数不变，任务交还队列，工具让出事件的阶段为 `deadline_skip`

#### Scenario: 读响应时被中止
- **WHEN** 整次调用还剩 100 秒时开始综合，模型已开始返回、读响应的途中到了 85 秒的超时
- **THEN** 与请求被中止的处理相同：这一步回到待执行、尝试次数不变，工具让出事件的阶段为 `deadline_cut`
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 规划的模型请求不越过整次调用的截止时间

带时间预算时，任务首个时间片发起规划的模型请求之前，可用时间不足开工门槛时系统 SHALL NOT 发出请求；否则超时 SHALL 取可用时间与 90 秒中较小的一个。开工门槛 SHALL 为 40 秒；时间预算本身减 15 秒小于 40 秒时，开工门槛 SHALL 为 10 秒。请求因可用时间到点被中止、或没有发出时，系统 SHALL 把任务交还队列（任务尝试次数置 0），SHALL NOT 写入计划或步骤，SHALL NOT 记为失败，「交还队列」事件 SHALL 标明是因整次调用的截止；任务列表里这类任务 SHALL 显示为「排队中」（与尚未开始的任务相同）。其它失败 SHALL 按既有规则（任务级重试）处理。

#### Scenario: 剩余 70 秒时规划，模型一直不返回
- **WHEN** 一个需要规划的任务被认领，规划开始时整次调用还剩 70 秒，模型一直不返回
- **THEN** 这次请求的超时是 55 秒，到点被中止后任务回到队列、任务尝试次数为 0、没有计划与步骤，交还事件标明是因整次调用的截止
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

#### Scenario: 剩余时间不够规划
- **WHEN** 时间预算为 240 秒，规划开始时整次调用还剩 50 秒
- **THEN** 不发出规划的模型请求，任务交还队列、任务尝试次数为 0

#### Scenario: 时间预算本身很小时规划
- **WHEN** 时间预算只有 50 秒，规划开始时还剩 40 秒
- **THEN** 开工门槛按 10 秒算，规划请求照常发出，超时是 25 秒
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 风险分析旧分支的模型请求不越过整次调用的截止时间

带时间预算时，风险分析在没有 canonical V2 结果、要调模型的旧分支上，可用时间不足开工门槛时系统 SHALL NOT 发出请求；否则超时 SHALL 取可用时间与 180 秒中较小的一个。开工门槛 SHALL 为 60 秒；时间预算本身减 15 秒小于 60 秒时，开工门槛 SHALL 为 10 秒。请求因可用时间到点被中止、或没有发出时，系统 SHALL 按综合汇总的同一规则把这一步放回待执行、不增加尝试次数、写理由为 `INVOCATION_DEADLINE` 的工具让出事件、把任务交还队列；其它失败 SHALL 按既有规则处理。有 canonical V2 结果时风险分析只做投影、SHALL NOT 发出模型请求（与现在相同）。

#### Scenario: 剩余 100 秒时做风险分析旧分支
- **WHEN** 整次调用还剩 100 秒时轮到风险分析旧分支，模型一直不返回
- **THEN** 这次请求的超时是 85 秒，到点后被中止，这一步回到待执行、尝试次数不变，任务交还队列
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 时间预算本身很小时做风险分析旧分支
- **WHEN** 时间预算只有 50 秒，轮到风险分析旧分支时还剩 40 秒
- **THEN** 开工门槛按 10 秒算，请求照常发出，超时是 25 秒
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 核验的模型复核时间不够时采用确定性结论

带时间预算时，需要模型复核的核验在发出复核请求之前，可用时间不足开工门槛时系统 SHALL NOT 发出请求；否则超时 SHALL 取可用时间与 60 秒中较小的一个。开工门槛 SHALL 为 20 秒；时间预算本身减 15 秒小于 20 秒时，开工门槛 SHALL 为 10 秒。没有发出或请求被中止时，系统 SHALL 采用确定性核验的结论（与模型复核出错时的既有处理相同），SHALL NOT 因此把任务交还队列、重新核验或记为失败。全部完成标准都能确定性核验的计划（现行一键分析）SHALL NOT 发出复核请求（与现在相同）。

#### Scenario: 剩余 30 秒时需要模型复核
- **WHEN** 时间预算为 240 秒，一个 LLM 规划的任务最后一步完成时整次调用还剩 30 秒，核验需要模型复核
- **THEN** 不发出复核请求，按确定性核验的结论收尾
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 时间预算本身很小时需要模型复核
- **WHEN** 时间预算只有 30 秒，核验需要模型复核时还剩 28 秒
- **THEN** 开工门槛按 10 秒算，复核请求照常发出，超时是 13 秒
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 被截止中止的累计次数有上限

同一步的模型请求被整次调用的截止中止累计满 3 次之后，再一次被截止中止时，系统 SHALL 按既有失败规则计一次尝试，错误信息 SHALL 以 `INVOCATION_DEADLINE_REPEATED` 开头，并写明「这一步已累计 3 次因单次处理时间不够被中断」；按失败计次之后累计次数 SHALL 保持，之后再被截止中止 SHALL 仍按失败计次。因可用时间不够而没有发出的请求 SHALL NOT 计入次数；中间任何一次让出（包括没有发出、其它原因的让出）SHALL NOT 清零已有次数。同一个任务的规划被截止中止累计满 3 次之后，再一次 SHALL 按既有的任务级重试处理。

#### Scenario: 综合第 4 次被截止中止
- **WHEN** 一个任务的综合汇总已经被截止中止 3 次，这一次又被截止中止
- **THEN** 这一步按既有失败规则计一次尝试，错误信息以 `INVOCATION_DEADLINE_REPEATED` 开头
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

#### Scenario: 截断 2 次、没发出 1 次、再截断
- **WHEN** 一个任务的综合汇总先被截止中止 2 次，下一次因可用时间不够没有发出，再下一次又被截止中止
- **THEN** 累计次数为 3：没发出的那一次既不计入也不清零，这一次仍按让出处理、这一步回到待执行、尝试次数不变；再下一次被截止中止时按既有失败规则计一次尝试，错误信息以 `INVOCATION_DEADLINE_REPEATED` 开头
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过；隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

### Requirement: 整次调用剩余不足 80 秒不再认领任务

一次带时间预算的数字员工队列处理里，认领每一个任务之前系统 SHALL 检查整次调用的剩余时间；不足 80 秒时 SHALL NOT 认领该任务及其后的任务，这些任务 SHALL 保持原状态与尝试次数，系统 SHALL NOT 为它们写任何状态或事件。时间预算本身小于 80 秒时，这个门槛 SHALL 为 10 秒。

#### Scenario: 轮到认领时只剩 79 秒
- **WHEN** 队列里有两个可认领的任务，轮到认领时整次调用只剩 79 秒（例如前面已用掉 161 秒）
- **THEN** 两个任务都不被认领，状态与尝试次数都不变，没有认领事件，处理结果里「因时间不足未认领」为 2
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

#### Scenario: 时间充裕
- **WHEN** 轮到认领时整次调用还剩 240 秒
- **THEN** 任务照常被认领

#### Scenario: 预算本身很小
- **WHEN** 一次处理的时间预算只有 50 秒，轮到认领时还剩 45 秒
- **THEN** 门槛按 10 秒算，任务照常被认领
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 整次调用剩余不足 60 秒不开新一轮

一个任务的时间片里，开始每一轮之前系统 SHALL 检查整次调用的剩余时间；不足 60 秒时 SHALL 结束本时间片、把任务交还队列（任务尝试次数置 0），SHALL NOT 记为失败，「交还队列」事件 SHALL 标明是因整次调用的截止。时间预算本身小于 60 秒时，这个门槛 SHALL 为 10 秒。

#### Scenario: 开始下一轮时只剩 59 秒
- **WHEN** 一个任务被认领后，开始下一轮时整次调用只剩 59 秒，任务还有后续步骤
- **THEN** 不开始这一轮，任务回到队列，任务尝试次数为 0，没有失败事件，交还事件标明是因整次调用的截止
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过

### Requirement: 处理结果报告因时间留下的工作

数字员工队列处理的结果 SHALL 报告因时间不足未认领的任务数与因整次调用截止交还队列的时间片数（开轮门槛结束的、规划被截止中止或没有发出的）。`/api/cron/agent-runs` 的响应 SHALL 在 `workforce` 对象里带出 `skippedForBudget` 与 `deadlineContinuations` 两项；自动化运行记录的元数据 SHALL 记为 `workforceSkippedForBudget` 与 `workforceDeadlineContinuations`；既有的 `workforceYieldedContinuations` SHALL 只计让出（含综合、风险分析被截止中止或没有发出的），SHALL NOT 混入这两项。

#### Scenario: 一次调用里两个任务都没认领
- **WHEN** 一次定时调用轮到认领时只剩 79 秒，队列里有两个可认领的任务
- **THEN** 响应的 `workforce.skippedForBudget` 为 2，自动化运行记录元数据的 `workforceSkippedForBudget` 为 2
- **AND** 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts` 通过（处理结果的计数）；测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过（路由把两项写进响应与元数据）

### Requirement: 留下工作时沿用链式自触发

一次调用的处理结果里，因时间不足未认领或因截止交还的数大于 0 时，系统 SHALL 按与「有任务让出」相同的条件安排一次链式自触发（同一个开关、同一个深度上限、每次调用至多一次），SHALL NOT 新增任何调度或队列。

#### Scenario: 有未认领、没有让出
- **WHEN** 一次调用里第一个任务完成（没有让出），第二个任务因时间不足未认领，链式自触发已开启且未到深度上限
- **THEN** 本次调用结束后安排一次链式自触发
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 已到深度上限
- **WHEN** 同样留下了未认领的任务，但本次调用已在深度上限
- **THEN** 不安排自触发，留下的任务等下一次定时触发

### Requirement: 不带时间预算的调用方行为不变

不带时间预算时（脚本、同步入口、审批后的恢复），这四类模型请求 SHALL 不带超时、SHALL 照常发出，认领与开轮 SHALL NOT 受上述门槛影响，行为 SHALL 与以前相同。时间预算本身（截止时刻、预算毫秒数）SHALL NOT 写进计划、步骤输出、交接、事件负载或任务元数据。

#### Scenario: 不带时间预算做综合
- **WHEN** 不带时间预算的调用方推进到综合汇总
- **THEN** 模型请求不带超时，结果与以前相同
- **AND** 测试 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过
