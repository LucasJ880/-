# revenue-spine/fde-draft-feedback Specification

## Purpose
把 FDE 询盘回复草稿（首封回复与跟进草稿）在审批中的结局，自动转成团队范围的人类反馈事件。草稿创建时留存脱敏快照，结局时与执行正文做结构化 diff，供偏好学习与方法挖掘使用；全过程不存买家个人信息、不影响审批本身。

## Requirements

### Requirement: 草稿结构化 diff
系统 SHALL 把询盘回复正文按空行切成段落，并按以下规则分成问候、事实段、追问段、签名四类：
- 问候：首段为称呼；
- 签名：结束语及其后各段；
- 追问段：含问句或问题列表的段；
- 事实段：其余各段。

比较两版正文时，系统 SHALL 输出：
- 是否改过；
- 改动涉及的段落类型；
- 改动字数占比（0–1）；
- 新增事实句中的数值与单位。

diff 结果 SHALL NOT 包含正文原文。

#### Scenario: 全文照发
- **WHEN** 两版正文逐字相同（首尾空白与 10k 截断后）
- **THEN** 判定未改过，改动段落类型为空，改动占比为 0

#### Scenario: 改签名
- **WHEN** 只改了结束语之后的落款行
- **THEN** 判定改过，改动段落类型只有"签名"

#### Scenario: 加一句 MOQ
- **WHEN** 在事实段新增一句 "MOQ is 500 pcs per color."
- **THEN** 改动段落类型只有"事实段"，捕获数值 500、单位 pcs

#### Scenario: 不含正文
- **WHEN** 运行 `npx tsx src/lib/revenue-spine/fde/__tests__/draft-diff.test.ts`
- **THEN** 序列化后的 diff 结果不包含两版正文中任何一个完整句子，退出码 0

### Requirement: 草稿创建时留存脱敏快照
询盘回复审批（首封回复与跟进草稿）新建成功时，系统 SHALL 写一条审计日志（动作 `revenue_spine.inquiry_reply.draft_snapshot`，目标为该审批）。内容包括：
- 主题；
- 正文：首尾去空白、截断 10,000 字符，与执行器发送前的处理一致；
- 护栏结果；
- 引用的工厂事实；
- 待内部确认项；
- 是否首封、第几次跟进。

快照里买家的联系人名、公司名、电话号码，以及收件人以外的邮箱地址 SHALL 替换为占位符。复用已有的未决草稿时 SHALL NOT 重复写快照。快照写入失败 SHALL NOT 影响审批创建与 FDE 流程。

#### Scenario: 买家信息替换
- **WHEN** 正文含买家联系人 "John Smith"、公司 "Acme Home Ltd"、电话 "+1 (416) 555-0199" 与另一个邮箱 "john.private@gmail.com"
- **THEN** 快照里这四项均被占位符替换，收件人邮箱保留

#### Scenario: 复用草稿不重复写
- **WHEN** 同一来信已有未决草稿被复用
- **THEN** 不写新的快照审计

### Requirement: 终态自动产生反馈事件
询盘回复审批到达以下终态时，系统 SHALL 产生一条反馈事件，事件属性如下：
- 员工键为 `inbound_sales_fde`，范围为团队候选；
- 引用包含审批 id、商机 id、终态类型；
- 携带结构化 diff，SHALL NOT 携带正文。

终态映射：
- 已执行，或批准后执行失败 → `approved_as_is`；正文与快照不同 → `approved_edited`；
- 人工驳回（不含关联任务取消导致的驳回）→ `rejected`；
- 过期 → `expired`；
- 因人工已回复而被系统作废（`SUPERSEDED_BY_MANUAL_REPLY`）→ `replaced_by_manual_reply`。diff 为草稿快照 vs 那次人工外发的正文，两边都替换买家信息；找不到外发正文时 diff 为空并注明。

其余终态 SHALL NOT 产生事件（见「不产生反馈事件的终态」）；事件的决策类型与归属用户见「反馈事件的决策类型与归属用户」。

#### Scenario: 照发批准
- **WHEN** 审批被批准并执行，正文与快照一致
- **THEN** 产生一条 `approved_as_is` 事件，`humanDecision = accepted`，用户为决策人

