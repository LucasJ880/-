# W-1 任务书：`rfq-web-entry` — 在项目页「问供应商要价」，一键生成、原地审批、自动发出

| 项 | 值 |
|---|---|
| change 名 | `rfq-web-entry` |
| TASKFLOW ID | 新增 **W-1**（Phase W「先把已建好的用起来」，表加在 Phase 1 之后）；同时让 P1-1～P1-8 的「待 GATE-1 联调」有了 Web 版 GATE |
| 动机 | `prepareRfqRound` 的唯一调用方是 `src/lib/muse-bridge/router.ts handleRfq`；Muse Connector 已冻结（已决定第 10 条）→ 整条 RFQ 线在 Web 上没有入口。旧的单封直发路径 `items/[itemId]/email/send` 绕过 PendingAction（违反纪律 2）且不写 threadId，回信永远不会被 `tender-rfq-inbound` 认领 |
| 依赖 | 无（P1-1～P1-8 已合并） |
| 执行者 | Claude Code：`/opsx:propose rfq-web-entry` → 四件套回传审 → `/opsx:apply` → `npm test` → `/opsx:verify` → PR |
| 审核 | Claude（chat）；Evan 拍板合并 |
| 已拍板 | 2026-11-06：① 保留 `MUSE_BRIDGE_ENABLED` 旁路，Web 与 Muse 并存；③ 旧 `email/send` 直接下线。2026-11-07：创建人可以批准自己发起的对外询价（Web 建的卡不指定审批人，按审批中心 `canDecidePending` 规则，与 Muse 路径一致），不另开「对外邮件不能自批」change；§6 第 9 步已按此改写 |

---

## 0. 先读

- `openspec/config.yaml` `context:`（八条硬纪律）与 `rules:`
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase 1 表、GATE-1 验收、「已决定」第 6/7/8/10 条
- `src/lib/tender-rfq/service.ts`（`PrepareRfqInput` / `PrepareRfqResult` / `prepareRfqRound`）、`round-pure.ts`（`decideRoundLock`、`readTenderRfqSettings`）、`execute.ts`（`execTenderSendRfq`）
- `src/lib/muse-bridge/prefs-pure.ts`（`readUserPrefs` / `pickRfqSuppliers` / `pickRfqIncoterm`）—— Web 入口复用同一套偏好
- `src/components/inquiry/project-inquiry-section.tsx`、`inquiry-detail.tsx`、`email-draft-dialog.tsx`（要下线的那条）
- `src/lib/capabilities/approvals/adapters.ts`（`canDecide` / `canApprove`）与 `POST /api/capabilities/approvals/[approvalId]/approve`
- `src/app/api/projects/[id]/inquiries/route.ts`（鉴权写法：`requireProjectReadAccess` / `requireProjectWriteAccess`）
- `docs/招投标四步路径整合方案-2026-11-06.md` §6b「体感原则」

---

## 1. 用户视角：这个 change 做完之后用户会经历什么

**场景**：Evan 打开一个 `workDomain=tender` 项目 → 「标书与报价」tab。

1. 顶部有一个主按钮 **「问供应商要价」**。按钮旁一行小字实时说明现在能不能发：
   - 能发：`将从 project@sunnyshutter.ca 发出 · 已确认要求 12 条 · 回复截止约 11-13`
   - 不能发（按钮禁用，灰字写原因 + 链接）：
     - `第 2 轮 11-04 刚发出，3 天内不开新轮 → 查看第 2 轮`（轮次锁）
     - `有一张待批准的发送卡 → 去批准`（有 pending/approved 的 `tender.send_rfq`）
     - `还没有已确认的要求 → 去「需求」tab 确认`
     - `授权邮箱 lucas@ 未连接 Gmail → 去设置`
2. 点按钮 → 右侧抽屉「发起第 N 轮询价」，一屏看完三块：
   - **问哪几家**：组织 active 供应商多选；常用供应商（偏好 `defaultSupplierIds`）默认勾选并标「常用」；没邮箱的灰显 + `补邮箱` 链接（跳 `/suppliers/[id]`），不可勾。
   - **条款**：Incoterm 下拉（默认偏好 `defaultIncoterm`，标「默认」）、目的地（可空）、补充说明（可空）、附加问题（可选，折叠，最多 5 条）。
   - **会发出什么**：发件人抬头 + 地址、回复截止日、「将包含 N 条已确认要求；M 条因未确认 / 不面向供应商不会发出」。
   - 底部一个按钮 **「生成并送审」**。
