# Spec Delta

## Purpose

规定招投标一键分析里「综合汇总」这一步（不调用业务工具、只把上游产出汇总成整个 Job 的一段说明）失败时，系统怎样不扣住已经算好的 canonical 结果：分析照常进入待审阅，并在作业页与项目卡片写明「AI 数字员工的综合汇总未生成」及原因。

## ADDED Requirements

### Requirement: 综合汇总步骤因执行失败终止时降级为已跳过

招投标域、按服务端确定性计划执行的一键分析 Job 里，综合汇总步骤因执行失败而终止时，系统 SHALL 在依赖它的收尾步骤开工之前，把这一步改为「已跳过」，并为它写入有效的交接数据，使收尾步骤照常开工。执行失败包括四类：模型调用报错（含 AI 账户余额不足、本组织本月 AI 费用已达上限）、输出不合格、重试次数用尽、执行时间过长被回收且次数用尽。

系统 SHALL 为这一步写一条用户可见的步骤完成事件，标题写明「综合汇总未生成，已跳过」。同一步 SHALL 至多降级一次、至多写一条这样的事件。这一步原有的错误码与错误原文 SHALL 保留。步骤产出 SHALL NOT 带「降级证据」标记。

#### Scenario: 余额不足时第 9 步照常终态化
- **WHEN** 第 1–7 步已完成，第 8 步综合汇总两次都因模型返回「429 You exceeded your current quota, please check your plan and billing details」失败
- **THEN** 第 8 步为「已跳过」，只有一条「综合汇总未生成，已跳过」的事件，第 9 步完成，分析记录为「待审阅」，Job 为「已完成」，没有「招标分析未能完成」的失败通知（`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`，隔离库）

#### Scenario: 执行被中断且次数用尽
- **WHEN** 第 8 步两次都被平台强制结束，处理器回收时把它记为「长时间没有进展」并终止
- **THEN** 随后第 8 步改为「已跳过」，第 9 步完成，分析记录为「待审阅」（同一测试）

#### Scenario: 交接数据的话
- **WHEN** 读被跳过的第 8 步的交接数据
- **THEN** 摘要为「综合汇总未生成」，警告里有原因的白话，没有「该任务未产生业务写入（审批拒绝或无可写对象）」（`npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`）

### Requirement: 只降级综合汇总这一步、只降级执行失败

降级 SHALL 只作用于综合汇总步骤。以下情况 SHALL NOT 降级，照旧停下：

- 失败原因是契约损坏：上游交接数据缺失、版本不认识、内容损坏、来源不符，任务说明损坏，执行者无效，这一步自己的产出无法生成交接数据，执行中出现未预期的异常。
- 为这一步生成「已跳过」的交接数据时，上游交接数据收不齐或生成失败。这时这一步 SHALL 保持失败。
- 综合汇总以外的任何步骤失败。

非招投标域的 Job SHALL NOT 降级。由模型规划出计划的招投标 Job 也 SHALL NOT 降级。降级 SHALL NOT 改变任何步骤的最多尝试次数，SHALL NOT 增加模型调用。

#### Scenario: 第 3 步失败照旧停下
- **WHEN** 第 3 步「Canonical V2 包级分析」重试用尽而失败
- **THEN** 第 4–9 步不开工，Job 为「需要人工处理」，分析记录为「AI 分析未完成」（`synthesis-degrade-db.isolated.test.ts`）

#### Scenario: 上游交接数据损坏
- **WHEN** 第 8 步因上游第 5 步的交接数据损坏而无法开工
- **THEN** 第 8 步保持失败，不改为已跳过，Job 为「需要人工处理」（同一测试）

#### Scenario: 销售域与模型规划的 Job 不受影响
- **WHEN** 一个销售域 Job、或一个由模型规划出计划的招投标 Job，它的综合汇总步骤失败
- **THEN** 判定结果为不降级，后续行为与改动前相同（`npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts` 判定函数用例）

### Requirement: 收尾步骤在综合汇总未生成时照常终态化

canonical V2 模式下，声明依赖里的综合汇总步骤带「未生成」的跳过标记时，收尾步骤 SHALL 照常把分析记录改为「待审阅」，并 SHALL NOT 改动分析记录上的 canonical 摘要与摘要文本。此时它的返回结果 SHALL 写明综合汇总未生成，SHALL NOT 带 Job 级汇总文字。

