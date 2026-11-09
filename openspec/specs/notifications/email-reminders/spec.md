# notifications/email-reminders Specification

## Purpose
站内通知的邮件补位：@提及与任务指派长时间未读时发一封升级邮件，每天按组织当地 7 点发一封未读汇总。邮件只发给本组织在职成员本人的青砚账号邮箱，格式固定、内容脱敏，挂在既有定时任务上运行。

## Requirements

### Requirement: 升级邮件的发送条件
系统 SHALL 每 15 分钟检查一次（随既有 `sales-actions` 定时任务）。同时满足以下条件的通知，给收件人发一封升级邮件：
- 类型为 `mention`、`task_assigned` 或 `rfq_chase_ready`；
- 创建时间在最近 24 小时内，且已满 15 分钟；
- 状态仍为未读。

已读、已完成、稍后提醒中的通知 SHALL NOT 发。同一条通知 SHALL 最多发一封升级邮件。`rfq_quote_received`、`rfq_reply_received`、`rfq_no_response` SHALL NOT 发升级邮件。

#### Scenario: 15 分钟未读
- **WHEN** B 被指派任务 16 分钟后仍未读，定时任务触发
- **THEN** B 收到一封升级邮件；下一轮不再为这条通知发邮件

#### Scenario: 先读了
- **WHEN** B 在定时任务触发前已在青砚读了这条通知
- **THEN** 不发邮件

#### Scenario: 超过 24 小时
- **WHEN** 一条 `mention` 创建于 25 小时前，仍未读，且从未发过邮件
- **THEN** 不发升级邮件

#### Scenario: 其他类型
- **WHEN** 一条 `task_status` 通知 20 分钟未读
- **THEN** 不发升级邮件

#### Scenario: 催单待批 15 分钟未读
- **WHEN** 项目负责人的"催单待批"通知创建 16 分钟后仍未读，定时任务触发
- **THEN** 他收到一封升级邮件，链接指向该询价轮次；下一轮不再为这条通知发邮件

#### Scenario: 报价通知不升级
- **WHEN** 一条 `rfq_quote_received` 通知 20 分钟未读
- **THEN** 不发升级邮件

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-email-escalation.test.ts`
- **THEN** 时间窗、已读、已发、免打扰、偏好、地址、重试与正文格式的断言全部通过（含 `rfq_chase_ready` 进候选、`rfq_quote_received` 不进候选），退出码 0

### Requirement: 升级邮件的跳过规则
以下情况 SHALL NOT 发升级邮件，并在该通知上记下跳过原因；之后 SHALL NOT 再为这条通知发升级邮件：
- 收件人邮件偏好的生效值为关闭；
- 当前时刻在收件人的免打扰时段内（不论通知优先级）；
- 收件人账号停用，或不是通知所属组织的 active 成员（通知没有所属组织时，不是任何在用组织的 active 成员）；
- 收件人账号邮箱不可投递。

#### Scenario: 免打扰时段内到期
- **WHEN** 收件人免打扰为 22:00–08:00，通知在 23:00 满 15 分钟未读
- **THEN** 这轮不发，通知记下跳过原因为免打扰；08:30 那一轮也不发；次日 7 点的汇总里列出这条通知

#### Scenario: 关了邮件偏好
- **WHEN** 收件人关了"未读提醒与每日汇总邮件"
- **THEN** 不发升级邮件，只有站内通知

### Requirement: 升级邮件发送失败
发送失败时，系统 SHALL 在该通知上记下错误信息与累计尝试次数，本轮 SHALL NOT 重试。之后的轮次在 24 小时窗口内 SHALL 再试；累计失败 3 次后，SHALL NOT 再试。

#### Scenario: 发送失败后重试
- **WHEN** 第一轮发送失败
- **THEN** 本轮不重试；下一轮再试一次

#### Scenario: 失败三次
- **WHEN** 同一条通知已累计失败 3 次
- **THEN** 之后的轮次不再尝试

### Requirement: 升级邮件在通知上的记录
升级邮件的处理结果 SHALL 记在该通知的 `metadata` 里：
- 开始发送前记 `emailSendingAt`（ISO 时间），并把 `emailAttempts` 加一；
- 发出后记 `emailedAt`（ISO 时间）；
- 跳过记 `emailSkipped`（原因）；
- 失败记 `emailError`。

`emailSendingAt` 在 10 分钟内、且还没有 `emailedAt` 与 `emailError` 的通知，SHALL NOT 被另一轮处理。

这些记录 SHALL 与通知原有的 `metadata` 内容合并，SHALL NOT 改变通知的已读状态。同一条通知同时被两轮处理时，SHALL 只有一轮发出邮件。

#### Scenario: 发出后的通知
- **WHEN** 一条带原有 `metadata` 的通知发出升级邮件
- **THEN** 它的 `metadata` 保留原有内容并多出 `emailedAt`，状态仍为未读

### Requirement: 升级邮件的主题与正文
升级邮件的主题 SHALL 为 `【青砚】{类型名} · {对象}`：
- 类型名为 `@提及`、`任务指派` 或 `催单待批`；
- 对象如 `任务「复尺安排」`、`项目「Smith 住宅」讨论区`、`项目「Alberta 露营装备」第 2 轮询价`，超过 40 个字符截断。

正文 SHALL 依次为：
1. 通知标题；
2. 通知摘要（没有则省略）；
3. 一行事项（格式见「邮件事项行的格式」）；
4. `在青砚打开：{链接}`；
5. 页脚：`这封邮件由青砚自动发出，只发到你的青砚账号邮箱。不想再收：青砚 → 设置 → 通知，关闭「未读提醒与每日汇总邮件」。`

邮件 SHALL 同时有纯文本与简单 HTML 两个版本，内容相同。

#### Scenario: 任务指派的升级邮件
- **WHEN** B 的"A 把任务「复尺安排」指派给你"通知触发升级邮件，任务截止 2026-11-05
- **THEN** 主题为"【青砚】任务指派 · 任务「复尺安排」"，正文含一行"任务指派｜任务「复尺安排」｜截止 2026-11-05｜{链接}"

#### Scenario: 催单待批的升级邮件
- **WHEN** 项目 P「Alberta 露营装备」第 2 轮（id R）的"催单待批"通知触发升级邮件
- **THEN** 主题为"【青砚】催单待批 · 项目「Alberta 露营装备」第 2 轮询价"，正文的打开链接为站点根地址加 `/projects/P?tab=bid#rfq-round-R`，正文不出现任何金额

