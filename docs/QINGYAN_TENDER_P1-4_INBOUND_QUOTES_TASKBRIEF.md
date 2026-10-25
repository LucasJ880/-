# P1-4 任务书：供应商回信入站 → 报价自动入表

| 项 | 值 |
|---|---|
| 编号 | P1-4（taskflow：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`） |
| 目标 | 供应商回复 `project@sunnyshutter.ca` 的询价邮件后，青砚自动读信、解析报价、写进 `InquiryItem`，缺什么如实标出来，并通过 Muse 事件告诉项目负责人 |
| 依赖 | P1-3 已合并（`tender-rfq/execute.ts` 发信时把 Gmail `messageId` 记进 `InquiryItem.contactNotes`） |
| 执行者 | Claude Code（本文是你的全部规格；有歧义按"禁止事项"和"验收用例"裁决，不要自行扩大范围） |
| 审核 | Claude（chat）审 PR；GATE-1 在 P1-5/P1-6 完成后统一验收 |

---

## 0. 先读这些文件（不读不要动手）

- `src/lib/google-email.ts` — OAuth、`getEmailProvider`、`sendGmail`、`EMAIL_SCOPES`（**现在只有 gmail.compose，读信需要加 scope，见 §2.1**）
- `src/lib/tender-rfq/execute.ts` — 发信后 `contactNotes` 里写了 `Gmail messageId=<id>`；P1-4 要改成写 `threadId`（§2.2）
- `src/lib/inquiry/service.ts` — `recordQuote` / `markItemReplied`、`ITEM_STATUS`、状态机 `canTransitionItem`
- `src/lib/muse-bridge/hooks.ts` — `museOnInquiryReplied` / `museOnQuoteRecorded` 已存在，直接调用，不要重写
- `src/lib/supplier/brochure-parser.ts` — PDF 文本提取（pdf-parse）；DOCX 用 `mammoth`、XLSX 用 `xlsx`（package.json 已有）
- `src/app/api/cron/inquiry-sla/route.ts` + `src/lib/cron/auth.ts` + `src/lib/automation/runner.ts` — cron 的鉴权与追踪写法，照抄
- `src/lib/tender-understanding/` 的 Evidence Verifier 思路：**结论必须能回指原文片段**

---

## 1. 范围

**做：**
1. 定时拉取 `project@sunnyshutter.ca` 收件箱里属于已发询价线程的新回信（轮询，不用 Pub/Sub push，理由见 §2.1）。
2. 把每封回信（正文 + 附件 PDF/DOCX/XLSX/图片）解析成结构化报价，带原文证据。
3. 写入 `InquiryItem`：只填空字段，不覆盖人工已录的值；解析证据与原文片段追加到 `quoteNotes`。
4. 触发已有的 Muse 事件 hook（`reply.received` / `quote.parsed` / `missing_fields`）。
5. 可观测：每封信的处理结果落 AuditLog，可重放、幂等。

**不做（留给后续编号）：**
- 币种/Incoterm/落地成本归一化 → P1-5
- 比价矩阵与 `compare` 意图 → P1-6
- 自动追问/催单邮件 → P1-7（本任务只**标记**缺字段，不发任何邮件）
- Pub/Sub push 通知 → 以后按需，不在本任务

---

## 2. 设计决定（已定，不要再讨论）

### 2.1 轮询，不用 Gmail push
Gmail `users.watch` 需要 GCP Pub/Sub topic + 公网 webhook + 7 天续订，运维面太大。本任务用 **`users.history.list`（startHistoryId 游标）+ Vercel cron 每 10 分钟**，与仓库现有 `service-inbox-sla` 同频。游标存零 schema：`EmailProvider` 没有 settings 列，存到 `Organization.settingsJson.tenderRfq.inbound = { historyId, lastSyncAt }`。

**scope 变更**：读信需要 `https://www.googleapis.com/auth/gmail.readonly`。把它加进 `EMAIL_SCOPES`，并在 `getGmailReauthUrl` 路径上让已授权用户能增量授权；`hasGmailReadScope(grantedScopes)` 新增一个判断函数，缺 scope 时 cron 跳过并写一条 `muse_bridge` 分类的站内通知提醒"请重新授权 Gmail 读取权限"（只提醒一次/天，用 sourceKey 去重）。

### 2.2 线程匹配，不靠主题
P1-3 发信时只记了 `messageId`。改 `execute.ts`：`sendGmail` 返回值里加 `threadId`（`messages.send` 响应有 `threadId`），`contactNotes` 改写成 `Gmail messageId=<id> threadId=<tid> · <iso>`，并同时把 `threadId` 存到 `InquiryItem.contactNotes` 可解析的前缀。入站匹配规则：**回信的 `threadId` 命中某个 `InquiryItem`** → 归属该 item；命不中的信一律忽略（不做模糊匹配、不按发件人猜）。

