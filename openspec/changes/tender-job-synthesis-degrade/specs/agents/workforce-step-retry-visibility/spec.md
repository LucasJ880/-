# Spec Delta

## Purpose

规定数字员工 Job 的步骤失败时，原因怎样在写入时归类成错误码，重试与中断回收怎样留下痕迹，以及作业页与项目卡片怎样写明「正在第 N 次重试」和受阻原因。读取侧只用步骤状态、尝试次数与错误码，不读错误原文。

## ADDED Requirements

### Requirement: 步骤失败时按确定性规则记下错误码

数字员工 Job 的步骤执行失败时，无论还会不会再试，系统 SHALL 在这一步上记下错误码。错误码按以下顺序判定：

1. 错误里含 `insufficient_quota` 或 `exceeded your current quota`（不分大小写）：记 `model_quota_exhausted`（AI 账户余额不足）。
2. 错误里含「月 AI 费用已达 hard limit」：记 `org_ai_budget_exhausted`（本组织本月 AI 费用已达上限）。
3. 其余：综合汇总步骤记 `synthesis_failed`，其它步骤记 `tool_failed`。

同一错误码 SHALL 写进该次失败的 `tool.failed` 事件。错误原文 SHALL 照旧保存在步骤上，供运维排查。

#### Scenario: 余额不足
- **WHEN** 综合汇总步骤的模型调用报「429 You exceeded your current quota, please check your plan and billing details」
- **THEN** 这一步的错误码为 `model_quota_exhausted`，`tool.failed` 事件的错误码相同（`npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`）

