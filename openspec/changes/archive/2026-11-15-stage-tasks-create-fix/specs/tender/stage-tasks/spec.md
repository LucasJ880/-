## Purpose
规定招投标项目阶段推进之后的自动任务：进入一个阶段时为它建一组固定的待办任务，并把之前阶段还没完成的自动任务关掉；项目被放弃时撤掉还没完成的自动任务。任务是固定模板，不调模型。

## ADDED Requirements

### Requirement: 进入阶段时建任务
建阶段任务以项目分发、项目解读、供应商询价、供应商报价为新阶段被调用时，系统 SHALL 为该阶段建模板里的任务：标题以「[阶段名]」开头，状态为待办，创建人与负责人是推进阶段的那个人，属于这个项目。新阶段是项目提交时 SHALL NOT 建任务。项目不是进行中（已放弃、已归档）时 SHALL NOT 建任务。建任务 SHALL NOT 调用模型。

#### Scenario: 逐个阶段
- **WHEN** 对一个进行中的项目依次以项目分发、项目解读、供应商询价、供应商报价调用建阶段任务
- **THEN** 各自建出 2、3、2、5 条任务，标题、优先级与模板一致（`npx tsx src/lib/tender/__tests__/stage-tasks-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-tasks.test.ts`）

#### Scenario: 进入项目提交
- **WHEN** 项目被推进到项目提交
- **THEN** 没有新任务（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 项目已放弃
- **WHEN** 对一个已放弃的项目调用建阶段任务
- **THEN** 之前阶段的自动任务照样被关掉，但不建新任务（`stage-tasks-db.isolated.test.ts`）

### Requirement: 到期日
任务的到期日 SHALL 是进入阶段那一刻加上模板里的天数。「提交投标」这一条 SHALL 以项目的截标时间为到期日。截标时间还没到时，任何一条任务的到期日 SHALL NOT 晚于截标时间。项目没有截标时间、或截标时间已经过了时 SHALL 一律按天数算。

#### Scenario: 截标在 10 天后
- **WHEN** 项目的截标时间在 10 天后，项目进入供应商报价阶段
- **THEN** 「提交投标」的到期日就是截标时间；同一批里别的任务按天数算（`stage-tasks-db.isolated.test.ts`；`stage-tasks.test.ts`）

#### Scenario: 截标只剩 1 天
- **WHEN** 项目的截标时间在 1 天后，项目进入供应商报价阶段
- **THEN** 5 条任务的到期日都是截标时间（`stage-tasks-db.isolated.test.ts`；`stage-tasks.test.ts`）

#### Scenario: 没有截标时间或已过
- **WHEN** 项目没有截标时间，或截标时间在昨天
- **THEN** 任务的到期日按进入阶段后的天数算（`stage-tasks-db.isolated.test.ts`；`stage-tasks.test.ts`）

### Requirement: 关掉之前阶段的、不重复建
进入新阶段时，新阶段之前所有阶段还没完成的自动任务（标题以那些阶段的「[阶段名]」开头、状态是待办或进行中）SHALL 被标为完成并记下完成时间；人自己建的任务、别的项目的任务 SHALL NOT 受影响。新阶段已经有还没完成的同前缀任务时 SHALL NOT 再建一批；同一项目同时被调用多次时 SHALL 只建一批。调用方指明不建任务时 SHALL 只关不建。

#### Scenario: 阶段时间被绕过阶段推进写入
- **WHEN** 项目推进到项目解读、建出 3 条任务；之后询价发出直接写入了供应商询价的时间；再推进到供应商报价
- **THEN** 项目解读的 3 条被标为完成（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 只动该动的
- **WHEN** 项目从项目解读推进到供应商询价，项目里有一条人自己建的任务、一条已取消和一条被阻塞的「[项目解读]」任务，同组织另一个项目里有同名的自动任务
- **THEN** 只有本项目待办、进行中的自动任务被标为完成（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 不重复
- **WHEN** 同一个阶段的建任务被先后调用两次，或同时调用 8 次
- **THEN** 只建一批（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 只关不建
- **WHEN** 调用方指明不建任务
- **THEN** 之前阶段的自动任务被关掉，新阶段没有任务（`stage-tasks-db.isolated.test.ts`）

### Requirement: 放弃项目时撤掉自动任务
项目经放弃项目接口被放弃时，系统 SHALL 在同一个事务里把这个项目还没完成的阶段自动任务标为已取消；人自己建的任务与已完成的任务 SHALL NOT 受影响。

#### Scenario: 放弃
- **WHEN** 项目处在项目解读阶段，有 2 条待办与 1 条已完成的「[项目解读]」任务和一条人自己建的任务，调用放弃项目接口
- **THEN** 2 条待办的被标为已取消，另外两条不变（`stage-tasks-db.isolated.test.ts`）

### Requirement: 从阶段推进的入口生效
通过阶段推进把项目推进到下一阶段后，上面这些任务 SHALL 真的出现在项目里。建任务失败 SHALL NOT 让阶段推进失败，但 SHALL 留下带原因的错误日志。

#### Scenario: 走一遍入口
- **WHEN** 调用阶段推进把项目推进到供应商询价
- **THEN** 阶段推进成功，项目里出现「[供应商询价]」的两条任务（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 建任务失败
- **WHEN** 任务表拒绝这个项目的写入，调用阶段推进把项目推进到项目解读
- **THEN** 阶段推进成功、项目解读的时间写上了，没有任务，错误日志里有「[StageTasks] failed」和拒绝的原因（`stage-tasks-db.isolated.test.ts`）
