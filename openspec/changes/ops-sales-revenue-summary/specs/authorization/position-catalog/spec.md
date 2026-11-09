# Spec Delta

## ADDED Requirements

### Requirement: 销售额汇总权限键
权限目录 SHALL 包含 `sales.revenue.summary.read`，中文标签为「查看销售额汇总」，只支持 `ORG` 数据范围。该键 SHALL 只授予全企业销售额汇总数字（成单金额、成单数、报价金额）的只读访问，SHALL NOT 授予客户、单个报价或按销售员明细的访问。

#### Scenario: 权限键可识别
- **WHEN** `sales.revenue.summary.read` 用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`，支持的数据范围只有 `ORG`

## MODIFIED Requirements

### Requirement: 运营岗位权限
`ops_lead` 模板 SHALL 以 `ORG` 范围绑定 `operations.read`、`operations.manage`、团队任务读 / 管理、执行项目读 / 管理 / 创建、`inventory.manage`、`identity.member.read`、`sales.revenue.summary.read`。`ops_staff` 模板沿用系统模板，SHALL NOT 绑定 `inventory.manage`，SHALL 以 `ORG` 范围绑定 `sales.revenue.summary.read`。两个运营模板 SHALL NOT 绑定 `sales.revenue.summary.read` 以外的任何 `sales.*` 权限。

#### Scenario: 运营主管含库存管理
- **WHEN** 读取 `ops_lead` 与 `ops_staff` 模板
- **THEN** `ops_lead` 包含 `inventory.manage`（ORG），`ops_staff` 不包含

#### Scenario: 运营可看销售额汇总
- **WHEN** 读取 `ops_lead` 与 `ops_staff` 模板（含与系统模板的并集）
- **THEN** 两者都包含 `sales.revenue.summary.read`（ORG），且不包含任何其他 `sales.*` 权限

#### Scenario: 其他岗位不含销售额汇总
- **WHEN** 读取 `sales_rep`、`bids`、三个出单模板与 `installer`
- **THEN** 都不包含 `sales.revenue.summary.read`