#### Scenario: 还会重试的那次失败也有错误码
- **WHEN** 一步第一次失败，还剩一次尝试
- **THEN** 这一步回到「待开始」，尝试次数为 1，错误码不为空（同一测试，以及 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`）

#### Scenario: 本组织月度费用上限
- **WHEN** 模型调用前的费用预检报「配额限制：月 AI 费用已达 hard limit」
- **THEN** 错误码为 `org_ai_budget_exhausted`（`step-failure-visibility.test.ts`）

#### Scenario: 普通错误不误认
- **WHEN** 错误是「400 Invalid request」或「429 Rate limit reached」
- **THEN** 综合汇总步骤记 `synthesis_failed`，工具步骤记 `tool_failed`（同一测试）

### Requirement: 余额不足照常按既有次数重试

识别为余额不足或费用上限的失败，系统 SHALL 按该步既有的最多尝试次数照常重试。系统 SHALL NOT 因为错误码而跳过重试，SHALL NOT 改变最多尝试次数。

#### Scenario: 余额不足仍试满两次
- **WHEN** 综合汇总步骤最多尝试 2 次，两次都报余额不足
- **THEN** 这一步的尝试次数为 2，`tool.failed` 事件有 2 条（`synthesis-degrade-db.isolated.test.ts`）

### Requirement: 中断回收留下痕迹

处理器重新认领一个 Job、把前一个执行者遗留的「执行中」步骤改回「待开始」（该步尝试次数还没用尽）时，系统 SHALL 给这一步记错误码 `stale_running_recovered`，并写一条不对用户显示的 `step.ready` 事件，事件里注明这一步是从中断里回收的。尝试次数已用尽、因此被终止的步骤，SHALL 照旧记 `stale_running_exhausted`。

#### Scenario: 被强制结束后回收
- **WHEN** 一步执行中被平台强制结束（尝试次数 1、最多 2），租约过期后另一次处理认领了这个 Job
- **THEN** 这一步为「待开始」，尝试次数仍为 1，错误码为 `stale_running_recovered`，有一条用户不可见的 `step.ready` 事件（`synthesis-degrade-db.isolated.test.ts`）

### Requirement: 重试那次执行中途让出时保留重试痕迹

一步在重试那次执行中途让出（交还队列、不算失败）时，系统 SHALL 保留这一步的错误码，使它在让出之后仍按「正在第 N 次重试」显示。这次执行本身不是重试（第一次执行）时，让出 SHALL 照旧清掉错误码。让出 SHALL NOT 消耗尝试次数（既有规则不变）。

#### Scenario: 第 3 步重试中途让出
- **WHEN** 第 3 步第一次失败后开始第二次尝试，执行中途让出
- **THEN** 这一步回到「待开始」，尝试次数为 1，错误码不为空，视图里这一步的重试信息为第 1 次（`npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts` 投影用例与源码断言；`npx tsx src/lib/tender-workforce/__tests__/t5-p11-resumability.test.ts` 通过数不变）

#### Scenario: 第一次执行中途让出
- **WHEN** 第 3 步第一次执行中途让出
- **THEN** 错误码为空，视图里这一步没有重试信息（同上两个测试）

### Requirement: 作业页写明「正在第 N 次重试」

满足以下三条的步骤，作业详情视图 SHALL 在该步上给出重试信息：

- 步骤为「待开始」或「执行中」；
- 已失败过：「待开始」时尝试次数 ≥ 1，「执行中」时尝试次数 ≥ 2；
- 错误码不为空。

重试信息包括三项：第几次重试（「待开始」时等于尝试次数，「执行中」时等于尝试次数减 1）、最多可重试几次（最多尝试次数减 1）、上一次失败原因的白话（按错误码查表）。

作业页 SHALL 在该步所在行、以及「进度」一节，写出「第 k 步〈步骤名〉正在第 N 次重试（最多重试 M 次）。上一次没成功：〈原因〉」。

#### Scenario: 第一次失败后等待重试
- **WHEN** 第 8 步〈Workforce 执行汇总〉第一次因余额不足失败，正等下一轮
- **THEN** 视图里这一步的重试信息为第 1 次、最多 1 次、原因「AI 账户余额不足，请联系平台管理员充值」；进度一节有同一句（`step-failure-visibility.test.ts`）

#### Scenario: 没失败过的步骤
- **WHEN** 一步「待开始」、尝试次数 0
- **THEN** 视图里这一步没有重试信息（同一测试）

### Requirement: 有失败的步骤就写明受阻原因

Job 为「失败」或「需要人工处理」时，或者 Job 还在进行中（含两轮之间回到排队）而有失败的步骤时，作业详情视图 SHALL 带停止原因「卡在第 N 步〈步骤名〉：〈原因〉」。作业页 SHALL 在「N 项受阻」旁边写出这句话，SHALL NOT 只显示「N 项受阻」。

Job 已完成、部分完成、已取消或等待审批时，视图 SHALL NOT 带停止原因。

#### Scenario: Job 还在进行中
- **WHEN** Job 状态为「进行中」（两轮之间），第 3 步已失败
- **THEN** 视图带停止原因，作业页进度一节「1 项受阻」后面跟着「卡在第 3 步〈Canonical V2 包级分析〉：…」（`step-failure-visibility.test.ts`）

#### Scenario: 等待审批与已完成不算停下
- **WHEN** Job 等待审批、或已完成，步骤里有一个失败的
- **THEN** 视图不带停止原因（`npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts`）

### Requirement: 项目卡片写明重试与受阻原因

项目页「AI 数字员工 · 投标分析」卡片在 Job「进行中」时：

- 有步骤在重试，SHALL 在「AI 分析中 · x/y 个任务完成」后面写出那一步的重试句；
- 有失败的步骤，SHALL 写出停止原因那一句。

项目卡片接口 SHALL 为此带上这两项（重试的步骤序号、步骤名、第几次、最多几次、原因白话；停止原因整句）。

#### Scenario: 卡片上的重试
- **WHEN** 第 8 步第一次因余额不足失败，Job 进行中
- **THEN** 卡片接口带这一步的重试信息，卡片在「AI 分析中」那一行写出「第 8 步〈Workforce 执行汇总〉正在第 1 次重试（最多重试 1 次）。上一次没成功：AI 账户余额不足，请联系平台管理员充值」（`synthesis-degrade-db.isolated.test.ts` 读接口；渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`）

### Requirement: 读取侧不读错误原文，不外露内部字段

重试信息与受阻原因 SHALL 只由步骤的状态、序号、标题、尝试次数、最多尝试次数与错误码算出。作业详情视图在计算时 SHALL NOT 读取步骤或运行记录的错误原文。作业接口与卡片接口新增的字段 SHALL NOT 含错误原文、错误码原文、模型或供应商名称。

#### Scenario: 源码断言
- **WHEN** 读作业详情视图的计算与查询源码
- **THEN** 不引用 `errorMessage`；步骤查询多取的只有尝试次数与最多尝试次数（`npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts`）

#### Scenario: 接口不带错误码原文
- **WHEN** 读一个第 8 步因余额不足在重试的 Job 的作业接口与卡片接口
- **THEN** 响应里搜不到 `model_quota_exhausted`、`quota`、`You exceeded`（`synthesis-degrade-db.isolated.test.ts`）
