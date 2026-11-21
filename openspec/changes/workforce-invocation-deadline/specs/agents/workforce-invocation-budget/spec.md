# Spec Delta

## Purpose

规定数字员工队列在一次带时间预算的调用里怎样使用时间：临近整次调用的截止时间时不再认领任务、不再开新一轮，模型调用不越过截止时间，被截断的工作交还队列继续，使一次调用不因后来开工的任务被平台强制结束。

## ADDED Requirements

### Requirement: 整次调用剩余不足 60 秒不再认领任务

一次带时间预算的数字员工队列处理里，认领每一个任务之前，系统 SHALL 检查整次调用的剩余时间；不足 60 秒时 SHALL NOT 认领该任务及其后的任务，这些任务 SHALL 保持原状态留在队列里，SHALL NOT 增加它们的尝试次数。处理结果 SHALL 报告因时间不足未认领的任务数。

#### Scenario: 第一个任务用掉大部分时间
- **WHEN** 队列里有两个可认领的任务，第一个任务在整次调用开始后 228 秒让出（预算 240 秒）
- **THEN** 第二个任务不被认领，状态与尝试次数都不变，处理结果里「因时间不足未认领」为 1
- **AND** 测试 `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 时间充裕
- **WHEN** 第一个任务在整次调用开始后 30 秒完成
- **THEN** 第二个任务照常被认领

### Requirement: 整次调用剩余不足 60 秒不开新一轮

一个任务的时间片里，开始每一轮之前，系统 SHALL 检查整次调用的剩余时间；不足 60 秒时 SHALL 结束本时间片并按既有的交还队列方式处理（任务回到队列、尝试次数归零），SHALL NOT 把它记为失败。

#### Scenario: 上一轮结束时已临近截止
- **WHEN** 一个任务的上一轮在整次调用开始后 190 秒结束，还有后续步骤
- **THEN** 不开始下一轮，任务回到队列，尝试次数为 0，没有失败事件
- **AND** 测试 `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

### Requirement: 数字员工路径上的模型调用不越过整次调用的截止时间

带时间预算时，规划、核验、多任务综合、旧版风险分析这四类模型调用 SHALL 带超时，超时取「整次调用的剩余时间 − 15 秒」与该类调用上限中较小的一个，最短 10 秒。不带时间预算时，这四类调用 SHALL 与以前完全相同（不带超时）。

#### Scenario: 剩余 100 秒时做多任务综合
- **WHEN** 整次调用还剩 100 秒时开始多任务综合，模型一直不返回
- **THEN** 这次模型请求在 85 秒后被中止，整次调用在截止时间之前返回
- **AND** 测试 `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 不带时间预算
- **WHEN** 脚本或同步入口不带时间预算调用同一个步骤
- **THEN** 模型请求不带超时，结果与以前相同

### Requirement: 被截止时间截断的模型调用交还队列继续

上一条里的模型调用因整次调用的截止时间被中止时，系统 SHALL 把任务交还队列继续（与工具让出相同），SHALL NOT 把这一步记为失败，SHALL NOT 消耗这一步的尝试次数。模型调用因其它原因失败（非截止时间造成的错误、输出不合格）时 SHALL 按既有规则处理。

#### Scenario: 核验被截止时间中止
- **WHEN** 核验的模型请求因整次调用的截止时间被中止
- **THEN** 任务回到队列，这一步的尝试次数不变，下一次调用从这一步继续
- **AND** 测试 `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过

#### Scenario: 模型返回 400
- **WHEN** 多任务综合的模型请求返回 400
- **THEN** 按既有规则记为这一步失败

### Requirement: 留下未认领任务时沿用链式自触发

一次定时调用因时间不足留下未认领任务时，系统 SHALL 按「有任务让出」的同一条件安排链式自触发（受同一个开关、同一个深度上限约束），SHALL NOT 新增任何调度或队列。

#### Scenario: 有未认领、没有让出
- **WHEN** 一次调用里第一个任务完成（没有让出），第二个任务因时间不足未认领，链式自触发已开启且未到深度上限
- **THEN** 本次调用结束后安排一次链式自触发
- **AND** 测试 `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 通过
