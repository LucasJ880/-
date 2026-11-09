# Spec Delta

## Purpose

通知类型在通知设置的开关列表与通知页的类型筛选里，只对能打开其入口页面的人出现；不出现的类型照旧按原偏好投递，用户看得到的开关都和自己的工作有关。

## ADDED Requirements

### Requirement: 通知类型按入口页面判定可见
每个已登记的通知类型（既有的三个隐藏类型 `runtime_failed`、`evaluation_low`、`feedback` 除外）SHALL 在代码常量里对应至少一个入口页面，即该类型的通知按跳转表会落到的页面；一个类型对某用户可见 SHALL 当且仅当其任一入口页面对该用户经路由门放行（平台 super_admin 全部可见）。对照：
- 任务截止、日程、跟进、提及、任务指派 / 状态 / 评论、系统 → 含 `/tasks`（对所有成员可见）；
- `project_update`、`agent_approval`、`rfq_*` → 项目详情（`project_update` 另含情报监控）；
- `agent_task` → 项目详情、效果图；
- `quote_signed` → 报价单；`sales_daily_briefing` → 销售首页、客户与商机；
- `install_*` → `/install`、`/accounting`、工艺单详情；`order_stage` → 工艺单详情。

#### Scenario: 每个类型都有入口
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/type-visibility.test.ts`
- **THEN** 每个已登记的通知类型都有入口页面，且入口都在路由门门表里，测试通过

#### Scenario: 销售看得到的类型
- **WHEN** 以只持 `sales_rep` 岗位的输入计算可见类型
- **THEN** 不含 `rfq_*`、`agent_approval`、`project_update`；含 `task_due`、`followup`、`quote_signed`、`agent_task`、`install_repair_submitted`（同一测试覆盖）

#### Scenario: 招投标看得到询价通知
- **WHEN** 以只持 `bids` 岗位的输入计算可见类型
- **THEN** 含全部 `rfq_*` 与 `project_update`（同一测试覆盖）

### Requirement: 设置开关与通知页筛选只列可见类型
通知设置页的类型开关列表 SHALL 只列对当前用户可见的类型（既有的三个隐藏类型照旧不列）。通知页的类型筛选 SHALL 只列其类型可见的选项；其中未登记的两项按代码常量给入口：「项目分发」（`project_dispatched`）为项目列表，「报价让利审核」（`quote_promotion_approval`）为审批详情。判定输入未取得时两处 SHALL NOT 先显示后消失。

#### Scenario: 销售的通知页筛选
- **WHEN** 运行同一测试，以只持 `sales_rep` 岗位的输入计算通知页类型筛选
- **THEN** 没有「项目分发」「项目更新」，有「全部类型」「任务截止」「报价让利审核」，测试通过

#### Scenario: 两处接线
- **WHEN** 运行同一测试
- **THEN** 源码断言设置页开关列表与通知页筛选都按同一个可见类型函数过滤，测试通过

### Requirement: 隐藏类型不改偏好、不停投递
开关列表里不出现的类型 SHALL 保留用户已存的开关状态：保存通知设置时这些类型的状态 SHALL NOT 改变。隐藏 SHALL NOT 影响通知的生成、投递、铃铛与通知页的渲染和跳转。

#### Scenario: 保存不动隐藏类型
- **WHEN** 只持 `sales_rep` 岗位、已开启 `rfq_quote_received` 的用户在设置页关掉「任务截止与逾期」并保存
- **THEN** 提交的已开启类型里仍有 `rfq_quote_received`，没有 `task_due`（同一测试覆盖）