### Requirement: 邮件事项行的格式
邮件正文里每条事项 SHALL 单独占一行，格式为 `{类型名}｜{对象}｜截止 {YYYY-MM-DD}｜{链接}`：
- 没有截止时间时，省略第三段；
- 对象等文字中原有的 `｜`，SHALL 替换为 `/`；
- 截止日期按通知所属组织的时区取日期；没有组织或组织未设时区时，按 America/Toronto；
- 链接为站点根地址加 `notifications/click-targets` 给出的地址，是绝对地址。

#### Scenario: 没有截止时间
- **WHEN** 一条讨论区 @提及进入邮件
- **THEN** 事项行为"@提及｜项目「Smith 住宅」讨论区｜{链接}"

#### Scenario: 对象里有竖线
- **WHEN** 任务标题为"复尺｜二次"
- **THEN** 事项行中的对象为"任务「复尺/二次」"

### Requirement: 每日汇总的发送时刻与收件人
系统 SHALL 在既有 `daily-brief` 定时任务里，为本地时间处于 7 点的在用组织发每日未读汇总邮件：
- 组织时区取组织设置，未设置时按 America/Toronto；
- 收件人是该组织中账号在职的 active 成员，每人一封。

汇总列出收件人名下全部计入汇总的未读通知，不论通知属于哪个组织。没有计入汇总的未读通知时，SHALL NOT 发。汇总 SHALL NOT 受免打扰时段影响。

#### Scenario: 次日 7 点
- **WHEN** 组织当地时间 7 点，成员 A 有 3 条未读、成员 B 没有未读
- **THEN** A 收到一封汇总，只列出这 3 条未读；B 不收

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-email-digest.test.ts`（用注入的时间模拟组织当地 7 点）
- **THEN** 分组、排序、上限、"无未读不发"、每人每天一封与正文格式的断言全部通过，退出码 0

### Requirement: 每日汇总的内容
汇总邮件的主题 SHALL 为 `【青砚】今日未读 {N} 条`，N 为计入汇总的未读通知总数。正文 SHALL 按类型分组，每组以 `【{类型名}】` 开头：
- 组的顺序：@提及、任务指派、任务截止与逾期、任务新评论、任务状态变化、工艺单阶段变化排在前面，其他类型按类型名排在后面；
- 组内按创建时间从新到旧，每条一行（格式见「邮件事项行的格式」）；
- 最多列 50 条；超出时，末尾加一行 `另有 {M} 条未读，请在青砚查看：{通知页链接}`。

类型 `daily_briefing` 与 `sales_daily_briefing` SHALL NOT 计入汇总。

#### Scenario: 超过 50 条
- **WHEN** 收件人有 93 条计入汇总的未读
- **THEN** 主题为"【青砚】今日未读 93 条"，正文列 50 条，末尾一行"另有 43 条未读，请在青砚查看：…"

#### Scenario: 只有每日简报未读
- **WHEN** 收件人唯一的未读通知是当天的 `daily_briefing`
- **THEN** 不发汇总

### Requirement: 每日汇总每人每天一封
同一收件人同一本地日期（按触发组织的时区）SHALL 最多收到一封汇总，即使他属于多个组织。发送每封汇总之前，系统 SHALL 先写一条审计记录：
- 动作 `notifications.email_digest`，对象为收件人；
- 内容含本地日期、条数、是否只记日志；
- 不带组织 id，不进驾驶舱公司日志。

写入前 SHALL 按收件人与本地日期串行化，并检查当天是否已有记录；已有则不再发送。发送失败时，当天 SHALL NOT 补发。

#### Scenario: 属于两个同时区组织
- **WHEN** A 同时是两个多伦多组织的 active 成员，7 点那一轮两个组织都到点
- **THEN** A 只收到一封汇总

#### Scenario: 汇总发送失败
- **WHEN** 给 A 的汇总在发送时失败
- **THEN** 本次 `notify-email-digest` 运行的失败数加一；当天不再给 A 发汇总

### Requirement: 邮件的收件地址
两种邮件的收件地址 SHALL 只取收件人青砚账号的邮箱，SHALL NOT 从任何请求或通知内容里取地址。账号邮箱属于以下任一情况时，SHALL NOT 发送：
- 域名为 `wechat.user` 或 `qingyan.internal`；
- 域名以 `.local`、`.internal`、`.invalid`、`.test`、`.example`、`.localhost` 结尾；
- 不是邮箱格式。

#### Scenario: 微信注册的账号
- **WHEN** 收件人账号邮箱是 `wx_abc@wechat.user`
- **THEN** 不发邮件，记跳过原因为地址不可投递

### Requirement: 发件地址与非生产只记日志
邮件 SHALL 以平台发件地址发出，显示名为"青砚"；SHALL NOT 使用任何个人邮箱、组织发件设置或 Gmail 授权。

非生产环境未开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD` 时，SHALL NOT 真发邮件：
- 只记一条日志，含收件人 id 与主题，不含邮箱地址与正文；
- 按已发送处理：升级邮件记 `emailedAt` 与 `emailDryRun: true`，汇总照常写审计记录。