以下两种情况，收尾步骤 SHALL 照旧以「输入缺失」失败：

- 旧的兼容模式（非 canonical V2）；
- 声明依赖里既没有综合结果、也没有跳过标记。

#### Scenario: canonical 结果原样保留
- **WHEN** 第 8 步已跳过，第 9 步执行
- **THEN** 分析记录的 `summaryJson` 与 `summaryText` 与执行前逐字节相同，状态为「待审阅」（`synthesis-degrade-db.isolated.test.ts`）

#### Scenario: 依赖里什么都没有
- **WHEN** 第 9 步的声明依赖里第 8 步的产出既没有综合结果也没有跳过标记
- **THEN** 第 9 步以「输入缺失：未在声明依赖中找到综合汇总结果」失败（同一测试）

### Requirement: 写明「AI 数字员工的综合汇总未生成」

招投标域、按服务端确定性计划执行的 Job 里，综合汇总步骤为「已跳过」时，系统 SHALL 在以下两处写明「AI 数字员工的综合汇总未生成」，并写出原因的白话：

- 作业详情接口与作业页的「最终结果」一节；
- 项目卡片接口，以及分析为「待审阅」时项目页「AI 数字员工 · 投标分析」卡片里「分析结果已就绪，请在下方审阅确认」那一行的下方。项目卡片挂在审阅面板顶部。

卡片上这句话后面 SHALL 只接「招标分析结果见下方。」，SHALL NOT 写「不影响」「可照常审阅」这类对分析结果是否完整的判断。原因 SHALL 按该步错误码查表得出，例如「AI 账户余额不足，请联系平台管理员充值」；查不到时写「执行出错」。

其它 Job（非招投标域、或由模型规划出计划）即使有已跳过的综合汇总步骤，SHALL NOT 带这项说明。

#### Scenario: 卡片上的说明
- **WHEN** 第 8 步因 AI 账户余额不足被跳过，分析为「待审阅」
- **THEN** 项目卡片接口带这项说明，卡片显示「本次 AI 数字员工的综合汇总未生成：AI 账户余额不足，请联系平台管理员充值。招标分析结果见下方。」，不含「可照常审阅」（`synthesis-degrade-db.isolated.test.ts` 读接口；卡片渲染见 `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`）

#### Scenario: 作业页最终结果
- **WHEN** 读这个 Job 的详情视图
- **THEN** 视图带「综合汇总未生成」及同一原因；作业页「最终结果」一节显示它，不再只显示「尚未生成最终结果」（`step-failure-visibility.test.ts`）

#### Scenario: 销售域里审批被拒而跳过的综合汇总
- **WHEN** 一个销售域 Job 的综合汇总步骤因审批被拒而为「已跳过」
- **THEN** 详情视图不带「综合汇总未生成」（`step-failure-visibility.test.ts`）

### Requirement: 说明里不出现内部文本与混淆的说法

「综合汇总未生成」的说明 SHALL NOT 含模型或供应商返回的原始错误文本、英文报错、内部错误码原文与接口地址。作业接口与卡片接口为它新增的字段 SHALL 只有固定中文句子、步骤标题与步骤序号。这句说明 SHALL NOT 使用「解读」二字（「项目解读」页是招标分析自身的内容，见 FIX-16）。

#### Scenario: 原始报错不外露
- **WHEN** 第 8 步的错误原文是「SYNTHESIS_MODEL_FAILED: 429 You exceeded your current quota…」
- **THEN** 作业接口与卡片接口的响应里搜不到 `quota`、`You exceeded`、`SYNTHESIS_MODEL_FAILED`（`synthesis-degrade-db.isolated.test.ts`）

### Requirement: 终态化之后的既有动作照常，降级本身不调模型

降级后第 9 步终态化成功时，分析完成通知、Muse `analysis.ready` 事件与外部情报的自动检索 SHALL 照既有规则执行，内容 SHALL NOT 因综合汇总未生成而改变。降级判定与说明拼装 SHALL NOT 发起任何模型调用。

#### Scenario: 降级模块不调模型
- **WHEN** 读降级判定与说明拼装的源码
- **THEN** 不引用任何模型调用入口（`step-failure-visibility.test.ts` 源码断言）