3. 点「生成并送审」→ 2 秒内抽屉变成结果页：
   - 成功：`第 N 轮询价已生成，等待批准后发出` + 每家一行（供应商 · 收件邮箱 · 展开看正文）。
     - 如果我有权批（`canApprove`）：原地两个按钮 **「批准并发送」/「驳回」**，不跳页。
     - 如果我没权批：`已通知 王某（组织管理员）批准`，附「去审批中心看」链接。
   - 失败：一句人话 + 一个能点的出路（见 §2.4 文案表），绝不出现 errorCode。
4. 批准后 → 抽屉关闭，轮次卡片变成 **「第 N 轮 · 已发出 N 家 · 等回复（截止 11-13）」**，每家一行显示发出时间；卡片底部一行：`回信会自动进表（每 10 分钟检查一次）；3 天没回会自动起草催单给你批`。
5. 卡片右上角显示 **「从发起到发出：4 分 12 秒」**（用 PendingAction 的 `createdAt` 与执行时间算，零 schema），这是 TASKFLOW 度量「决定询价 → RFQ 发出 ≤ 5 min」的现场版。

**不再有的**：`inquiry-detail.tsx` 每家供应商旁的「邮件」按钮（单封直发）消失。「标记发送」保留（给电话 / 微信线下联系的手工登记用，它不出站）。

---

## 2. 做什么（What，每条可验证）

### 2.1 服务层（最小改动）
- `PrepareRfqInput` 加 `source: "web" | "muse"`（必填）。轮次标题从硬编码 `第 N 轮询价（Muse）` 改为 `第 N 轮询价`，`source` 写进 `ProjectInquiry.scope` 末尾不合适 → 写进 PendingAction `source.toolName`（`tender_send_rfq_web` / `tender_send_rfq`）与 AuditLog。`muse-bridge/router.ts handleRfq` 传 `source: "muse"`，**其余零改动**。
- 新增纯函数 `src/lib/tender-rfq/web-entry-pure.ts`：
  - `decideRfqEntryState(input)` → `{ enabled: boolean; reason?: EntryBlockReason; hint: string; link?: string }`。输入：`decideRoundLock` 结果、待批发送数、已确认要求数、Gmail 授权状态。**查表，零 LLM**。
  - `rfqErrorToUserMessage(errorCode, ctx)` → `{ message: string; action?: { label: string; href: string } }`，覆盖 `PrepareRfqResult` 全部 7 个 errorCode。
  - `elapsedLabel(createdAt, sentAt)` → `从发起到发出：4 分 12 秒`。

### 2.2 API（两条，鉴权同 `inquiries/route.ts`）
- `GET /api/projects/[id]/tender-rfq/entry`（`requireProjectReadAccess`）→
  ```json
  { "state": { "enabled": true, "hint": "...", "link": null },
    "suppliers": [{ "id", "name", "contactEmail", "ready": true, "blockedReason": null, "isDefault": true }],
    "defaults": { "incoterm": "DDP", "incotermFromPrefs": true },
    "preview": { "fromName", "fromEmail", "replyBy", "confirmedRequirementCount", "excludedCount" },
    "pendingSend": { "actionId", "roundNumber" } | null }
  ```
  `excludedCount` 来自 `buildRfqDocument` 的 dry-run（不建轮次、不建审批）；若 build 本身就会失败（`NO_CONFIRMED_REQUIREMENTS` / `SENSITIVE_LEAK`），`state` 直接禁用并给原因。
- `POST /api/projects/[id]/tender-rfq/rounds`（`requireProjectWriteAccess`）body 用 zod：`{ supplierIds: string[] (1–8), incoterm?, destination?, scopeNote?, extraQuestions?: string[] (≤5), quantityTiers?: number[] }` → 调 `prepareRfqRound({ ...body, source: "web", projectId, orgId, userId })` → 原样返回 `PrepareRfqResult`，外加 `approval: { approvalId, canApprove, approverNames: string[] }`（复用 `capabilities/approvals/adapters.ts` 的 `canDecide` 判定，**不新写权限逻辑**）。
- 批准 / 驳回：前端直接调既有 `POST /api/capabilities/approvals/[approvalId]/approve|reject`，不新增路由。

