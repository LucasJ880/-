# Proposal：询价进展通知——报价到了、该催了、没回了，告诉对的人（T-1）

TASKFLOW：T-1（新增 Phase T「询价追踪」；任务书 `docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md` §2，Evan 2026-11-07 拍板：「催单待批」15 分钟未读要发升级邮件，只此一类）。

## Why

供应商回信、报价自动入表，cron 起草催单卡、标「未响应」，现在都只推 Muse 钩子，而 Muse 旁路关着，所以站内没有任何人收到通知；催单卡 48 小时没人批就过期，W-1 卡片上「3 天没回会自动起草催单给你批」实际没人提醒。

## What Changes

- 登记四个通知类型：`rfq_quote_received`「供应商报价了」、`rfq_reply_received`「供应商回信（无报价）」、`rfq_chase_ready`「催单待批」、`rfq_no_response`「供应商未响应」；对上线前保存过类型清单的用户一律视为开启。
- 新增纯函数 `src/lib/tender-rfq/tracking-notify-pure.ts`：四类事件 → 标题、摘要、优先级、跳转对象、去重键、metadata；文案按任务书 §2.4 真值表，供应商名与项目名逐段脱敏，项目名超过 24 字截断。
- 新增 `src/lib/tender-rfq/tracking-notify.ts`：补齐收件人（项目负责人 ∪ 本轮发起人；催单待批只给项目负责人）后统一经 `deliverCollabNotification` 投递，`actorId` 为空。
- 入站同步：`InboundSyncDeps` 新增可选 `notifyTracking`，在回信入表、写完审计之后调用；`quoted` 发报价通知，`replied` 发回信通知；解析失败、自己发出的邮件、未命中线程、`none` 不调用。
- 催单扫描：`runChaseScan`（cron）在每一轮起草完后把本次新建的催单与追问汇成一条「催单待批」通知，每标一家未响应发一条「未响应」通知；手动 `draftChasesForProject` 不发。Muse 钩子照常调用、一行不改。
- 跳转：`entityType = tender_rfq_round` → `/projects/{projectId}?tab=bid#rfq-round-{entityId}`；项目页「标书与报价」首屏读地址里的 `#rfq-round-<id>`，展开并滚到该轮（优先于默认展开最新一轮 / 待批轮）。
- 升级邮件：`rfq_chase_ready` 加入升级邮件类型（15 分钟未读、24 小时内），其余规则不变；邮件主题对象为 `项目「{项目}」第 {n} 轮询价`。
- 既有两条入站提醒（回信解析失败、请重新授权 Gmail 读取权限）的 `category` 从 `muse_bridge` 改为 `tender_rfq`；解析失败那条改跳该轮（`tender_rfq_round`）；`sourceKey` 不变。

## Capabilities

### New Capabilities
- `tender/rfq-notifications`：询价进展的站内通知——哪些自动事件发通知、发给谁、标题摘要怎么写、怎么去重与脱敏，以及入站提醒的归类与跳转。

### Modified Capabilities
- `notifications/email-reminders`：「升级邮件的发送条件」类型从两种变三种（加 `rfq_chase_ready`）；「升级邮件的主题与正文」类型名多一个「催单待批」、对象多一种询价轮次写法。
- `notifications/click-targets`：新增「询价轮次的跳转地址」（`tender_rfq_round`）。
- `tender/rfq-web-entry`：新增「从链接直达询价轮次」（项目页首屏按 `#rfq-round-<id>` 展开该轮）。

受影响的 Muse 意图：无。`muse-bridge/hooks.ts` 与 Muse 出站箱不改；`chase` 意图走的 `draftChasesForProject` 不发站内通知；`MUSE_BRIDGE_ENABLED` 打开时项目负责人会同时看到 Muse 事件与新的站内通知（旁路目前关闭，记入已知局限，本 change 不去重）。

## Impact

- 新增：`src/lib/tender-rfq/tracking-notify-pure.ts`、`src/lib/tender-rfq/tracking-notify.ts`、`src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`、`src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts`。
- 修改：`src/lib/notifications/constants.ts`、`src/lib/notifications/delivery-gate.ts`、`src/lib/notifications/href.ts`、`src/lib/notifications/collab/escalation.ts`、`src/lib/tender-rfq/inbound-sync.ts`、`src/lib/tender-rfq/chase-service.ts`、`src/lib/tender-rfq/web-entry-pure.ts`（锚点解析）、`src/components/inquiry/project-inquiry-section.tsx`；测试 `inbound-apply.test.ts`、`collab-email-escalation.test.ts`、`notification-href.test.ts`、`collab-preferences.test.ts`、`web-entry-pure.test.ts`；`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 不动：`chase-pure.ts`（`decideChases` / `decideNoResponse`）、`chase-execute.ts`、`execute.ts`、`inbound-parse.ts`、`inbound-apply.ts`、`muse-bridge/**`、`collab/deliver.ts`、`collab/email.ts`、`collab/digest.ts`、Prisma schema、`vercel.json`。
- 硬纪律：零 schema（类型是字符串，通知写既有 `Notification`）；通知与升级邮件只发本组织 active 成员本人青砚账号（config 第 2 条澄清），零对外发送；不新增 cron / 队列；零 LLM 调用；标题、摘要、升级邮件不出现金额。

## Out of scope

- 跨项目询价追踪页、首页「供应商未回复」建议修正、`batch-followup` 下线（T-2 `rfq-tracker`）；询价日报（T-3）。
- 报价 / 回信 / 未响应的升级邮件；7 点汇总的任何规则（新类型按既有规则进汇总）。
- 人工录报价、手动「现在就催」、审批通过 / 驳回、发送轮次审批卡创建时的通知。
- 改 `decideChases` / `decideNoResponse` 的任何判定、`tender-rfq-inbound` 的节奏、催单模板与执行器。
- Muse 事件与站内通知的去重；`collab/deliver.ts` 的 `category` 规则（见 design 的开放问题）。
