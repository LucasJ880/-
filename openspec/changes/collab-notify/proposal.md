# Proposal：协作通知（@ 必通知、任务与订单动态、邮件补位）

TASKFLOW：COLLAB-2（Phase C 协作通知；任务书 `docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` §5、§7 change B、§9 D1–D6）

## Why

员工在青砚里 @ 同事、指派任务、推进工艺单时，相关的人收不到任何通知：讨论区的 @ 只存不发，任务的指派 / 状态 / 评论与工艺单从确认到排期都不通知，设置页的"邮件"开关也从没接上发信。CEO 2026-11-04 定下以青砚为核心：A 在青砚做了动作，相关的 B 能看到；B 在青砚里 @A，青砚通知 A（任务书 §1）。

## What Changes

- 校验讨论区消息与任务评论里的 @：被 @ 的人必须是在职账号、对象所属组织的 active 成员，并且能看到这条讨论或这个任务；任一人不满足，整条请求返回 400（`MENTION_NOT_ALLOWED`），不建消息、不发通知；一次最多 @ 20 人。
- 发送 `mention` 通知：每个被 @ 的人一条（高优先级，摘要取正文前 80 字并脱敏，@ 自己不发）。同一人 10 分钟内重发内容相同的带 @ 讨论消息或任务评论时，返回第一次创建的那条，不再新建、不再通知。
- 扩展任务评论框支持 @：复用讨论区的 `MentionDropdown`，候选人由新接口 `GET /api/tasks/{id}/mention-candidates` 给出；@ 名单写进 `TaskActivity(action="comment.mentioned")`。发评论时校验评论人能看到该任务，看不到返回 404。
- 发动态通知：
  - 任务指派与改派（`task_assigned`）
  - 任务状态变化（`task_status`，含批量改状态）
  - 任务新评论（`task_comment`）
  - 工艺单进入已确认 / 开始生产 / 备货完成 / 已排期（`order_stage`，`/transition` 与编辑接口两条路径都发）
  - 项目文件上传（`project_update`）

  动态通知的共同规则：
  - 操作人自己不收；
  - 收件人必须是在职账号，并且是对象所属组织的 active 成员；
  - 全部经过站内投递门禁；
  - 通知写失败只记日志，不影响业务操作。
- 脱敏通知标题、摘要和邮件正文：一段文字只要含金额、电话、地址，或毛利率、项目估值、我方最终报价，就整段换成"（含敏感信息，请在青砚查看）"。
- 修正通知类型偏好：新增类型对已保存过类型清单的老用户默认开启，设置页如实显示为开启；老用户保存设置页或改自动化偏好之后，新类型仍然开启；新类型发版前的旧清单仍按清单的保存时间判定。
- 统一通知的跳转地址：顶栏铃铛、通知页和邮件链接共用同一张对照表。
  - 新增两个目标：讨论区跳 `/projects/{id}?tab=workbench#project-discussion`，项目文件跳 `/projects/{id}?tab=files`。
  - 未登录时打开链接，登录后回到原页面；`next` 参数只接受站内路径。
- 发未读升级邮件：`mention` 与 `task_assigned` 通知创建满 15 分钟仍未读时发一封，只扫最近 24 小时创建的通知。
  - 挂在 `sales-actions` 定时任务上，记为自动化 `notify-email-escalation`。
  - 在免打扰时段内到期的通知不发，留给次日汇总。
- 发每日未读汇总邮件：组织当地 7 点，给有未读通知的 active 成员各发一封；按类型分组、每条一行、最多列 50 条；每日简报两类不计入。
  - 挂在 `daily-brief` 定时任务上，记为自动化 `notify-email-digest`。
  - 每人每天最多一封。
