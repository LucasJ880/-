# Spec Delta

## MODIFIED Requirements

### Requirement: 终态自动产生反馈事件
询盘回复审批到达以下终态时，系统 SHALL 产生一条反馈事件：
- 员工键为 `inbound_sales_fde`，范围为团队候选；
- 引用包含审批 id、商机 id、终态类型；
- 携带结构化 diff，SHALL NOT 携带正文。

终态映射：
- 已执行，或批准后执行失败 → `approved_as_is`；正文与快照不同 → `approved_edited`；
- 人工驳回（不含关联任务取消导致的驳回）→ `rejected`；
- 过期 → `expired`；
- 因人工已回复而被系统作废（`SUPERSEDED_BY_MANUAL_REPLY`）→ `replaced_by_manual_reply`。

以下情况 SHALL NOT 产生事件：人工取消；其它系统作废（新来信、入驻测试、报价变化）；批量准备失败；关联任务取消导致的驳回；入驻测试询盘（判定同询盘 SLA 指标）草稿的任何终态。

事件的 `humanDecision` SHALL 依次为 accepted / edited / rejected / deferred / edited。

#### Scenario: 照发批准
- **WHEN** 审批被批准并执行，正文与快照一致
- **THEN** 产生一条 `approved_as_is` 事件，`humanDecision = accepted`，用户为决策人

#### Scenario: 过期
- **WHEN** 审批过期（`failureReason = "已过期"`、无决策人），审批人为 u-approver
- **THEN** 产生一条 `expired` 事件，`humanDecision = deferred`，用户为 u-approver

#### Scenario: 系统作废不产事件
- **WHEN** 审批以 `SUPERSEDED_BY_NEWER_INBOUND` 作废
- **THEN** 不产生反馈事件

#### Scenario: 入驻测试询盘不产事件
- **WHEN** 草稿所属商机的客户带入驻测试标签，审批被批准
- **THEN** 不产生反馈事件

### Requirement: 同一审批同一终态只产一条事件
系统 SHALL 以"审批 id + 终态类型"为幂等键：已存在相同键的事件时 SHALL NOT 再写。"先查后写" SHALL 在按审批串行化的锁内完成，多路同时到达也只写一条。

写入时机：
- 批准：只在本次调用确实改变了审批状态时写入（无权、环境隔离、跨组织等未改状态的错误不写）；
- 驳回：只在驳回生效时写入；
- 过期：由过期扫描中成功改变状态的那一批写入；
- 人工已回复：由外贸外发同步中成功作废的那一批写入；
- 补漏：只处理终态超过 10 分钟仍无事件的审批。

记录失败 SHALL NOT 改变审批结果、外发同步结果或接口响应。

#### Scenario: 重复调用
- **WHEN** 对同一已执行审批连续调用两次记录
- **THEN** 只有一条事件

#### Scenario: 并发到达
- **WHEN** 端口钩子与补漏扫描同时为同一审批记录
- **THEN** 只有一条事件

#### Scenario: 重复批准请求
- **WHEN** 对已执行的审批再次发起批准
- **THEN** 走既有幂等分支，不调用记录器

#### Scenario: 记录失败不影响审批
- **WHEN** 记录器抛出异常
- **THEN** 批准接口的返回值与不记录时相同

### Requirement: 接入点覆盖全部审批入口并有补漏
记录器的调用点：
- 审批端口的批准与驳回 SHALL 在非重复分支调用记录器，覆盖审批中心、Muse、微信确认与助手收件箱；
- 过期扫描 SHALL 对本轮成功过期的询盘回复审批调用记录器；
- 外贸外发同步 SHALL 对本次成功作废的询盘回复审批调用记录器（尽力而为，不影响外发同步结果）。

既有 `approval-timeout` 定时任务 SHALL 追加补漏扫描，范围是近 7 天内终态已超过 10 分钟、仍无事件、可能产事件的询盘回复审批，包括因人工已回复而作废的。扫描 SHALL 从最早的开始翻页，不会产事件的终态 SHALL 在查询中排除，每轮处理条数有上限。系统 SHALL NOT 新增定时任务或队列。

#### Scenario: 接入点
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/fde/__tests__/draft-feedback.test.ts`
- **THEN** 源码静态断言以下各点，且 `vercel.json` 未改动：
  - 审批端口批准 / 驳回的非重复分支与过期赢家处调用记录器，且包在异常保护里；
  - 外贸外发同步在作废之后调用记录器；
  - `approval-timeout` 路由调用补漏扫描；
  - 补漏条件包含人工已回复的作废。

## ADDED Requirements

### Requirement: 人工回复作废事件的 diff 与事件归属用户
因人工已回复而作废产生的事件，diff SHALL 为草稿快照 vs 那次人工外发的正文，两边都替换买家信息；找不到外发正文时 diff 为空并注明。

事件的 userId SHALL 依次取以下第一个存在的：
- 决策人；
- 人工回复作废时，发出人工回复的人；
- 过期等没有决策人时，取审批人；
- 仍没有则取创建人。

#### Scenario: 人工已回复
- **WHEN** 审批因 u-sales 在外贸收件箱人工回复买家而被作废，人工回复比草稿多一句 "MOQ is 500 pcs per color."
- **THEN** 产生一条 `replaced_by_manual_reply` 事件，`humanDecision = edited`，用户为 u-sales，diff 的改动段落含"事实段"、捕获数值 500 pcs
