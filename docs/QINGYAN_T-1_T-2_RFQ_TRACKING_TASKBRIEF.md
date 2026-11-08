# T-1 / T-2 任务书：询价追踪——谁回了、谁没回、该催谁，一处看清

| 项 | 值 |
|---|---|
| change | **T-1** `rfq-tracking-notify`（先做）→ **T-2** `rfq-tracker`（后做）；两个 change、两个 PR，各自 propose / apply / archive |
| TASKFLOW ID | 新增 Phase T：T-1、T-2（T-3「询价日报」不在本任务书，见 §9） |
| 目标 | 替掉「Grok Bot 追踪」这一步：供应商回信 / 报价、催单卡待批、标未响应，**不用盯 Grok Bot 也不用一个个项目点进去看** |
| 依赖 | W-1（PR #389）合并后再开工——T-2 复用 W-1 的 `RfqApprovalPanel`、`web-entry-approval.ts`、`web-entry-pure.ts` |
| 执行者 | Claude Code：每个 change `/opsx:propose` → 四件套回传 Claude（chat）审 → `/opsx:apply` → `npm test` → `/opsx:verify` → PR |
| 审核 | Claude（chat）；Evan 拍板合并 |
| 已拍板 | 2026-11-07（§8）：① 催单待批**要**额外发邮件 ② `batch-followup` 直接下线 ③ 追踪页**要**显示价格 |

---

## 0. 先读

- `openspec/config.yaml` `context:`（八条硬纪律）与 `rules:`；`CLAUDE.md`
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase 1（P1-4 入站 / P1-7 催单）、Phase W、Phase C（协作通知）
- 入站：`src/lib/tender-rfq/inbound-sync.ts`（`syncOrgInbound`、`defaultInboundSyncDeps` 里的 `applyPlan` / `notifyFailed` / `remindReadScope`）
- 催单：`src/lib/tender-rfq/chase-service.ts`（`loadItems` / `runForItems` / `runChaseScan` / `draftChasesForProject`）、`chase-pure.ts`（`decideChases` / `decideNoResponse` / `resolveChaseAfterDays` / `CHASE_TTL_HOURS`）
- 通知：`src/lib/notifications/collab/deliver.ts`（`deliverCollabNotification`）、`recipients.ts`、`redact.ts`、`constants.ts`（类型注册表）、`delivery-gate.ts`（`TYPE_INTRODUCED_AT`）、`href.ts`、`collab/digest.ts`（7 点未读汇总）
- 规格：`openspec/specs/notifications/{activity-events,click-targets,email-reminders,preferences}/spec.md`、`openspec/specs/tender/rfq-web-entry/spec.md`（W-1 归档后）
- 可见性：`src/lib/projects/visibility.ts buildProjectVisibilityWhere`；参考路由 `src/app/api/org/tender-intel-profiles/route.ts`（`resolveRequestOrgIdForUser` + 可见性过滤）
- 现状问题：`src/lib/proactive/scanner.ts:199` 与 `src/app/api/projects/[id]/inquiries/batch-followup/route.ts:60` 过滤 `status in ["pending","contacted"]`，但状态机（`src/lib/inquiry/status.ts`）没有 `contacted`

---

## 1. 现在用户卡在哪（证据）

| # | 现状 | 代码证据 | 用户感受 |
|---|---|---|---|
| 1 | 供应商回信、报价自动进表，**不通知任何人** | `inbound-sync.ts` 只调 `museOnQuoteRecorded` / `markItemReplied` 的 Muse 钩子，`MUSE_BRIDGE_ENABLED` 关着时第一行就返回 | 报价到了不知道，得自己一个个项目点开看 |
| 2 | cron 起草的催单卡**没人知道**；卡 48 小时（`CHASE_TTL_HOURS`）没人批就过期 | `chase-service.ts runForItems` 只 `requestApproval`，不发站内通知（建卡通知只有 Muse 钩子） | W-1 卡片上写着「3 天没回会自动起草催单给你批」，可实际上没人提醒你去批 |
| 3 | 催满两次被标「未响应」，不通知 | `runChaseScan` 的 `onNoResponse` 只发 Muse 事件 | 不知道该换供应商了 |
| 4 | 没有跨项目「谁没回」视图 | 只有项目内的询价明细 | 同时跟 3 个标时，要点 3 个项目 |
| 5 | 首页「供应商未回复」建议永远不准 | `scanner.ts` 查 `pending/contacted` + `createdAt`：真正已发出的是 `sent`，`contacted` 不存在 | 提醒的是从没发出去的项，真正在等的反而漏掉 |

