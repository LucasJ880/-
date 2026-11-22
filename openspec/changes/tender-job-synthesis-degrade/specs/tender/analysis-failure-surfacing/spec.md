# Spec Delta

## MODIFIED Requirements

### Requirement: 失败或卡住时收尾分析记录
以下两个时点写完之后，只要该 Job 在库里的状态是「失败」或「需要人工处理」，系统 SHALL 收尾。不论这个状态是处理器、执行器还是验证器写的，都要收尾。

- 处理器每认领处理完一次招投标域（`workDomain = tender`）的 AI 分析 Job；
- 租约超时且重试耗尽的清扫。

收尾是把该 Job 对应、仍在「AI 数字员工分析中」的分析记录改为「AI 分析未完成」，记下错误码与原因：

- 有失败的步骤时，错误码 SHALL 取第一个失败步骤自己的错误码；
- 没有失败的步骤，或那一步没有错误码时，才取 Job 的错误码；
- 都没有时取「需要人工处理」或「失败」的固定码。

以下情况 SHALL NOT 改动分析记录：分析记录已不在「分析中」，即已完成、已失败、已被取消或被新的一次取代。Job 在库里仍是活跃状态时 SHALL NOT 收尾，例如别的 worker 已接手。

#### Scenario: 第 3 步失败
- **WHEN** 招投标 Job 的第 3 步「Canonical V2 包级分析」失败、重试耗尽，Job 在库里为失败
- **THEN** 对应分析记录为「AI 分析未完成」，原因以「卡在第 3 步〈Canonical V2 包级分析〉：」开头（`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 停在需要人工处理
- **WHEN** 招投标 Job 被处理器写成「需要人工处理」
- **THEN** 对应分析记录同样为「AI 分析未完成」，原因写明停在哪一步（同一测试）

#### Scenario: 错误码取失败那一步的
- **WHEN** 第 3 步因 AI 账户余额不足失败（步骤错误码 `model_quota_exhausted`），下游步骤无法推进，Job 被写成「需要人工处理」（Job 错误码 `blocked_graph`）
- **THEN** 分析记录的错误码为 `model_quota_exhausted`，失败通知元数据里的错误码相同，`[tender-alert]` 日志写 `code=model_quota_exhausted`（同一测试）

#### Scenario: 已完成的分析不被改
- **WHEN** 分析记录已是「待审阅」，之后同一 Job 再被写成失败
- **THEN** 分析记录仍是「待审阅」，不发失败通知（同一测试）

### Requirement: 原因的写法
原因 SHALL 写成「卡在第 N 步〈步骤名〉：〈原因〉」，其中 N 是该步在计划里的顺序（从 1 起）。取哪一步：

- 第一个失败的步骤；
- 没有失败的步骤时，取第一个还没完成的步骤；
- 每一步都已完成时，取最后一步。

〈原因〉SHALL 按以下顺序由确定性的查表得出：

1. 失败那一步的错误码若是具体原因码：AI 账户余额不足、本组织本月 AI 费用已达上限、重试次数用尽、长时间没有进展。取表中文字。
2. 否则（项目卡片与失败通知这条路）在该失败步骤自己的错误里认招投标工具的已知标记：AI 账户余额不足、模型调用全部失败（未产出有效分析）、模型调用被限流、单次调用超时。余额不足 SHALL 排在限流之前。
3. 否则按该步的笼统错误码，如「工具执行失败」「综合汇总生成失败」。
4. 都不认识时写「执行出错」。

Job 的错误码（如 `blocked_graph`「前置步骤没有完成」、`verification_failed`「结果没有通过校验」）SHALL 只在所取的那一步不是失败步骤时使用。失败的那一步 SHALL NOT 被写成「前置步骤没有完成」。Job 停在需要人工处理、又没有更具体的原因时，写「需要人工处理」。

一个步骤都没有时，原因 SHALL 为「系统未记录原因」。原因 SHALL NOT 含原始错误文本、英文堆栈与内部错误码原文。长度 SHALL NOT 超过 300 字。

#### Scenario: 已知标记
- **WHEN** 第 3 步〈Canonical V2 包级分析〉失败，步骤错误里含 `ANALYSIS_EMPTY`
- **THEN** 原因为「卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析」（`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`）

#### Scenario: 余额不足
- **WHEN** 第 8 步〈Workforce 执行汇总〉失败，步骤错误码为 `model_quota_exhausted`，Job 错误码为 `blocked_graph`
- **THEN** 原因为「卡在第 8 步〈Workforce 执行汇总〉：AI 账户余额不足，请联系平台管理员充值」，不含「前置步骤没有完成」（同一测试）

#### Scenario: 余额不足的文本带 429
- **WHEN** 失败步骤的错误码是笼统的 `tool_failed`，错误文本是「HTTP 429 insufficient_quota」
- **THEN** 原因为「AI 账户余额不足，请联系平台管理员充值」，不是「模型调用被限流」（同一测试）

#### Scenario: 笼统错误码不回落到 Job 的错误码
- **WHEN** 第 8 步失败，步骤错误码为 `synthesis_failed`，错误文本不含任何已知标记，Job 错误码为 `blocked_graph`
- **THEN** 原因为「卡在第 8 步〈…〉：综合汇总生成失败」（同一测试）

#### Scenario: 不认识的错误
- **WHEN** 第 2 步失败，错误码与错误文本都不认识，错误文本是一段英文堆栈
- **THEN** 原因为「卡在第 2 步〈…〉：执行出错」，不含堆栈里的任何一行（同一测试）

#### Scenario: 没有步骤
- **WHEN** Job 在规划阶段就失败，还没有任何步骤
- **THEN** 原因为「系统未记录原因」（同一测试）

### Requirement: 失败通知带上停在哪一步
收尾后发出的既有失败通知 SHALL 在摘要里写明原因「卡在第 N 步〈步骤名〉：〈原因〉」，并提示可在项目里重新发起分析。这是站内通知，收件人为项目负责人与发起人，去重。原因与写进分析记录的那一句 SHALL 一字不差。通知 SHALL NOT 含原始错误文本，SHALL NOT 在有失败步骤时写「前置步骤没有完成」。

#### Scenario: 发起人收到通知
- **WHEN** 发起人不是项目负责人，Job 第 3 步失败
- **THEN** 两人各收到一条「招标分析未能完成」，摘要含「卡在第 3 步」与「重新发起分析」（`job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 通知写那一步自己的原因
- **WHEN** Job 第 3 步因 AI 账户余额不足失败、Job 被写成「需要人工处理」（`blocked_graph`）
- **THEN** 通知摘要含「卡在第 3 步〈Canonical V2 包级分析〉：AI 账户余额不足，请联系平台管理员充值」，不含「前置步骤没有完成」，不含 `quota`（同一测试）

