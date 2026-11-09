# Spec Delta

## MODIFIED Requirements

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