- 改邮件偏好的读法：用户在设置页明确选过就按选择，没选过就视为开启。设置页开关改名为"未读提醒与每日汇总邮件"。
- 固定邮件格式：
  - 主题以 `【青砚】` 开头；
  - 正文每条事项一行：`类型｜对象｜截止 YYYY-MM-DD｜链接`（没有截止时间就不写这一段）；
  - 发件地址用 `platformFromAddress()`，收件人只取账号邮箱，跳过占位邮箱；
  - 非生产环境没开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD` 时，只记日志、不真发。
- 补上 `openspec/config.yaml` 硬纪律第 2 条末尾的澄清：任务书 §5.4 那句原文，一字不改。
- 登记两个新自动化键到三处：自动化注册表、调度表、岗位注册表（归"运维与知识"岗位）。

## Capabilities

### New Capabilities

- `notifications/mentions`：讨论区与任务评论的 @，包括被 @ 人的校验与 400 拒绝、`mention` 通知、10 分钟内重发去重，以及任务评论框的候选人接口。
- `notifications/activity-events`：任务指派 / 状态 / 评论、工艺单阶段、项目文件上传各自通知谁、通知写什么，以及所有协作通知共用的规则：
  - 收件人过滤、操作人排除、按事件去重；
  - 投递门禁；
  - 失败隔离；
  - 摘要脱敏。
- `notifications/email-reminders`：两种邮件。
  - 未读升级邮件：什么时候发、怎么跳过、怎么防重。
  - 每日未读汇总：发送时刻、内容、每人每天一封。

  两者共用的规则：收件地址、主题与正文格式、脱敏、非生产只记日志、自动化运行记录。
- `notifications/preferences`：
  - 邮件偏好的生效值与设置页文案；
  - 新增通知类型对老用户默认开启，设置页显示与实际投递一致。
- `notifications/click-targets`：
  - 通知类型到页面地址的对照表，顶栏铃铛、通知页和邮件三处共用；
  - 讨论区锚点；
  - 未登录访问时登录后回到原页面。

### Modified Capabilities

- `cockpit/post-registry`：「每个自动化恰好归属一个岗位」的计数从 31 改为 33，补上两个新键归属"运维与知识"岗位的场景。
- `cockpit/posts-overview`：「自动化调度表与线上调度一致」的计数从 31 改为 33，补上汇总邮件按组织本地 7 点门控、升级邮件每 15 分钟一次的场景。

## Impact

- 接口：
  - `POST /api/projects/{id}/discussion/messages`：新增 400 `MENTION_INVALID` / `MENTION_NOT_ALLOWED`；重发返回 200。
  - `POST /api/tasks/{id}/comments`：新增 404（看不到任务）、400 `MENTION_INVALID` / `MENTION_NOT_ALLOWED`；重发返回 200。
  - 新增 `GET /api/tasks/{id}/mention-candidates`。
  - 未登录访问页面时，跳转登录页会带上 `?next=`。
- 代码：
  - 新增 `src/lib/notifications/collab/`：脱敏、收件人、投递、事件文案、@ 校验与输入、两种邮件；
  - 新增 `src/lib/notifications/href.ts`（跳转地址）、`src/lib/auth/safe-next.ts`（`next` 校验）、`src/lib/tasks/access.ts`（任务查看规则，从任务详情路由移出）；
  - 改 `src/lib/notifications/{constants,delivery-gate,preferences}.ts`、`src/lib/proactive/automation-prefs.ts`；
  - 改讨论区、任务、工艺单、项目文件的 API 路由；
  - 改 `src/app/api/cron/{sales-actions,daily-brief}/route.ts`；
  - 改 `src/lib/automation/registry.ts`、`src/lib/cockpit/{schedule,posts}.ts`；
  - 改 `src/middleware.ts`、登录页与选择组织页；
  - 改 `src/components/{header,tasks/task-drawer}.tsx`、`src/components/project-discussion/*`、通知页与通知设置页。
- 配置：`openspec/config.yaml` 第 2 条补一句。
- 运维前置（本 change 不改任何 Vercel 设置）：
  - 生产须设 `NEXT_PUBLIC_APP_URL=https://qingyan.ca`，并已有 `RESEND_API_KEY`；
  - 缺任一项时，两个邮件自动化只记"未配置"的跳过，不发信；
  - staging 要真发邮件，须临时开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`。
- 测试：新增纯逻辑与源码断言测试，全部注册进 `scripts/test-all.sh`；既有调度测试的组织时区门控清单补上 `notify-email-digest`；`daily-brief` 路由的既有源码断言保持通过。
- 不加 model、字段、迁移、cron 条目或队列；不调 LLM；不碰 muse-bridge。

## Out of scope

- 每条通知都发邮件；微信 / 企微推送；短信；任何机器人、个人助理插件与 Muse 对接（任务书 §5.5、D6）。
- 订单评论区、关注 / 订阅、通知页与铃铛的界面改版（任务书 §6、D2）。
- 排期时通知安装工：安装工看不到工艺单页面，安装任务另有 `/install` 入口与日历显示。
- 这些写入路径不发通知：
  - 其他任务写入路径（审批执行器、项目交接、招标阶段任务、投标流程、muse-bridge 询盘、招标自动分析、项目接口、`/api/v1/projects`）；
  - 其他工艺单状态写入路径（安装完工、返修、取消审批）；
  - 已安装 / 已完成 / 已取消三个阶段。
- 这些上传路径不发通知：报价导入、生成 PDF、费用票据、知识库文档、AI 清单、`/api/v1/projects` 的外链文档。
- 本 change 不修的既有访问控制缺口：
  - 任务评论 GET 与活动 GET 不查任务访问权；
  - 批量改任务不查访问权；
  - 删除项目文件不查项目访问权。
- `notifyProjectMembers` 的两个既有调用方（AI 标书包、招标阶段推进）的行为。
- 免打扰时段的时区（仍固定按 America/Toronto）。
- 扫描类通知的偏好过滤路径。
- 未进注册表的类型（如 `approval`、`process_order_generated`）的门禁结果。
- 修复微信绑定；`muse-bridge/v1` 与 S1–S3 销售意图。