### Requirement: AI 任务详情显示原因
AI 任务详情页在以下三种情况下 SHALL 写明「卡在第 N 步〈步骤名〉：〈原因〉」：

- Job「需要你处理」、等待类型为「需要人工处理」或「未知」、且没有结构化说明时，写在「需要你处理」框里。澄清、权限、审批等类型的标题本身已说明，不在此列。
- Job 失败时，显示一张「任务未能完成」卡，写这句原因。
- Job 里有失败的步骤、而 Job 本身还在进行中时，写在「进度」一节「N 项受阻」旁边。

几种情况下都算不出原因时 SHALL 写「系统未记录原因」，SHALL NOT 留空白，SHALL NOT 只显示「N 项受阻」。原因只由步骤的标题、顺序与错误码确定性得出，SHALL NOT 读取或显示运行记录与步骤上的原始错误文本。

#### Scenario: 失败的 Job
- **WHEN** 读一个第 3 步失败（错误码为工具执行失败）的 Job 详情
- **THEN** 视图里的停止原因为第 3 步、该步标题、「工具执行失败」（`npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts`）

#### Scenario: 需要你处理但没有说明
- **WHEN** Job 为「需要人工处理」，等待事件没有说明，第 3 步失败
- **THEN** 「需要你处理」框的说明为「卡在第 3 步〈…〉：工具执行失败」（同一测试）

#### Scenario: 进行中的 Job 有失败步骤
- **WHEN** Job 为「进行中」，第 3 步已失败（错误码 `model_quota_exhausted`）
- **THEN** 视图带停止原因「卡在第 3 步〈…〉：AI 账户余额不足，请联系平台管理员充值」，作业页进度一节在「1 项受阻」旁写出这句（同一测试）

#### Scenario: 读模型不读原始错误文本
- **WHEN** 读读模型的源码
- **THEN** 停止原因的计算不引用步骤或运行记录的 `errorMessage`（同一测试源码断言）

## ADDED Requirements

### Requirement: 三处说同一句
同一个停下的招投标 Job，有三处写停止原因：AI 任务详情页、项目卡片（分析为「AI 分析未完成」时）、失败通知。失败那一步的错误码是具体原因码（AI 账户余额不足、本组织本月 AI 费用已达上限、重试次数用尽、长时间没有进展）时，这三处的「卡在第 N 步〈步骤名〉：〈原因〉」SHALL 一字不差。失败那一步的错误码是笼统码时，项目卡片与失败通知 SHALL 用同一句（含已知标记识别出的原因），作业页 SHALL 用该笼统码的白话；三处的步骤序号与步骤名 SHALL 相同。

#### Scenario: 余额不足三处一致
- **WHEN** 第 3 步因 AI 账户余额不足失败、Job 停下并收尾
- **THEN** 作业详情视图的停止原因整句、项目卡片接口的原因、失败通知摘要里的原因三者相同（`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`）
