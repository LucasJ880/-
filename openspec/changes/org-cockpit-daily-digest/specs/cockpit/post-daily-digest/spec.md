## ADDED Requirements

### Requirement: 日结的触发时刻
系统 SHALL 在既有 `daily-brief` 每小时定时任务里，为组织时区处于本地 00 点的在用组织生成**前一个本地日**的岗位日结，作为自动化 `post-daily-digest` 记一次运行；没有组织到点时 SHALL NOT 记运行。系统 SHALL NOT 新增 cron、队列或 `vercel.json` 条目。

#### Scenario: 多伦多 00 点
- **WHEN** 定时任务在多伦多时间 2026-10-31 00:00 唤醒，某组织时区为多伦多
- **THEN** 为该组织生成本地日 2026-10-30 的日结，并记一次 `post-daily-digest` 运行

#### Scenario: 没有组织到点
- **WHEN** 唤醒时没有任何组织处于本地 00 点
- **THEN** 不生成日结，不记 `post-daily-digest` 运行

### Requirement: 日结只含按岗位的计数
日结内容 SHALL 取 A-4 按岗位工作量汇总里前一个本地日那一列，逐行（七个岗位、展会询盘子行、未归属）只记以下计数：AI 运行、起草、批准、驳回、过期、取消、作废、系统失败、执行失败、守卫拦截。日结 SHALL NOT 包含平台级自动化运行数、token 与成本、正文、客户、金额或员工信息。全部为 0 的行 SHALL NOT 写入。

#### Scenario: 只有询盘销售有活动
- **WHEN** 前一个本地日只有询盘销售岗位起草 3 条、批准 2 条
- **THEN** 日结只有询盘销售一行，起草 3、批准 2，其余计数为 0，其它岗位不出现

### Requirement: 写入审计且同日幂等
日结 SHALL 写成一条 `AuditLog`：`action = cockpit.post_daily_digest`、`targetType = organization`、`targetId = 组织 id`、操作人为组织所有者，内容带本地日、时区、各行计数与是否截断。整组织全部为 0 时 SHALL NOT 写入。同一组织同一本地日 SHALL 只有一条：写入前按组织与本地日串行化并检查已有记录。

#### Scenario: 重复触发
- **WHEN** 同一组织同一本地日的日结被生成两次
- **THEN** 只有第一次写入审计，第二次返回"已存在"

#### Scenario: 空日不写
- **WHEN** 前一个本地日该组织没有任何岗位活动
- **THEN** 不写审计，结果记为"无活动"

### Requirement: 不进企业记忆、不触发动作
日结 SHALL NOT 写入 Corporate Memory（MemoryClaim），`corporate-memory` 的访问控制与写入口径 SHALL 不变。日结 SHALL NOT 发通知、推送微信或 Muse、调用 LLM、创建审批或改动任何业务记录。

#### Scenario: 生成后无其它写入
- **WHEN** 为一个有活动的组织生成日结
- **THEN** 只新增一条 `cockpit.post_daily_digest` 审计，没有新的 MemoryClaim、通知或审批

### Requirement: 单个组织失败不影响其它
某个组织生成日结失败时，系统 SHALL 记入该次运行的失败计数并继续处理其它组织；`daily-brief` 本身的处理 SHALL NOT 受影响。

#### Scenario: 一个组织读取失败
- **WHEN** 同一时刻两个组织到点，其中一个读取工作量时出错
- **THEN** 另一个组织照常写日结，运行记为部分成功，失败计数为 1