### 2.3 解析：LLM 只负责"读"，代码负责"信不信"
- 先用确定性代码把正文/附件转成纯文本（PDF→pdf-parse，DOCX→mammoth，XLSX→`xlsx` 转 CSV 文本，图片→本任务**不 OCR**，只记录"有图片附件未解析"）。
- 再调 `createCompletion`（`workflow: "tender_rfq_inbound_parse"`，`temperature: 0`）输出 **严格 JSON**，schema 在 §3。
- 每个字段必须附 `evidence`：原文逐字片段（≤ 200 字）。**代码校验 evidence 是否逐字出现在纯文本里（去空白后比较）；不出现 → 该字段作废，当作未填。** 这是 Evidence Verifier 的同款硬闸。
- 价格只接受带数字的明确报价；"面议 / 待定 / 看数量" → `unitPrice/totalPrice` 为 null，并进 `missingFields`。

### 2.4 写入规则（不覆盖、不猜）
| 字段 | 规则 |
|---|---|
| `unitPrice` / `totalPrice` | 原值为 null 才写；有多档价时取**与询价第一档数量**对应的那档，其它档写进 `quoteNotes` |
| `currency` | 解析到就写；解析不到保持原默认 `CAD` **且**把 `currency` 列入 `missingFields`（默认值 ≠ 供应商说了） |
| `deliveryDays` | 只接受"天"或可换算的"周/月"；"现货"写 0 |
| `validUntil` | 只接受明确日期；"30 天有效"按邮件日期 +30 天换算并在 notes 注明"由邮件日期推算" |
| `quoteNotes` | 追加一段：`[auto <iso> msg=<messageId>] 字段=值（证据："…"）…；缺：…；附件：…`；永不覆盖原有 notes |
| 状态 | 有任一价格字段 → `recordQuote`（状态机到 `quoted`）；无价格但有回信 → `markItemReplied`（状态机到 `replied`） |

### 2.5 幂等与重放
- 以 Gmail `messageId` 为幂等键：AuditLog `targetType="rfq_inbound_message"`, `targetId=messageId`，已存在则跳过。
- 同一 item 多封回信：每封都处理，但写入仍遵守"只填空"，后到的信不覆盖先到的值；差异写进 notes。
- 处理失败（解析异常、附件损坏）：AuditLog 记 `action="rfq_inbound:failed"`，游标照常前进，不卡住后面的信；失败的信在下次 cron **不重试**（避免死循环），改为站内通知"有一封回信解析失败，请手工录入"。

---

## 3. 解析输出 schema（zod，放 `src/lib/tender-rfq/inbound-contract.ts`）

```ts
export const inboundQuoteSchema = z.object({
  contractVersion: z.literal("tender-rfq-inbound/v1"),
  isQuote: z.boolean(),                       // false = 只是回复（如"收到，明天给你"）
  declined: z.boolean(),                      // 明确拒绝报价
  currency: z.string().length(3).nullable(),
  prices: z.array(z.object({
    quantity: z.number().positive().nullable(),
    unitPrice: z.number().positive().nullable(),
    totalPrice: z.number().positive().nullable(),
    evidence: z.string().min(1).max(200),
  })).max(10),
  deliveryDays: z.number().int().min(0).nullable(),
  deliveryEvidence: z.string().max(200).nullable(),
  validUntil: z.string().date().nullable(),   // YYYY-MM-DD
  validUntilEvidence: z.string().max(200).nullable(),
  moq: z.number().positive().nullable(),
  incoterm: z.enum(["EXW","FOB","CIF","DDP","DAP"]).nullable(),
  incotermEvidence: z.string().max(200).nullable(),
  mandatoryAnswers: z.array(z.object({        // 对应 RFQ Q1 逐条回复
    requirementCode: z.string(),
    answer: z.enum(["满足","部分满足","不满足","未答"]),
    evidence: z.string().max(200).nullable(),
  })).max(60),
  missingFields: z.array(z.enum(["price","currency","deliveryDays","validUntil","moq","incoterm"])),
  attachmentsSeen: z.array(z.object({ filename: z.string(), parsed: z.boolean() })),
}).strip();
```
`.strip()` + 版本字面量，reader fail-closed（与 `muse-bridge/contract.ts` 同纪律）。

---

## 4. 文件清单

