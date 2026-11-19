## Purpose

规定招投标 AI 分析 Job 失败或卡住时，系统怎样及时告诉人：项目上的分析记录收尾为「AI 分析未完成」并写明卡在哪一步、为什么，发一次失败通知，AI 任务详情与项目卡片显示同样的原因；不影响 Job 本身的状态与正常完成路径。

## ADDED Requirements

### Requirement: 失败或卡住时收尾分析记录
招投标域（`workDomain = tender`）的 AI 分析 Job 被处理器写成「失败」或「需要人工处理」（含租约超时且重试耗尽的清扫）且这次写入成功之后，系统 SHALL 把该 Job 对应、仍在「AI 数字员工分析中」的分析记录改为「AI 分析未完成」，记下错误码与原因。分析记录已不在「分析中」（已完成、已失败、已被取消或被新的一次取代）时 SHALL NOT 改动它。处理器丢失租约、写入没有成功时 SHALL NOT 收尾。

#### Scenario: 第 3 步失败
- **WHEN** 招投标 Job 的第 3 步「Canonical V2 包级分析」失败、重试耗尽，处理器把 Job 写成失败
- **THEN** 对应分析记录为「AI 分析未完成」，原因以「卡在第 3 步〈Canonical V2 包级分析〉：」开头（`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 停在需要人工处理
- **WHEN** 招投标 Job 被处理器写成「需要人工处理」
- **THEN** 对应分析记录同样为「AI 分析未完成」，原因写明停在哪一步（同一测试）

#### Scenario: 已完成的分析不被改
- **WHEN** 分析记录已是「待审阅」，之后同一 Job 再被写成失败
- **THEN** 分析记录仍是「待审阅」，不发失败通知（同一测试）

### Requirement: 只对招投标 Job、每个 Job 只收尾一次
系统 SHALL 只对招投标域的 Job 收尾；其它域的 Job 失败时 SHALL NOT 读写任何招投标分析记录、SHALL NOT 发招投标失败通知。同一个 Job 无论被处理器重复判为失败多少次，系统 SHALL 只改一次分析记录、只写一条审计 `tender.workforce.failed_surfaced`（目标为该 Job）、每位收件人只收到一条失败通知。

#### Scenario: 重放收尾
- **WHEN** 对同一个已收尾的招投标 Job 再调用一次收尾
- **THEN** 审计仍只有一条，发起人的失败通知仍只有一条（`job-failure-surfacing-db.isolated.test.ts`）

#### Scenario: 非招投标 Job
- **WHEN** 一个没有 `workDomain` 的 Job 失败
- **THEN** 没有招投标分析记录被改，没有招投标失败通知，没有该审计（同一测试）

### Requirement: 收尾不影响 Job
收尾过程中的任何错误 SHALL NOT 改变处理器已经写好的 Job 状态与返回结果，SHALL NOT 触发重试、排队或新的定时任务；错误只记日志。

#### Scenario: 收尾抛错
- **WHEN** 收尾时读取分析记录出错
- **THEN** 处理器的返回结果与不收尾时相同（`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 源码断言：调用处包在 try/catch 内且不改变返回值）

### Requirement: 原因的写法
原因 SHALL 写成「卡在第 N 步〈步骤名〉：〈原因〉」，其中 N 是该步在计划里的顺序（从 1 起），步骤是第一个失败的步骤；没有失败的步骤时取第一个还没完成的步骤。〈原因〉SHALL 由确定性的查表得出：先认招投标工具已知的失败标记（如「模型调用全部失败，未产出有效分析」「模型调用被限流」「单次调用超时」），再按错误码（如「重试次数用尽」「长时间没有进展」「工具执行失败」「需要人工处理」），都不认识时写「执行出错」。一个步骤都没有时，原因 SHALL 为「系统未记录原因」。原因 SHALL NOT 含原始错误文本、英文堆栈、内部错误码原文，长度 SHALL NOT 超过 300 字。

