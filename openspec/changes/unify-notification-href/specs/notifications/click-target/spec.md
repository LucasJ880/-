# Spec Delta

## Purpose

约束站内通知被点击后跳到哪里：顶栏铃铛下拉与通知中心页对同一条通知给出同一个站内地址，按实体类型定位到对应页面，否则回退到所属项目，都没有时不跳转；企业作用域的实体在跳转前记住通知所属企业。

## ADDED Requirements

### Requirement: 两个入口跳到同一地址
顶栏铃铛下拉与通知中心页（`/notifications`）对同一条通知 SHALL 跳到同一个站内地址；跳转目标 SHALL 只由通知的 `entityType`、`entityId`、`projectId`、`activityId`、`orgId` 决定，SHALL NOT 读取通知 `metadata` 中的任何字段。

#### Scenario: 审批通知在两个入口一致
- **WHEN** 分别在铃铛下拉与通知中心页点击 `entityType=approval`、`entityId=ap1` 的通知
- **THEN** 两处都跳到 `/capabilities/approvals/ap1`

#### Scenario: metadata 里的链接不参与决定
- **WHEN** 一条通知 `entityType=blinds_order`、`entityId=bo1`，`metadata.href` 为 `/somewhere-else`
- **THEN** 跳到 `/blinds-orders/bo1`

### Requirement: 任务、项目、询问、工艺单与审批通知的地址
带 `entityId` 的通知 SHALL 按以下类型跳转（`<id>` 为 `entityId`）：`task`→`/tasks?open=<id>`；`project`→`/projects/<id>`；`muse_inquiry`→`/sales/inquiries/<id>`；`blinds_order`→`/blinds-orders/<id>`；`approval`→`/capabilities/approvals/<id>`。

#### Scenario: 表驱动测试覆盖全部类型
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/href.test.ts`
- **THEN** 本条与下一条列出的 12 个 `entityType` 各自得到所列地址，退出码为 0

#### Scenario: 任务通知直接打开任务
- **WHEN** 点击 `entityType=task`、`entityId=t1` 的通知
- **THEN** 跳到 `/tasks?open=t1`，任务详情抽屉打开

#### Scenario: 询问通知在通知中心页可点
- **WHEN** 在通知中心页点击 `entityType=muse_inquiry`、`entityId=inq1` 的通知
- **THEN** 跳到 `/sales/inquiries/inq1`

### Requirement: 销售、外贸与商机通知的地址
带 `entityId` 的通知 SHALL 按以下类型跳转：`sales_quote`→`/sales/quote-sheet?mode=order&quoteId=<id>`，通知带 `orgId` 时追加 `&orgId=<orgId>`；`trade_prospect`→`/trade/prospects/<id>`；`trade_booth_summary`→`/trade/booth-cards?day=<id>`；`revenue_opportunity`→`/revenue/<id>`；`sales_customer`→`/sales/customers/<id>`；`visualizer_session`→`/sales/visualizer/<id>`。`sales_actions` 不需要 `entityId`，SHALL 跳到 `/sales?view=customers`。

#### Scenario: 销售报价带企业参数
- **WHEN** 点击 `entityType=sales_quote`、`entityId=q1`、`orgId=org_b` 的通知
- **THEN** 跳到 `/sales/quote-sheet?mode=order&quoteId=q1&orgId=org_b`

#### Scenario: 销售动作提醒无实体 ID
- **WHEN** 点击 `entityType=sales_actions`、无 `entityId` 的通知
- **THEN** 跳到 `/sales?view=customers`

### Requirement: 地址中的 ID 经过编码
跳转地址中出现的 `entityId`、`orgId`、`projectId`、`activityId` SHALL 经 URL 组件编码后再拼入路径或查询参数。

#### Scenario: ID 中的特殊字符被编码
- **WHEN** 点击 `entityType=trade_prospect`、`entityId` 为 `a/b?c` 的通知
- **THEN** 跳到 `/trade/prospects/a%2Fb%3Fc`

### Requirement: 项目兜底与无目标不跳转
实体类型不在上表中，或在上表中但缺 `entityId`（`sales_actions` 除外）时：有 `projectId` 与 `activityId` SHALL 跳到 `/projects/<projectId>?activity=<activityId>`；只有 `projectId` SHALL 跳到 `/projects/<projectId>`；两者都没有 SHALL NOT 跳转，页面停留原处。

#### Scenario: 未知类型带项目活动
- **WHEN** 点击 `entityType=calendar_event`、`projectId=p1`、`activityId=a1` 的通知
- **THEN** 跳到 `/projects/p1?activity=a1`

#### Scenario: 已知类型缺实体 ID
- **WHEN** 点击 `entityType=approval`、无 `entityId`、`projectId=p1` 的通知
- **THEN** 跳到 `/projects/p1`

#### Scenario: 未知类型无项目
- **WHEN** 点击 `entityType=unknown_kind`、无 `projectId` 的通知
- **THEN** 不发生跳转

### Requirement: 企业作用域类型跳转前记住所选企业
`sales_quote`、`approval`、`trade_booth_summary`、`revenue_opportunity`、`sales_customer`、`sales_actions`、`visualizer_session` 七类通知按上表跳转且通知带 `orgId` 时，两个入口 SHALL 先把该 `orgId` 记为当前所选企业再跳转。其余类型以及走项目兜底的通知 SHALL NOT 改动所选企业。

#### Scenario: 铃铛下拉点商机通知切到所属企业
- **WHEN** 当前所选企业为 `org_a`，在铃铛下拉点击 `entityType=revenue_opportunity`、`entityId=r1`、`orgId=org_b` 的通知
- **THEN** 所选企业记为 `org_b`，然后跳到 `/revenue/r1`

#### Scenario: 任务通知不改所选企业
- **WHEN** 当前所选企业为 `org_a`，点击 `entityType=task`、`entityId=t1`、`orgId=org_b` 的通知
- **THEN** 所选企业仍为 `org_a`，跳到 `/tasks?open=t1`

#### Scenario: 企业标记由测试覆盖
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/href.test.ts`
- **THEN** 七类企业作用域类型标记为需要记住企业，其余类型与项目兜底标记为不需要，退出码为 0
