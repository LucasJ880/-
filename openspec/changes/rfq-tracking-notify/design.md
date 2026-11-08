# Design：询价进展通知（T-1）

## Context

动机见 proposal.md「Why」。与实现方式相关的现状：

- **入站**：cron `tender-rfq-inbound` 每 10 分钟一次 → `inbound-sync.ts syncAllOrgsInbound` → 每个组织 `syncOrgInbound(org, deps)`：逐封回信 `parse` → `planInquiryItemUpdate`（`plan.transition` 为 `quoted` / `replied` / `none`，`plan.missingFields`）→ `deps.applyPlan` → `deps.writeAudit`（审计即幂等键）。失败分支写失败审计 + `deps.notifyFailed`。组织处理完、没被跳过时再调 `deps.runChaseScan`。`syncOrgInbound` 的测试在 `inbound-apply.test.ts`，用内存版 deps。
- **催单**：`chase-service.ts runForItems` 按轮次分组 → `decideChases` → 对 `noResponse` 调 `markItemNoResponse` 后调可选 `opts.onNoResponse(itemId, reason)`；对 `drafts` 逐张 `requestApproval`（principal = 项目负责人，`ttlHours = CHASE_TTL_HOURS = 48`）。`runChaseScan`（cron，`manual: false`）传 `onNoResponse = emitNoResponse`（Muse 钩子）；`draftChasesForProject`（Muse `chase` 意图，`manual: true`）不传。返回值 `ChaseRunResult.drafted` 只有 `itemId / supplierName / actionId / kind / chaseIndex`，没有轮次、项目、缺字段与催单天数。`runChaseScan` 读库，没有单测。
- **通知**：`collab/deliver.ts deliverCollabNotification(event)` 做收件人过滤（在职、active 成员、排除操作人、去重）→ 投递门禁 → 按 `sourceKeyPrefix` 或 `<type>:<entityId>:<eventKey>` 加收件人 id 去重写入；不向外抛错；写入的 `category` 固定等于 `type`。类型注册在 `constants.ts`，`delivery-gate.ts TYPE_INTRODUCED_AT` 用 `9999-12-31` 哨兵让上线前保存的清单视为开启。设置页直接列 `NOTIFICATION_TYPE_KEYS`。
- **升级邮件**：`collab/escalation.ts ESCALATION_TYPES = ["mention", "task_assigned"]`，候选查询已带 `projectId / entityType / entityId`；`collab/email.ts` 用 `notificationHref` 生成链接、用 `metadata.objectLabel`（缺省用标题）作主题对象并再脱敏一次。
- **项目页**：`project-inquiry-section.tsx` 每轮卡片 `id="rfq-round-<id>"`，已有页内 `followAnchor`；首屏由两个 effect 决定展开哪一轮（列表加载后默认最新一轮；`firstPendingInquiryId` 变化时展开待批轮），不读 `location.hash`。
- **缺字段标签**：`inbound-contract.ts INBOUND_MISSING_LABEL` 是纯表（只依赖 zod），与 `muse-bridge/hooks.ts MISSING_FIELD_LABELS` 逐字相同；字段顺序 `chase-pure.ts CHASE_FIELD_ORDER`。
- **`category` 的读取方**：全仓只有 `muse-bridge/evidence.ts` 按 `category = "muse_bridge"` 且 `sourceKey` 含销售询问 / 跟进对象 id 读通知；Muse bridge 接口与通知 UI 都不读 `category`。

## Goals / Non-Goals

**Goals：**
- 四类自动事件各在发生的同一次 cron tick 内写入站内通知；人工动作一概不发。
- 一轮一次扫描只出一条「催单待批」，读标题就知道哪个项目、哪几家、要不要动手；点开到能动手的那一轮。
- 通知链路任何一步失败，不改变收信、催单的结果与计数。

**Non-Goals：**
- 不改 `src/lib/tender-rfq/chase-pure.ts`（`decideChases` / `decideNoResponse` / `resolveChaseAfterDays` / 模板）、`chase-execute.ts`、`execute.ts`、`inbound-parse.ts`、`inbound-apply.ts`（`planInquiryItemUpdate`）。
- 不改 `src/lib/muse-bridge/**`（`hooks.ts`、`events.ts`、`evidence.ts`）。
- 不改 `src/lib/notifications/collab/deliver.ts`、`recipients.ts`、`email.ts`、`digest.ts`、`redact.ts`；不改 `src/lib/inquiry/service.ts`（`recordQuote` / `markItemReplied` / `markItemNoResponse`）。
- 不改 `vercel.json`、`src/app/api/cron/tender-rfq-inbound/route.ts`、`src/app/api/cron/sales-actions/route.ts`；不改 Prisma schema。
- 不在 `src/app/(main)/bids/**`、`src/lib/proactive/scanner.ts` 做任何事（T-2）。

