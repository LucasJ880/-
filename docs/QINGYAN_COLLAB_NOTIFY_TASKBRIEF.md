# 青砚协作通知 — 实施 PRD / 任务书（v1.0 定稿）

| 项       | 值                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本     | v1.0 定稿（2026-11-04）。CEO 同意方向；CTO 定稿 §9 全部决定                                                                                                       |
| 实施仓库 | **青砚** `LucasJ880/-`，基于 origin/main（本文核对时为 `deccf844`，2026-10-30）。本仓库（Muse--Bridge-bot）不参与实施                                             |
| 实施流程 | 青砚自己的 `CLAUDE.md` + `openspec/config.yaml` 八条纪律 + OpenSpec 流程；本文是 `/opsx:propose` 的输入，在青砚里另存为 `docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` |
| 取代     | Muse--Bridge-bot `docs/prd/sales-pilot-prd.md` 的接入层（个人 Token + 远程 MCP + VPS Connector）。Muse Connector 永久冻结，不再做任何个人助理插件                 |

---

## 1. Why

CEO 原话（2026-11-04）：

> 本身想做就是以青砚为核心，之前说拉群，是因为觉得青砚做不了底座，才这么搞的。等于 A 在青砚上上传或者做动作，B 能看到，同时在青砚上 @A，青砚再通知 A。

需求就三条：**A 在青砚做了动作，相关的 B 能看到；B 在青砚里 @A；青砚通知 A。**

另外 CEO 确认：青砚的微信绑定和微信扫码登录**目前不可用**（"只是做了一个名称"），对用户可见却点不通。

## 2. What（两个 change）

| change              | 内容                                                                                               | PR              |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| `hide-wechat-entry` | 用开关隐藏不可用的微信入口（登录按钮、设置入口、绑定页、开通页提示），代码保留                     | 独立小 PR，先做 |
| `collab-notify`     | ① @ 必通知；② 任务与订单动态通知相关人；③ 邮件补位（未读升级 + 每日未读汇总）；④ 纪律第 2 条补澄清 | 一个 PR         |

不需要新机器人、AI、插件、微信推送；不调 LLM；不改数据库表；不新建定时任务。每个员工不用做任何配置。

---

## 3. 现状与代码位置（origin/main `deccf844` 已核对）

