## Purpose
规定招投标项目的阶段记录在哪些事实发生时自动前进、什么情况下不前进，以及前进时做什么、不做什么。前进是确定性的条件写入，不调模型，不对外发送。

## ADDED Requirements

### Requirement: 三种触发
开关打开时：分析产出可审核的结果 SHALL 让阶段记录到达「项目解读」；一轮询价至少发出一家 SHALL 让它到达「供应商询价」；某个询价项第一次录入报价（人工录入或回信自动解析）SHALL 让它到达「供应商报价」。到达 = 该段的时间原来为空时写入当时的时间；已有时间 SHALL NOT 被这一机制改写。

#### Scenario: 第一家报价
- **WHEN** 开关打开，项目在「供应商询价」，人工为一个询价项录入报价
- **THEN** 项目的供应商报价时间被写入，阶段记录变成「供应商报价」（`npx tsx src/lib/tender/__tests__/stage-auto-db.isolated.test.ts`）

#### Scenario: 回信自动解析录入报价
- **WHEN** 开关打开，回信自动解析为一个询价项录入了报价
- **THEN** 同样写入供应商报价时间（`stage-auto-db.isolated.test.ts`）

#### Scenario: 分析完成与询价发出
- **WHEN** 开关打开，分析完成或询价发出
- **THEN** 阶段记录分别到达「项目解读」「供应商询价」（`stage-auto-db.isolated.test.ts`）

### Requirement: 不前进的情形
项目不是招投标项目、不是进行中（已放弃、已归档）、或招投标状态已是结果（已中标、未中标、不投标、已放弃投标、已取消等）时，系统 SHALL NOT 写入时间、SHALL NOT 建或关任务。同一个事实再次发生（第二家报价、第二轮询价）SHALL NOT 再次前进。

#### Scenario: 已放弃与已有结果
- **WHEN** 开关打开，已放弃的项目或招投标状态为未中标的项目录入第一家报价
- **THEN** 供应商报价时间仍为空，没有新任务（`stage-auto-db.isolated.test.ts`）

#### Scenario: 第二家报价
- **WHEN** 开关打开，同一项目录入第二家报价
- **THEN** 供应商报价时间不变，不再建任务，不再写审计（`stage-auto-db.isolated.test.ts`）

### Requirement: 前进时的任务
写入的时间让阶段记录比原来靠后时，系统 SHALL 关掉新阶段之前各阶段还没完成的自动任务，并为新阶段建阶段任务，负责人是触发的那个人（不知道是谁时是项目负责人）。写入的时间没有让阶段记录变化时（项目已经在更靠后的阶段）SHALL NOT 建或关任务。

#### Scenario: 报价让项目进入供应商报价
- **WHEN** 开关打开，项目在「供应商询价」、有两条还没完成的「[供应商询价]」任务，录入第一家报价的人是 A
- **THEN** 那两条被标为完成；建出「[供应商报价]」的任务，负责人是 A（`stage-auto-db.isolated.test.ts`）

#### Scenario: 项目已在更靠后的阶段
- **WHEN** 开关打开，项目已有提交时间，录入一家报价
- **THEN** 供应商报价时间被写入，但阶段记录仍是「项目提交」，没有新任务（`stage-auto-db.isolated.test.ts`）

### Requirement: 前进时不做的事
自动前进 SHALL NOT 改招投标状态，SHALL NOT 触发来源系统的状态回调，SHALL NOT 发讨论区消息或成员通知，SHALL NOT 调用模型。自动前进失败 SHALL NOT 让录入报价、发出询价、分析收尾失败。

#### Scenario: 招投标状态不变
- **WHEN** 开关打开，录入第一家报价让项目进入「供应商报价」
- **THEN** 招投标状态与之前相同；没有新的讨论区消息与通知（`stage-auto-db.isolated.test.ts`）

### Requirement: 审计
每一次自动前进写入时间时，系统 SHALL 写一条审计，记下触发（分析完成 / 询价发出 / 录入报价）、写入的是哪一段、前进前后的阶段记录、触发的人。审计 SHALL NOT 含报价金额。

#### Scenario: 审计内容
- **WHEN** 开关打开，录入第一家报价
- **THEN** 有一条自动前进的审计，含触发、前后阶段与触发的人，不含金额（`stage-auto-db.isolated.test.ts`）

### Requirement: 开关
开关 `TENDER_STAGE_AUTO_ADVANCE_ENABLED` 未设或为假时，系统 SHALL 与没有本能力时完全相同：录入报价不写时间；分析完成、询价发出照原样写时间，不建不关任务，不写自动前进的审计。设了组织白名单时 SHALL 只对名单里的组织生效。

#### Scenario: 开关关闭
- **WHEN** 开关关闭，录入第一家报价、分析完成
- **THEN** 供应商报价时间为空；项目解读时间照原样写入；没有新任务、没有自动前进的审计（`stage-auto-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-auto.test.ts`）