## Decisions

### D1 入站挂钩：新的可选依赖 `notifyTracking`，在写完审计之后调
`InboundSyncDeps` 加可选 `notifyTracking({ orgId, item, plan, messageId })`。`syncOrgInbound` 在 `applyPlan` 与 `writeAudit` 都成功后、仅当 `plan.transition` 为 `quoted` / `replied` 时调用，`.catch` 记日志（与 `notifyFailed` 同一写法）。默认 deps 实现为：按 `item.id` 查一次供应商名、轮次序号、轮次发起人、项目名与负责人，交给 `tracking-notify.ts`。未响应后才到的回信（`revived`）照常走这里。
否决：挂在 `inquiry/service.ts recordQuote / markItemReplied` 里——人工在明细里录报价也走它们，违反「人工动作不发」；否决：挂进 `deps.applyPlan`——拿不到回信 `messageId`（去重键要用），且 `applyPlan` 的内存版测试 deps 要跟着改。

### D2 催单挂钩：`runForItems` 增加可选 `onRoundDrafted`，`onNoResponse` 带上下文
`runForItems` 的 opts 增加可选 `onRoundDrafted(round)`：每一轮的 `drafts` 循环结束、本轮 `drafted` 非空时调用一次，参数含轮次 id、序号、项目 id / 名 / 负责人、本轮催单天数 `days`、本轮新建卡（`supplierName / actionId / kind / missingFields`，`missingFields` 取自 `ChaseDraftPlan`）。`onNoResponse` 的第三个参数补上同样的轮次与项目上下文和该家的供应商名。`loadItems` 的 select 增加 `inquiry.roundNumber`、`inquiry.createdById`（只加字段，`where` 不变）。`runChaseScan` 传两者：`onNoResponse` 先调 Muse `emitNoResponse` 再发站内通知，两者各自 `.catch`；`draftChasesForProject` 什么都不传，所以手动与 Muse `chase` 不发。
否决：在 `syncAllOrgsInbound` 拿 `runChaseScan` 的返回值统一发——返回值没有轮次、项目、缺字段与催单天数，只能回查库并重写一遍分组，第二套逻辑；否决：改 `decideChases` 让它产出通知——禁止事项。

### D3 分层：纯函数算文案，服务端只补上下文与投递
`tracking-notify-pure.ts` 导出四个构造函数（报价 / 回信 / 催单待批 / 未响应），输入是已查好的名字、序号、字段与原因，输出 `{ type, priority, title, summary, entityType: "tender_rfq_round", entityId, projectId, sourceKeyPrefix, metadata: { objectLabel } }`，外加 `trackingRecipients(kind, { ownerId, roundCreatorId })`。`tracking-notify.ts` 补 `orgId`、`actorId: null`、收件人，调 `deliverCollabNotification`。纯模块只依赖 `collab/redact.ts`、`inbound-contract.ts`、`chase-pure.ts` 的常量，不引 `db`。
否决：文案写在 `tracking-notify.ts` 里——要连库才能测真值表；否决：复用 `collab/events.ts`——那是协作对象（任务 / 工艺单）的事件，混进询价会让那个文件的 import 链拖进 tender-rfq。

### D4 去重键用 `sourceKeyPrefix`，与任务书逐字一致
`rfq_quote_received:<itemId>:<messageId>`、`rfq_reply_received:<itemId>:<messageId>`、`rfq_chase_ready:<inquiryId>:<h>`（`h` = 本次新建卡 actionId 升序以「,」连接后的 sha256 前 16 位）、`rfq_no_response:<itemId>`；`deliverCollabNotification` 再拼收件人 id。同一封回信重试、同一次扫描重跑都命中同一键。
否决：默认的 `<type>:<entityId>:<eventKey>`（entity = 轮次）——未响应键会多出轮次段，且与任务书记录的键不一致，后来的人查库对不上。

### D5 缺字段标签复用 `INBOUND_MISSING_LABEL`
任务书写的是在纯模块里复写 `hooks.ts` 的 `MISSING_FIELD_LABELS`（因为 `hooks.ts` 引了 `db`）。实际 `inbound-contract.ts` 已有一张只依赖 zod 的同内容表，直接用它，字段顺序用 `CHASE_FIELD_ORDER`。测试断言两张表逐字相同，防漂移。
否决：复写第三份——三张表迟早不一致。

