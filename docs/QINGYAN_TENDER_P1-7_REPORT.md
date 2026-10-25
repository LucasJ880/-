# P1-7 完成报告：催单与缺字段追问（审批后发送，同线程回复）

任务书：P1-7 任务书（claude.ai artifact LGAP7zAa5UUvx7NJbPMjLn）
分支：`feature/tender-rfq-chase-p1-7`（基于 main，已合入邮箱拆分 `feature/tender-rfq-mailbox-split`）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/google-email.ts` | `sendGmail` 加可选 `threadId` / `inReplyTo` / `references`：`threadId` 进 `messages.send` 的 body，两个头写进 raw（去换行防头注入）；`buildRawEmail` 导出供测试；新增 `getMessageIdHeader(userId, messageId)`（`messages.get format=metadata`） |
| `src/lib/tender-rfq/chase-pure.ts` | `decideChases(snapshot, {manual})`、`decideNoResponse`、`currentMissingFields`、正文模板 `renderChaseEmail`、`hashChaseBody`、`buildChasePayload`（全量敏感闸）、`chase#N` notes 读写、`resolveChaseAfterDays` |
| `src/lib/tender-rfq/chase-service.ts` | `runChaseScan(orgId)`（cron）与 `draftChasesForProject`（Muse `chase`）：取数 → 决策 → 一家一张 `tender.send_chase` 审批卡 / `markItemNoResponse` + `no_response` 事件 |
| `src/lib/tender-rfq/chase-execute.ts` | 执行器：bodyHash 校验、线程一致校验、执行时重读状态（已回复 / 已发过不重发）、授权邮箱 = org settings 的 `mailboxEmail`、取原信 Message-ID → 线程回复发出 → `contactNotes` 追加 `chase#N kind=… messageId=…` |
| `src/lib/tender-rfq/inbound-sync.ts` | 每个组织收信成功后，同一次 tick 末尾调 `runChaseScan`（不新增 cron；入站被跳过时不扫） |
| `src/lib/tender-rfq/notes-parse.ts` / `inbound-apply.ts` | `parseAutoNotes` 多出 `lastMissingFields`（最新 `[auto]` 段的「缺：…」）；`INBOUND_MISSING_LABEL` 导出供反查（往返测试已补） |
| `src/lib/pending-actions/types.ts` / `executor.ts` | 加 `tender.send_chase` |
| `src/lib/muse-bridge/contract.ts` | `chase` args = `{ projectId, inquiryId?, itemIds? }`；事件类型加 `no_response` |
| `src/lib/muse-bridge/router.ts` / `router-pure.ts` | `chase` handler + `chaseAdvisory`；单项目 `status` 提示"N 家没回且无法自动催，请手工催" |
| `src/lib/muse-bridge/next-step.ts` | "超期未回"行接 `chase`（带 `inquiryId` + 可催的 `itemIds`）；天数按最后一次联系算；催满两次不再建议；无线程的只提示手工 |
| `src/lib/muse-bridge/hooks.ts` / `events-pure.ts` / `events.ts` | `museOnNoResponse` / `noResponseEventInput`：summary "A厂催了两次没回，已标未响应；当前 N 家有报价"，nextStep ≥2 家 quoted → `compare`，否则 `rfq` |

### `sendGmail` 签名 diff
```diff
 export interface SendEmailParams {
   to: string;
   from: string;
   subject: string;
   body: string;
   replyTo?: string;
+  threadId?: string;     // → messages.send requestBody.threadId
+  inReplyTo?: string;    // 原始邮件的 RFC 822 Message-ID 头 → In-Reply-To
+  references?: string;   // → References（缺省同 inReplyTo）
 }
-requestBody: { raw: string }
+requestBody: { raw: string; threadId?: string }
+export async function getMessageIdHeader(userId: string, messageId: string, deps?: GmailReadDeps): Promise<string | null>
```

---

## 2. 怎么验

```bash
npx tsx src/lib/tender-rfq/__tests__/chase-pure.test.ts     # 47 passed（§4-1…§4-8、§4-11、§4-12；§4-4 事件、§4-6 status 提示）
npx tsx src/lib/tender-rfq/__tests__/chase-execute.test.ts  # 20 passed（§4-9、§4-10；注入假 Gmail 验证 threadId 与线程头；mailboxEmail）
```
回归：next-step 59、advisory 70、muse-bridge-pure 43、prefs 26、notes-parse 17、inbound-apply 49、round-pure 31、landed-cost 70、inbound-parse 38、build 21、compare 40。本地 `typecheck`、`lint:baseline`、`test:ci` 通过。

