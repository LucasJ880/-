# P1-7 任务书：催单与缺字段追问（审批后发送，同线程回复）

> 原文来自 claude.ai artifact LGAP7zAa5UUvx7NJbPMjLn，按原文转录入库。

| 项 | 值 |
|---|---|
| 编号 | P1-7 |
| 目标 | 供应商超期未回 → 自动起草催单；报价缺字段 → 自动起草追问。两者都是**审批卡**，批准后作为**同一 Gmail 线程的回复**发出；第二次催单后仍无回复 → 自动标 `no_response` 并通知 |
| 依赖 | P1-3（发信留 threadId）、P1-4（入站按 threadId 认领）、P1-8（`next_step` 已为 chase 留位；偏好 `chaseAfterDays`） |
| 执行者 | Claude Code |
| 审核 | Claude（chat）；合并后进 GATE-1 |

---

## 0. 先读

- `src/lib/google-email.ts` `sendGmail`（返回 `{messageId, threadId}`）— P1-7 要加**线程回复**能力：`threadId` + `In-Reply-To` / `References` 头，否则供应商回催单信会开新线程，P1-4 认领不到
- `src/lib/tender-rfq/execute.ts` — 发信执行器的写法（发件账号解析、hash 防篡改、逐封记录）照抄
- `src/lib/tender-rfq/inbound-apply.ts` + `notes-parse.ts` — `missingFields` 写在 `[auto …]` 段里，追问草稿从这里读
- `src/lib/inquiry/service.ts` `markItemNoResponse`（状态机 `sent → no_response`）、`contactNotes` 里的 `messageId=… threadId=…` 前缀
- `src/lib/muse-bridge/next-step.ts` 第 164 行附近——"超过 N 天未回复"分支现在 `nextStep=null`，P1-7 把它接到 `chase`
- `src/lib/muse-bridge/prefs-pure.ts` `chaseAfterDays`
- `src/app/api/cron/tender-rfq-inbound/route.ts` — cron 写法；**催单扫描加进这个 cron 的同一次 tick**（先收信，再判断谁该催），不新增 cron 条目

---

## 1. 范围

**做：**

1. 扫描：每次 `tender-rfq-inbound` tick 结束后，找 `sent` 超过 `chaseAfterDays` 未回的 item → 起草催单；找 `replied/quoted` 且最新 `[auto]` 段有 `missingFields` 且尚未追问过的 item → 起草追问。
2. 草稿 = PendingAction `tender.send_chase`，payload 一个 item 一封（不是一轮一张卡——审批人要能只催其中一家）。
3. `chase` 意图：手动触发同样的起草（`{ projectId, inquiryId?, itemIds? }`），立即返回审批卡。
4. 执行器：批准后以线程回复发出；`InquiryItem.contactNotes` 追加 `chase#N messageId=…`。
5. 第二次催单发出后再过 `chaseAfterDays` 仍 `sent` → `markItemNoResponse` + Muse 事件 `reply.received` 的反面：新增事件类型 `no_response`。
6. `next_step` 的"超期未回"分支接 `chase`。

**不做：**

- 不打电话、不发微信（`SENT_VIA` 其它渠道留人工）。
- 不在没有 `threadId` 的 item 上催（P1-3 之前发的）；这些只在 `status` 里提示"无法自动催，请手工"。
- 不解析供应商对催单的回复（那是 P1-4 的事，线程一致它自然会认领）。

---

## 2. 设计决定

### 2.1 同线程回复，这是硬要求

`sendGmail` 加可选 `{ threadId, inReplyTo, references }`：

- `threadId` 进 `messages.send` 的 body；
- `In-Reply-To` / `References` 头取**原始 RFQ 邮件的 `Message-ID` 头**（不是 Gmail 的 messageId）。P1-3 没存这个头，所以执行器发催单前先 `messages.get(format=metadata, metadataHeaders=["Message-ID"])` 取一次；取不到就只带 `threadId`（Gmail 仍会归线程），并在 notes 注明。
- 主题 = `Re: ` + 原主题。
- 测试：`buildRawEmail` 输出含这两个头；`deps.getGmail` 注入假对象验证 `threadId` 传到了 `send`。

### 2.2 催单节奏

| 参数 | 来源 | 默认 |
|---|---|---|
| 首次催单 | `prefs.chaseAfterDays`（项目 owner 的偏好）→ 组织 `tenderRfq.chaseAfterDays` → 3 天 | 3 |
| 第二次催单 | 首次发出后再 `chaseAfterDays` | — |
| 最多催 | 2 次 | 2 |
| 自动 `no_response` | 第二次发出后再 `chaseAfterDays` | — |
| 回复截止已过 | 不再起草催单，直接走 `no_response` 判断 | — |

每个 item 同一时刻最多一张待批催单卡（`idempotencyKey = tender.send_chase:${itemId}:${n}`）。待批卡过期（TTL 48h）视为"没催"，下次 tick 重新起草（不自动发）。

### 2.3 正文（纯代码模板，不走 LLM）

