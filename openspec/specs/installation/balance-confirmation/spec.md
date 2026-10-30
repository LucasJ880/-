# installation/balance-confirmation Specification

## Purpose
装完之后的尾款环节：会计在哪里看到"已安装、待收尾款"的工艺单，怎样登记尾款已收（金额、方式、差额说明）并把工艺单推进到已完成，以及完工与尾款确认时谁会收到站内通知、通知点开落到哪里。

## Requirements

### Requirement: 待收尾款列表
`GET /api/accounting/balance` SHALL 要求调用者在当前企业持 ORG 范围的 `install.balance.confirm`，否则返回 403。响应 SHALL 含 `pending`：本企业（按客户所属企业）没有尾款确认记录、且状态为 `installed`，或状态为 `completed` 且当前安装预约有完成收口记录（`install.task.completed`）的工艺单，每条含工艺单 id、单号、客户名、销售、安装完成时间、安装任务 id、收口单元数与已收口数、关联报价 id、应收尾款；以及 `recentConfirmed`：最近 30 条已确认记录（实收、方式、收款日期、确认人、确认时间）。

#### Scenario: 会计看到待收尾款
- **WHEN** 本企业有 1 张已安装未确认、1 张安装中的工艺单，会计请求列表
- **THEN** 返回 200，`pending` 只含已安装那张，带应收尾款与收口计数（`balance-db.isolated.test.ts`）

#### Scenario: 销售无权
- **WHEN** 只持 `sales_rep` 的销售请求列表
- **THEN** 返回 403

#### Scenario: 他企业的单不出现
- **WHEN** 另一企业有已安装的工艺单
- **THEN** 本企业会计的 `pending` 不含该单

#### Scenario: 出单已手动推到已完成但未确认尾款
- **WHEN** 工艺单走过系统收口后被出单手动推到 `completed`，没有尾款确认记录
- **THEN** 该单仍在 `pending` 中（`balance-db.isolated.test.ts`）

#### Scenario: 历史手工完工不进列表
- **WHEN** 工艺单状态为 `completed`、当前安装预约没有完成收口记录（上线前手工推到已完成），没有尾款确认记录
- **THEN** 该单不在 `pending` 中（`balance.test.ts`、`balance-db.isolated.test.ts`）

### Requirement: 应收尾款口径
一张工艺单的应收尾款 SHALL 取其签字自动生成时关联的报价：有约定尾款（`agreedBalanceAmount`）时取约定尾款；否则为报价总价减已登记定金（未登记按 0），不小于 0。没有关联报价的工艺单应收尾款 SHALL 为空。会计页与销售首页 SHALL 使用同一口径。

#### Scenario: 有约定尾款
- **WHEN** 报价总价 5000、约定尾款 2500
- **THEN** 应收尾款为 2500（`balance.test.ts`）

#### Scenario: 无约定尾款
- **WHEN** 报价总价 5000、无约定尾款、已登记定金 1500
- **THEN** 应收尾款为 3500

#### Scenario: 手工建的单
- **WHEN** 工艺单不是由报价签字生成
- **THEN** 应收尾款为空，页面显示"—"

### Requirement: 确认收到尾款
`POST /api/accounting/balance/{orderId}/confirm`（JSON：`amount`、`method`、`receivedAt`、`note`）SHALL 要求 ORG 范围的 `install.balance.confirm`，否则 403；工艺单不属本企业 SHALL 返回 404；状态不是 `installed` / `completed` SHALL 返回 409 `NOT_INSTALLED`。金额须大于 0 且最多两位小数，方式须为 `cash` / `visa` / `check` / `finance`，收款日期须为不晚于当天的 `YYYY-MM-DD`，备注不超过 500 字，否则返回 400。成功时 SHALL 写审计 `install.balance.confirmed`（目标为工艺单，含关联报价、应收、实收、方式、收款日期、备注），并把 `installed` 的工艺单推进到 `completed`（记状态日志"尾款确认"）。

#### Scenario: 会计确认
- **WHEN** 会计对已安装、应收 2500 的单提交实收 2500、方式 visa、今天
- **THEN** 返回 200，工艺单为 `completed`，审计出现一条 `install.balance.confirmed`（`balance-db.isolated.test.ts`）