本地 Postgres 端到端（临时脚本，未提交）：
1. A 已发 4 天（有线程）、B 已报价缺币种 + 有效期、C 已发 4 天但无线程 → 扫描起草 A `chase#1`、B 追问；C 跳过（no_thread）。
2. 再扫一次 → 不重复起草（pending_card）。
3. `status` 出现"1 家没回且无法自动催（没有邮件线程），请手工催"；`next_step` → "有 2 条等你批"。
4. 卡片：标题"催 E2E A 工厂 — …"/"追问 E2E B 贸易缺币种、报价有效期 — …"，TTL 48h，正文与模板一致。
5. 走真实 `executePendingAction`（本地没连授权邮箱）→ `SENDER_NOT_CONNECTED`："授权邮箱 lucas@sunnyshutter.ca 未连接…"，没有发信。
6. 假 Gmail 执行 A → From `"Qyan-Sunny Purchasing" <project@…>`、主题 `Re: 询价：…`、notes 追加 `chase#1 kind=no_reply messageId=…`。
7. 3 天后扫描 → A `chase#2`（正文含"视为不参与"）；B 的追问卡已过 48h → 重新起草（新幂等键）。
8. 再 3 天 → A 标 `no_response`，`no_response` 事件 "E2E A 工厂催了两次没回，已标未响应 · 当前 1 家有报价"，action = `rfq`。
9. 手动 `chase` 指定 B（已有待批）+ C（无线程）→ "没有需要催的供应商 · B 已有一张待批的催单 · C 没有邮件线程，请手工联系"。

---

## 3. 判断点（请审）

1. **"现在还缺什么"**：以最新 `[auto]` 段的「缺：…」为准，再去掉后来补上的——价格 / 交期 / 有效期看字段值；**币种列有默认值 CAD 看不出是否补了**，按"`[auto]` 段之后这一行被人改过（> 15 分钟）"视为已人工核对。
2. **入站目前只会判出 4 种缺失**（价格 / 币种 / 交期 / 有效期）；模板里起订量、贸易条款两条措辞已备好，没有扩入站解析。
3. **原主题 / 收件地址**从这轮 `tender.send_rfq` payload 取（发出去的就是事实来源）；取不到 → 主题回退 `询价：<项目名>`、收件回退供应商联系邮箱。
4. **回复截止已过（§4-5）**：不再起草催单；最后一次联系（询价或催单）满 `chaseAfterDays` 仍 sent → 直接标 no_response，不要求先催满两次。截止按 `ProjectInquiry.dueDate` 当天结束算。
5. **幂等键**：no_reply 用任务书的 `tender.send_chase:${itemId}:${n}`；追问用 `…:${itemId}:missing_fields`（否则和 no_reply 的第 1 次撞键）。草稿层按幂等键复用旧卡（含已过期的），所以**过期重起草加 `:r<k>` 后缀**；**被驳回的卡扫描不再自动起草**（人已经说了不催），手动 `chase` 可以。
6. **入站被跳过（没连邮箱 / 没读权限）时不扫催单**：没读到回信就不知道谁真没回，宁可不催。
7. **敏感闸只闸正文**：主题是原询价主题原样加 `Re:`（P1-1 起草时已过闸），全量模式会把项目名里的 "Cost…" 之类误判。
8. **执行时重读**：对方已回复 / 同一次已发过 → 不发并返回说明（ok）；线程与审批时不一致 / 无线程 / 追问对象不是 replied·quoted → 拒绝。
9. **审批卡的 principal**：扫描起草 = 项目 owner（actorType agent），手动 = 发起人；催单天数按项目 owner 的偏好（next_step 按当前用户的偏好），都回退到组织 `tenderRfq.chaseAfterDays` → 3。
10. **next_step 第 7 行**：天数判断从 `>` 改成 `≥`（与扫描一致，§4-3"已发 3 天 → 第二次"）；最后一次联系 = 最后一条催单；催满两次不再建议催。
11. **`chase` 不在 Phase 0 默认白名单**：要在 `MUSE_BRIDGE_INTENTS` 里显式加；没加时 next_step 的催单按钮会被 `gateAdvisory` 去掉。

---

## 4. 已知限制 / 发现

- **标了 no_response 的 item 不再被入站盯**（`loadInboundOrgContexts` 只看 sent/replied/quoted）：供应商之后才回的信不会自动入表。可以在 P1-4 的取数里把 no_response 加进去（状态机允许 no_response → sent），本 PR 没动。
- ~~（P1-3 既有）询价 / 催单正文是纯文本，但 `buildRawEmail` 以 `text/html` 发出~~：已在后续 PR 修复——`sendGmail` 加 `contentType`，询价与催单都按 `text/plain` 发。
- 催单计数从 `contactNotes` 读：有人手工清空沟通备注会丢掉计数（与任务书"不改 schema"一致）。
