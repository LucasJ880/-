# accounting/project-settlement-view Specification

## Purpose
项目结算汇总：会计看企业全部项目、招投标参与方只看自己参与的项目，只给汇总不给逐笔明细，与销售成交分开展示。

## Requirements

### Requirement: 项目结算接口与范围
`GET /api/accounting/projects` SHALL 要求调用者在当前企业持有 `project.finance.read`，否则返回 403。持 `ORG` 范围时 SHALL 列出本企业全部已派发项目；只持 `ASSIGNED` 范围时 SHALL 只列出调用者是 active 项目成员或负责人的项目。`quarter=YYYY-Qn` 时只列投标提交时间（无则创建时间）落在该季度的项目，格式非法返回 400；最多 100 个项目。

#### Scenario: 会计看全部
- **WHEN** 会计请求项目结算，企业有 3 个已派发项目
- **THEN** 返回 3 个项目

#### Scenario: 招投标只看参与的
- **WHEN** 只持 `bids` 岗位、只是其中 1 个项目成员的人请求
- **THEN** 只返回该 1 个项目

#### Scenario: 销售无权
- **WHEN** 只持 `sales_rep` 岗位的销售请求
- **THEN** 返回 403

### Requirement: 结算只给汇总
每个项目 SHALL 只返回项目 id、名称、投标结果、币种、总成本、合同收入、已确认收入、未结应付、未结报销、结算状态、预测利润、最终利润及其是否可用；SHALL NOT 返回逐笔费用、收据、付款记录或供应商明细。

#### Scenario: 不含逐笔费用
- **WHEN** 会计请求项目结算
- **THEN** 每个项目对象只含汇总字段，不含费用列表或收据

### Requirement: 与销售成交分开
项目结算 SHALL 由独立接口与独立页签提供，SHALL NOT 与销售成交金额合并计算或合并展示。持 `project.finance.read` 而不持 `accounting.read` 的人 SHALL 拿不到销售成交汇总。

#### Scenario: 招投标看不到销售成交
- **WHEN** 只持 `bids` 岗位的人请求全员成交汇总
- **THEN** 返回 403

### Requirement: 财务控制未启用
项目财务控制功能未启用时，接口 SHALL 返回 200、`available: false` 与空项目列表，SHALL NOT 报错。

#### Scenario: 功能关闭
- **WHEN** 财务控制开关关闭时会计请求项目结算
- **THEN** 返回 200，`available` 为 false，项目列表为空
