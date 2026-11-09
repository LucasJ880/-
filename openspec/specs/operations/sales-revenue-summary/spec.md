# operations/sales-revenue-summary Specification

## Purpose
运营中心的全公司销售额只读汇总：让运营岗看到本周与本月至今的成单金额、成单数、报价金额，而看不到客户、单个报价与按销售员的明细。

## Requirements

### Requirement: 销售额汇总接口
`GET /api/ops/sales-summary` SHALL 只放行在当前企业持有全企业（`ORG`）范围 `sales.revenue.summary.read` 或 `sales.analytics.read` 的用户；只有本人范围或没有这两个键 SHALL 返回 403，错误码 `SALES_SUMMARY_FORBIDDEN`。放行时 SHALL 返回组织时区下本周（本周一至今天）与本月至今两个窗口，每个窗口 SHALL 只含起止日期、成单金额、成单数、报价金额、报价数，口径与销售期间汇总的全企业范围一致（草稿、已归档客户的报价不计，非 CAD 报价不计入金额并单独给出条数）。响应 SHALL NOT 含客户、报价标识或按销售员的明细。

#### Scenario: 运营岗读取
- **WHEN** 窗饰企业的运营主管或运营人员请求销售额汇总
- **THEN** 返回 200，本周与本月至今的成单金额、成单数、报价金额与销售期间汇总（全企业）同期数字一致

#### Scenario: 销售与招投标被拒
- **WHEN** 只有本人范围销售权限的销售人员、招投标岗或没有岗位的成员请求销售额汇总
- **THEN** 返回 403，错误码 `SALES_SUMMARY_FORBIDDEN`

#### Scenario: 不泄露明细
- **WHEN** 运营人员读取销售额汇总
- **THEN** 响应里没有客户名、销售员名或标识、报价标识；运营人员请求销售期间汇总（按人明细）仍返回 403

### Requirement: 运营中心销售额卡
运营中心 SHALL 在可读销售额汇总的用户面前显示只读卡「全公司销售额」，分本周与本月至今两栏，各显示成单金额、成单数、报价金额，并注明 CAD 含税、成单按签约日、报价按发出日。接口返回 403 时 SHALL NOT 显示该卡。卡片 SHALL NOT 链接到销售页面。

#### Scenario: 运营人员打开运营中心
- **WHEN** 运营人员打开运营中心
- **THEN** 看到「全公司销售额」卡，含本周与本月至今两栏数字，没有客户或销售员明细
