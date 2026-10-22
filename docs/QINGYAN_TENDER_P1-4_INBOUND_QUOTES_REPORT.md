# P1-4 完成报告：供应商回信入站 → 报价自动入表

任务书：`docs/QINGYAN_TENDER_P1-4_INBOUND_QUOTES_TASKBRIEF.md`
分支：`feature/tender-rfq-inbound-p1-4`（基于 `feature/muse-bridge-phase0` = Phase 0 + P1-1..3）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/google-email.ts` | `EMAIL_SCOPES` 加 `gmail.readonly`；`hasGmailReadScope`；`sendGmail` 返回 `{ messageId, threadId }`；新增 `listThreadReplies(userId, { sinceHistoryId })`、`listThreadMessages`（游标重建时按线程补扫）、`getMessageWithAttachments`（正文 + 附件 buffer，base64url 解码，单附件 10MB 上限）。全部 `deps.getProvider / deps.getGmail` 可注入，与现有 `sendGmail` 一致。 |
| `src/lib/tender-rfq/execute.ts` | 发信后 `contactNotes` 写 `Gmail messageId=<id> threadId=<tid> · <iso>`（`formatRfqContactNotes`，与 `parseRfqThreadId` 成对）。 |
| `src/lib/tender-rfq/inbound-contract.ts` | §3 `inboundQuoteSchema`（版本字面量 + `.strip()`）、`verifyEvidence`、threadId 读写、`rfqContextFromBody`（从已发 RFQ 正文取第一档数量与强制编号）。 |
| `src/lib/tender-rfq/inbound-parse.ts` | 纯文本化（PDF→unpdf，DOCX→mammoth，XLSX→`xlsx` 转 CSV，CSV/TXT 直读，图片不 OCR）+ 去引用原询价 + `createCompletion`（`workflow: "tender_rfq_inbound_parse"`, `temperature: 0`，`deps.complete` 注入）+ 证据闸。 |
| `src/lib/tender-rfq/inbound-apply.ts` | 纯函数 `planInquiryItemUpdate(existingItem, parsed, rfqFirstTierQty, emailDate, meta)`：§2.4 全部规则，无 DB。 |
| `src/lib/tender-rfq/inbound-sync.ts` | 编排：游标 → history.list → threadId 过滤 → AuditLog 幂等 → 取信 → parse → plan → `recordQuote` / `markItemReplied`（含 Muse hooks）→ AuditLog → 写游标。所有 I/O 经 `InboundSyncDeps` 注入。 |
| `src/app/api/cron/tender-rfq-inbound/route.ts` | `requireCronSecret` + `runTrackedAutomation("tender-rfq-inbound")`，`maxDuration = 120`。 |
| `src/lib/automation/registry.ts` | 登记 `tender-rfq-inbound`（`runTrackedAutomation` 的 key 类型来自 registry）。 |
| `vercel.json` | `/api/cron/tender-rfq-inbound`，`*/10 * * * *`。 |
| `__tests__/inbound-apply.test.ts` | §5 的 12 个验收用例逐条（`§5-1` … `§5-12`），41 项断言。 |
| `__tests__/inbound-parse.test.ts` | 假 `complete` 验证证据闸作废编造字段 + 确定性推导 + 附件文本化，38 项断言。 |

### 证据闸（代码说了算）
- 每个字段的 `evidence` 必须逐字（去全部空白、NFKC、忽略大小写）出现在本封信纯文本里，否则作废。
- 再加一道"值必须在证据里"：价格数字、Incoterm 必须出现在各自证据片段中；交期天数由代码从证据换算（天 / 周×7 / 月×30 / 工作日×7/5 / 现货=0，区间取上限），不采信 LLM 自报的数字；有效期只接受证据里的明确日期，或"N 天有效"按邮件日期推算并在 notes 注明。
- 币种只在原文出现三位代码或无歧义别名（人民币/RMB、US$、C$、€ …）时采信；裸 `$` 不算。
- 强制项回答只接受本次 RFQ 的强制编号，无证据的降级为"未答"。
- **去掉引用的原询价**（"On … wrote:" / "在 … 写道：" / Outlook 原始邮件头 / `>` 行）后再送 LLM、再校验证据——否则 LLM 能从我们自己发出的询价正文里摘"数量 1500""60 天交付"并通过逐字校验。

### 写入规则（§2.4）
- 只填空：价格/交期/有效期原值非空 → 不写，差异写进 notes（如"回信报价 58000 与已录 60000 不一致"）。
- 多档价：取与询价第一档数量相同的那档；只有一档就用它；多档都对不上 → 不选，全部写 notes。第一档数量来自 `tender.send_rfq` PendingAction 里已发出的 RFQ 正文（数量阶梯没有单独落库，零 schema）。
- currency：解析不到 → 保持默认 CAD 且列入缺字段。解析到时，只在"没有人工价格且仍是默认 CAD"时写；已有人工价格或已被改成非默认值 → 视为人工已定，不覆盖，只记不一致（列默认值是 CAD，无法区分"默认"与"人工填了 CAD"，宁可不写）。
- quoteNotes：追加 `[auto <iso> msg=<messageId>] 字段=值（证据："…"）…；缺：…；附件：…`，永不覆盖。
- 状态：有新价格 → `recordQuote`（quoted）；无价格但有回信 → `markItemReplied`（replied）；已 replied/quoted 且无新价格 → 只追加 notes。

### 幂等与失败
- 幂等键 = Gmail messageId：AuditLog `targetType="rfq_inbound_message"`, `targetId=messageId`；成功记 `rfq_inbound:applied`，失败记 `rfq_inbound:failed`，两者都使下次跳过（失败不重试，避免死循环）。
- 单封失败（解析异常、LLM 输出不合契约）：记 failed + 站内通知项目负责人"有一封回信解析失败，请手工录入"（sourceKey 按 messageId 去重），游标照常前进。
- 缺 `gmail.readonly`：该组织返回 `skipped: "no_read_scope"`（所有组织都缺时 cron 顶层也返回 `skipped: "no_read_scope"`），给发件邮箱的青砚账号发一条 `muse_bridge` 分类站内提醒，24h 内不重复（按 sourceKey 前缀 + createdAt 判断）。
- 游标：`Organization.settingsJson.tenderRfq.inbound = { historyId, lastSyncAt }`，只改这一个键，保留 `tenderRfq` 其它设置与 `museBridge` 绑定。首次无游标或游标过期（history.list 404）→ 先取当前 historyId，再对已知询价线程 `threads.get` 补扫，不漏首次同步前已到的回信。

---

## 2. 没做什么（按任务书留给后续）

- 币种 / Incoterm / 落地成本归一化（P1-5）；比价矩阵与 `compare` 意图（P1-6）。
- 自动追问 / 催单（P1-7）：本任务只标记缺字段，不发任何邮件（入站代码只调用 Gmail 读接口）。
- Gmail push / Pub/Sub。
- 图片附件 OCR：只记"图片附件未解析"。
- 没有新增 Prisma model、queue、lease、scheduler。

---

## 3. 怎么验

```bash
npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts   # 41 passed（§5-1 … §5-12）
npx tsx src/lib/tender-rfq/__tests__/inbound-parse.test.ts   # 38 passed
npx tsx src/lib/tender-rfq/__tests__/build.test.ts           # 21 passed（回归）
npx tsx src/lib/tender-rfq/__tests__/round-pure.test.ts      # 25 passed（回归）
npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts  # 43 passed（回归）
QINGYAN_RUNTIME_ENV=test npx tsx src/lib/__tests__/google-email-oauth.test.ts  # 30 passed（EMAIL_SCOPES 断言仍成立：不含 send/modify/mail.google.com）
```

另在本地 Postgres 上用真实默认 deps（只替换 Gmail 与 LLM）跑过一遍：首次无游标 → 按线程补扫 → `sent → replied → quoted`、单价/币种/交期/有效期入表、notes 带证据、`contactNotes` 的 threadId 保留、游标写入且 `museBridge` 绑定保留；第二次同一 messageId 跳过、陌生线程忽略、AuditLog 不重复。

GATE-1 联调前置（运维）：
1. 拥有 `project@sunnyshutter.ca` 的人在青砚 设置 → 邮箱绑定 **重新授权**（`getGmailReauthUrl` 已带 `gmail.readonly`，`prompt=consent`）。不重新授权时 cron 只会提醒、不读信。
2. 配置 `CRON_SECRET`；非生产环境 cron 受 `assertNonProdSideEffectsAllowed("cron")` 保护。

---

## 4. 已知限制

- **P1-3 之前发出的询价不入站**：旧 `contactNotes` 只有 messageId、没有 threadId，按"只认 threadId"规则不匹配。只有本分支之后发出的询价才会自动入表。
- **只扫最近 90 天发出的询价**（`sentAt`），更早的线程不再期待回信。
- **事件粒度**：`quote.parsed` / `missing_fields` 由 `recordQuote` 里已有的 hook 推，它按自己的规则判缺；币种列有默认值 CAD，hook 看不出"供应商没写币种"，所以 §5-4 这种情况 Muse 事件可能是 `quote.parsed`，而 `missingFields`（与 notes）里有 currency。hook 按要求未改写。
- **sent → quoted 时不经 `markItemReplied`**：状态机要求先 replied 才能 quoted。为避免先推一条"报价还没录入"的 `reply.received`、紧接着又推 `quote.parsed`，这一步用带状态条件的 `updateMany({ status: "sent" } → "replied")`，再调 `recordQuote`。
- **人工已录价格、状态仍是 replied 的 item**：回信带报价时会走 `recordQuote` 到 quoted，把原价格原样带回以满足校验（值不变）。
- **附件损坏**：单个附件解析失败只标 `parsed=false` 并在 notes 说明，不让整封信失败（正文里的报价照常入表）；整封信级别的异常（LLM 输出不合契约等）才记 failed。
- **并发**：cron 每 10 分钟、`maxDuration=120`，正常不会重叠；万一重叠，同一封信可能被处理两次，但"只填空"保证不覆盖，最多 notes 多追加一段。按 T5 禁令未加锁。
- **回信引用剥离是启发式的**：覆盖常见 Gmail/Outlook/中文客户端格式；不认识的引用格式里如果出现我方询价原文，仍可能被当作证据（证据闸只能保证"原文里有这句"）。
- 交期"工作日"按 ×7/5 向上取整换算为日历天；"N 个月"按 30 天。