### 2.3 UI
- `project-inquiry-section.tsx`：顶部「新建询价轮次」按钮改为主按钮「问供应商要价」+ 状态小字（来自 `GET …/entry`）。原「新建询价轮次」（建空轮次手工加条目）降级为次级文字链接「手工建一轮」，保留给线下场景。
- 新组件 `src/components/inquiry/rfq-web-entry-drawer.tsx`：三块表单 → 结果页 → 原地审批。
- 新组件 `src/components/inquiry/rfq-round-status-line.tsx`：轮次卡片上的「已发出 N 家 · 等回复（截止 …）」+ 耗时标签 + 「回信自动进表 / N 天没回自动催」说明行（催单天数读 `settingsJson.tenderRfq.chaseAfterDays` 与个人偏好，同 `chase-pure`）。
- `inquiry-detail.tsx`：移除 `key="email"` 动作与 `EmailDraftDialog` 引用；删除 `email-draft-dialog.tsx`。
- 批准成功后轮询该轮次状态直到 `in_progress`（最长 60 秒，每 3 秒），再刷新卡片；超时显示「已批准，正在发出…稍后刷新」而不是卡住。

### 2.4 文案表（纯函数的真值表，直接当测试用例）

| 情形 / errorCode | 用户看到 | 出路链接 |
|---|---|---|
| 轮次锁 `ROUND_LOCKED` | 第 {n} 轮 {date} 刚发出，{days} 天内不开新轮。 | 查看第 {n} 轮（锚到该轮卡片） |
| 有待批发送 | 第 {n} 轮还有一张待批准的发送卡。 | 去批准（原地展开 / 审批中心） |
| `NO_CONFIRMED_REQUIREMENTS` | 还没有已确认的要求，询价单会是空的。 | 去「需求」tab 确认要求 |
| `SENSITIVE_LEAK` | 要求里含有不能发给供应商的内容（如我方价格），本轮整单不发。 | 去「需求」tab 查看被拦的要求 |
| `NO_SUPPLIERS` | 还没选供应商。 | — |
| `SUPPLIERS_NOT_READY` | {names} 还发不了：{没有邮箱 / 已停用}。 | 补邮箱（供应商页） |
| Gmail 未授权 | 授权邮箱 {mailboxEmail} 还没连接 Gmail（需要发信 + 读回信两个权限）。 | 去设置 → 连接 Gmail |
| `PROJECT_NOT_FOUND` | 这个项目不是投标项目，或你没有权限。 | 返回项目列表 |
| `DRAFT_FAILED` | 生成审批草稿没成功，请重试；再不行把这个时间告诉管理员。 | 重试 |

### 2.5 下线单封直发（已拍板 ③）
- `src/app/api/projects/[id]/inquiries/[inquiryId]/items/[itemId]/email/send/route.ts` 与 `…/email/generate/route.ts`：`POST` 返回 **410** `{ error: "单封直发已下线，请用项目页「问供应商要价」" }`。不删文件（保留路由做显式 410，避免 404 让人以为是网络问题）。
- 保留 `src/lib/ai/prompts/sales.ts getEmailDraftPrompt` 与 `src/lib/agent/skills/email-draft.ts`（agent 工具 `project_inquiry_email_draft` 仍用它起草，不出站）。
- `ProjectEmail` 表与 `projectEmail` 读路径不动。

### 2.6 文档
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：新增 Phase W 表（W-1 / W-2 / W-3 三行，W-1 状态随 PR），GATE-1 验收下加一行「Web 版：从 bid tab 点『问供应商要价』到三家报价进表，人工手录字段 = 0」。
- `docs/QINGYAN_W-1_REPORT.md`：完成报告（含 staging 一轮真实发送的截图或日志摘录）。

---

## 3. 受影响的 Muse 意图

`rfq`（只多传 `source: "muse"`，响应不变）。`status` / `next_step` 读轮次状态，轮次标题去掉「（Muse）」后文案无影响（它们不依赖标题）。其它意图不涉及。

---

## 4. Out of scope（本次不做）

- 往**已发出的轮次追加一家供应商**（`prepareRfqRound` 只建新轮，轮次锁会挡）→ 单独 change `rfq-add-supplier-to-round`。
- RFQ 设置页（fromEmail / mailboxEmail / 落地成本 FX）→ W-2。
- 比价结果进定价助手 → W-3。
- 入站 / 催单事件的站内通知 → T-1；跨项目追踪页 → T-2。
- 不改 `execute.ts` 发送逻辑、不改 `chase-*`、不改 `inbound-*`。
- 不改审批中心页面与权限模型；不新增 PendingAction 类型。

---

## 5. 与八条硬纪律

