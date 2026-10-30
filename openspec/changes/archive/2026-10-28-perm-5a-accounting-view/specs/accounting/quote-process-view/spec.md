## Purpose

会计只读查看报价全过程：每张报价的金额、折扣、超限审批状态与审批人、签约时间，不暴露客户个人资料与成本。

## ADDED Requirements

### Requirement: 报价过程接口
`GET /api/accounting/quotes` SHALL 要求调用者在当前企业持有 `ORG` 范围的 `accounting.read` 与 `ORG` 范围的 `sales.quote.read`，否则返回 403。SHALL 列出创建时间落在所选月份（`month=YYYY-MM`，缺省本月，非法 400）的本企业报价，可按 `salesId`（创建人）与 `status` 过滤，按创建时间倒序，最多 500 条。每条 SHALL 包含报价 id、版本、状态、客户名称、销售、税前合计、总价、MSRP 合计、最终折扣率、特别让利、超限审批状态 / 申请比例 / 上限、申请时间、批准人与批准时间、驳回人与驳回时间、签约时间、创建时间。

#### Scenario: 会计看审批轨迹
- **WHEN** 会计请求本月报价，其中一张超限折扣已由老板批准
- **THEN** 返回 200，该报价带审批状态 `approved`、批准人姓名与批准时间

#### Scenario: 按销售过滤
- **WHEN** 会计以 `salesId=<Lynn>` 请求
- **THEN** 只返回 Lynn 创建的报价

#### Scenario: 销售无权
- **WHEN** 只持 `sales_rep` 岗位的销售请求该接口
- **THEN** 返回 403

### Requirement: 报价过程不输出个人资料与成本
报价过程接口 SHALL NOT 输出客户电话、邮箱、地址、报价备注、表单原文、分享令牌、签名图片与 PDF 路径，SHALL NOT 输出任何报价行的成本价。

#### Scenario: 响应不含敏感字段
- **WHEN** 会计请求报价过程
- **THEN** 响应文本中不出现 `costPrice`、`shareToken`、`signatureUrl`、`phone`、`email` 字样