- **催单**：称呼 + "我们 X 月 X 日的询价还没收到贵司报价，回复截止 Y，请问是否能报？若不参与请直接告知，方便我们安排。" + 落款。第二次加一句"如本周内无回复我们将视为不参与"。
- **追问**：称呼 + "感谢报价。为便于比价，还需补充：" + 缺字段逐条（`price → 各档单价`、`currency → 币种`、`deliveryDays → 交期（天）`、`validUntil → 报价有效期`、`moq → 起订量`、`incoterm → 贸易条款`）+ 落款。
- 两种都走 `china-supplier-brief` 的全量敏感模式闸（和 P1-1 自由文本同档）；模板里没有任何我方价格。

### 2.4 payload

```ts
type TenderSendChasePayload = {
  projectId; inquiryId; inquiryItemId; supplierName; to;
  kind: "no_reply" | "missing_fields";
  chaseIndex: 1 | 2;                 // missing_fields 固定 1
  threadId: string; originalSubject: string;
  subject: string; body: string;
  fromName; fromEmail;
  bodyHash: string;                  // 防篡改，同 P1-3
};
```

### 2.5 事件

- 起草 → 复用 `approval.requested`（P0-6 挂钩自动发），标题"催 A厂 / 追问 B厂缺币种"。
- 发出 → 不单独发事件（审批结果已回）。
- `no_response` → 新事件类型 `no_response`，summary "A厂催了两次没回，已标未响应；当前 N 家有报价"，nextStep = `compare`（≥2 家 quoted）或 `rfq`（补人）。

---

## 3. 文件清单

| 文件 | 内容 |
|---|---|
| `src/lib/google-email.ts` | `sendGmail` 线程回复参数；`getMessageIdHeader(userId, messageId)` |
| `src/lib/tender-rfq/chase-pure.ts` | `decideChases(snapshot, now) → ChaseDraft[]`、正文模板、`bodyHash`、`decideNoResponse` |
| `src/lib/tender-rfq/chase-service.ts` | DB：扫描 + 起草 `tender.send_chase`；手动 `chase` 入口 |
| `src/lib/tender-rfq/chase-execute.ts` | 执行器 |
| `src/lib/tender-rfq/inbound-sync.ts` | tick 末尾调用 `runChaseScan(orgId)` |
| `src/lib/pending-actions/types.ts` / `executor.ts` | 加 `tender.send_chase` |
| `src/lib/muse-bridge/contract.ts` | `chase` args 改为 `{ projectId, inquiryId?, itemIds? }`；事件类型加 `no_response` |
| `src/lib/muse-bridge/router.ts` / `next-step.ts` | `chase` handler；超期分支接 `chase` |
| `src/lib/muse-bridge/hooks.ts` | `museOnNoResponse(itemId)` |
| `src/lib/tender-rfq/__tests__/chase-pure.test.ts` | §4 用例 |
| `src/lib/tender-rfq/__tests__/chase-execute.test.ts` | 注入假 Gmail，验证线程头 |
| `docs/QINGYAN_TENDER_P1-7_REPORT.md` | 完成报告 |

---

## 4. 验收用例

1. item `sent` 4 天、偏好 3 天 → 起草 `chase#1`，正文含回复截止日期。
2. 同 item 已有待批 `chase#1` → 不重复起草。
3. `chase#1` 已发 3 天仍 `sent` → 起草 `chase#2`，正文含"视为不参与"。
4. `chase#2` 已发 3 天仍 `sent` → `markItemNoResponse`，发 `no_response` 事件，nextStep 正确（2 家 quoted → compare；否则 rfq）。
5. 回复截止已过且未回 → 不起草，直接按第 4 条判断。
6. item 无 `threadId` → 不起草，`status` 里提示"手工催"。
7. `quoted` 且 `[auto]` 段 `missingFields=[currency, validUntil]` → 起草追问，正文两条且顺序固定；已追问过（notes 含 `chase#1 kind=missing_fields`）→ 不重复。
8. 人工录入后 `missingFields` 清空 → 不起草追问。
9. 执行器：`send` 收到 `threadId`，原始 `Message-ID` 存在时头里有 `In-Reply-To`；不存在时仍发出且 notes 注明。
10. 执行器：`bodyHash` 不一致 → 拒绝。
11. 正文模板含"毛利"字样（人为注入）→ 闸门拒绝起草。
12. 手动 `chase` 意图：指定 `itemIds` 两家，其中一家已 `quoted` → 只为 `sent` 那家起草，回复里说明另一家已报价。

---

## 5. 禁止事项

- 不新增 cron 条目、不新增 queue；扫描挂在 `tender-rfq-inbound` tick 内。
- 不绕过审批发任何催单；偏好里没有"自动发"这个选项。
- 不用 LLM 写催单正文。
- 不改 schema；催单计数从 `contactNotes` 的 `chase#N` 前缀读。
- 不对无 `threadId` 的 item 发信。

---

## 6. 提交

分支 `feature/tender-rfq-chase-p1-7`，基于 main。PR 描述贴测试通过数、`sendGmail` 签名 diff、报告链接。
