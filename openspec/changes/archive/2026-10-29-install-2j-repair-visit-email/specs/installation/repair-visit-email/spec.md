# Spec Delta

## ADDED Requirements

### Requirement: 返修时间确认邮件的生成
安排返修或改期成功后，系统 SHALL 为该维修单当前返修预约的时间生成一条 `install.send_repair_visit_email` 审批，批准人为排期的人，内容为已定稿的收件人（客户档案邮箱）、主题、正文与 HTML；排期接口响应 SHALL 带该邮件的状态与预览。客户没有有效邮箱、报修电话或报修邮箱未配置时 SHALL NOT 生成审批，SHALL 返回全部原因，排期本身不受影响。批准前 SHALL NOT 发出任何邮件。

#### Scenario: 排期后待批准
- **WHEN** 运营主管给维修单安排返修
- **THEN** 排期返回 200，响应里邮件状态为 `pending_approval` 带审批 id 与预览，审批人为该运营主管，发送次数为 0（`repair-visit-email-db.isolated.test.ts`）

#### Scenario: 客户没有邮箱
- **WHEN** 客户档案邮箱为空时安排返修
- **THEN** 排期返回 200，邮件状态为 `blocked`，原因含"客户没有邮箱"，没有新审批

#### Scenario: 改期
- **WHEN** 已生成邮件审批后把返修改到另一个时间
- **THEN** 为新时间生成一条新审批，主题为改期主题；旧审批批准时被拒发（见「批准后发送返修时间确认邮件」）

### Requirement: 返修时间确认邮件内容
邮件 SHALL 为英文：首次排期主题 `Your repair visit is scheduled — <日期> (Repair <单号>)`，改期主题 `Your repair visit has been rescheduled — <日期> (Repair <单号>)`；正文与 HTML 来自同一份内容，含客户名、维修单号、工艺单号、地址、企业时区的日期与到达时间段、各行位置与问题的英文说明、改期请联系的报修电话与邮箱。同样输入 SHALL 得到完全相同的邮件。

#### Scenario: 内容
- **WHEN** 返修排在多伦多时间 2026-11-05 10:00–12:00，两行（Den 尺寸不对、Kitchen 部件缺失）
- **THEN** 主题含 "Thursday, November 5, 2026"，正文含 "10:00 AM – 12:00 PM"、"Den — Size adjustment / remake"、"Kitchen — Missing parts"、报修电话与邮箱；HTML 同内容（`repair-visit-email.test.ts`）

### Requirement: 返修时间确认邮件不输出的内容
返修时间确认邮件的主题、正文与 HTML SHALL NOT 含任何金额、内部备注（维修单备注、问题描述原文、出单备注）、问题照片地址、出单与工厂信息、员工姓名，以及中文问题类型标签。

#### Scenario: 不出内部信息
- **WHEN** 维修单备注写"客户难沟通"、问题描述写"Den 宽差 1/2 寸"、有问题照片、安装工为小李
- **THEN** 主题、正文、HTML 都不含这些内容，也不含 `$`、`CAD`、`proxy`（`repair-visit-email.test.ts`）

### Requirement: 批准后发送返修时间确认邮件
批准后系统 SHALL 重新校验：维修单属本企业且未关闭（否则拒发 `REPAIR_CLOSED`）；该维修单当前返修预约仍是审批里的预约、未取消且开始时间未变（否则 `SCHEDULE_CHANGED`）；收件人等于客户档案当前邮箱（否则 `RECIPIENT_MISMATCH`）；企业已配置组织发件身份（否则 `NO_ORG_SENDER`，SHALL NOT 改用个人邮箱）；同一预约同一时间已发过 SHALL 拒发 `ALREADY_SENT`。通过后以组织发件身份发出，成功 SHALL 写审计（收件人、主题、预约、时间、消息 id）。

#### Scenario: 批准发送
- **WHEN** 运营主管批准待发邮件，组织已配置发件身份
- **THEN** 发送一次，审计一条，审批状态为已执行（`repair-visit-email-db.isolated.test.ts`，测试发件通道）

#### Scenario: 改期后批准旧审批
- **WHEN** 改期后再批准改期前生成的审批
- **THEN** 不发送，失败原因 `SCHEDULE_CHANGED`

#### Scenario: 未配置发件身份与重复发送
- **WHEN** 组织未配置发件身份时批准；或同一时间的第二条审批在第一条发出后批准
- **THEN** 分别失败 `NO_ORG_SENDER`、`ALREADY_SENT`，都不发送

### Requirement: 返修时间确认邮件状态与重新生成
`GET /api/install/repairs/{id}` SHALL 对有未完成返修预约的维修单另返回邮件状态（`blocked` 带原因、`pending_approval` 带审批 id 与预览、`sent` 带时间、`failed` / `rejected` / `expired` 带原因、`none`）。`POST /api/install/repairs/{id}/visit-email` SHALL 要求 `install.task.assign`（ORG），否则 403；没有未完成返修预约 409 `NO_SCHEDULE`；该时间已发送 409 `ALREADY_SENT`；已有待批准的返回该审批；否则按生成条件生成或返回 `blocked`。维修单详情页 SHALL 显示状态、预览与"批准发送"。该审批 SHALL 归为对外发送类，不能微信回数字确认。

#### Scenario: 补齐邮箱后重新生成
- **WHEN** 先因客户没有邮箱被阻断，补上邮箱后运营主管点"生成确认邮件"
- **THEN** 返回 200、`pending_approval` 与审批 id；出单·Vinyl 调用返回 403（`repair-visit-email-db.isolated.test.ts`）

#### Scenario: 审批渠道
- **WHEN** 读取微信确认策略
- **THEN** `install.send_repair_visit_email` 属对外发送类（`wechat-confirm-policy.test.ts`）
