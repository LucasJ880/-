# cockpit/company-log-labels Specification

## Purpose
company.log 时间线的审计条目用中文说明发生了什么，并标出每条记录来自人工、AI 还是系统；系统或 AI 以负责人名义写的审计不再显示成负责人本人操作。

## Requirements

### Requirement: 审计条目的中文摘要

时间线审计条目的摘要 SHALL 对常见动作显示中文标签，对常见目标类型显示中文名，格式为"<动作标签> · <目标名>"。常见动作至少包括：
- 通用：新建、更新、删除、登录、退出登录、邀请成员、移除、变更角色、变更状态、导出；
- 审批：发起审批、批准、驳回、取消审批、开始执行、执行完成、执行失败、执行被拦下、被系统作废、驳回 AI 草稿；
- 配额与自动录入：配额用尽被拦下、配额接近上限、配额预警、询价邮件已自动录入、询价邮件自动录入失败；
- Revenue Spine：商机阶段变更、商务事实写入、FDE 草稿留底、跟进草稿被守卫拦下、草稿偏好有项被忽略、询盘录入、询盘回复已发送、人工外发已同步到商机。

上述动作的写入方实际使用的目标类型 SHALL 都有中文名。没有中文标签的动作 SHALL 原样显示原始动作代码与原始目标类型（目标类型有中文名也不翻译，避免半中半英）；有标签的动作遇到没有中文名的目标类型时 SHALL 显示原始目标类型。摘要 SHALL 继续经过时间线既有的敏感词整段替换。

#### Scenario: 常见动作
- **WHEN** 一条审计的动作为 `APPROVAL_REJECTED`、目标类型为 `pending_action`
- **THEN** 摘要为"驳回 · 审批"

#### Scenario: 未知动作
- **WHEN** 一条审计的动作为 `supplier_intel.run.created`、目标类型为 `supplier_intel_run`
- **THEN** 摘要为 "supplier_intel.run.created · supplier_intel_run"

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/audit-labels.test.ts`
- **THEN** 全部断言通过，退出码 0

### Requirement: 商机阶段变更显示前后阶段

商机阶段变更审计的摘要 SHALL 为"商机阶段：<原阶段中文名> → <新阶段中文名>"；按策略自动流转（审计记录了策略键）时 SHALL 追加"（按策略自动）"。原阶段或新阶段不是已知阶段值时，系统 SHALL NOT 显示该值，摘要退回"商机阶段变更 · 商机"。

#### Scenario: 自动搁置
- **WHEN** 一条商机阶段变更审计记录原阶段 `follow_up`、新阶段 `stale`、来源 `system`、带策略键
- **THEN** 摘要为"商机阶段：跟进中 → 搁置（按策略自动）"（阶段中文名与 `/revenue` 的商机阶段标签一致），来源为 `system`

#### Scenario: 异常阶段值
- **WHEN** 审计里的新阶段是任意自由文本
- **THEN** 摘要退回"商机阶段变更 · 商机"，不出现该文本

### Requirement: 条目来源

时间线条目 SHALL 按以下规则标出来源：
- AI 运行事件为 `ai`，自动化运行为 `system`；
- 审计条目默认为 `human`；
- 固定由 FDE 写入的审计（FDE 草稿留底、跟进草稿被守卫拦下、草稿偏好有项被忽略）为 `ai`；
- 固定由系统写入的审计（审批被系统作废、配额守卫的三档提醒、询价邮件自动录入成功 / 失败、人工外发同步到商机、岗位日结）为 `system`；
- 商机阶段变更按审计记录的流转来源：人工为 `human`、FDE 为 `ai`、系统为 `system`；记录缺失或不是已知值时为 `human`；
- 发起审批按该审批记录的发起方：AI 发起为 `ai`，人工发起、缺失或找不到审批时为 `human`；批准、驳回等审批决定始终按人工。

#### Scenario: FDE 留底
- **WHEN** 一条审计动作为 FDE 草稿留底，操作人是负责人
- **THEN** 该条目 `source` 为 `ai`，`actor` 仍为负责人的用户 id

#### Scenario: 人工阶段变更
- **WHEN** 商机阶段变更审计记录来源为人工
- **THEN** 该条目 `source` 为 `human`

#### Scenario: FDE 发起的审批
- **WHEN** 一条"发起审批"审计对应的审批由 FDE（AI）发起，操作人是负责人
- **THEN** 该条目 `source` 为 `ai`；同一审批后续的"批准"条目 `source` 为 `human`

#### Scenario: 岗位日结
- **WHEN** 一条审计动作为岗位日结（`cockpit.post_daily_digest`），操作人是组织所有者
- **THEN** 该条目摘要为"岗位日结 · 组织"，`source` 为 `system`，`actor` 仍为组织所有者的用户 id

### Requirement: 审计只读白名单字段

时间线 SHALL 只为商机阶段变更审计额外读取变更数据，并且只解析、使用三项：流转来源、是否带策略键、前后阶段；只接受已知枚举值。发起审批的来源 SHALL 只用读模型为归属本就读取的审批记录里的发起方，不额外读审计变更数据。时间线 SHALL NOT 读取或输出任何其他审计的变更前后数据，SHALL NOT 输出流转原因、策略键本身、金额或其他自由文本。额外读取 SHALL 限定在当前组织、当前页的审计条目内。

#### Scenario: 不输出原因与金额
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/audit-labels.test.ts` 与 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`
- **THEN** 审计里带原因文本、预估金额与策略键时，时间线条目序列化后不含这些值（前者）；额外查询限定组织与本页 id、没有阶段变更时不查（后者），退出码 0

### Requirement: 时间线显示来源

company.log 时间线的操作者列 SHALL 对来源为 `ai` 的审计显示"AI"、来源为 `system` 的审计显示"系统"，并提示"以 <负责人姓名> 名义记录"（没有姓名时提示"以成员名义记录"）；来源为 `human` 的条目照旧显示操作人姓名。

#### Scenario: 渲染
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/presentation.test.ts`
- **THEN** AI / 系统来源的审计显示"AI"/"系统"并带名义提示，人工条目显示姓名，退出码 0
