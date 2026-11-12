## Purpose
规定招投标项目的阶段记录已经到了某一阶段、招投标状态却还落后时，人确认推进到这一阶段会发生什么。补的只是状态与它原本就有的状态回调；不调模型。

## ADDED Requirements

### Requirement: 补状态
人确认推进到某一阶段，而这个招投标项目是进行中、阶段记录已在这一阶段或更靠后、招投标状态落后于人确认的阶段时，系统 SHALL 把招投标状态改成人确认的那一阶段对应的状态（SHALL NOT 改成更靠后的），SHALL 写一条讨论区的状态变化与一条审计（标明是补状态、由人确认、阶段记录与人确认的阶段），项目有来源系统时 SHALL 发一次状态回调。推进 SHALL 返回成功，用状态的中文名说明已同步成什么。

#### Scenario: 报价阶段已到、状态还是供应商询价
- **WHEN** 项目已有供应商报价时间、招投标状态是「供应商询价」，人确认推进到「供应商报价」
- **THEN** 招投标状态变成「供应商报价」；有一条审计与一条讨论区的状态变化；返回成功并说明已同步（`npx tsx src/lib/tender/__tests__/stage-status-catch-up-db.isolated.test.ts`）

#### Scenario: 阶段记录比人确认的更靠后
- **WHEN** 阶段记录已在「供应商询价」、招投标状态是「新导入」，人确认推进到「项目解读」
- **THEN** 不再是「不允许回退」：状态补成「跟进中」，返回成功；之后人确认推进到「供应商询价」，状态再补成「供应商询价」（`stage-status-catch-up-db.isolated.test.ts`）

#### Scenario: 有来源系统
- **WHEN** 同上，项目有来源系统、配置了接收地址
- **THEN** 发出一次状态回调，旧状态是「供应商询价」，新状态是「供应商报价」（`stage-status-catch-up-db.isolated.test.ts`）

### Requirement: 补状态时不做的事
补状态 SHALL NOT 写阶段时间，SHALL NOT 建或关阶段任务，SHALL NOT 写「推进到某某」的讨论区消息，SHALL NOT 发「项目已推进」的成员通知，SHALL NOT 调用模型。审计派生的「变更了状态」通知与任何一次状态变更相同，照常出现。

#### Scenario: 只改状态
- **WHEN** 补状态成功
- **THEN** 阶段时间不变，项目里没有新任务、已有任务的状态不变；点确认时没有成员通知，之后成员刷新通知只看到「变更了状态」（`stage-status-catch-up-db.isolated.test.ts`）

### Requirement: 不补的情形
以下情形系统 SHALL 与原来一样返回「无需重复推进」或「不允许回退」、SHALL NOT 改任何东西、SHALL NOT 发回调：不是招投标项目；没有人确认；项目不是进行中；招投标状态已是结果或系统认不出；招投标状态不落后于人确认的阶段；写入时招投标状态或项目状态已被别人改了。同一次补状态 SHALL 只发生一次。

#### Scenario: 没确认、已放弃、已有结果、状态不落后
- **WHEN** 阶段已到，但没有人确认；或项目已放弃；或不是招投标项目；或状态是未中标；或状态已是「供应商报价」或「投标准备」；或状态已是「供应商报价」时人确认更早的「项目解读」
- **THEN** 返回「无需重复推进」，状态不变，没有审计、没有回调（`stage-status-catch-up-db.isolated.test.ts`；`npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts`）

#### Scenario: 同时点两次
- **WHEN** 两个确认同时到达
- **THEN** 只补一次：一条审计、一次回调（`stage-status-catch-up-db.isolated.test.ts`）

### Requirement: 怎样算落后
招投标状态为空、或它对应的阶段比目标阶段靠前时 SHALL 算落后。已是结果（已中标、未中标、不投标、已放弃投标、已取消等）或系统认不出的状态（含大小写不同的写法）SHALL NOT 算落后。

#### Scenario: 规则表
- **WHEN** 目标是「供应商报价」，状态分别为空、「跟进中」「供应商询价」「供应商报价」「投标准备」「已提交」「未中标」、一个认不出的值
- **THEN** 前三个算落后，其余不算（`stage-status-catch-up.test.ts`）
