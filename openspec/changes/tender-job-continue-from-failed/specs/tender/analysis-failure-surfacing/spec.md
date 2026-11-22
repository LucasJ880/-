# Spec Delta

## MODIFIED Requirements

### Requirement: 只对招投标 Job、每个 Job 只收尾一次
系统 SHALL 只对招投标域的 Job 收尾。其它域的 Job 失败时，SHALL NOT 读写任何招投标分析记录，SHALL NOT 发招投标失败通知。

同一个 Job 的每一轮 SHALL 只收尾一次。一轮指从发起、或从一次「从失败的这一步继续」开始，到停下为止；轮次按这个 Job 已被继续的次数计。同一轮里无论被处理器重复判为失败多少次，系统 SHALL 只改一次分析记录、只写一条审计 `tender.workforce.failed_surfaced`（目标为该 Job），每位收件人只收到一条失败通知。继续之后再次停下属于新的一轮：系统 SHALL 再收尾一次、写一条新的审计，每位收件人收到一条新的失败通知。从未继续过的 Job，失败通知的去重方式 SHALL 与改动前相同。

#### Scenario: 重放收尾
- **WHEN** 对同一个已收尾的招投标 Job、同一轮再调用一次收尾
- **THEN** 审计仍只有一条，发起人的失败通知仍只有一条（`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 继续之后再次停下
- **WHEN** Job 被继续一次后又停下
- **THEN** 审计 `tender.workforce.failed_surfaced` 共两条，发起人共收到两条失败通知（`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`）

#### Scenario: 非招投标 Job
- **WHEN** 一个没有 `workDomain` 的 Job 失败
- **THEN** 没有招投标分析记录被改，没有招投标失败通知，没有该审计（`job-failure-surfacing-db.isolated.test.ts`）

### Requirement: 项目卡片显示原因
项目页「AI 数字员工 · 投标分析」卡片在最近一次分析为「AI 分析未完成」且记有原因时 SHALL 显示该原因（用户主动取消的不显示），此时 SHALL NOT 再另外显示「需要你处理」的说明。

对能用卡片发起的人（组织开了一键分析且过了用户级开关）：

- 该次分析可继续时，SHALL 显示主按钮「从失败的这一步继续」，「重新分析」为次按钮（见 `tender/analysis-continue-from-failed`）；
- 不可继续时，按钮 SHALL 仍为「重新分析」（既有的重新发起）。

对过不了用户级开关的人，SHALL NOT 显示发起按钮，也 SHALL NOT 显示「从失败的这一步继续」（见 `tender/analysis-single-entry`）。项目卡片接口的最近分析 SHALL 带这个原因字段，且 SHALL NOT 带原始错误文本以外的内部字段。

#### Scenario: 卡片上的原因
- **WHEN** 最近一次分析为「AI 分析未完成」，原因为「卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析」，这次分析不可继续
- **THEN** 项目卡片接口的最近分析带这句原因，卡片显示它与「重新分析」按钮（`job-failure-surfacing-db.isolated.test.ts` 读接口；卡片渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`）

#### Scenario: 可继续时两个按钮
- **WHEN** 同上，但这次分析可继续，当前用户能用卡片发起
- **THEN** 卡片显示这句原因，主按钮为「从失败的这一步继续」，另有「重新分析」（`job-failure-surfacing.test.ts`）

#### Scenario: 过不了用户级开关的人看到原因但没有按钮
- **WHEN** 同上，但当前用户过不了用户级开关
- **THEN** 卡片显示这句原因，不显示「重新分析」，也不显示「从失败的这一步继续」（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts` 纯函数）