| 纪律 | 本 change |
|---|---|
| 1 零 schema | 不加字段；`source` 落 PendingAction `source.toolName` 与 AuditLog；耗时用既有时间戳算 |
| 2 出站先审批 | 完全复用 `tender.send_rfq`；下线绕过审批的 `email/send`；UI 的「批准并发送」调既有审批接口 |
| 3 禁止第三套队列 | 不新增 cron / queue；前端轮询只在抽屉打开期间、最长 60 秒 |
| 4 脱敏 | Web 是内部页面，决定 A 不适用；`buildRfqDocument` 的敏感词整单拦截不变 |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 显示 `fromEmail`、发送用 `mailboxEmail`，均从组织设置读；Gmail 授权状态按 `mailboxEmail` 对应用户查 |
| 7 确定性优先 | 入口状态、错误文案、耗时标签全部查表；零新增 LLM 调用 |
| 8 测试注册 | `web-entry-pure.test.ts` 注册进 `scripts/test-all.sh` |

---

## 6. 验收（Claude 审 + Evan 在 staging 走一遍）

**自动化**
1. `web-entry-pure.test.ts`：§2.4 真值表每行一个用例；`decideRfqEntryState` 四种禁用原因各一例 + 可发一例；`elapsedLabel` 边界（< 1 分钟 / > 1 小时）。全部注册进 `npm test`。
2. `npm run typecheck`、`npm run lint:baseline` 通过；`openspec validate rfq-web-entry` 通过。
3. 既有 `tender-rfq/__tests__/*` 与 `muse-bridge/__tests__/*` 全过（`source` 字段不破坏 Muse 路径）。

**staging 手工（GATE-W，Evan）**
4. 打开一个已确认要求的 tender 项目 → bid tab 按钮可用、小字显示发件人与已确认要求数。
5. 点「问供应商要价」→ 默认勾上常用供应商、Incoterm 默认值带「默认」标；一家没邮箱的供应商灰显并有「补邮箱」链接。
6. 「生成并送审」→ 结果页列出每家收件人，能展开看正文；作为 org_admin 看到「批准并发送」。
7. 点「批准并发送」→ 60 秒内卡片变「已发出 N 家 · 等回复」，供应商测试邮箱收到来自 project@ 的 text/plain 邮件；卡片出现「从发起到发出：x 分 x 秒」。
8. 立刻再点「问供应商要价」→ 按钮禁用，小字「第 N 轮刚发出，3 天内不开新轮 → 查看第 N 轮」。
9. 用一个 org_member 账号重复 6 → 作为创建人看到「批准并发送」，可以批准自己发起的询价（2026-11-07 拍板）；换一个没有审批权限、也不是创建人的账号打开同一张待批轮次 → 看到「需要组织管理员批准 → 审批中心」，没有批准按钮。
10. 从测试供应商邮箱回一封含单价的邮件 → 10 分钟内该供应商行变「已报价」，字段自动填入（人工手录 = 0）。
11. 旧接口：`POST …/items/{itemId}/email/send` 与 `…/email/generate` 返回 410；`inquiry-detail` 里没有「邮件」按钮，仍有「标记发送」。
12. Muse 旁路：`MUSE_BRIDGE_ENABLED=1` 的环境里 `rfq` 意图响应与改动前一致（对比一次 `muse-bridge-pure.test.ts` 的快照即可）。

**体感验收（§6b 六条逐条）**
13. 没有任何情形是「填完表才告诉你不能发」——四种禁用原因都在按钮上。
14. 送审后页面上同时能看到：发生了什么（第 N 轮已生成）、下一步（等批准 / 批准并发送）、在等谁（X 批准）。
15. 审批人全程不离开项目页。
16. 错误文案里不出现 errorCode、英文枢纽词、函数名。

---

## 7. 禁止事项

- 禁止在 UI 或 API 里绕过 `prepareRfqRound` 自己拼 RFQ 或自己建 PendingAction。
- 禁止新增 LLM 调用（包括「帮我润色补充说明」之类的小功能）。
- 禁止改 `execute.ts` / `chase-*` / `inbound-*`。
- 禁止删除 `email/send`、`email/generate` 路由文件（改为 410，不是 404）。
- 禁止手写 `openspec/specs/**`；禁止把 `.claude/` 或 `openspec/` 加进 `.gitignore`。
- tasks ≤ 8 条；最后一条固定是「写 `docs/QINGYAN_W-1_REPORT.md` + TASKFLOW 加 Phase W 表并更新 W-1 状态」。