#### Scenario: 已知标记
- **WHEN** 第 3 步〈Canonical V2 包级分析〉失败，步骤错误里含 `ANALYSIS_EMPTY`
- **THEN** 原因为「卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析」（`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`）

#### Scenario: 不认识的错误
- **WHEN** 第 2 步失败，错误码与错误文本都不认识，错误文本是一段英文堆栈
- **THEN** 原因为「卡在第 2 步〈…〉：执行出错」，不含堆栈里的任何一行（同一测试）

#### Scenario: 没有步骤
- **WHEN** Job 在规划阶段就失败，还没有任何步骤
- **THEN** 原因为「系统未记录原因」（同一测试）

### Requirement: 失败通知带上停在哪一步
收尾后发出的既有失败通知（站内通知，收件人为项目负责人与发起人，去重）SHALL 在摘要里写明原因（「卡在第 N 步〈步骤名〉：〈原因〉」），并提示可在项目里重新发起分析。通知 SHALL NOT 含原始错误文本。

#### Scenario: 发起人收到通知
- **WHEN** 发起人不是项目负责人，Job 第 3 步失败
- **THEN** 两人各收到一条「招标分析未能完成」，摘要含「卡在第 3 步」与「重新发起分析」（`job-failure-surfacing-db.isolated.test.ts`）

### Requirement: AI 任务详情显示原因
AI 任务详情页 SHALL 在 Job「需要你处理」、等待类型为「需要人工处理」或「未知」且没有结构化说明时（澄清、权限、审批等类型的标题本身已说明，不在此列），在「需要你处理」框里显示「卡在第 N 步〈步骤名〉：〈原因〉」；Job 失败时 SHALL 显示一张「任务未能完成」卡，写同样的原因；两种情况下都算不出原因时 SHALL 写「系统未记录原因」，SHALL NOT 留空白。原因只由步骤的标题、顺序与错误码确定性得出，SHALL NOT 读取或显示运行记录与步骤上的原始错误文本。

#### Scenario: 失败的 Job
- **WHEN** 读一个第 3 步失败（错误码为工具执行失败）的 Job 详情
- **THEN** 视图里的停止原因为第 3 步、该步标题、「工具执行失败」（`npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts`）

#### Scenario: 需要你处理但没有说明
- **WHEN** Job 为「需要人工处理」，等待事件没有说明，第 3 步失败
- **THEN** 「需要你处理」框的说明为「卡在第 3 步〈…〉：工具执行失败」（同一测试）

#### Scenario: 读模型不读原始错误文本
- **WHEN** 读读模型的源码
- **THEN** 停止原因的计算不引用步骤或运行记录的 `errorMessage`（同一测试源码断言）

### Requirement: 项目卡片显示原因
项目页「AI 数字员工 · 投标分析」卡片在最近一次分析为「AI 分析未完成」时 SHALL 显示该分析记下的原因，按钮 SHALL 仍为「重新分析」（既有的重新发起）。项目卡片接口的最近分析 SHALL 带这个原因字段，且 SHALL NOT 带原始错误文本以外的内部字段。

#### Scenario: 卡片上的原因
- **WHEN** 最近一次分析为「AI 分析未完成」，原因为「卡在第 3 步〈Canonical V2 包级分析〉：模型调用全部失败，未产出有效分析」
- **THEN** 项目卡片接口的最近分析带这句原因，卡片显示它与「重新分析」按钮（`job-failure-surfacing-db.isolated.test.ts` 读接口；卡片渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 源码断言）

### Requirement: 没有开关
本收尾 SHALL 对所有组织生效，SHALL NOT 受任何功能开关控制。

#### Scenario: 不读开关
- **WHEN** 读收尾模块与处理器调用处的源码
- **THEN** 没有读取任何功能开关的环境变量（`job-failure-surfacing.test.ts` 源码断言）
