# accounting/sales-commission-view Specification

## Purpose
会计按月查看全员成交与提成：与销售本人业绩页同一口径，按销售人员分组，可导出并留审计，不输出逐行成本。

## Requirements

### Requirement: 提成口径唯一
全员成交汇总与销售本人提成汇总 SHALL 使用同一口径：只统计 `status = signed`、签约时间落在所选自然月（服务器本地时间）的报价；真实毛利 = 有成本快照的报价行 Σ(价格 − 成本价)，无成本快照的行计入未覆盖；提成 = 真实毛利 × 企业设置的提成比例；金额四舍五入到分。销售本人提成接口的响应字段与取值 SHALL 与本次改动前一致。

#### Scenario: 与本人口径一致
- **WHEN** 同一位销售本月的签约单分别经本人提成接口与全员汇总计算
- **THEN** 两者的签约单数、真实毛利、提成、成本覆盖数相同

#### Scenario: 无成本快照
- **WHEN** 某签约单所有行都没有成本价
- **THEN** 该单计入签约单数与成交金额，不计入有成本单数，其行计入未覆盖

### Requirement: 全员成交汇总接口
`GET /api/accounting/sales-summary` SHALL 要求调用者在当前企业持有 `ORG` 范围的 `accounting.read`，否则返回 403。`month` 参数为 `YYYY-MM`，缺省为本月，格式非法返回 400。响应 SHALL 包含所选月份、提成比例、企业合计，以及按销售人员分组的签约单数、成交金额（总价合计）、真实毛利、提成、有成本单数、已覆盖行数、总行数。

#### Scenario: 销售无权
- **WHEN** 只持 `sales_rep` 岗位的销售请求该接口
- **THEN** 返回 403

#### Scenario: 会计按人分组
- **WHEN** 会计请求本月汇总，本月 Alex 签约 2 单、Lynn 签约 1 单
- **THEN** 返回 200，分组中 Alex 签约单数 2、Lynn 签约单数 1，合计 3

#### Scenario: 月份非法
- **WHEN** 以 `month=2026-13` 请求
- **THEN** 返回 400

### Requirement: 汇总不输出成本明细
全员成交汇总的 JSON 与 CSV SHALL NOT 包含任何报价行的成本价、单价或逐行明细，SHALL NOT 包含客户姓名、电话、邮箱或地址。

#### Scenario: 响应不含成本价
- **WHEN** 会计请求全员汇总
- **THEN** 响应文本中不出现 `costPrice` 字样

### Requirement: 导出与审计
`format=csv` 时接口 SHALL 返回 `text/csv` 附件，每行一位销售，列为销售、签约单数、成交金额、真实毛利、提成、成本覆盖；每次导出 SHALL 写一条动作为 `accounting.export` 的审计记录，含导出人、企业、月份与行数。

#### Scenario: 导出写审计
- **WHEN** 会计以 `format=csv` 导出本月汇总
- **THEN** 返回 `text/csv`，审计日志新增一条 `accounting.export` 记录，目标为该月份
