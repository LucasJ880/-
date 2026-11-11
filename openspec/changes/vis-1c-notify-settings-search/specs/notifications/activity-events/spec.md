# Spec Delta

## MODIFIED Requirements

### Requirement: 新增五个通知类型
系统 SHALL 把以下五个通知类型登记进通知类型注册表，并在通知设置页与邮件里统一使用这些名称：

| 类型 | 名称 |
|---|---|
| `mention` | @提及 |
| `task_assigned` | 任务指派 |
| `task_status` | 任务状态变化 |
| `task_comment` | 任务新评论 |
| `order_stage` | 工艺单阶段变化 |

#### Scenario: 设置页列出新类型
- **WHEN** 工艺单详情对其放行的用户（如持 `owner` 或 `sales_rep` 岗位）打开通知设置页的类型开关列表（其余用户见 `notifications/type-visibility`）
- **THEN** 列表中出现"@提及""任务指派""任务状态变化""任务新评论""工艺单阶段变化"五项
