## Purpose
规定招投标项目阶段推进之后的自动任务：进入一个阶段时为它建一组固定的待办任务，并把上一阶段的自动任务关掉。任务是固定模板，不调模型。

## ADDED Requirements

### Requirement: 进入阶段时建任务
项目经阶段推进进入项目分发、项目解读、供应商询价、供应商报价时，系统 SHALL 为该阶段建模板里的任务：标题以「[阶段名]」开头，状态为待办，创建人与负责人是推进阶段的那个人，属于这个项目，并按模板里的先后顺序排列。进入项目提交阶段 SHALL NOT 建任务。建任务 SHALL NOT 调用模型。

#### Scenario: 逐个阶段
- **WHEN** 一个项目依次被推进到项目分发、项目解读、供应商询价、供应商报价
- **THEN** 各自建出 2、3、2、5 条任务，标题、优先级与模板一致，顺序与模板一致（`npx tsx src/lib/tender/__tests__/stage-tasks-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-tasks.test.ts`）

#### Scenario: 进入项目提交
- **WHEN** 项目被推进到项目提交
- **THEN** 没有新任务（`stage-tasks-db.isolated.test.ts`）

### Requirement: 到期日
任务的到期日 SHALL 是进入阶段那一刻加上模板里的天数。「提交投标」这一条 SHALL 以项目的截标时间为到期日；项目没有截标时间、或截标时间已经过了时 SHALL 仍按天数算。

#### Scenario: 有截标时间
- **WHEN** 项目的截标时间在 10 天后，项目进入供应商报价阶段
- **THEN** 「提交投标」的到期日就是截标时间；同一批里别的任务按天数算（`stage-tasks-db.isolated.test.ts`；`stage-tasks.test.ts`）

#### Scenario: 没有截标时间或已过
- **WHEN** 项目没有截标时间，或截标时间在昨天
- **THEN** 「提交投标」的到期日按进入阶段后的天数算（`stage-tasks.test.ts`）

### Requirement: 关掉上一阶段的、不重复建
进入新阶段时，上一阶段还没完成的自动任务（标题以上一阶段的「[阶段名]」开头、状态是待办或进行中）SHALL 被标为完成；人自己建的任务与别的阶段的任务 SHALL NOT 受影响。新阶段已经有还没完成的自动任务时 SHALL NOT 再建一批。调用方指明不建任务时 SHALL 只关不建。

#### Scenario: 关掉上一阶段的
- **WHEN** 项目从项目解读推进到供应商询价，项目里有「[项目解读] 精读招标文件」（待办）、一条人自己建的任务、一条已取消的「[项目解读]」任务
- **THEN** 只有那条待办的自动任务被标为完成并记下完成时间（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 不重复
- **WHEN** 同一个阶段的建任务被调用两次
- **THEN** 第二次不建（`stage-tasks-db.isolated.test.ts`）

#### Scenario: 只关不建
- **WHEN** 调用方指明不建任务
- **THEN** 上一阶段的自动任务被关掉，新阶段没有任务（`stage-tasks-db.isolated.test.ts`）

### Requirement: 从阶段推进的入口生效
通过阶段推进接口把项目推进到下一阶段后，上面这些任务 SHALL 真的出现在项目里。建任务失败 SHALL NOT 让阶段推进失败，但 SHALL 留下可查的错误日志。

#### Scenario: 走一遍入口
- **WHEN** 调用阶段推进把项目推进到供应商询价
- **THEN** 阶段推进成功，项目里出现「[供应商询价]」的两条任务（`stage-tasks-db.isolated.test.ts`）