---

## 2. T-1 `rfq-tracking-notify`：发生了就告诉对的人

### 2.1 用户视角

- 甲厂回了邮件、报价进表 → 10 分钟内，项目负责人和这一轮的发起人的铃铛里出现一条：**「甲厂报价了 · Alberta 露营装备」**，摘要「第 2 轮询价：单价、交期已自动进表；还缺：有效期」，点开直接到该项目「标书与报价」并展开这一轮。
- 乙厂回了邮件但没写价 → **「乙厂回信了，没有报价 · Alberta 露营装备」**，摘要「第 2 轮询价：需要你看一眼原文」。
- 同一次检查里系统起草了催单 / 追问（丙厂、丁厂 3 天没回；甲厂报价缺有效期）→ 项目负责人只收到**一条**：**「3 封催单 / 追问已起草，等你批准 · Alberta 露营装备」**，摘要「第 2 轮：丙厂、丁厂超过 3 天没回；甲厂报价缺有效期。48 小时内不批会过期」，priority high；点开到该轮，审批面板就在那里。
- 戊厂催了两次没回 → **「戊厂没有回复，已标未响应 · Alberta 露营装备」**，摘要「第 2 轮：催了两次仍未回复。可以换一家供应商再问」。
- **催单待批**这一条 15 分钟没读 → 发一封邮件到负责人自己的青砚账号邮箱（主题以【青砚】开头），邮件里的链接直接到该轮审批面板；用的是 COLLAB-2 既有的升级邮件（随 `sales-actions` 每 15 分钟检查一次，所以是 15–30 分钟内到），尊重邮件偏好与免打扰。报价 / 回信 / 未响应不发升级邮件。
- 这些通知与邮件都**不写任何金额**（与 COLLAB-2 脱敏一致）；没读的会进第二天早上 7 点的未读汇总邮件（既有机制，无需新代码）；用户可在通知设置里按类型关掉。

### 2.2 做什么

1. **登记四个通知类型**（`constants.ts`）：`rfq_quote_received`「供应商报价了」、`rfq_reply_received`「供应商回信（无报价）」、`rfq_chase_ready`「催单待批」、`rfq_no_response`「供应商未响应」；`delivery-gate.ts TYPE_INTRODUCED_AT` 用远未来哨兵 `9999-12-31T00:00:00Z`（与 COLLAB-2 同法，保证之前保存过偏好的人默认开启）。
2. **新增 `src/lib/tender-rfq/tracking-notify-pure.ts`**（纯函数）：四类事件 → `{ type, priority, title, summary, entityType: "tender_rfq_round", entityId: inquiryId, eventKey }`；文案见 §2.4 真值表；标题摘要过 `collab/redact.ts` 的脱敏规则（测试断言不含数字金额）。
3. **新增 `src/lib/tender-rfq/tracking-notify.ts`**（服务端）：组装后统一调 `deliverCollabNotification`（收件人过滤 / 偏好门禁 / 去重 / 失败隔离全部复用，**不新写**）。
   - 收件人：报价 / 回信 / 未响应 → 项目负责人 ∪ 该轮 `ProjectInquiry.createdById`；催单待批 → 项目负责人（cron 卡的创建人就是他，只有他和组织管理员能批）。
   - `actorId: null`（系统触发）。
   - 去重键：报价 `rfq_quote_received:<itemId>:<回信 messageId>`、回信 `rfq_reply_received:<itemId>:<messageId>`、催单待批 `rfq_chase_ready:<inquiryId>:<本次新建卡 actionId 排序后拼接的 hash>`、未响应 `rfq_no_response:<itemId>`。