#### Scenario: staging 未开真发
- **WHEN** staging 没有开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`，一条通知满足升级条件
- **THEN** 不调用发信服务，日志里有一条只记日志的记录，通知记 `emailDryRun: true`

### Requirement: 缺少发信配置时不发
在真发环境（生产，或已开真发的非生产）缺 `RESEND_API_KEY` 或 `NEXT_PUBLIC_APP_URL` 时，两种邮件 SHALL NOT 发送，SHALL NOT 改动任何通知；本次运行记为跳过，并写明缺少哪项配置。

#### Scenario: 生产缺站点地址
- **WHEN** 生产没有设置 `NEXT_PUBLIC_APP_URL`
- **THEN** 升级邮件这一轮记为跳过、写明缺 `NEXT_PUBLIC_APP_URL`；没有邮件发出，通知不变

### Requirement: 邮件的运行记录、上限与隔离
运行记录：
- 升级邮件每次随定时任务触发，SHALL 记一次自动化运行 `notify-email-escalation`；没有可发的也记，状态为跳过；
- 每日汇总在有组织到 7 点时，SHALL 记一次 `notify-email-digest`；
- 运行记录 SHALL 含处理数、成功数、失败数与按原因的跳过数。

同一定时任务里排在前面的既有步骤出错、请求提前结束时，本步骤这一轮不跑，也不记运行；下一轮照常（既有步骤的收错方式不在本 change 范围内）。

上限：单轮最多 100 封升级邮件、300 封汇总；超出上限或时间预算用完时，SHALL 停止并在运行记录里标出。

升级邮件每轮从时间窗内按创建时间从新到旧最多取 500 条候选（发过邮件、仍未读的通知也算在内），处理时再从旧到新；取满 500 条时 SHALL 在运行记录里标出候选被截断。

隔离：单封邮件出错 SHALL NOT 影响同一轮的其他邮件；本步骤出错 SHALL NOT 影响同一定时任务的其他步骤与它的响应。

#### Scenario: 汇总步骤整体出错
- **WHEN** 汇总这一步查询失败
- **THEN** `notify-email-digest` 记为失败；`daily-brief` 的其他步骤结果照常返回

#### Scenario: 没有可发的
- **WHEN** 一轮 `sales-actions` 触发时没有满足条件的通知
- **THEN** 记一次 `notify-email-escalation` 运行，状态为跳过

#### Scenario: 前面的既有步骤出错
- **WHEN** `sales-actions` 里排在前面的既有步骤出错，请求提前结束
- **THEN** 这一轮没有 `notify-email-escalation` 运行记录；下一轮照常检查并发送

#### Scenario: 窗口里积压了很多发过邮件仍未读的通知
- **WHEN** 24 小时窗口里已有 600 条发过邮件、一直没读的通知，又有一条新的指派满 15 分钟未读
- **THEN** 这条新的照样在这一轮发出；运行记录标出候选被截断

### Requirement: 邮件不输出敏感内容
两种邮件的主题与正文 SHALL NOT 包含：
- 金额；
- 电话号码；
- 地址；
- 毛利率、项目估值、我方最终报价等内部财务信息。

判定规则与替换方式同 `notifications/activity-events`「敏感内容的判定」：命中时，整段换成 `（含敏感信息，请在青砚查看）`。汇总里来自其他功能的未读通知，其标题同样适用。

#### Scenario: 汇总里的报价签署通知
- **WHEN** 收件人有一条标题含"$12,000"的未读通知
- **THEN** 汇总里这一行的对象为"（含敏感信息，请在青砚查看）"，邮件中不出现"$12,000"