### D6 脱敏按段做，模板文字由测试保证不命中
供应商名、项目名各自过 `redactText`（命中整段换成 `（含敏感信息，请在青砚查看）`），再拼进固定模板；`objectLabel` 同样拼脱敏后的项目名（发邮件时 `email.ts` 还会再脱敏一次）。测试对真值表每个输出断言 `isSensitiveText(title) === false`、`isSensitiveText(summary) === false`，并断言不含任何数字价格（入参里本来就不传价格）。
否决：整句过 `redactText`——项目名里有个门牌号就会把「报价了 / 该催了」整句抹掉，通知失去意义（`collab/mentions.ts` 也是按段做）。

### D7 收件人：三类给负责人 ∪ 发起人，催单待批只给负责人
定时检查起草的卡 principal 是项目负责人（`runForItems` 的 `principalUserId ?? owner`），审批中心 `canDecidePending` 下创建人能批；本轮发起人不一定能批，给他发「等你批准」是误导。报价 / 回信 / 未响应是信息类，发起人需要知道。负责人与发起人同一人时由 `filterCollabRecipients` 去重。
否决：催单待批也给发起人——见上；否决：给组织管理员——收件面太大，且他们有审批中心。

### D8 跳转与首屏锚点
`href.ts` 的 `switch` 加 `tender_rfq_round` → `projectId && /projects/{projectId}?tab=bid#rfq-round-{entityId}`（缺 `projectId` 返回 null，按既有顺序回落）。`web-entry-pure.ts` 新增 `roundIdFromHash(hash)`（只接受 `#rfq-round-` 后跟 id 字符集）与 `initialExpandedRound({ hashRoundId, roundIds, pendingRoundId, latestRoundId })`（锚点轮次在列表里 → 它；否则待批轮；否则最新一轮）。`project-inquiry-section.tsx` 列表首次加载时调这两个函数决定展开并滚动，用一个 ref 记下「已按锚点展开」，让待批 effect 不再覆盖。
否决：查询参数 `?round=`——W-1 的入口说明与 `followAnchor` 已用 `#rfq-round-`，两套约定会分叉；锚点也不触发服务端重渲染。

### D9 升级邮件只加一个类型
`ESCALATION_TYPES` 加 `rfq_chase_ready`，其余（24 小时窗、15 分钟、3 次尝试、免打扰、邮件偏好、认领锁、单轮上限）全部沿用。主题对象来自写入时的 `metadata.objectLabel = 项目「{项目}」第 {n} 轮询价`；类型名来自注册表「催单待批」；链接由 D8 的跳转自动生效。卡 48 小时过期、升级窗口 24 小时，未读满 15 分钟即进候选，不冲突。
否决：在 `tracking-notify.ts` 里自己发邮件——第二条发信路径，绕过偏好、免打扰与认领锁。

### D10 既有两条入站提醒改类别与对象
`INBOUND_NOTIFICATION_CATEGORY` 改为 `"tender_rfq"`；`notifyFailed` 的入参加 `inquiryId`，写入改为 `entityType: "tender_rfq_round"`、`entityId: inquiryId`（`projectId` 照旧）。标题、摘要、优先级、`sourceKey` 一字不改，所以老回信不会再提醒一次。两条仍是 `type: project_update`、单人直写 `createNotification`（任务书 §7 允许的单人系统提醒，类型已登记）。
否决：改走 `deliverCollabNotification`——去重键格式会变，已提醒过的老回信会再提醒一次。

### D11 新四类的 `category`：保持 `deliver.ts` 现状（= 类型名）
`deliverCollabNotification` 把 `category` 写成 `type`，所以新四类的 `category` 分别是各自的类型名，而 D10 的两条是 `tender_rfq`。Context 已核实没有任何 UI 或接口按这两个值筛选，这个不一致只体现在库里。选择不动 `deliver.ts`。
否决：给 `CollabEvent` 加可选 `category` 覆盖、让六条都是 `tender_rfq`——为一个没有读取方的字段改协作通知的共享入口，扩大 COLLAB-2 的回归面。审核若要统一，改动只在 `deliver.ts` 加一个可选字段 + 一条测试，不影响 specs 与任务拆分。

