## ADDED Requirements

### Requirement: 其它写入方只改自己的键
跟标检查与盯梢设置、外部情报（检索结果、确认竞争对手、确认授标）、投标草稿、分析备忘、投标工作区写调查室 `summaryJson` 时，系统 SHALL 在一个事务里先取得项目行锁，再读取最新的 `summaryJson`，只设或去掉自己的键；依赖原值的计算（竞争对手列表、授标确认字段、盯梢状态、投标工作区合并、要不要写首次推导的报价模型）SHALL 在锁住后读到的最新值上进行。读与写之间的外部请求与模型调用 SHALL NOT 在持锁期间进行。外部情报 SHALL NOT 在最新值里已有同版本有效报价模型时写入报价模型。投标工作区保存与报价同步 SHALL NOT 互相死锁。

#### Scenario: 跟标抓取期间报价同步提交
- **WHEN** 跟标检查在抓取公告页期间，报价同步把新报价提交进 `pricingInputs`
- **THEN** 检查写回后 `pricingInputs` 里是新报价与原来的人工输入，盯梢状态照常更新（`npx tsx src/lib/tender-room/__tests__/room-summary-writers-db.isolated.test.ts`）

#### Scenario: 投标工作区保存与先读后写的同步交错
- **WHEN** 一个与报价引擎同样写法的同步（锁项目行、读房间、暂停、展开旧值写回）读完房间后暂停，这期间保存投标工作区，然后同步写回
- **THEN** 两边都成功、没有死锁；同步写的新报价与工作区这次保存的内容都在（`room-summary-writers-db.isolated.test.ts`）

#### Scenario: 确认竞争对手与停止盯梢时报价同步未提交
- **WHEN** 报价同步在项目行锁下写了新报价、尚未提交，这期间确认一家竞争对手，或停止盯梢，然后同步提交
- **THEN** 新报价在；竞争对手列表是在最新值上加了这一家，返回值与库里一致；停止盯梢后 `tenderWatch` 不在（`room-summary-writers-db.isolated.test.ts`）

### Requirement: 跟标检查不写回已停掉的盯梢
跟标检查写回时，最新的 `tenderWatch` 已不存在或 URL 与抓取时不同的，系统 SHALL NOT 写入、SHALL NOT 发变化通知，并返回「没有盯梢」。

#### Scenario: 抓取期间停止盯梢
- **WHEN** 跟标检查在抓取公告页期间，用户停止了盯梢
- **THEN** `tenderWatch` 仍然不在，没有新的变化通知，检查返回「没有盯梢」（`room-summary-writers-db.isolated.test.ts`）

### Requirement: 新的写入必须经入口
`src/` 下（测试除外）直接写调查室 `summaryJson` 的地方 SHALL 只有写入入口本身、报价引擎镜像、报价表助手与新建房间时带初始摘要这四处，且前三处 SHALL 在事务里先取得项目行锁；其余写入 SHALL 经 `patchRoomSummary` / `patchRoomSummaryTx`。

#### Scenario: 守卫
- **WHEN** 扫描 `src/` 下所有非测试的 TypeScript 文件
- **THEN** 没有名单以外直接写 `summaryJson` 的调用（只在 `select` 里读的不算），名单里的每一处都还在且先 `lockProject`（`npx tsx src/lib/tender-room/__tests__/summary-write-guard.test.ts`）
