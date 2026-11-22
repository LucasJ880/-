# Spec Delta

## Purpose

规定招投标一键分析停下之后，系统怎样确定性地判断能不能「从失败的这一步继续」。还规定继续时只重跑失败的那一步及其后续、复用已完成步骤的产出，以及入口、权限、项目卡片与失败通知怎样提示。

## ADDED Requirements

### Requirement: 关键步骤与可继续的条件

关键步骤 SHALL 定义为：招投标确定性计划里，综合汇总以外的每一步。这些步骤一旦失败，Job 就会停下。

一个招投标一键分析 Job，只有同时满足以下全部条件，系统 SHALL 判为「可继续」；任一条不满足 SHALL 判为不可继续：

1. 它是该项目最新创建的招投标分析 Job，并由服务端确定性计划执行。
2. 状态为「需要人工处理」，或者为「失败」，且停下的错误码属于执行类：依赖无法推进、结果没有通过校验、重试次数用尽、长时间没有进展。
3. 至少有一个失败的步骤，而且每一个失败步骤的错误码都属于执行失败：工具执行失败、综合汇总生成失败、AI 账户余额不足、本组织本月 AI 费用已达上限、重试次数用尽、长时间没有进展。
4. 没有执行中或等待审批的步骤。
5. 对应分析记录为「AI 分析未完成」，且不是用户取消。
6. 项目当前投标文件包的指纹与这次分析开始时记录的相同。
7. 把失败步骤的尝试次数清零后，全 Job 已用的执行次数加上「还没完成的步骤数」，不超过每个 Job 的执行次数上限。

判定 SHALL NOT 调用模型。

#### Scenario: 第 3 步余额不足
- **WHEN** 第 3 步因 AI 账户余额不足失败，第 4–9 步未开始，Job 为「需要人工处理」，分析记录为「AI 分析未完成」，文件包未变
- **THEN** 判为可继续（`npx tsx src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`）

#### Scenario: 契约损坏
- **WHEN** 失败步骤的错误码是「上游交接数据缺失」
- **THEN** 判为不可继续，原因为「这次的执行记录不完整，请重新分析」（同一测试）

#### Scenario: 文件包已变
- **WHEN** 停下之后项目里新上传了一份补遗
- **THEN** 判为不可继续，原因为「投标文件包已变化，请重新分析」（同一测试）

#### Scenario: 不是最新的 Job
- **WHEN** 同一项目之后又发起过一次分析
- **THEN** 旧 Job 判为不可继续（同一测试）

### Requirement: 继续只重跑失败的步骤及其后续

用户对可继续的 Job 执行「从失败的这一步继续」时，系统 SHALL 在同一个事务里完成以下几项，每一项都用条件更新：

- 每个失败步骤改回「待开始」，尝试次数清零，清掉错误码、错误原文与完成时间；
- Job 改为排队、尝试次数 0、立即可认领，清掉错误码与错误原文，并在 Job 元数据里把继续次数加 1；
- 分析记录改回「AI 数字员工分析中」，清掉错误码、原因与失败时间。

任一项没有命中 SHALL 整体回滚，并返回「状态已变化」。

继续 SHALL NOT 改动已完成步骤的状态、产出与尝试次数，SHALL NOT 新建 Job 或分析记录。提交后系统 SHALL 写一条用户可见的恢复事件（触发来源为「从失败的这一步继续」，带重置的步骤键），并写一条审计 `tender.workforce.continued`（目标为该 Job，记下发起人）。

#### Scenario: 已完成的步骤不再执行
- **WHEN** 第 3 步失败的 Job 被继续，随后被处理器跑完
- **THEN** 第 1、2 步的执行次数与产出与继续前相同，第 3–9 步完成，分析记录为「待审阅」，Job 为「已完成」，分析记录的 id 不变（`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`，隔离库）

#### Scenario: 第 3 步从检查点续跑
- **WHEN** 第 3 步失败前已经写过检查点，Job 被继续
- **THEN** 第 3 步从该检查点往下做，不从第一个内容段重来（同一测试）

#### Scenario: 并发
- **WHEN** 两个请求同时继续同一个 Job
- **THEN** 只有一个成功；另一个返回「状态已变化」，库里没有任何多余改动（同一测试）

### Requirement: 入口与权限

「从失败的这一步继续」的入口 SHALL 是 `POST /api/projects/[id]/tender-analysis/agent`，请求体 `{"action":"continue","jobId":"…"}`，权限 SHALL 与「重新分析」相同（项目写权限）。各种结果的返回：

| 情况 | 返回 |
|---|---|
| 成功 | 200 `{ "continued": true, "jobId": "…" }` |
| 缺 `jobId` | 400 |
| 无写权限 | 403（与「重新分析」相同） |
| Job 不属于该项目或不存在 | 404 |
| 不可继续或状态已变化 | 409，带一句中文原因 |

被拒绝的请求 SHALL NOT 改动任何数据。

#### Scenario: 只读成员
- **WHEN** 只有项目读权限的成员请求继续
- **THEN** 返回 403，Job、步骤、分析记录都不变（`continue-from-failed-db.isolated.test.ts`）

#### Scenario: 别的项目的 Job
- **WHEN** 请求里的 `jobId` 属于另一个项目
- **THEN** 返回 404（同一测试）

### Requirement: 项目卡片提示继续

项目卡片接口 SHALL 返回 `continuable`，取值由第一条要求的判定得出。可继续时，项目页「AI 数字员工 · 投标分析」卡片 SHALL 在「重新分析」旁显示主按钮「从失败的这一步继续」。不可继续时 SHALL 只显示「重新分析」。点击继续成功后，卡片 SHALL 回到「AI 分析中」。

#### Scenario: 卡片按钮
- **WHEN** 最近一次分析停在第 3 步、可继续
- **THEN** 卡片接口 `continuable` 为 true，卡片有「从失败的这一步继续」与「重新分析」两个按钮（`continue-from-failed-db.isolated.test.ts` 读接口；渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 源码断言）

### Requirement: 失败通知写明可以继续

停下时若判为可继续，失败通知的摘要 SHALL 以「可在项目里点「从失败的这一步继续」，或重新发起分析。」结尾；不可继续时保持「可在项目里重新发起分析。」。

#### Scenario: 可继续时的通知
- **WHEN** Job 第 3 步因 AI 账户余额不足停下、可继续
- **THEN** 两位收件人的通知摘要都以「可在项目里点「从失败的这一步继续」，或重新发起分析。」结尾（`continue-from-failed-db.isolated.test.ts`）

### Requirement: 继续不新增队列与模型调用

继续 SHALL 只把 Job 改回既有的排队状态，由既有的数字员工定时任务认领执行。系统 SHALL NOT 为继续新增队列、调度、租约、定时任务或执行者注册，继续动作本身 SHALL NOT 发起模型调用。执行时的身份与权限 SHALL 照既有规则由处理器与执行器重新校验。

#### Scenario: 由定时任务接手
- **WHEN** Job 被继续
- **THEN** 它的状态为排队、可立即认领；下一次数字员工队列处理把它认领执行，处理时重新校验发起人身份（`continue-from-failed-db.isolated.test.ts`）

### Requirement: 不外露内部文本

继续接口的响应、409 的原因与卡片接口的 `continuable`，SHALL NOT 含错误原文、内部错误码原文、文件指纹与模型或供应商名称。

#### Scenario: 409 的原因
- **WHEN** 因文件包已变化而拒绝继续
- **THEN** 响应只有中文原因，搜不到指纹值与任何错误码（`continue-from-failed-db.isolated.test.ts`）