4. **挂钩点（只挂自动路径）**：
   - `inbound-sync.ts syncOrgInbound`：在 `deps.applyPlan` 成功、写完审计之后调用新依赖 `deps.notifyTracking({ item, plan, messageId })`（那里才拿得到回信 `messageId`；`applyPlan` 本身不改）：`transition === "quoted"` → 报价通知（缺字段取 `plan.missingFields`；中文标签与 `muse-bridge/hooks.ts` 的 `MISSING_FIELD_LABELS` 一致——在纯模块里复写同一张表，因为 `hooks.ts` 顶部引了 `db`，纯函数不能引它）；`transition === "replied"` → 回信通知。**人工在明细里录报价不发**（那是用户自己的动作，走的是 `recordQuote` 路由，不经过这里）。
   - `chase-service.ts runChaseScan`（cron，`manual: false`）：按轮次把本次 `drafted`（催单 `no_reply` 与追问 `missing_fields` 合在一起）汇成**一条**催单待批通知；每个 `noResponse` → 一条未响应通知。**手动「现在就催」不发**（发起人就在页面上）。
   - 回信通知不承诺「追问已起草」：追问卡是同一 tick 末尾的催单扫描才起草的，那一刻还不知道；起草了就由催单待批那一条告诉负责人。
   - 与 Muse 钩子并列调用，Muse 钩子一行不改。
5. **跳转**：`href.ts` 新增 `entityType: "tender_rfq_round"` → `/projects/{projectId}?tab=bid#rfq-round-{entityId}`；W-1 的 `project-inquiry-section.tsx` 在页面加载时读 `location.hash`，`#rfq-round-<id>` 就展开并滚到该轮（W-1 已有 `followAnchor`，补一个首屏读取）。
6. **催单待批升级邮件**：`collab/escalation.ts` 的 `ESCALATION_TYPES` 加入 `rfq_chase_ready`（其余候选窗口、尝试次数、免打扰、邮件偏好、在途锁规则全部沿用）；邮件主题 / 正文 / 链接沿用 `collab/email.ts`（链接经 `notificationHref`，第 5 条加的 `tender_rfq_round` 跳转自动生效）。收件人是本组织 active 成员自己的青砚账号邮箱，属 config 第 2 条澄清的「站内通知补位」，不算对外发送。规格：`notifications/email-reminders` 的「升级邮件的发送条件」改为 MODIFIED（类型从两种变三种）。
7. **顺带统一两条既有入站提醒**：「回信解析失败，请手工录入」与「请重新授权 Gmail 读取权限」现在用 `type: project_update, category: muse_bridge`，改为 `category: "tender_rfq"`，解析失败那条加 `entityType: "tender_rfq_round"` 跳到该轮；`sourceKey` 不变（老数据幂等不受影响）。

### 2.3 受影响的 Muse 意图

无。Muse 钩子照旧；`MUSE_BRIDGE_ENABLED` 打开时项目负责人会同时看到 Muse 出站箱那条（`category=muse_bridge`）和新的站内通知——旁路目前关闭，记入已知局限，不在本 change 去重。

### 2.4 文案真值表（`tracking-notify-pure.test.ts` 逐行一个用例）

