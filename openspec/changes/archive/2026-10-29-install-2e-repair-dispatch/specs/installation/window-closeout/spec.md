# Spec Delta

## MODIFIED Requirements

### Requirement: 完成收口
`POST /api/install/tasks/{id}/complete` SHALL 要求操作者是被分配人或持 `install.task.update`（ORG）。任务没有任何收口单元时 SHALL 返回 409 `NO_UNITS` 并说明需出单补齐；任一单元未收口时 SHALL 返回 409 `WINDOWS_MISSING` 并列出未收口单元的序号与位置；全部收口时 SHALL 把预约置为已完成（记录完成时间）、按状态机把工艺单推进到"已安装"（记录安装时间与状态日志），并写审计 `install.task.completed`（含单元数与照片张数）。任务的收口单元与返修预约完成时的效果见 `installation/repairs`「返修预约的收口范围」「返修完成」。重复调用已完成的任务 SHALL 返回 200 且不重复推进。

#### Scenario: 还有窗没拍
- **WHEN** 4 扇窗只有 3 扇有照片时点完成
- **THEN** 返回 409，响应列出第 4 扇窗的序号与位置，状态不变

#### Scenario: 全部收口
- **WHEN** 4 扇窗都有照片时点完成
- **THEN** 预约 completed，工艺单 installed，审计 `install.task.completed`

#### Scenario: 只有 Vinyl 窗的单全部收口
- **WHEN** 没有 Blinds 行、Vinyl 3 扇窗都有照片时点完成
- **THEN** 返回 200，预约 completed，工艺单 installed（`closeout-db.isolated.test.ts`）

#### Scenario: 没有任何收口单元
- **WHEN** 工艺单既无 Blinds 行、工艺参数四段也都为空时点完成
- **THEN** 返回 409 `NO_UNITS`，状态不变；任务页显示"工艺单没有可收口的行"，不显示"还差 0 扇"

#### Scenario: 工艺单不在可推进状态
- **WHEN** 工艺单已是 cancelled
- **THEN** 返回 409 说明状态不允许，预约不变

#### Scenario: 返修预约只看维修行
- **WHEN** 返修任务的维修单只有 Den 一行，Den 已拍完工照
- **THEN** 完成收口返回 200，不因工艺单其他单元判定未收口（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 照片可见范围
文件代理 SHALL 对 `install-photos/{orgId}/...` 前缀只放行：该工艺单任一安装预约（首次安装与各次返修）的被分配人，或持 `install.photo.read`（ORG）的企业成员；其他人 SHALL 收到 403。工艺单详情页的"收口"标签 SHALL 只对持 `install.photo.read` 的人显示每窗照片。

#### Scenario: 老板查看
- **WHEN** 持 `owner` 岗位的 Bob 打开工艺单详情的收口标签
- **THEN** 看到每扇窗的照片缩略图与时间

#### Scenario: 销售不能看
- **WHEN** 只持 `sales_rep` 的 Alex 请求某张收口照片的代理地址
- **THEN** 返回 403

#### Scenario: 返修排给别人后首装安装工仍能看
- **WHEN** 首次安装的是小王，返修排给了小李
- **THEN** 小王与小李都能打开该工艺单的问题照与完工照；另一位安装工小张返回 403（`repair-dispatch-db.isolated.test.ts`）
