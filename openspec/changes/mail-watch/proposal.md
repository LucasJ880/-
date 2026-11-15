# Proposal：客户来信提醒（MAIL-2）

TASKFLOW：MAIL-2（Phase M「邮箱助手」；任务书 `docs/QINGYAN_MAIL-1_MAILBOX_ASSISTANT_TASKBRIEF.md`，判断点 2–6 已于 2026-11-14 拍板，判断点 8 待定、按 A 实现）。依赖 MAIL-1（change `mail-read-tools`，PR #455）的读接口与读信开关。不触碰 `muse-bridge`，没有受影响的 Muse 意图（design 待拍板 D 已取 D2：不走 Muse 事件）。

## Why

客户的回信只在成员各自的 Gmail 里，青砚不知道：客户时间线只有发出、没有收到，成员不切到邮箱就不知道客户回了。读信授权、游标轮询、账本幂等都有现成样板（询价回信入站、日历观察），缺的是一条来信观察步骤。

## What Changes

**来信观察步骤**
- 在既有 `sales-actions` 定时任务里加一个 `mail-watch` 步骤，排在 `calendar-watch` 之后、未读升级邮件之前，带截止时刻；不改 `vercel.json`，不新增定时任务、队列或认领。
- 逐个已勾选的成员邮箱，按游标增量读取收件箱新到的邮件，只取元数据（发件人、主题、日期、标签、线程、`Message-ID`），不取正文。
- 首次勾选只记起点，不回溯历史邮件；游标过期时重建起点、不回溯，并记一条 `mail.watch.cursor_reset`。
- 每轮每个邮箱至多处理 50 封，其余留到下一轮；单封失败记 `mail.watch.failed`，不重试、不阻塞后面的信。

**归类（查表，不调模型）**
- 跳过：本人发出的、垃圾邮件、已删除、促销 / 社交 / 论坛分类、不在收件箱的；线程属于在途询价的信（由既有询价回信入站处理）。
- 规则 1「客户来信」：发件地址等于本组织某个未归档客户档案的邮箱，且该客户对邮箱主人可见。
- 规则 2「客户回信」：同一线程里有青砚发出过的邮件（客户互动记录里记着它的邮件 id），且对应客户对邮箱主人可见。
- 其余归「未匹配」：不提醒、不写客户，只在账本里计数。

**命中之后**
- 记账本 `mail.watch.observed`（按 Gmail 邮件 id 幂等），只有发件地址、主题（至多 120 字）、客户、命中规则。
- 在客户时间线上建一条入站邮件互动，不挂商机、不进销售知识库分析；同一封信进了两个成员的邮箱时只建一条。
- 给邮箱主人发通知「客户来信：〈客户名〉」（新类型 `mail_inbound`，点开到客户详情页）；收件人由一个纯函数算出，判断点 8 改 B 时只动这一处。
- 每新建一条通知再推一条销售域微信（上限与日历变更推送相同，每轮 30 条）；文案只有客户名与主题。不走 Muse 事件。

**开关与配置（零 schema）**
- 三道开关都开才读某个邮箱：平台 `MAIL_WATCH_ENABLED`（默认关）∧ 组织开关（默认关，企业管理员开）∧ 成员本人勾选（默认不勾）。
- 配置与游标存在 `Organization.settingsJson.mailWatch`，写入走既有的加锁写入口。
- 新增组织开关接口 `GET / PUT /api/organizations/[orgId]/mail-watch-settings` 与成员勾选接口 `GET / PUT /api/sales/mail-watch/opt-in`；成员只能改自己的勾选，取消勾选即删除本人的游标。
- 已勾选但授权缺读信权限：本轮跳过该邮箱，24 小时内至多发一条站内提醒「请到邮箱绑定页重新授权」。

**页面**
- `/settings/email` 增加「客户来信提醒」勾选项（成员本人）与组织开关（企业管理员）；平台开关关闭时都不显示。
- 客户详情页的入站邮件互动条目加「让助手读这封信」入口：打开助手并预填一句不含邮件主题的话；读信开关关闭时不显示。

**通知类型登记**
- 新增通知类型 `mail_inbound`（中文名「客户来信」）：类型清单、处理页面对照（客户详情页）、铃铛图标。

**测试**
- 新增并注册 `mail-watch-pure`（归类表、跳过标签、主题处理、文案、收件人、三道开关真值表）与 `mail-watch-db.isolated`（首轮不回溯、重放不重复、不可见不命中、游标过期重建、询价线程不重复提醒、50 封上限后续上、取消勾选删游标、两个邮箱同一封信只建一条互动）。

## Capabilities

### New Capabilities
- `mail/inbound-watch`：按成员本人的勾选观察其 Gmail 收件箱的新来信——三道开关、增量读取与游标、确定性归类、账本与幂等、客户时间线入站互动、`mail_inbound` 通知与微信推送、缺权限提醒、设置页与客户详情页的入口。

### Modified Capabilities

（无。`calendar/change-push`、`notifications/type-visibility`、`notifications/click-targets` 的既有 Requirement 文字不变：`mail_inbound` 的处理页面与跳转沿用既有规则，写在新能力里；`sales_customer` 的跳转地址已有规定。）

## Impact

- 新增：`src/lib/mail-watch/**`（`pure.ts`、`run.ts`、`settings.ts`、`types.ts` 与测试）、`src/app/api/organizations/[orgId]/mail-watch-settings/route.ts`、`src/app/api/sales/mail-watch/opt-in/route.ts`。
- 修改：`src/lib/google-email.ts`（新增收件箱增量读取函数；既有函数不改）、`src/lib/env/runtime-isolation.ts`（开关）、`src/app/api/cron/sales-actions/route.ts`（加步骤）、`src/lib/automation/registry.ts` 与 `src/lib/cockpit/schedule.ts`、`src/lib/cockpit/posts.ts`（登记步骤名称、节奏与岗位归属）、`src/lib/notifications/constants.ts`、`type-visibility.ts`、`src/components/header.tsx`（图标表）、`src/app/(main)/settings/email/page.tsx`、`src/app/(main)/sales/customers/[id]/interaction-timeline.tsx` 与 `types.ts`、`src/lib/organizations/__tests__/settings-write-guard.test.ts`（登记新的写入方）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`.env.example`。
- 与任务书「Impact」不同：`src/lib/notifications/href.ts` 不用改（`sales_customer` 的跳转已存在）；多出两个接口路由。
- 零 schema；`vercel.json` 无 diff；不新增依赖；新增一个环境变量 `MAIL_WATCH_ENABLED`。
- 上线前置：MAIL-1 已合并；运维前置同 MAIL-1（OAuth 同意屏幕状态、成员重新授权）。

## Out of scope

- 读取、保存或推送邮件正文；读附件。
- 用模型做分类、优先级或回复草稿（MAIL-5）；任何新增的模型调用。
- 实时推送（Gmail Pub/Sub，MAIL-3）；未回复提醒（MAIL-4）；未匹配来信一键建客户（MAIL-7）。
- 组织公共邮箱的统一监控与分发；读组织授权邮箱 `mailboxEmail`。
- 改动邮箱（标已读、归档、打标签、删除）；任何对外发送。
- 询价回信入站（`src/lib/tender-rfq/inbound-sync.ts`）与外贸的邮件转发询盘入站。
- MAIL-1 的读信工具、写入封锁与读信权限状态。
- 让既有的「多久没跟进」类提醒区分客户来信与成员跟进（见 design 风险一节）。
- Muse 事件推送（已绑定 Muse 的成员同样收站内通知与微信）；微信 / Muse 通道里读邮件。
