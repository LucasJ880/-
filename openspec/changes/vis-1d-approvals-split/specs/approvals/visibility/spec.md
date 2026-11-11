# Spec Delta

## Purpose

审批中心、AI 助手「待我确认」、侧栏红点、运营看板与 Muse 审批收件箱按同一个可见集合列出审批：本人相关的，加上本岗位负责的业务类型；企业管理员角色本身不再等于看全企业。

## ADDED Requirements

### Requirement: 审批的可见集合
岗位模式企业里，本企业的一条审批（PendingAction、项目智能体审批、产品内容审批）对某成员可见 SHALL 当且仅当满足任一：本人提交；本人是指定审批人；本人是审批所在工作区的成员；本人是审批所属项目的负责人或项目管理员；按类型的可见岗位条件放行（见本能力其余三条）。平台 super_admin SHALL 可见全部。企业成员角色 org_owner / org_admin 本身 SHALL NOT 使人看到业务类型的审批。

#### Scenario: 销售只看到与自己相关的
- **WHEN** 运行 `npx tsx src/lib/approval/__tests__/audience.test.ts`，只持 `sales_rep` 的成员判定另一位销售提交的让利审批与自己提交的让利审批
- **THEN** 只有自己提交的可见，测试通过

#### Scenario: 指定审批人与项目负责人
- **WHEN** 同一测试中，成员是一条审批的指定审批人，或是一条 `tender.send_rfq` 所属项目的负责人（自己不持招投标岗位）
- **THEN** 两条都可见（同一测试覆盖）

#### Scenario: 平台管理员
- **WHEN** 未绑岗位的平台 super_admin 判定任意类型的审批
- **THEN** 全部可见（同一测试覆盖）

### Requirement: 销售、订单与安装审批的可见岗位
下列类型 SHALL 对「业务页面经路由门放行 ∧ 持该类型审批键」的成员可见：
- `sales.approve_quote_promotion`：报价单 ∧ `sales.quote.discount.over_limit.approve`；
- `sales.update_signed_quote`：报价单 ∧ `sales.quote.signed_amount.approve`；
- `sales.update_quote_settings`：销售驾驶舱 ∧ `sales.settings.manage`；
- `orders.cancel_blinds_order`：工艺单详情 ∧ `orders.cancel`；
- `install.send_warranty_email`：会计 ∧ `install.balance.confirm`；
- `install.send_repair_visit_email`：安装 ∧ `install.task.assign`。

#### Scenario: Sunny 老板与会计
- **WHEN** 运行同一测试，以 Sunny 持 `owner`、只持 `accounting`、只持 `pricing_lead` 的输入判定这六类他人提交的审批
- **THEN** 老板六类都可见；会计只见两类安装邮件；合价一类都不见，测试通过

### Requirement: 外贸、招投标、营销与产品内容审批的可见岗位
下列类型 SHALL 对其业务页面经路由门放行（有审批键的另要持键）的成员可见：
- `revenue_spine.*`、`sales.send_inquiry_reply`：营收中心 ∧ `trade.settings.manage`；
- `tender.*` 与项目智能体审批：招投标中心；
- `marketing.*`：品牌增长；
- 产品内容审批：产品内容页。

#### Scenario: Sunny 老板没有外贸营收类
- **WHEN** 运行同一测试，以 Sunny（未启用 `trade`）持 `owner` 的输入判定他人提交的各类审批
- **THEN** 看不到 `revenue_spine.*` 与 `sales.send_inquiry_reply`；看得到 `tender.*`、`marketing.*` 与产品内容审批，测试通过

#### Scenario: 梦馨 Cathy 的外贸审批不受影响
- **WHEN** 以梦馨（未启用 `bids` / `projects`）持 `owner` + `trade_rep` 的输入判定
- **THEN** 看得到 `revenue_spine.*`、`sales.send_inquiry_reply`、`marketing.*` 与产品内容审批，看不到 `tender.*`（同一测试覆盖）

#### Scenario: 运营与招投标各看各的
- **WHEN** 分别以只持 `ops_staff`、只持 `bids` 的输入判定
- **THEN** 运营只见 `marketing.*`；招投标只见 `tender.*` 与项目智能体审批（同一测试覆盖）

### Requirement: 没有业务归属的草稿
类型不在前两条对照里的 PendingAction（如助手、Grader、日历草稿）SHALL 对本企业 org_owner / org_admin 可见：执行期只认企业管理员、项目负责人 / 项目管理员与指定审批人处理这些草稿。其余成员照「审批的可见集合」。

#### Scenario: 销售的助手草稿
- **WHEN** 运行同一测试，一位销售在助手里生成了 `grader.email_draft`，以 org_admin 与另一位只持 `sales_rep` 的成员分别判定
- **THEN** org_admin 可见，另一位销售不可见，测试通过

### Requirement: 旧模式企业沿用原规则
行业包没有岗位模板的企业（旧模式）SHALL 沿用改动前的规则：org_owner / org_admin 可见本企业全部审批；其余成员只见本人提交、本人为指定审批人或本人所在工作区的审批。

#### Scenario: 旧模式的企业管理员
- **WHEN** 运行同一测试，旧模式企业的 org_admin 判定一条他人提交的 `tender.send_rfq`
- **THEN** 可见，测试通过

### Requirement: 审批中心按可见集合
审批中心列表（含首页「等你拍板」与审批中心概览所用的「待我审批」）SHALL 只含可见的审批；「待我审批」为可见 ∧ 待审批 ∧ 本人能批（能批判定不变）。审批详情对不可见的审批 SHALL 返回 404；对不可见的审批批准、驳回、撤回或重试 SHALL 返回 404，且审批状态 SHALL NOT 改变。

#### Scenario: 管理员不持招投标岗位
- **WHEN** 运行 `npx tsx src/lib/approval/__tests__/audience-db.isolated.test.ts`（本机隔离库），岗位模式企业里一位 org_admin 不持任何岗位，打开审批中心并直接请求他人 `tender.send_rfq` 的详情与批准
- **THEN** 列表里没有这一条，详情与批准都返回 404，该审批仍为待审批，测试通过

#### Scenario: Sunny 老板照常处理折扣审批
- **WHEN** 同一测试中，持 `owner` 的 org_admin 打开审批中心「待我审批」
- **THEN** 列表含销售提交的让利审批，可以批准（同一测试覆盖）

### Requirement: 待我确认与审批收件箱用同一集合
AI 助手「待我确认」列表与侧栏红点数、运营看板的待审批、审批收件箱（`/api/agent/approvals` 与 Muse）SHALL 只含各自既有处理人范围中可见的 PendingAction，用同一个查询条件函数。红点数 SHALL 与列表一样只数当前企业（另含本人的个人草稿）。经 AI 助手或审批端口（含 Muse 批准 / 驳回）处理看不见的审批 SHALL 被拒绝，且不执行。

#### Scenario: 红点数与列表一致
- **WHEN** 运行同一隔离库测试，不持岗位的 org_admin 请求「待我确认」列表与红点数，企业里有一条他人的 `tender.send_rfq` 与一条无业务归属的助手草稿
- **THEN** 列表只有助手草稿，红点数为 1；经 AI 助手批准那条询价被拒绝、未执行（同一测试覆盖）

#### Scenario: Muse 收件箱
- **WHEN** 同一测试中，以该管理员调用审批收件箱（Muse `status` / `approve` 所用）
- **THEN** 不含那条询价（同一测试覆盖）
