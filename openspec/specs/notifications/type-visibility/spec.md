# notifications/type-visibility Specification

## Purpose
通知类型在通知设置的开关列表与通知页的类型筛选里，只对能打开其处理页面的人出现；不出现的类型照旧按原偏好投递，用户看得到的开关都和自己的工作有关。

## Requirements

### Requirement: 通知类型按处理页面判定可见
每个已登记的通知类型（既有的三个隐藏类型除外）SHALL 在代码常量里对应至少一个处理页面；一个类型对某用户可见 SHALL 当且仅当其任一处理页面对该用户经路由门放行（平台 super_admin 全部可见）。对照：
- 任务截止、日程、跟进、提及、任务指派 / 状态 / 评论、系统 → `/tasks`；
- `project_update` → 项目详情、情报监控、询盘回复页；
- `agent_approval` → 审批详情；`agent_task` → 项目详情、效果图；
- `rfq_*` → 招投标中心；
- `quote_signed` → 报价单；`sales_daily_briefing` → 销售首页、客户与商机；
- `install_*` → 安装、会计、工艺单详情；`order_stage` → 工艺单详情。

#### Scenario: 每个类型都有处理页面
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/type-visibility.test.ts`
- **THEN** 每个非隐藏的已登记类型都有处理页面，且都命中路由门门表，测试通过

#### Scenario: 销售看得到的类型
- **WHEN** 运行同一测试，以 Sunny 只持 `sales_rep` 岗位的输入计算可见类型
- **THEN** 不含任何 `rfq_*`；含 `task_due`、`followup`、`quote_signed`、`agent_task`、`agent_approval`、`project_update`、`install_repair_submitted`，测试通过

#### Scenario: 询价通知只给招投标
- **WHEN** 以只持 `bids`、只持 `ops_staff`、只持 `accounting`、只持 `fulfillment_vinyl` 的输入分别计算可见类型
- **THEN** 只有 `bids` 含全部 `rfq_*`；四者都含 `project_update`（同一测试覆盖）

#### Scenario: 安装工看得到的类型
- **WHEN** 以只持 `installer` 岗位的输入计算可见类型
- **THEN** 不含 `rfq_*`、`project_update`、`agent_task`、`quote_signed`；含 `install_repair_scheduled`、`agent_approval`（同一测试覆盖）

### Requirement: 设置开关与通知页筛选只列可见类型
通知设置页的类型开关列表 SHALL 只列对当前用户可见的类型（既有的三个隐藏类型照旧不列）。通知页的类型筛选 SHALL 只列其类型可见的选项；未登记的两项按代码常量给处理页面：「项目分发」（`project_dispatched`）为项目详情，「报价让利审核」（`quote_promotion_approval`）为报价单。判定输入未取得时两处 SHALL NOT 先显示后消失。

#### Scenario: 销售的通知页筛选
- **WHEN** 运行同一测试，以只持 `sales_rep` 岗位的输入计算通知页类型筛选
- **THEN** 没有「项目分发」，有「全部类型」「任务截止」「项目更新」「报价让利审核」，测试通过

#### Scenario: 安装工的通知页筛选
- **WHEN** 以只持 `installer` 岗位的输入计算通知页类型筛选
- **THEN** 没有「项目分发」「项目更新」「报价让利审核」（同一测试覆盖）

#### Scenario: 两处接线
- **WHEN** 运行同一测试
- **THEN** 源码断言设置页开关列表与通知页筛选都按同一个可见类型函数过滤（同一测试覆盖）

### Requirement: 隐藏类型不改偏好、不停投递
开关列表里不出现的类型 SHALL 保留用户已存的开关状态：保存通知设置时这些类型的状态 SHALL NOT 改变。隐藏 SHALL NOT 影响通知的生成、投递、铃铛与通知页的渲染和跳转。

#### Scenario: 保存不动隐藏类型
- **WHEN** 运行同一测试，只持 `sales_rep` 岗位、已开启 `rfq_quote_received` 的用户在设置页关掉「任务截止与逾期」并保存
- **THEN** 提交的已开启类型里仍有 `rfq_quote_received`，没有 `task_due`，测试通过
