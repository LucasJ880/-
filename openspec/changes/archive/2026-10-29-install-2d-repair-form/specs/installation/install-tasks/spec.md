# Spec Delta

## MODIFIED Requirements

### Requirement: 开始与完成状态
被分配人 SHALL 能把任务从"已排期"置为"进行中"（`POST /api/install/tasks/{id}/start`），SHALL NOT 能直接置为"已完成"；完成只能通过收口流程（见 `installation/window-closeout`）或提交维修单（见 `installation/repairs`，结果为需返修，工艺单保持已排期）。

#### Scenario: 开始安装
- **WHEN** 小王在任务页点"开始安装"
- **THEN** 预约状态为 in_progress，审计记录 `install.task.started`

#### Scenario: 提交维修单完成任务
- **WHEN** 小王在有问题的任务上提交维修单
- **THEN** 预约状态为 completed，审计 `install.task.completed` 的结果为 `needs_repair`，工艺单仍为 scheduled（`repair-db.isolated.test.ts`）
