# tender/stage-auto-advance Specification

## Purpose
规定招投标项目的阶段记录在哪些事实发生时自动前进、什么情况下不前进，以及前进时做什么、不做什么。前进是确定性的条件写入，不调模型，不对外发送。

## Requirements

### Requirement: 三种触发
开关打开时：分析产出可审核的结果 SHALL 让阶段记录到达「项目解读」；询价执行这一次真的发出至少一家、或有人把询价项标记为已发送 SHALL 让它到达「供应商询价」；没取消的询价轮次里某个询价项第一次录入报价（人工录入或回信自动解析）SHALL 让它到达「供应商报价」。到达 = 该段的时间原来为空、且写入会让阶段记录变靠后时，写入当时的时间；已有时间 SHALL NOT 被这一机制改写。

#### Scenario: 第一家报价
- **WHEN** 开关打开，项目在「供应商询价」，人工为一个询价项录入报价
- **THEN** 项目的供应商报价时间被写入，阶段记录变成「供应商报价」（`npx tsx src/lib/tender/__tests__/stage-auto-db.isolated.test.ts`）

#### Scenario: 回信自动解析录入报价
- **WHEN** 开关打开，回信自动解析为一个询价项录入了报价
- **THEN** 同样写入供应商报价时间（`stage-auto-db.isolated.test.ts`）

#### Scenario: 分析完成、询价发出、标记已发送
- **WHEN** 开关打开，分析完成、询价执行发出一家、或有人把电话询价标记为已发送
- **THEN** 阶段记录分别到达「项目解读」「供应商询价」「供应商询价」（`stage-auto-db.isolated.test.ts`）

#### Scenario: 执行时一封也没发
- **WHEN** 开关打开，询价执行时所有询价项都是此前已发
- **THEN** 不前进（`stage-auto-db.isolated.test.ts`）

### Requirement: 不前进的情形
项目不是招投标项目、不是进行中（已放弃、已归档）、招投标状态已是结果（已中标、未中标、不投标、已放弃投标、已取消等）或已记了授标日期时，系统 SHALL NOT 写入时间、SHALL NOT 建或关任务。写入不会让阶段记录变靠后时（项目已在更靠后的阶段，或阶段只由招投标状态得出）SHALL NOT 写入。读到项目之后它被放弃、记了结果或被推进到更靠后的阶段时 SHALL NOT 写入。同一个事实再次发生（第二家报价、第二轮询价）SHALL NOT 再次前进。

#### Scenario: 已放弃与已有结果
- **WHEN** 开关打开，已放弃的项目或招投标状态为未中标的项目录入第一家报价
- **THEN** 供应商报价时间仍为空，没有新任务（`stage-auto-db.isolated.test.ts`）

#### Scenario: 已提交、或阶段只由状态得出
- **WHEN** 开关打开，项目已有提交时间；或项目没有任何阶段时间、招投标状态是已提交；录入一家报价
- **THEN** 供应商报价时间仍为空，已有的任务不变，没有审计（`stage-auto-db.isolated.test.ts`）

#### Scenario: 读之后被放弃
- **WHEN** 开关打开，读到项目是进行中，写入时它已被放弃（或已记成未中标）
- **THEN** 不写入，没有任务（`stage-auto-db.isolated.test.ts`）

#### Scenario: 第二家报价
- **WHEN** 开关打开，同一项目录入第二家报价
- **THEN** 供应商报价时间不变，不再建任务，不再写审计（`stage-auto-db.isolated.test.ts`）

### Requirement: 前进时的任务
写入时间之后，系统 SHALL 关掉新阶段之前各阶段还没完成的自动任务，并为新阶段建阶段任务，负责人是触发的那个人（不知道是谁时是项目负责人）。没有写入时 SHALL NOT 建或关任务。

#### Scenario: 报价让项目进入供应商报价
- **WHEN** 开关打开，项目在「供应商询价」、有两条还没完成的「[供应商询价]」任务，录入第一家报价的人是 A
- **THEN** 那两条被标为完成；建出「[供应商报价]」的任务，负责人是 A（`stage-auto-db.isolated.test.ts`）

### Requirement: 前进时不做的事
自动前进 SHALL NOT 改招投标状态，SHALL NOT 触发来源系统的状态回调或发出任何网络请求，SHALL NOT 发讨论区消息或成员通知，SHALL NOT 调用模型。写时间、建任务、写审计任何一步失败 SHALL NOT 让录入报价、标记已发送、发出询价、分析收尾失败，并 SHALL 留下错误日志。

#### Scenario: 招投标状态不变
- **WHEN** 开关打开，录入第一家报价让项目进入「供应商报价」；另一个项目有来源系统
- **THEN** 招投标状态与之前相同；没有新的讨论区消息与通知；来源系统的项目没有发出任何请求（`stage-auto-db.isolated.test.ts`）

#### Scenario: 某一步失败
- **WHEN** 写阶段时间、建任务或写审计被数据库拒绝
- **THEN** 录入报价照样成功，留下错误日志；其余步骤照常（`stage-auto-db.isolated.test.ts`）

### Requirement: 审计
每一次自动前进写入时间时，系统 SHALL 写一条审计，记下触发（分析完成 / 询价发出 / 标记已发送 / 录入报价）、写入的是哪一段、前进前后的阶段记录、触发的人与是否知道是谁。审计 SHALL 被标为系统动作。审计 SHALL NOT 含报价金额。

#### Scenario: 审计内容
- **WHEN** 开关打开，录入第一家报价
- **THEN** 有一条自动前进的审计，含触发、前后阶段与触发的人，不含金额（`stage-auto-db.isolated.test.ts`）

### Requirement: 开关
开关 `TENDER_STAGE_AUTO_ADVANCE_ENABLED` 未设或为假时，系统 SHALL 与没有本能力时相同：不为它多查库、不加载它的模块；录入报价、标记已发送不写时间；分析完成、询价发出照原样写时间，不建不关任务，不写自动前进的审计。设了组织白名单时 SHALL 只对名单里的组织生效。

#### Scenario: 开关关闭
- **WHEN** 开关关闭，录入第一家报价、询价发出
- **THEN** 供应商报价时间为空；供应商询价时间照原样写入；没有新任务、没有自动前进的审计（`stage-auto-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-auto.test.ts`）