| 事件 | 标题 | 摘要 | priority |
|---|---|---|---|
| 报价，字段齐 | `{供应商}报价了 · {项目}` | `第 {n} 轮询价：报价已自动进表，可以去比价了。` | medium |
| 报价，缺字段 | 同上 | `第 {n} 轮询价：报价已自动进表；还缺：{有效期、币种}。` | medium |
| 回信无报价 | `{供应商}回信了，没有报价 · {项目}` | `第 {n} 轮询价：需要你看一眼原文。` | medium |
| 催单待批，只有催单 1 封 | `{供应商}该催了，催单已起草，等你批准 · {项目}` | `第 {n} 轮：超过 {d} 天没回。48 小时内不批会过期。` | high |
| 催单待批，只有催单多封 | `{k} 家供应商该催了，催单已起草，等你批准 · {项目}` | `第 {n} 轮：{甲厂、乙厂}超过 {d} 天没回。48 小时内不批会过期。`（名单超过 3 家写「甲厂、乙厂、丙厂等 k 家」） | high |
| 催单待批，只有追问 | `{供应商}的报价缺{有效期}，追问已起草 · {项目}`（多家：`{k} 家报价缺信息，追问已起草 · {项目}`） | `第 {n} 轮：批准后在原邮件线程里追问。48 小时内不批会过期。` | medium |
| 催单待批，催单 + 追问 | `{k} 封催单 / 追问已起草，等你批准 · {项目}` | `第 {n} 轮：{丙厂、丁厂}超过 {d} 天没回；{甲厂}报价缺{有效期}。48 小时内不批会过期。` | high |
| 未响应，催满两次 | `{供应商}没有回复，已标未响应 · {项目}` | `第 {n} 轮：催了两次仍未回复。可以换一家供应商再问。` | medium |
| 未响应，截止已过 | 同上 | `第 {n} 轮：回复截止已过仍未回复。可以换一家供应商再问。` | medium |

项目名超过 24 字截断加「…」；标题摘要都不得出现金额、单价、币种数值。

### 2.5 Out of scope（T-1）

- 不新增 cron、不改 `tender-rfq-inbound` 节奏；不改 `decideChases` 任何判定。
- 只给「催单待批」加升级邮件；报价 / 回信 / 未响应不加。不改 7 点汇总的规则（新类型天然进汇总）。
- 不给人工录报价、手动「立即催」、审批通过 / 驳回发通知。
- 不改 Muse 钩子与 Muse 出站箱。

### 2.6 验收（T-1）

自动化：
1. `tracking-notify-pure.test.ts`：§2.4 每行一例；脱敏断言（标题摘要无金额 / 数字价格）；去重键格式；收件人组合（负责人 = 发起人时只一条，由 `deliverCollabNotification` 保证，另用注入 deps 的测试覆盖）。
2. `inbound-sync` 既有测试 + 新增「quoted / replied 各调用一次 `notifyTracking`，解析失败与自己发的邮件不调用」（注入 deps）；`runChaseScan` 新增「一轮 2 催单 + 1 追问 → 一条通知；手动 `draftChasesForProject` → 不通知」；`chase-pure` / `chase-execute` 既有测试不回归。
3. 升级邮件既有测试（`collab-email-escalation.test.ts`）增：`rfq_chase_ready` 满 15 分钟未读 → 进候选并发信；`rfq_quote_received` 不进候选；邮件链接指向 `/projects/{id}?tab=bid#rfq-round-{inquiryId}`、正文无金额。
4. `notification-href.test.ts` 增 `tender_rfq_round` 一例；`typecheck`、`lint:baseline`、`test:ci`、`check-test-registry`、`openspec validate --strict` 全过。

staging 手工（用 W-1 发出的一轮）：
5. 用测试邮箱回一封带价邮件 → 10 分钟内负责人铃铛出现「报价了」，点开展开到该轮。
6. 把 `chaseAfterDays` 临时设为 1（个人偏好或组织设置），等一天或把一项的 `sentAt` 在 staging 库里往前调 → 下一个 tick 出现一条「该催了，等你批准」，点开就是审批面板。
7. 「催单待批」出现后 30 分钟内不点开 → 负责人邮箱收到【青砚】升级邮件，点链接直接到该轮审批面板；点开过的不再发。
8. 通知设置里关掉「催单待批」→ 再触发不再出现；7 点汇总邮件里能看到前一天没读的询价通知、无金额。

体感验收：
9. 每条通知读完标题就知道是哪个项目、哪家、要不要我动手；点一下就到能动手的地方（不是项目首页）。

---

## 3. T-2 `rfq-tracker`：一页看清所有在途询价

### 3.1 用户视角