| 能力           | 现状                                                                                                                                                            | 位置                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 站内通知       | `Notification`：type、entityType / entityId、未读 / 已读 / 完成、`sourceKey` 唯一（幂等）、`metadata`；`/notifications` 页                                      | `prisma/schema.prisma`、`src/lib/notifications/create.ts`（`createNotification`、`createNotificationsForUsers`、`notifyProjectMembers`）                                                             |
| 顶栏铃铛       | 未读数每 60 秒刷新；下拉看最近通知                                                                                                                              | `src/components/header.tsx`、`src/app/api/notifications/unread-count/route.ts`                                                                                                                       |
| 通知类型注册表 | `task_due`、`followup`、`project_update`、`quote_signed`、`install_*` 等                                                                                        | `src/lib/notifications/constants.ts`                                                                                                                                                                 |
| 投递门禁       | 类型开关、只看高优先级、免打扰；直发路径走 `shouldDeliverInApp`；新类型的 grandfather 规则用 `TYPE_INTRODUCED_AT`                                               | `src/lib/notifications/delivery-gate.ts`、`filter.ts`、`preferences.ts`                                                                                                                              |
| 邮件偏好       | `UserNotificationPreference.emailEnabled`（默认 false）存在，但没有任何代码按它发邮件                                                                           | 同上                                                                                                                                                                                                 |
| 平台发件       | Resend；`RESEND_FROM_EMAIL`（未设时 `noreply@qingyan.ai`）；生产已配置 `RESEND_API_KEY`、`RESEND_FROM_EMAIL`；非生产受 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD` 限制 | `src/lib/trade/email.ts`（`sendEmail`）、`src/lib/trade/email-sender.ts`（`platformFromAddress`）                                                                                                    |
| 项目讨论区 @   | 前端有 @ 下拉框；接口收 `mentions` 只做类型检查后存进消息 metadata；**不通知、不校验成员**                                                                      | `src/components/project-discussion/*`、`src/app/api/projects/[id]/discussion/messages/route.ts`、`src/lib/project-discussion/{service,access}.ts`                                                    |
| 任务评论       | `TaskComment`（只有 content）、`TaskActivity`；不支持 @；指派 / 状态 / 评论不通知                                                                               | `src/lib/tasks/*`、`src/app/api/tasks/**`                                                                                                                                                            |
| 订单           | `BlindsOrder` 状态机 + `OrderStatusLog`；安装 / 尾款 / 维修已有通知；确认 → 生产 → 备货 → 排期不通知                                                            | `src/app/api/blinds-orders/[id]/transition/route.ts`、`src/lib/install/*`、`openspec/specs/fulfillment/order-category-access/spec.md`                                                                |
| 定时任务       | `sales-actions` 每 15 分钟；`daily-brief` 每小时整点，按组织当地时间筛 7 点（`orgsAtLocalHour`），用 `runTrackedAutomation` 记录                                | `vercel.json`、`src/app/api/cron/{sales-actions,daily-brief}/route.ts`、`src/lib/automation/{registry,runner}.ts`                                                                                    |
| 微信入口       | 登录页"微信扫码登录"；设置页"微信"入口；`/settings/wechat`、`/wechat` 页；组织开通页"到设置 → 微信扫码绑定"提示                                                 | `src/app/(auth)/login/page.tsx`、`src/app/(main)/settings/page.tsx`、`src/app/(main)/settings/wechat/page.tsx`、`src/app/(main)/wechat/page.tsx`、`src/app/(main)/admin/onboarding/[orgId]/page.tsx` |

实施前先在新 worktree 里重新核对以上位置（main 可能已前进）。

---

## 4. change A：`hide-wechat-entry`

- 新增服务端开关 `WECHAT_BINDING_ENABLED`，**默认关**（未设置 = 关）。
- 关闭时：
  - 登录页不显示"微信扫码登录"按钮和它上面的"或"分隔线；
  - 设置页不显示"微信"入口；
  - 直接访问 `/settings/wechat`、`/wechat` 显示"暂未开放"，不渲染绑定 / 扫码组件；
  - 组织开通页去掉"到设置 → 微信扫码绑定"的提示和绑定表。
- 微信相关 API、回调、`wechat-push` 定时任务**不动**；开关打开即恢复原样。
- 不改名：改名后按钮仍然点不通。
- **验收**：开关关闭时，以上四处都看不到；开关打开时与现在一致；单元测试覆盖开关解析（未设置 / `false` / `true`）。

---

## 5. change B：`collab-notify`

### 5.1 @ 提及

- **入口**：讨论区沿用现有 @ 下拉框；任务评论框复用同一组件（`MentionDropdown`）。接口收 `mentions: [{ userId }]`，名字只用于显示。
- **服务端校验**（讨论区与任务评论都做）：被 @ 的人必须是本组织 active 成员，且能看到这条对象（讨论区 = 能访问该项目讨论区，复用 `project-discussion/access.ts`；任务 = 有该任务的查看权限，复用任务现有的权限判断）。**任一不满足，整条请求 400 拒绝**，不静默丢弃。
- **通知**：每个被 @ 的人一条 `Notification`：`type="mention"`、`entityType="project_discussion"`（entityId = 消息 id，projectId 填项目）或 `"task"`（entityId = 任务 id）、`priority="high"`、`summary` = 正文前 80 字（过脱敏）、`sourceKey = mention:<消息或评论 id>:<userId>`。不通知自己。
- **任务评论的 @ 落点**：不加字段。@ 列表写进 `TaskActivity(action="comment.mentioned", detail={ commentId, userIds })`。
- 通知必须能点回对象：讨论区跳到项目讨论区，任务跳到任务详情。

### 5.2 动态通知规则

| 事件                                           | 通知谁                                                                                                                                  | 新类型          | 未读升级邮件 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| 被 @                                           | 被 @ 的人                                                                                                                               | `mention`       | 是           |
| 任务指派 / 改派                                | 新负责人；改派时也通知原负责人                                                                                                          | `task_assigned` | 是           |
| 任务状态变化（完成、退回、取消等）             | 创建人                                                                                                                                  | `task_status`   | 否           |
| 任务新评论                                     | 负责人 + 创建人（排除评论人、排除本条已被 @ 的人）                                                                                      | `task_comment`  | 否           |
| 任务到期 / 逾期                                | 已有 `task_due`，不改                                                                                                                   | —               | 否           |
| 项目上传文件                                   | 核对上传路径是否已调 `notifyProjectMembers`（`project_update`）；没接就补上                                                             | —               | 否           |
| 订单阶段变化：确认、开始生产、备货完成、已排期 | 订单创建人 + 关联商机负责人（`opportunity.assignedToId`）+ 下一阶段负责角色（按现有订单分类权限取人，实施时在 design 里写清楚取人规则） | `order_stage`   | 否           |
| 订单安装 / 尾款 / 维修                         | 已有 `install_*`，不改                                                                                                                  | —               | 否           |

**通用规则**

- 操作人自己不收；同一事件同一人只收一条（`sourceKey = <type>:<对象 id>:<事件区分键>:<userId>`）。
- 全部经过 `shouldDeliverInApp`；新类型加进 `NOTIFICATION_TYPE_KEYS` 与 `TYPE_INTRODUCED_AT`（保存过偏好清单的老用户视为开启）。
- 摘要沿用现有脱敏规则（纪律第 4 条）：不出毛利率、项目估值、我方最终报价；本期所有通知摘要都**不带金额、客户电话、地址**。
- 通知创建失败不能让原业务操作失败（记日志即可），与现有直发路径一致。

### 5.3 邮件补位

**两种邮件，都挂在已有定时任务上（纪律第 3 条），不新增 cron：**

1. **未读升级邮件**：`mention`、`task_assigned` 两类，创建 15 分钟后仍未读 → 发一封。挂在 `sales-actions`（每 15 分钟）上，用 `runTrackedAutomation` 单独记一条自动化运行（如 `notify-email-escalation`）。只扫最近 24 小时内创建的通知。
2. **每日未读汇总**：每个组织当地 7 点（与 `daily-brief` 同一时刻、同一 `orgsAtLocalHour` 写法），给每个有未读通知的成员发一封汇总（含 `task_due` 等所有未读类型，按类型分组，每条带链接）；没有未读就不发。挂在 `daily-brief` 上，单独记一条自动化运行（如 `notify-email-digest`）。

**规则**

- **发件**：`src/lib/trade/email.ts` 的 `sendEmail`，发件地址 `platformFromAddress()`。不用任何个人邮箱或 Gmail OAuth（纪律第 6 条不受影响）。
- **收件人**：服务端按通知的 `userId` 取该用户的青砚账号邮箱；只发给本组织 active 成员；绝不从请求里取地址。
- **内容**：标题 + 一句摘要 + "在青砚打开"链接；同 §5.2 的脱敏；纯文本 + 简单 HTML。
- **方便个人助理读（§5.5）**：主题统一以 `【青砚】` 开头，后接类型和对象，例如 `【青砚】@提及 · 任务 T-482`、`【青砚】今日未读 5 条`；正文每条事项一行，格式固定为"类型｜对象｜截止时间（有则写）｜链接"。人看着清楚，Muse 这类助理也能稳定识别，员工还能按主题设过滤。
- **偏好**：读 `emailEnabled`。**没有偏好记录的用户按"开"处理**；有记录的按记录。偏好页的"邮件"开关文案改成"未读提醒与每日汇总邮件"。
- **免打扰**：免打扰时段内不发升级邮件（留给次日汇总）；汇总本身在 7 点发，不受影响。
- **不重发**：发送后在 `Notification.metadata` 里写 `emailedAt`（升级邮件）；同一条通知最多一封升级邮件；汇总邮件每人每天最多一封（用 `runTrackedAutomation` 记录 + 当天幂等判断）。发送失败写 `emailError`，不在同一轮重试。
- **非生产**：沿用 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`，未开启时只记日志不真发。

### 5.4 纪律第 2 条补澄清

在青砚 `openspec/config.yaml` 第 2 条末尾补一句（CTO 已决定）：

> 发给本组织 active 成员本人青砚账号邮箱的系统通知邮件（未读提醒、每日汇总）属于站内通知的补位，不算对外发送；任何发给客户或组织外地址的邮件仍须先建 PendingAction。

---

### 5.5 员工侧：用 Muse 读通知邮件（可选，个人自行配置，青砚零开发）

CTO 与 CEO 2026-11-04 确认的用法：青砚只负责站内通知和邮件；员工如果用 Muse，就自己在 Muse 里授权 Gmail，让 Muse 读青砚发来的邮件并提醒自己。青砚与 Muse 之间没有任何对接。

- 前提：员工青砚账号的邮箱是 Gmail / Google Workspace 邮箱（Muse 连的是 Gmail）。不是的话，Muse 读不到。
- 员工在 Muse 里说一句即可，例如："每天早上 7 点半看一下主题以【青砚】开头的新邮件，按截止时间列出我今天要处理的事；白天如果有新的【青砚】@提及或任务指派邮件，马上提醒我。"
- Muse 只看得到邮件里的标题、摘要和链接；看细节、做操作都要点链接回青砚登录。
- 青砚这边唯一相关的要求是 §5.3 的主题前缀和固定正文格式。

## 6. Out of scope

- 每条通知都发邮件；微信 / 企微推送；短信。
- Muse、Grok、Telegram、WhatsApp、任何机器人或个人助理插件；任何 LLM 调用。员工用 Muse 读通知邮件见 §5.5，青砚不做任何对接。
- 新数据表、新字段、migration；新队列 / 调度器 / cron 条目。
- 订单评论区、关注 / 订阅、通知页和铃铛的界面改版。
- 修复微信绑定本身。
- 改动 `muse-bridge/v1` 及 S1–S3 的销售意图。

---

## 7. 验收（GATE）

**change A**

1. 开关关闭（默认）：登录页、设置页、`/settings/wechat`、`/wechat`、组织开通页都看不到微信绑定 / 扫码入口。
2. 开关打开：与改动前一致。
3. `openspec validate hide-wechat-entry` 通过；`npm run typecheck`、`npm run lint:baseline`、`npm test` 通过。

**change B**（用两个测试账号 A、B，在本地或 staging；staging 真发邮件需临时开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`）

1. A 把任务指派给 B → B 铃铛出现未读 `task_assigned`；A 自己没有通知。
2. B 15 分钟内不读 → 收到一封升级邮件；再过一轮不重发。B 先在青砚读了 → 不发。
3. B 在任务评论里 @A → A 收到 `mention`，点进去是该任务；同一请求重放不产生第二条。
4. 在讨论区 @ 一个不是项目成员的人 → 整条 400，没有消息、没有通知。
5. 订单从"备货完成"转到"已排期" → 创建人、商机负责人、排期负责角色各收到一条 `order_stage`；操作人不收。
6. 次日 7 点（可用时间注入的单测代替）每人一封汇总，只含未读；没有未读的人不收。
7. 关了"邮件"偏好的人只收站内通知。
8. 所有邮件和通知摘要不含金额、客户电话、地址。 邮件主题都以 `【青砚】` 开头，正文每条一行、格式固定（§5.3）。
9. 新测试全部在 `scripts/test-all.sh` 注册（纪律第 8 条）；`openspec validate collab-notify` 通过；`npm run typecheck`、`npm run lint:baseline`、`npm test` 通过。
10. 合并后看合并提交上 Vercel 的生产与 staging 两个构建状态都成功。

**必须有的纯逻辑测试**：@ 校验（成员 / 非成员 / 看不到对象 / 自己）、各事件收件人计算（含排除操作人与去重）、`sourceKey` 生成、升级邮件筛选（15 分钟、已读、已发、免打扰、偏好）、汇总分组与"无未读不发"、脱敏、开关解析。

---

## 8. 拆分、顺序与工期

| 顺序 | 内容                                                    | 估算   |
| ---- | ------------------------------------------------------- | ------ |
| 1    | change A `hide-wechat-entry`：propose → 审 → apply → PR | 0.5 天 |
| 2    | change B 第 1 段：@ 提及（§5.1）                        | 1 天   |
| 3    | change B 第 2 段：动态通知（§5.2）                      | 1.5 天 |
| 4    | change B 第 3 段：邮件（§5.3）+ 纪律澄清（§5.4）        | 1 天   |
| 5    | GATE（§7）→ PR → 合并 → 各自独立小 PR 归档              | —      |
| 6    | 试点：订单跟单 / 安装排期组，2 周                       | 2 周   |

TASKFLOW：在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加一节"协作通知"，列 A、B 两项与 GATE；归档时按青砚约定更新状态列。

---

## 9. 已定决策（CTO，2026-11-04）

| #   | 问题                        | 决定                                                                                                    |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| D1  | 试点小组                    | 订单跟单 / 安装排期组                                                                                   |
| D2  | 订单评论区                  | 本期不做；试点后看需求                                                                                  |
| D3  | 邮件默认                    | 没有偏好记录的人按开；个人可关                                                                          |
| D4  | 微信入口                    | 隐藏（开关默认关），不改名，代码保留                                                                    |
| D5  | 纪律第 2 条                 | 按 §5.4 补澄清                                                                                          |
| D6  | 个人助理 / 插件 / Connector | 青砚不做任何对接；员工自行用 Muse 授权 Gmail 读通知邮件（§5.5）；Muse--Bridge-bot 的 Connector 永久冻结 |

## 10. 试点度量

- 通知 24 小时内被读的比例；其中多少是收到邮件后点进来的；
- 被 @ 后到第一次回应（回复或状态变化）的时间；
- 任务派出到负责人第一次操作的时间；
- 逾期任务数，与试点前两周对比；
- 每人每天收到的通知条数和邮件封数（太多说明规则要收）。
