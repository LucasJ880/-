# Spec Delta

## MODIFIED Requirements

### Requirement: 安装阶段推导
安装阶段 SHALL 只由工艺单状态、是否有尾款确认记录、当前安装预约是否有完成收口记录与最新一张未关闭维修单的情况查表得出：已取消 → `cancelled`；草稿 / 已确认 / 生产中 / 待安装 → `not_scheduled`；已排期且无未关闭维修单 → `scheduled`；已排期且未关闭维修单已排返修（返修预约未完成）→ `repair_scheduled`；未排返修且还有需工厂品类没登记出单 → `repair_open`；未排返修且无需工厂或已全部登记 → `repair_ready_to_schedule`；已安装且无尾款确认 → `awaiting_balance`；已完工且无尾款确认时，当前安装预约有完成收口记录 → `awaiting_balance`，没有 → `closed`；有尾款确认 → `closed`。

#### Scenario: 查表
- **WHEN** 分别输入：已排期无维修单；已排期且维修单有一行需工厂；已排期且维修单只有客户原因；已安装未确认尾款；有尾款确认
- **THEN** 依次得到 `scheduled`、`repair_open`、`repair_ready_to_schedule`、`awaiting_balance`、`closed`（`stage.test.ts`）

#### Scenario: 已完工但没有尾款确认
- **WHEN** 两张已完工、都没有尾款确认的单，一张当前安装预约有完成收口记录，另一张是历史上手工推到已完工、没有收口记录
- **THEN** 前者 `awaiting_balance`，后者 `closed`（`stage.test.ts`）

#### Scenario: 取消优先
- **WHEN** 工艺单已取消且有未关闭维修单
- **THEN** 阶段为 `cancelled`

#### Scenario: 出单登记后
- **WHEN** 维修单需工厂品类为 Vinyl 与布帘，只有 Vinyl 登记了出单
- **THEN** 阶段仍为 `repair_open`；布帘也登记后为 `repair_ready_to_schedule`（`stage.test.ts`）

#### Scenario: 已排返修
- **WHEN** 维修单已安排返修、返修预约未完成
- **THEN** 阶段为 `repair_scheduled`，无论出单是否登记完（`stage.test.ts`）

#### Scenario: 返修完成
- **WHEN** 返修预约全部收口、工艺单转为已安装
- **THEN** 阶段为 `awaiting_balance`（`repair-dispatch-db.isolated.test.ts`）

### Requirement: 阶段文案
每个阶段 SHALL 有固定的中文名与销售文案：`not_scheduled` 未排安装；`scheduled` 已排期（销售："已排 <安装日> 安装"）；`repair_open` 返修待出单、`repair_ready_to_schedule` 返修待排期（销售都为"返修中，目标 <目标日>"）；`repair_scheduled` 返修已排期（销售："<返修日> 再去返修"）；`awaiting_balance` 待收尾款（销售："已装完，收尾款"）；`closed` 已结清（销售：有尾款确认时为"已结清"并附质保邮件状态：已发送 / 待批准 / 未发出；历史手工完工为"已完工"）；`cancelled` 已取消。

#### Scenario: 返修中的销售文案
- **WHEN** 阶段为 `repair_open`，目标日 2026-11-04
- **THEN** 销售文案为"返修中，目标 2026-11-04"（`stage.test.ts`）

#### Scenario: 已排返修的销售文案
- **WHEN** 阶段为 `repair_scheduled`，返修预约在 2026-11-03
- **THEN** 销售文案为"2026-11-03 再去返修"（`stage.test.ts`）