- 招投标中心 `/bids` 最上面多一张卡：**「询价追踪：6 家等回复 · 2 张催单待批 · 本周 3 家已报价」**，点进 `/bids/rfq`。首页 AI 建议里的「供应商未回复」改成准的，按钮「去询价追踪」也到这里。
- `/bids/rfq` 打开默认是 **「需要我处理」**：只列需要动手的——催单卡待批、回信没报价、报价缺字段、过了回复截止还没回的。顶部一排计数：需要我处理 · 等回复 · 已报价 · 未响应，点哪个看哪个。
- 按项目 → 轮次分组；每家供应商一行：**状态 · 发出于 11-06 · 已催 1 次 · 下次自动催 11-09（或「将于 11-12 标未响应」/「催单卡待批」）· 缺：有效期 · 回复截止 11-13**。手工登记发送（没有邮件线程）的行写明「手工联系，系统不会自动催」。
- **已报价的行显示价格**：「报价 USD 89.50 / 件 · 总价 USD 17,900 · 交期 21 天 · 有效至 12-31」，后面是 **「落地价 CAD 24,310」**，本轮落地价最低的那家标 **「最便宜」**；换算不了的写「落地价未换算（缺运费）」，并给「去比价」链接（到该轮比价面板）。落地价与「最便宜」都直接取比价矩阵，和比价面板永远是同一个数。
- 行内按钮：
  - 有待批催单卡 → 原地 **「批准并发送 / 驳回」**（同一轮多张卡有 **「全部批准（3 封）」**）；
  - 在等回复、没有待批卡 → **「现在就催」** → 起草卡（同手动催单规则）→ 立刻在原地出现审批面板；
  - **「打开项目」** → `/projects/{id}?tab=bid#rfq-round-{inquiryId}`。
- 看不到自己没权限的项目；价格的可见范围与项目里的询价明细相同（能看这个项目就能看它的报价，不新增权限）。空状态：「没有在途询价。去项目里点『问供应商要价』」。`/bids` 汇总卡与所有通知 / 邮件仍然不出现金额。

### 3.2 做什么

1. **纯函数 `src/lib/tender-rfq/tracker-pure.ts`**：
   - `nextChaseOutlook(item, { now, chaseAfterDays, replyBy })` → `{ kind: "chase_on", at } | { kind: "no_response_on", at } | { kind: "card_pending" } | { kind: "manual_only" } | { kind: "done" } | { kind: "max_reached_wait", at }`；**必须与 `decideChases` / `decideNoResponse` 一致**：测试对每个用例断言「在 `at` 时刻 `decideChases` 起草 / 标未响应，`at − 1ms` 时 `not_due`」。不改 `chase-pure.ts` 的任何判定，只读它导出的函数与常量。
   - `trackerRowView(...)`：状态标签、各列文案（日期按组织时区，纯日期与 UTC 零点取字面月日——直接用 W-1 `web-entry-pure.monthDay`）。
   - `classifyNeedsAction(row)`：`chase_card_pending` / `reply_no_quote` / `missing_fields` / `past_reply_by` / null。
   - `trackerSummary(rows)`：顶部计数与 `/bids` 卡片文案（只有计数，不含金额）。
   - `quoteCellView(item, matrixRow | null)`：报价列文案——原币种单价 / 总价（千分位、币种码）、交期、有效期；落地价取 `matrixRow.landedCad.total`，`flags` 含 `cheapest` 时标「最便宜」，为 null 时写「落地价未换算（{blockers[0]}）」。**不自己换汇、不自己算落地价。**