#### Scenario: 过期
- **WHEN** 审批过期（`failureReason = "已过期"`、无决策人），审批人为 u-approver
- **THEN** 产生一条 `expired` 事件，`humanDecision = deferred`，用户为 u-approver

#### Scenario: 人工已回复
- **WHEN** 审批因 u-sales 在外贸收件箱人工回复买家而被作废，人工回复比草稿多一句 "MOQ is 500 pcs per color."
- **THEN** 产生一条 `replaced_by_manual_reply` 事件，`humanDecision = edited`，用户为 u-sales，diff 的改动段落含"事实段"、捕获数值 500 pcs

#### Scenario: 系统作废不产事件
- **WHEN** 审批以 `SUPERSEDED_BY_NEWER_INBOUND` 作废
- **THEN** 不产生反馈事件

#### Scenario: 入驻测试询盘不产事件
- **WHEN** 草稿所属商机的客户带入驻测试标签，审批被批准
- **THEN** 不产生反馈事件

### Requirement: 驳回原因原样带入
驳回事件的原因文本 SHALL 取审批的驳回备注，原样带入，只把买家信息替换为占位符。没有备注时原因 SHALL 为空。系统 SHALL NOT 推断原因代码。系统记录的驳回事件在原因为空时 SHALL NOT 报错。

#### Scenario: 无备注驳回
- **WHEN** 审批被驳回且没有填写备注
- **THEN** 产生 `rejected` 事件，原因文本与原因代码均为空，不报错

#### Scenario: 有备注驳回
- **WHEN** 驳回备注为 "语气太硬，John 是老客户"，买家联系人为 John
- **THEN** 原因文本为替换 "John" 后的备注

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

### Requirement: 不存买家个人信息与正文
反馈事件 SHALL NOT 包含草稿正文、主题、买家邮箱、联系人名、公司名或电话。快照审计 SHALL 只保留收件人邮箱这一项买家个人信息。替换 SHALL NOT 误伤数量区间、金额、日期与小写常用词；收件人邮箱 SHALL 原样保留、不被名字替换拆坏。

#### Scenario: 不误伤
- **WHEN** 正文含 "MOQ 500-1000 pcs"、"USD 12000.50"、"2026-12-01"，联系人为 "Will An"、正文含 "We will ship an order"，收件人邮箱为 "john@acme.com" 且联系人为 "John"
- **THEN** 这些内容原样保留

#### Scenario: 事件不含个人信息
- **WHEN** 草稿正文含买家联系人名、公司名、电话，并为一条已执行审批产生事件
- **THEN** 序列化后的事件数据不包含这些值，也不包含收件人邮箱与正文句子

### Requirement: 手工反馈入口行为不变
`POST /api/agent-feedback` 的手工反馈 SHALL 保持原有校验与写入行为：驳回必须给原因；diff 由提交的修改结果计算。

#### Scenario: 手工驳回仍需原因
- **WHEN** 不带系统记录标记、以 `rejected` 且无原因调用反馈服务
- **THEN** 仍抛出"拒绝操作需要选择简短原因"

### Requirement: 不产生反馈事件的终态
以下终态 SHALL NOT 产生反馈事件：
- 人工取消；
- 人工已回复以外的系统作废：新来信、入驻测试、报价变化；
- 批量准备失败；
- 关联任务取消导致的驳回；
- 入驻测试询盘（与询盘 SLA 指标同一判定）的草稿，任何终态。

#### Scenario: 批量准备失败不产事件
- **WHEN** 审批以批量准备失败（`BATCH_PREPARE_FAILED`）结束
- **THEN** 不产生反馈事件

### Requirement: 反馈事件的决策类型与归属用户
事件的 `humanDecision` SHALL 按终态依次为：照发批准 accepted、改稿批准 edited、驳回 rejected、过期 deferred、人工已回复 edited。

事件的 userId SHALL 依次取以下第一个存在的：
- 决策人；
- 人工回复作废时，发出人工回复的人；
- 过期等没有决策人时，取审批人；
- 仍没有则取创建人。

#### Scenario: 过期事件归审批人
- **WHEN** 审批过期，没有决策人，审批人为 u-approver
- **THEN** 产生一条 `expired` 事件，`humanDecision = deferred`，用户为 u-approver
