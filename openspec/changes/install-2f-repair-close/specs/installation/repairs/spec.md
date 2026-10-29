# Spec Delta

## ADDED Requirements

### Requirement: 维修单作废的条件
`POST /api/install/repairs/{id}/void`（JSON：`reason` 必填、不超过 500 字）SHALL 要求 `install.task.assign`（ORG），否则 403；他企业的维修单 SHALL 返回 404；原因为空或超长 SHALL 返回 400。维修单已关闭 SHALL 返回 409 `CLOSED`；在返修预约上提交的维修单 SHALL 返回 409 `RETURN_VISIT`（提示改用关闭不返修）；工艺单不是已排期、或提交维修单的那次预约已取消 SHALL 返回 409 `ORDER_STATUS`。以上情况都 SHALL NOT 写记录或改状态。

#### Scenario: 无权或缺原因
- **WHEN** 出单·Vinyl 作废维修单；或运营主管不填原因作废
- **THEN** 分别返回 403、400，维修单仍未关闭，预约状态不变（`repair-close-db.isolated.test.ts`）

#### Scenario: 已关闭与返修中提交的
- **WHEN** 对已作废的维修单再作废；或对在返修预约上提交的 `R-<单号>-2` 作废
- **THEN** 分别返回 409 `CLOSED`、409 `RETURN_VISIT`

### Requirement: 维修单作废的效果
作废成功 SHALL 写审计 `install.repair.completed`（原因"已作废"、原因说明、操作人）；该维修单未完成的返修预约 SHALL 置为已取消；提交维修单的那次安装预约 SHALL 回到已排期并清除完成时间；工艺单当前预约 SHALL 指回该预约（排过返修时安装日期恢复为该预约的时间），工艺单状态 SHALL 保持已排期，不写状态日志。同一维修单重复或并发作废 SHALL 只有一次生效，其余返回 409 `CLOSED`。

#### Scenario: 提交错了
- **WHEN** 运营主管以"Den 标错了，实际没问题"作废未排返修的 `R-<单号>-1`
- **THEN** 返回 200；维修单关闭原因为已作废；首装预约为已排期、无完成时间；工艺单仍为已排期，阶段为 `scheduled`（`repair-close-db.isolated.test.ts`）

#### Scenario: 已排返修后作废
- **WHEN** 维修单已安排小李返修，运营主管作废它
- **THEN** 返修预约为已取消；工艺单当前预约为首装预约，安装日期为首装预约的日期

#### Scenario: 并发作废
- **WHEN** 两个请求同时作废同一张维修单
- **THEN** 一个返回 200，另一个返回 409 `CLOSED`，只有一条关闭记录

### Requirement: 作废后的安装任务
重新打开的安装任务详情 SHALL 带已作废维修单的单号与原因说明，SHALL NOT 再带该维修单的摘要；任务回到正常收口：全部单元已收口后完成收口 SHALL 按「完成收口」把工艺单推进到已安装并发完工通知；仍有问题时提交维修单 SHALL 生成序号递增的新单号。已作废的维修单 SHALL NOT 计入"同一预约只有一张维修单"。

#### Scenario: 补完收口
- **WHEN** 小王打开重新打开的任务，给 Den 补拍完工照并完成收口
- **THEN** 详情先带"`R-<单号>-1` 已作废"与原因；完成后工艺单为已安装，会计"待收尾款"出现该单（`repair-close-db.isolated.test.ts`）

#### Scenario: 作废后重新提交
- **WHEN** 作废后小王把 Kitchen 标为有问题并提交维修单
- **THEN** 生成 `R-<单号>-2`，不返回已作废的 `R-<单号>-1`

### Requirement: 关闭不返修
`POST /api/install/repairs/{id}/close`（JSON：`reason` 必填、不超过 500 字）SHALL 要求 `install.task.assign`（ORG），否则 403；他企业 404；原因为空或超长 400；已关闭 409 `CLOSED`；工艺单不是已排期 409 `ORDER_STATUS`。成功 SHALL 写审计 `install.repair.completed`（原因"关闭不返修"、原因说明、操作人）；未完成的返修预约置为已取消，工艺单当前预约指回提交维修单的那次预约（排过返修时恢复安装日期）；没有其他未关闭维修单时 SHALL 按状态机把工艺单从已排期推进到已安装（记安装时间与状态日志"关闭不返修（<单号>）"，不含原因说明），并发出与首次完成收口相同的完工通知。

#### Scenario: 客户接受现状
- **WHEN** 维修单已安排小李返修，运营主管以"客户接受色差"关闭不返修
- **THEN** 返回 200；返修预约已取消；工艺单为已安装，状态日志为"关闭不返修（`R-<单号>-1`）"；会计收到 `install_completed`，"待收尾款"出现该单，阶段为 `awaiting_balance`（`repair-close-db.isolated.test.ts`）