2. **服务端 `src/lib/tender-rfq/tracker.ts`**：
   - 复用 `chase-service.ts` 的 `loadItems`（导出；`where` 增加 `projectIds?: string[]`），另查近 14 天的 `no_response`；项目先经 `buildProjectVisibilityWhere(user)` + `orgId` + `workDomain: "tender"` 过滤再取 id。
   - 待批催单卡经 W-1 的 `loadRfqApprovalInfo` 取 `canApprove` / `payloadHash`；正文经 `loadRfqSendEmails`——**扩展它兼容 `tender.send_chase` 的单封 payload**（`{ supplierName, to, subject, body }`）。
   - 每轮的 `chaseAfterDays` 用 `resolveChaseAfterDays(负责人偏好, 组织设置)`（与 cron 同一来源）。
   - 价格：对「至少一家已报价」的轮次调 `compare-service.ts loadCompareMatrix({ projectId, orgId, inquiryId })`，按 `itemId` 对上行；每次请求最多算 50 轮（按最近报价时间），其余轮次只显示原币种报价并写「落地价请到比价面板查看」。响应按白名单组装：只含报价字段与矩阵的 `landedCad` / `flags` / `blockers`，**不含**项目估值、我方报价、毛利、`price_scenario` 结果。
3. **API**：
   - `GET /api/org/tender-rfq/tracker`（`withAuth` + `resolveRequestOrgIdForUser`；`/api/org/` 在 `apiFetch` 的组织作用域前缀里，自动带 `orgId`）→ `{ summary, groups: [{ project, rounds: [{ round, rows }] }], timeZone }`，项目上限 200、行上限 1000，超出返回 `truncated: true`。
   - `POST /api/projects/[id]/tender-rfq/chase`（项目写权限 + zod：`inquiryId`、`itemIds` 1–8）→ `draftChasesForProject({ manual: true })` → 返回新卡（附审批信息与正文）+ `skipped` 的人话原因（`pending_card`「已有一张待批的催单卡」、`max_reached`「已经催过两次」、`no_thread`「这家是手工联系的，没有邮件线程可回复」、`quoted` / `complete`「已经报价，不用催」）。
4. **页面**：`src/app/(main)/bids/rfq/page.tsx`（与 `/bids` 同一个 `canAccessBidWorkspace` 门禁）+ `src/components/bids/rfq-tracker.tsx`；`bids-workspace-shell.tsx` 顶部加汇总卡；「全部批准」顺序调用既有 approve 接口，逐张显示结果（一张失败不影响其它）。
5. **修首页建议**：`scanner.ts checkSupplierNoResponse` 改查 `status: "sent"` 且 `sentAt` 早于「负责人催单天数」（`resolveChaseAfterDays`），`suggestedAction` 改为 `{ type: "open_rfq_tracker", label: "去询价追踪", params: { projectId } }`；`dashboard-ai-suggestions.tsx` 对它跳 `/bids/rfq?project={id}`，并移除 W-1 留下的 `send_followup_email` 兼容分支。
6. **下线死路径**：`POST /api/projects/[id]/inquiries/batch-followup` 返回 410（W-1 已删掉它唯一的调用方；它每次调用都会跑一次 LLM 生成没人用的草稿）（已拍板 ②）。

### 3.3 受影响的 Muse 意图

`chase`：不改；`draftChasesForProject` 只多一个调用方。`loadItems` 导出并加 `projectIds` 过滤，Muse 与 cron 不传该参数，行为不变（测试覆盖）。

### 3.4 Out of scope（T-2）

- 不改 `decideChases` / `decideNoResponse` / 催单天数规则 / 催单模板；不改比价矩阵与落地价换算。
- 不在追踪页显示项目估值、我方报价、毛利、价格情景；不做导出 Excel；不做「换一家供应商」一键补询（属 `rfq-add-supplier-to-round`）。
- 不做询价日报（T-3）；不改审批中心。

### 3.5 验收（T-2）

自动化：
1. `tracker-pure.test.ts`：`nextChaseOutlook` 与 `decideChases` 的一致性表（未催 / 催过一次 / 催满两次 / 截止已过 / 有待批卡 / 被驳回过 / 手工联系 / 已报价缺字段）；`classifyNeedsAction` 每类一例；`trackerSummary` 文案；日期跨时区不差一天。
2. `quoteCellView`：齐全 / 缺落地价参数 / 最便宜 / 只有总价 / 只有单价各一例；用同一轮的 `buildCompareMatrix` 结果做对照，追踪页的落地价与「最便宜」和矩阵逐家一致；响应白名单断言（不含 `estimatedValue` / `ourBidPrice` / `winningBidPrice` / `margin`）。
3. `chase-service` 的 `loadItems` 不传 `projectIds` 时与改前同结果（注入或快照测试）；scanner 新测试：`sent` 超期被提醒、`pending` 不提醒。
4. 门禁同 T-1；`grep -rn '"contacted"' src/lib/proactive src/app/api/projects` 为空。