| 文件 | 内容 |
|---|---|
| `src/lib/google-email.ts` | `EMAIL_SCOPES` 加 readonly；`hasGmailReadScope`；`sendGmail` 返回 `{ messageId, threadId }`；新增 `listThreadReplies(userId, { sinceHistoryId })` 与 `getMessageWithAttachments(userId, messageId)`（返回正文文本 + 附件 buffer，base64 解码；深度注入：`deps.getGmail` 与现有一致，便于测试） |
| `src/lib/tender-rfq/execute.ts` | `contactNotes` 写 `threadId` |
| `src/lib/tender-rfq/inbound-contract.ts` | §3 schema + `verifyEvidence(text, evidence)` 纯函数 |
| `src/lib/tender-rfq/inbound-parse.ts` | 纯文本化（pdf/docx/xlsx）+ LLM 调用 + 证据校验，导出 `parseInboundQuote(input) → ParsedQuote`；LLM 调用通过 `deps.complete` 注入 |
| `src/lib/tender-rfq/inbound-apply.ts` | 纯函数 `planInquiryItemUpdate(existingItem, parsed, rfqFirstTierQty, emailDate) → { data, notesAppend, missingFields, transition: "quoted" \| "replied" \| "none" }`（§2.4 全部规则在这里，**无 DB**） |
| `src/lib/tender-rfq/inbound-sync.ts` | 编排：读游标 → history.list → 过滤线程命中 → 取信 → parse → plan → `recordQuote`/`markItemReplied` → hooks → AuditLog → 写游标 |
| `src/app/api/cron/tender-rfq-inbound/route.ts` | `requireCronSecret` + `runTrackedAutomation`，`maxDuration = 120` |
| `vercel.json` | 加 `/api/cron/tender-rfq-inbound`，`*/10 * * * *` |
| `src/lib/tender-rfq/__tests__/inbound-apply.test.ts` | 纯逻辑测试（§5 用例全部要有） |
| `src/lib/tender-rfq/__tests__/inbound-parse.test.ts` | 注入假 `complete`，验证证据校验会作废编造字段 |
| `docs/QINGYAN_TENDER_P1-4_INBOUND_QUOTES_REPORT.md` | 完成报告：做了什么、没做什么、怎么验、已知限制 |

---

## 5. 验收用例（测试里必须逐条出现）

1. 回信"单价 CAD 42.50/个，1500 个，交期 35 天，报价有效至 2026-11-30" → `unitPrice=42.5, currency=CAD, deliveryDays=35, validUntil=2026-11-30`，`missingFields=[]`，状态 `quoted`。
2. 回信只说"收到，周五前给你报价" → `isQuote=false`，状态 `replied`，不写任何价格，触发 `reply.received`。
3. 回信"价格面议" → 价格 null，`missingFields` 含 `price`，状态 `replied`（不是 quoted），触发 `missing_fields`。
4. 回信报价但没写币种 → `currency` 保持默认且 `missingFields` 含 `currency`。
5. 人工已录 `totalPrice=60000`，回信解析出 `totalPrice=58000` → **不覆盖**，notes 追加"回信报价 58000 与已录 60000 不一致"。
6. LLM 返回的 evidence 在原文里不存在 → 该字段作废，不写库；其它字段照常。
7. 同一 `messageId` 第二次处理 → 跳过，AuditLog 不重复。
8. `threadId` 命不中任何 item 的信 → 忽略，不写库、不通知。
9. 附件 PDF 含表格报价、正文只说"见附件" → 从附件解析出价格，`attachmentsSeen[0].parsed=true`。
10. 图片附件 → `attachmentsSeen[].parsed=false`，notes 注明"图片附件未解析"，不报错。
11. 缺 gmail.readonly scope → cron 返回 `skipped: "no_read_scope"`，发一条站内提醒，24h 内不重复。
12. 三封信中第二封解析抛异常 → 第一、三封正常入表，第二封记 failed，游标前进。

---

## 6. 禁止事项

- 不新增 queue / lease / scheduler（T5 永久禁令）；用 cron + 游标。
- 不按发件人邮箱或主题模糊匹配供应商；只认 `threadId`。
- 不覆盖任何人工已填的 `InquiryItem` 字段。
- 不发送任何邮件（追问是 P1-7）。
- 不做币种换算、不算落地成本（P1-5）。
- 不把邮件原文整段存库；只存 ≤200 字的证据片段与结构化字段。
- 不新增 Prisma model；游标、提醒去重全部零 schema。
- 不引入 OCR 依赖；图片只记"未解析"。

---

## 7. 提交方式

分支 `feature/tender-rfq-inbound-p1-4`（基于已合并的 Phase 0 + P1-1..3）。PR 描述贴：三个测试文件的通过数、`vercel.json` diff、`EMAIL_SCOPES` diff、完成报告链接。把 PR 链接给 Evan，Evan 转给 Claude 审。