#### Scenario: 未排返修也能关闭
- **WHEN** 维修单还没登记出单、没排返修，运营主管关闭不返修
- **THEN** 返回 200，工艺单为已安装，没有新预约

#### Scenario: 无权与已关闭
- **WHEN** 出单·Vinyl 关闭不返修；或对已关闭的维修单再关闭
- **THEN** 分别返回 403、409 `CLOSED`，工艺单状态不变

### Requirement: 作废与关闭通知
作废或关闭不返修成功 SHALL 发站内通知（类型 `install_repair_closed`，标题写明"已作废"或"关闭不返修"与单号）：该维修单提交时的通知收件人（相关品类出单岗、持 `install.task.assign` 者、持 `install.balance.confirm` 者）落到维修单详情；工艺单创建人落到工艺单详情；重新打开任务的被分配人与被取消返修预约的被分配人落到 `/install/{预约 id}`。操作人本人不收；同一事件同一人只发一条；通知 SHALL NOT 含原因说明与金额。

#### Scenario: 每个收件人都点得上
- **WHEN** 运营主管作废已安排小李返修的 Vinyl 维修单
- **THEN** 出单·Vinyl、会计、老板各收到一条落到维修单详情的通知且能打开；销售收到一条落到工艺单详情的；小王收到落到首装任务、小李收到落到已取消返修任务的，都能打开；运营主管不收（`repair-close-db.isolated.test.ts`、`balance.test.ts`）

### Requirement: 维修单逾期提醒
既有每日简报定时任务处理到某企业（企业当地 07:00）时 SHALL 对该企业满足全部条件的维修单发站内通知（类型 `install_repair_overdue`）：目标日早于企业时区当天；未关闭；没有返修安排，或返修预约日期早于当天。收件人为持 `install.task.assign` 者（落到维修单详情）与工艺单创建人（落到工艺单详情）。内容含单号、客户、目标日、已过天数与卡在哪一步（待登记出单的品类 / 未排返修 / 返修日已过未收口），SHALL NOT 含金额。同一维修单同一人同一天只发一条；一个企业失败 SHALL NOT 影响其他企业与当天简报。

#### Scenario: 过了目标日还没排
- **WHEN** 企业时区今天 2026-10-29，维修单目标日 2026-10-20、未排返修、Vinyl 未登记出单
- **THEN** 运营主管、会计、老板各一条落到维修单详情、销售一条落到工艺单详情；内容含"已过 9 天""待登记出单：Vinyl"，不含金额（`repair-close-db.isolated.test.ts`）

#### Scenario: 已有返修安排不提醒
- **WHEN** 目标日已过，但返修排在明天
- **THEN** 不发提醒

#### Scenario: 返修日已过仍未收口
- **WHEN** 目标日已过，返修预约在昨天且未完成
- **THEN** 发提醒，内容写明"返修日 <日期> 已过仍未收口"

#### Scenario: 一天一条
- **WHEN** 同一天运行两次；第二天再运行
- **THEN** 同一天每人只有一条；第二天每人新增一条

#### Scenario: 已关闭不提醒
- **WHEN** 维修单已作废、已关闭不返修或返修已完成，目标日已过
- **THEN** 不发提醒

## MODIFIED Requirements

### Requirement: 维修单的进度与可执行操作
`GET /api/install/repairs/{id}` SHALL 另返回：各需工厂品类的出单登记（预计备好日、备注、登记人、时间）与待登记品类；返修排期（预约、时间、安装工、是否完成）；关闭情况（原因：已完成 / 转入 <单号> / 已作废 / 关闭不返修，原因说明、操作人、时间）；当前用户可做的操作（可登记出单的品类、能否安排返修、能否作废、能否关闭不返修）。可执行操作 SHALL 与四个写接口使用同一判定：列出的操作调用接口成功，没列出的被拒绝。维修单列表 SHALL 另含待登记品类、返修时间与关闭原因；已关闭的维修单 SHALL NOT 标为已过目标日。

#### Scenario: 页面按钮与接口一致
- **WHEN** 对出单·Vinyl、出单·布帘、出单·Roller、运营主管、会计各取一次可执行操作，再逐一调用登记出单、安排返修、作废、关闭不返修
- **THEN** 每个人每个操作：列出 ⇔ 接口 2xx（`repair-dispatch-db.isolated.test.ts`、`repair-close-db.isolated.test.ts`）

#### Scenario: 返修中提交的维修单
- **WHEN** 运营主管查看在返修预约上提交的 `R-<单号>-2`
- **THEN** 可执行操作含关闭不返修，不含作废

#### Scenario: 关闭原因
- **WHEN** 维修单已作废，原因"Den 标错了"
- **THEN** 详情关闭情况为已作废、带原因说明与操作人，可执行操作为空；列表该单关闭原因为已作废、不标已过目标日