staging 手工：
4. `/bids` 汇总卡数字 = 追踪页顶部计数；点进去默认「需要我处理」。
5. 一家 3 天没回、cron 已起草催单 → 追踪页该行显示「催单卡待批」，原地「批准并发送」后该行变「已催 1 次 · 下次自动催 MM-DD」。
6. 另一家点「现在就催」→ 卡立即出现在原地，批准后测试邮箱在原询价线程里收到催单。
7. 用一个只能看其中一个项目的账号打开 → 只看到那个项目。
8. 首页 AI 建议「供应商未回复」列的是真正在等回复的那几家，点「去询价追踪」到对应项目分组。
9. 两家报价进表后，追踪页显示的落地价与该轮比价面板完全一致，「最便宜」标在同一家；缺运费的那家写明「落地价未换算（缺运费）」。

体感验收：
10. 从打开 `/bids/rfq` 到批完今天所有该催的卡，不离开这一页、不超过 3 次点击 / 每轮。
11. 每一行都能回答三个问题：现在什么状态、系统下一步会做什么（哪天）、要不要我动手。

---

## 4. 与八条硬纪律

| 纪律 | T-1 | T-2 |
|---|---|---|
| 1 零 schema | 新类型是字符串；通知写既有 `Notification` | 只读 + 复用 PendingAction；无字段无迁移 |
| 2 出站先审批 | 通知与升级邮件都是发给本组织 active 成员自己青砚账号的提醒（config 第 2 条澄清），不算对外；7 点汇总是既有机制 | 「现在就催」只建 `tender.send_chase`，批准走审批中心既有接口 |
| 3 禁止第三套队列 | 挂在既有 `tender-rfq-inbound` tick 里，不新增 cron | 不新增 cron；「全部批准」是前端顺序调用 |
| 4 脱敏 | 标题摘要与升级邮件无金额，过 `collab/redact` | 追踪页是内部页面，显示供应商报价与落地价（可见范围 = 项目询价明细；决定 A 只约束 Muse 通道）；SHALL NOT 显示项目估值、我方报价、毛利；`/bids` 汇总卡无金额 |
| 5 不爬登录页 | 不涉及 | 不涉及 |
| 6 邮箱分离 | 不涉及 | 不涉及（催单执行器不改） |
| 7 确定性优先 | 全部查表，零 LLM | 全部查表，零 LLM；下线 batch-followup 反而少一处 LLM |
| 8 测试注册 | 新测试注册 `test-all.sh` + `test-ci-unit.sh` | 同左 |

---

## 5. 实施时必须一并做到（W-1 踩过的坑，直接照做）

1. **通知类型注册**：新类型必须同时进 `NOTIFICATION_TYPE_KEYS`、`NOTIFICATION_TYPE_LABELS`、`TYPE_INTRODUCED_AT`（哨兵 `9999-12-31`），否则保存过偏好的老用户会被判为「显式关闭」，静默收不到。
2. **组织作用域**：`apiFetch` 只给 `/api/org/`、`/api/capabilities` 等前缀自动带 `orgId`，`/api/projects/*` 不带。跨项目接口放 `/api/org/` 下；在项目接口里取审批能力要按项目所属企业解析（W-1 `web-entry-approval.ts` 的做法）；前端调 approve / reject 显式带 `?orgId=`。
3. **判定一致性**：页面上说「下次自动催 11-09」，cron 必须真在 11-09 起草——用 `decideChases` 做对照测试，不要另写一套天数逻辑。
4. **日期**：回复截止 `ProjectInquiry.dueDate` 存的是 UTC 零点，多伦多直接换算会差一天；统一用 `web-entry-pure.monthDay`。
5. **审批是同步执行**：approve 响应里就是「已发出」结果，不要轮询；有了决策结果就隐藏按钮，结果文字留在行上直到关掉。
6. **Next.js 路由文件**只导出 HTTP 方法；常量放到 lib。
7. **错误文案**：不出现错误码、英文原文；Gmail 授权类错误转人话（`web-entry-pure.friendlyExecutionError`）。
8. **不声称没做的事**：没有发通知就不写「已通知」；`skipped` 原因要如实说。
9. **价格只有一个出处**：追踪页的落地价、「最便宜」必须直接取比价矩阵（`loadCompareMatrix` / `buildCompareMatrix`），不另写换汇或排序；和比价面板对不上就是 bug。

