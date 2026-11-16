## Purpose
规定投标调查室 `BidIntelligenceRoom.summaryJson` 的写入：它是分析投影、报价表助手、报价引擎镜像的我方报价、投标工作区、跟标等功能共用的一个 JSON 位，谁写都与报价引擎拿同一把项目行锁、锁住后重读最新值、只改自己的键，不整块替换。

## ADDED Requirements

### Requirement: 分析投影只改分析的键
分析跑完投影到调查室时，系统 SHALL 在一个事务里先取得项目行锁，再读取最新的 `summaryJson`，设这次分析摘要里的键、`projectedFromRunId` 与这次写了哪些键的记录（`projectedKeys`），并同时更新摘要文字与状态。系统 SHALL 只去掉「上一次投影记下的、这一次分析摘要里没有的」键；没有记录（改动前投影过）时 SHALL NOT 去掉任何键。`summaryJson` 里别的功能写的键（例如 `pricingInputs`、`pricingModel`、`bidWorkspace`、`tenderWatch`）SHALL 原样保留。已被替代的分析 SHALL NOT 投影。

#### Scenario: 重新分析之后再投影
- **WHEN** 房间里有报价表助手的输入与报价引擎镜像的我方报价、投标工作区的价格表、跟标与报价模型，先后投影两次分析，第二次分析没有第一次独有的某个键
- **THEN** 两次投影之后别的功能的键都与投影前相同；分析的键是第二次的；第一次独有的键被去掉；`projectedFromRunId` 指向第二次分析；摘要文字与状态照常更新（`npx tsx src/lib/tender-room/__tests__/room-summary-merge-db.isolated.test.ts`）

#### Scenario: 改动前投影过的房间
- **WHEN** 房间里有上一次投影留下的分析键，但没有 `projectedKeys` 记录，再投影一次分析
- **THEN** 这次分析的键覆盖写入，不去掉任何键，别的功能的键保留（`npx tsx src/lib/tender-room/__tests__/summary-json.test.ts`）

#### Scenario: 投影时报价同步正在进行
- **WHEN** 报价同步在项目行锁下把新报价写进 `pricingInputs`、尚未提交，这期间投影一次分析，然后同步提交
- **THEN** 投影写入；`pricingInputs` 里是同步写的新报价与原来的人工输入（`room-summary-merge-db.isolated.test.ts`）

#### Scenario: 已被替代的分析
- **WHEN** 投影一个状态为已被替代的分析
- **THEN** 不投影，房间不变（`room-summary-merge-db.isolated.test.ts`）

### Requirement: 开始投标调查不冲掉已有的键
开始投标调查时，房间已经存在但还没有摘要的，系统 SHALL 在同一事务里先取得项目行锁，再读取最新的 `summaryJson`，只设初始摘要的键并写入摘要文字与状态；房间里别的功能写的键 SHALL 原样保留。房间不存在时 SHALL 照常新建并写入初始摘要。

#### Scenario: 房间由投标工作区先建
- **WHEN** 房间里已有报价表助手、投标工作区、跟标与报价模型的键，还没有摘要，开始投标调查
- **THEN** 沿用这个房间，写入初始摘要的键与摘要文字；别的功能的键与之前相同（`room-summary-merge-db.isolated.test.ts`）

#### Scenario: 没有房间
- **WHEN** 项目还没有调查室，开始投标调查
- **THEN** 新建房间并写入初始摘要（`room-summary-merge-db.isolated.test.ts`）

### Requirement: 写入入口只改给出的键
调查室 `summaryJson` 的写入入口 SHALL 先取得项目行锁、再读取房间，只设或去掉调用方给出的键（值为 undefined 视为去掉；同一个键既去掉又设时以设为准），其余键原样保留；SHALL NOT 提供整块替换。房间不存在时 SHALL NOT 写入。

#### Scenario: 设与去掉
- **WHEN** 在一个含别的功能键的对象上设两个键、去掉一个键
- **THEN** 只有这三个键变化，其余与原来相同，入参不被修改（`summary-json.test.ts`）