### D12 失败隔离
`syncOrgInbound` 对 `notifyTracking` 加 `.catch`；`runChaseScan` 传入的两个回调内部 `try/catch`，绝不向 `runForItems` 抛错——否则 `onNoResponse` 抛错会让该家同时进 `noResponse` 与 `failed`（现有代码把回调放在同一个 `try` 里）。`deliverCollabNotification` 本身不抛错，补上下文的查询失败只记日志。

## 与八条硬纪律

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不新增 model / 字段 / 迁移；新类型是字符串，写既有 `Notification`；`loadItems` 只多 select 两个已有字段 |
| 2 | 出站先审批 | 不新增任何对外发送；通知与升级邮件只发本组织 active 成员本人的青砚账号（config 第 2 条澄清的站内补位）；催单仍只建 `tender.send_chase` 卡 |
| 3 | 禁止第三套队列 | 挂在既有 `tender-rfq-inbound` tick 与 `sales-actions` 升级邮件步骤里；不新增 cron / 队列 / worker |
| 4 | 脱敏 | 标题、摘要、metadata 不传任何价格；名字按段 `redactText`；升级邮件再脱敏一次（既有）；SHALL NOT 写在 `tender/rfq-notifications`「询价通知不输出敏感内容」 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及（不读 `mailboxEmail` / `fromEmail`，不改执行器） |
| 7 | 确定性优先 | 全部查表与字符串拼接，零 LLM；测试断言新文件不导入 LLM 客户端 |
| 8 | 测试注册 | `tracking-notify-pure.test.ts`、`tracking-notify-wiring.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`check-test-registry.sh` 通过 |

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`：spec 文案表每行一例、文字规则、按段脱敏、四类去重键（含「同一批卡顺序不同键相同」）、催单待批合并与优先级、收件人组合、两张缺字段标签表逐字相同。
- `npx tsx src/lib/tender-rfq/__tests__/tracking-notify.test.ts`（注入 deps 执行）：`runForItems` 真跑 `decideChases`，一轮多张卡只调一次 `onRoundDrafted`、起草失败的卡不进通知；三个投递入口的收件人、去重与吞错（`runForItems` 的库读写为此改为可注入，默认不变）。
- `npx tsx src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts`（源码断言，同 `collab-wiring.test.ts` 写法）：`runChaseScan` 传 `onRoundDrafted` 与带通知的 `onNoResponse`，`draftChasesForProject` 都不传；默认入站 deps 有 `notifyTracking`；两条入站提醒的类别、对象与 `sourceKey` 字符串；新文件不导入 LLM 客户端、`db` 不进纯模块、`muse-bridge/hooks.ts` 未被修改的导出仍在。
- `npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts`：quoted / replied 各调一次 `notifyTracking`、解析失败 / 自己发出 / 未命中线程 / `none` 不调；`notifyTracking` 抛错时结果计数、审计、游标不变。
- `npx tsx src/lib/notifications/__tests__/collab-email-escalation.test.ts`、`notification-href.test.ts`、`collab-preferences.test.ts`、`src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`：各自新增用例。
- 门禁：`npm run typecheck`（`NODE_OPTIONS=--max-old-space-size=8192`）、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-tracking-notify --strict`。
- staging 手工：任务书 §2.6 第 5–9 步。

## Risks / Trade-offs

- [Muse 旁路打开时负责人收到两条（Muse 事件 + 站内）] → 旁路现关闭；记入报告已知局限，本 change 不去重。
- [同一页面上点铃铛里的另一轮通知，Next.js 只改 hash 不重挂载，不会自动展开] → 浏览器仍会滚到 `#rfq-round-<id>`；首屏读取覆盖「从别处点进来」的主路径；报告记为已知局限。
- [入站每条报价 / 回信多一次查询（补名字与发起人）] → 每 10 分钟一次、按回信条数计，量级很小；只查一次、不进循环内的其他查询。
- [`onNoResponse` 签名变了] → 它是 `runForItems` 的内部 opts，只有 `runChaseScan` 一个传入方；wiring 测试锁住。
- [新四类 `category` 与两条入站提醒不一致] → 见 D11，无读取方；审核可改。

## Migration Plan

无数据迁移、无新开关、无新环境变量、无新 cron。上线即生效：下一个 `tender-rfq-inbound` tick 起开始写新通知；已存在的入站提醒行保持原 `category`，只有之后新写的用 `tender_rfq`。回滚 = 还原本 PR（已写入的通知行留在库里，类型未登记时按「其他通知」显示）。