#### Scenario: 未安装
- **WHEN** 对状态 `scheduled` 的单提交
- **THEN** 返回 409 `NOT_INSTALLED`，无审计

#### Scenario: 非法输入
- **WHEN** 金额为 0、方式为 `mastercard`，或收款日期在明天之后
- **THEN** 返回 400，状态不变

#### Scenario: 销售无权
- **WHEN** 只持 `sales_rep` 的销售提交
- **THEN** 返回 403

### Requirement: 差额必须说明
应收尾款不为空、且实收与应收相差 0.01 及以上时，备注 SHALL 必填，缺备注 SHALL 返回 400 `NOTE_REQUIRED`；带备注时 SHALL 照常确认，记录同时保存应收与实收。

#### Scenario: 少收无说明
- **WHEN** 应收 2500、实收 2400、备注为空
- **THEN** 返回 400 `NOTE_REQUIRED`，状态不变（`balance.test.ts`）

#### Scenario: 少收有说明
- **WHEN** 应收 2500、实收 2400、备注"客户扣 100 作为划痕补偿"
- **THEN** 返回 200，记录含应收 2500 与实收 2400

### Requirement: 尾款只确认一次
同一工艺单 SHALL 只有一条尾款确认记录。已确认后再次提交 SHALL 返回 200、`idempotent: true` 与首次记录，SHALL NOT 新增审计或状态日志；并发提交 SHALL 只产生一条记录。

#### Scenario: 重复点击
- **WHEN** 会计连续两次提交同一单
- **THEN** 第二次返回 `idempotent: true`，审计只有一条 `install.balance.confirmed`（`balance-db.isolated.test.ts`）

### Requirement: 完工通知
完成收口首次成功（非幂等返回）后，系统 SHALL 给本企业每位持 `install.balance.confirm` 的成员与该工艺单的创建人（销售）各发一条站内通知（类型 `install_completed`），同一单同一人只发一次；通知标题与摘要 SHALL NOT 含金额。通知创建失败 SHALL NOT 改变完成收口的响应。收件人的通知偏好照常生效。

#### Scenario: 收口后会计与销售收到
- **WHEN** 安装工完成收口
- **THEN** 会计与该单销售各有一条 `install_completed` 未读通知（`balance-db.isolated.test.ts`）

#### Scenario: 重复收口不重复通知
- **WHEN** 已完成的任务再次调用完成收口
- **THEN** 不新增通知

### Requirement: 尾款确认通知
尾款确认成功后，系统 SHALL 给该工艺单的创建人（销售）发一条站内通知（类型 `install_balance_confirmed`），只发一次，标题与摘要 SHALL NOT 含金额。

#### Scenario: 销售收到尾款已确认
- **WHEN** 会计确认尾款
- **THEN** 该单销售有一条 `install_balance_confirmed` 通知，内容不含金额

### Requirement: 通知落点
点击 `install_completed` 或 `install_balance_confirmed` 通知 SHALL 打开收件人有权打开的页面：发给持 `install.balance.confirm` 者的落到 `/accounting?tab=balance&order=<工艺单 id>`，发给销售的落到 `/blinds-orders/<工艺单 id>`。头部通知下拉与通知页 SHALL 使用同一落点规则。

#### Scenario: 会计点通知
- **WHEN** 会计在头部通知下拉或通知页点击 `install_completed`
- **THEN** 两处都打开 `/accounting?tab=balance&order=<id>`，页面落在"待收尾款"页签（`balance.test.ts`）

### Requirement: 销售首页待收尾款
销售首页"待收尾款"SHALL 为本月签约报价逐单的应收尾款之和（口径同「应收尾款口径」），其关联工艺单已有尾款确认记录的报价 SHALL NOT 计入。

#### Scenario: 已确认的单不再计入
- **WHEN** 销售本月签约两张报价，应收尾款各 1000，其中一张的工艺单已确认尾款
- **THEN** 销售首页"待收尾款"为 1000（`balance-db.isolated.test.ts`）

### Requirement: 不输出的内容
待收尾款列表与确认接口 SHALL NOT 输出报价行成本价、毛利、提成、客户电话与邮箱、报价备注与表单原文。

#### Scenario: 响应字段
- **WHEN** 会计请求待收尾款列表
- **THEN** 响应文本不含 `costPrice`、`margin`、`commission`、`phone`、`email`、`formDataJson`
