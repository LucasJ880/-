# Spec Delta

## ADDED Requirements

### Requirement: 出单确认按品类登记
`POST /api/install/repairs/{id}/factory-issued`（JSON：`readyDate` 不早于填写日的 YYYY-MM-DD、`note` 不超过 500 字）SHALL 只对持该维修单待登记品类的修改键（`orders.fulfillment.update.<品类>`）或全品类伞键的成员开放，否则 403。登记的品类 = 调用者能登记的待登记品类；品类推不出的需工厂行由任一品类岗或伞键登记。没有需工厂行 SHALL 返回 409 `NOT_NEEDED`；能登记的都已登记 SHALL 返回 409 `ALREADY_ISSUED`；维修单已关闭 SHALL 返回 409 `CLOSED`。成功写审计 `install.repair.factory_issued`（维修单、品类、预计备好日、备注、登记人）。

#### Scenario: 各登各的品类
- **WHEN** 维修单需工厂品类为 Vinyl 与布帘，出单·Vinyl 登记预计 2026-11-02 备好
- **THEN** 返回 200，登记品类只有 Vinyl，待登记品类剩布帘（`repair-dispatch-db.isolated.test.ts`）

#### Scenario: 不相关的出单岗
- **WHEN** 出单·Roller 对只有 Vinyl 行的维修单登记
- **THEN** 返回 403，无记录

#### Scenario: 重复与不需要
- **WHEN** 出单·Vinyl 再登记一次；或对只有客户原因的维修单登记
- **THEN** 分别返回 409 `ALREADY_ISSUED`、409 `NOT_NEEDED`

### Requirement: 安排返修
`POST /api/install/repairs/{id}/schedule`（JSON：`installAt` 时间、`assignedToId`）SHALL 要求 `install.task.assign`（ORG），否则 403；所选人须持 `install.task.read`，否则 400。成功 SHALL 新建一条安装预约（所选时间起 2 小时、分配给所选人、标题"返修 — <客户> (<工艺单号>) <维修单号>"），把工艺单当前预约指向它并更新安装日期，工艺单状态不变，写审计 `install.repair.scheduled`。已有未完成的返修预约时再次提交 SHALL 改期该预约，不新建。维修单已关闭 SHALL 返回 409。出单未全部登记或预计备好日晚于所选日期时 SHALL 照常排期并在响应里给出提示。

#### Scenario: 运营排返修
- **WHEN** 运营主管为维修单安排小王 2026-11-03 10:00 返修
- **THEN** 返回 200；新预约分配给小王、标题含维修单号；工艺单当前预约为它、状态仍为已排期；阶段为 `repair_scheduled`（`repair-dispatch-db.isolated.test.ts`）

#### Scenario: 改期
- **WHEN** 已排返修后改为 2026-11-04 09:00、安装工小李
- **THEN** 同一条预约的时间与安装工更新，没有新预约

#### Scenario: 无权或选错人
- **WHEN** 出单·Vinyl 安排返修；或运营主管选择一位销售
- **THEN** 分别返回 403、400，没有新预约

#### Scenario: 出单还没好
- **WHEN** 需工厂品类未登记出单时安排返修
- **THEN** 返回 200，响应带"出单尚未登记"提示

### Requirement: 返修预约的收口范围
由安排返修建立的预约（返修预约）的收口单元 SHALL 只是该维修单各行对应的单元。任务列表与详情的计数、完成收口、再提交维修单 SHALL 都按这个范围判定；拍照与标记问题 SHALL 只接受范围内的单元，范围外 SHALL 返回 404。

#### Scenario: 只列维修行
- **WHEN** 工艺单 3 扇窗、维修单 1 行（Den），小王打开返修任务
- **THEN** 详情只有 Den 一个单元，计数 0 / 1；对 Kitchen 拍照返回 404（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 返修完成
返修预约全部收口后完成收口 SHALL 把预约置为已完成，写审计 `install.task.completed`（结果 `repair_completed`、维修单）与 `install.repair.completed`（原因"已完成"）。该工艺单没有其他未关闭维修单时 SHALL 按状态机把工艺单从已排期推进到已安装（记安装时间与状态日志"返修完成"），并发出与首次完成收口相同的完工通知（会计"待收尾款"、销售"已装完"）。

#### Scenario: 返修完成进入待收尾款
- **WHEN** 小王在返修任务里给 Den 拍完工照并完成收口
- **THEN** 预约 completed，维修单关闭，工艺单 installed；会计收到 `install_completed`，会计"待收尾款"列表出现该单（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 返修中再发现问题
在返修预约上提交维修单 SHALL 按「维修单内容」生成新维修单（单号序号递增，行只来自返修范围内有问题的单元），并把原维修单以"转入 <新单号>"关闭（`install.repair.completed`，原因 superseded）；原维修单的出单登记 SHALL NOT 带入新单。

#### Scenario: 第二张维修单
- **WHEN** 返修时 Den 仍不合适，小王标记问题并提交
- **THEN** 生成 `R-<单号>-2`，`R-<单号>-1` 关闭且记"转入 R-<单号>-2"；新单待登记出单（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 维修单的进度与可执行操作
`GET /api/install/repairs/{id}` SHALL 另返回：各需工厂品类的出单登记（预计备好日、备注、登记人、时间）与待登记品类；返修排期（预约、时间、安装工、是否完成）；关闭情况（原因、时间、转入单号）；当前用户可做的操作（可登记出单的品类、能否安排返修）。可执行操作 SHALL 与两个写接口使用同一判定：列出的操作调用接口成功，没列出的被拒绝。维修单列表 SHALL 另含待登记品类与返修时间。

#### Scenario: 页面按钮与接口一致
- **WHEN** 对出单·Vinyl、出单·布帘、出单·Roller、运营主管、会计各取一次可执行操作，再逐一调用两个写接口
- **THEN** 每个人每个操作：列出 ⇔ 接口 2xx（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 返修通知
出单登记成功 SHALL 通知持 `install.task.assign` 者（落到维修单详情）与工艺单创建人（落到工艺单详情），内容"返修件预计 <日期> 备好"。安排返修或改期成功 SHALL 通知被分配的安装工（落到 `/install/{预约 id}`）、工艺单创建人（工艺单详情）与持 `install.balance.confirm` 者（维修单详情）。通知 SHALL NOT 含金额；同一事件同一人只发一条；提交人本人不收。

#### Scenario: 安装工收到返修任务
- **WHEN** 运营主管给小王排了返修
- **THEN** 小王收到一条落到 `/install/{预约 id}` 的通知，且能打开该任务；销售收到一条落到工艺单详情的通知（`repair-dispatch-db.isolated.test.ts`、`balance.test.ts`）