---

## 6. 任务拆分（每个 change ≤ 8 条，最后一条固定写报告 + 改 TASKFLOW）

**T-1**：① 类型注册 + `tracking-notify-pure.ts` + 测试 ② `tracking-notify.ts` + 入站挂钩（`deps.notifyTracking`）+ 测试 ③ 催单扫描挂钩 + 测试 ④ `href.ts` + 首屏锚点展开 ⑤ 催单待批升级邮件（`ESCALATION_TYPES`）+ 既有两条入站提醒改类别 ⑥ 门禁 + 独立审查 ⑦ `docs/QINGYAN_T-1_REPORT.md` + TASKFLOW。

**T-2**：① `tracker-pure.ts`（含 `quoteCellView`）+ 一致性测试 ② `loadItems` 导出 + `projectIds` + `tracker.ts`（含比价矩阵取价）③ `GET /api/org/tender-rfq/tracker` + `POST …/tender-rfq/chase` + 催单正文兼容 ④ `/bids/rfq` 页面 + `/bids` 汇总卡 ⑤ scanner 修正 + 首页建议跳转 + batch-followup 410 ⑥ 门禁 + 独立审查 ⑦ `docs/QINGYAN_T-2_REPORT.md` + TASKFLOW。

---

## 7. 禁止事项

- 禁止修改 `decideChases` / `decideNoResponse` / `execute.ts` / `chase-execute.ts` / `inbound-parse.ts` 的判定与发送逻辑。
- 禁止绕过 `deliverCollabNotification` 直接 `createNotification` 给多人发（单人系统提醒除外，且须登记类型）。
- 禁止通知标题 / 摘要 / 升级邮件 / 7 点汇总 / `/bids` 汇总卡出现金额；追踪页 SHALL NOT 出现项目估值、我方报价、毛利、价格情景。
- 禁止追踪页自行换汇或计算落地价。
- 禁止新增 cron、队列、轮询；禁止新增 LLM 调用。
- 禁止手写 `openspec/specs/**`；一个 change 一个 PR；合并后再 archive。

---

## 8. 已拍板（Evan，2026-11-07）

| # | 问题 | 拍板 | 落到哪里 |
|---|---|---|---|
| 1 | 「催单待批」要不要 15 分钟没读就发邮件？ | **要** | T-1 §2.2 第 6 条：`ESCALATION_TYPES` 加 `rfq_chase_ready`；只此一类，报价 / 回信 / 未响应不发 |
| 2 | `batch-followup` 接口是否下线？ | **直接下线（410）** | T-2 §3.2 第 6 条 |
| 3 | 追踪页要不要显示价格？ | **显示** | T-2 §3.1 / §3.2：原币种报价 + 比价矩阵的落地价与「最便宜」；可见范围同询价明细；通知 / 邮件 / `/bids` 汇总卡仍不出金额 |

## 9. 之后（不在本任务书）

- **T-3 询价日报**：7 点汇总里单独一段「今天到期回复 / 昨天新报价 / 待批催单」——等 T-1 / T-2 跑一周，看汇总邮件够不够用再决定。
- **R-1 研究简报**：替掉「ChatGPT 查资料」（纪律 7 例外已拍板）。
