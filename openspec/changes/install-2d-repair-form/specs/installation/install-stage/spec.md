# Spec Delta

## Purpose

用一张表把工艺单推导到一个安装阶段（未排期 / 已排期 / 返修 / 待收尾款 / 已结清），安装、维修单列表、通知与工艺单详情共用同一结果，销售在工艺单详情看到对应的状态卡。

## ADDED Requirements

### Requirement: 安装阶段推导
安装阶段 SHALL 只由工艺单状态、是否有尾款确认记录、是否有未关闭的维修单及其是否含需工厂行查表得出：已取消 → `cancelled`；草稿 / 已确认 / 生产中 / 待安装 → `not_scheduled`；已排期且无未关闭维修单 → `scheduled`；已排期且未关闭维修单含需工厂行 → `repair_open`；已排期且未关闭维修单不含需工厂行 → `repair_ready_to_schedule`；已安装且无尾款确认 → `awaiting_balance`；已完工且无尾款确认时，当前安装预约有完成收口记录 → `awaiting_balance`，没有（历史手工完工）→ `closed`；有尾款确认 → `closed`。已提交的维修单在出单、排返修与二次安装上线前都视为未关闭。

#### Scenario: 查表
- **WHEN** 分别输入：已排期无维修单；已排期且维修单有一行需工厂；已排期且维修单只有客户原因；已安装未确认尾款；有尾款确认
- **THEN** 依次得到 `scheduled`、`repair_open`、`repair_ready_to_schedule`、`awaiting_balance`、`closed`（`stage.test.ts`）

#### Scenario: 已完工但没有尾款确认
- **WHEN** 两张已完工、都没有尾款确认的单，一张当前安装预约有完成收口记录，另一张是历史上手工推到已完工、没有收口记录
- **THEN** 前者 `awaiting_balance`，后者 `closed`（`stage.test.ts`）

#### Scenario: 取消优先
- **WHEN** 工艺单已取消且有未关闭维修单
- **THEN** 阶段为 `cancelled`

### Requirement: 阶段文案
每个阶段 SHALL 有固定的中文名与销售文案：`not_scheduled` 未排安装；`scheduled` 已排期（销售："已排 <安装日> 安装"）；`repair_open` 返修待出单、`repair_ready_to_schedule` 返修待排期（销售都为"返修中，目标 <目标日>"）；`awaiting_balance` 待收尾款（销售："已装完，收尾款"）；`closed` 已结清（销售：有尾款确认时为"已结清"并附质保邮件状态：已发送 / 待批准 / 未发出；历史手工完工为"已完工"）；`cancelled` 已取消。

#### Scenario: 返修中的销售文案
- **WHEN** 阶段为 `repair_open`，目标日 2026-11-04
- **THEN** 销售文案为"返修中，目标 2026-11-04"（`stage.test.ts`）

### Requirement: 安装状态接口
`GET /api/blinds-orders/{id}/install-status` SHALL 对能读该工艺单的人返回阶段、阶段名、销售文案、最近一次安装预约时间；有未关闭维修单时另含单号、目标日、是否已和客户确认、各行位置与问题类型名、是否需工厂。不能读该工艺单的人 SHALL 收到 404（与工艺单详情一致）。

#### Scenario: 销售看自己的单
- **WHEN** 工艺单创建人 Alex（只持 `sales_rep`）请求返修中的单
- **THEN** 返回 200，阶段 `repair_open`，含单号与目标日，各行有位置与问题类型名（`repair-db.isolated.test.ts`）

#### Scenario: 无读权
- **WHEN** 另一位不是创建人的销售请求该单
- **THEN** 返回 404

### Requirement: 工艺单详情的安装状态卡
工艺单详情页 SHALL 在顶部显示安装状态卡：阶段名与销售文案；有未关闭维修单时列出单号、目标日、是否已和客户确认与各行位置和问题类型名。能打开该页的人都 SHALL 看到（包括作为创建人的销售）；接口失败时 SHALL 不显示卡片且不影响页面其他内容。

#### Scenario: 销售从通知点进
- **WHEN** 销售点开"返修单已提交"通知
- **THEN** 落到工艺单详情，顶部状态卡显示"返修中，目标 <日期>"与单号（本地 Playwright 走查截图）

### Requirement: 安装状态不输出的内容
安装状态接口与状态卡 SHALL NOT 含问题照片、问题描述、维修单表头电话与备注、报价金额、定金、尾款、折扣、成本或毛利。

#### Scenario: 响应字段
- **WHEN** 销售请求返修中工艺单的安装状态
- **THEN** 响应不含 `photos`、`proxyUrl`、`description`、`phone`、`notes` 与任何金额字段（`repair-db.isolated.test.ts`）
