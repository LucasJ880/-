/**
 * P1-7 催单 / 缺字段追问 — 纯函数测试（任务书 §4-1 … §4-8、§4-11、§4-12；§4-4 事件、§4-6 status 提示）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/chase-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  CHASE_MAX,
  appendContactNote,
  buildChasePayload,
  chaseSlot,
  chaseSubject,
  chaseTitle,
  currentMissingFields,
  decideChases,
  decideNoResponse,
  formatChaseNote,
  hashChaseBody,
  parseChaseNotes,
  parseRfqMessageId,
  renderChaseEmail,
  resolveChaseAfterDays,
  type ChaseItemSnapshot,
  type ChaseSnapshot,
} from "../chase-pure";
import { formatRfqContactNotes, parseRfqThreadId } from "../inbound-contract";
import { chaseAdvisory, statusAdvisory, type StatusProjectRow } from "@/lib/muse-bridge/router-pure";
import { noResponseEventInput, buildMuseEvent } from "@/lib/muse-bridge/events-pure";
import { museCommandResponseSchema } from "@/lib/muse-bridge/contract";
import { advisoryResponse, firstLine } from "@/lib/muse-bridge/advisory";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-25T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const RFQ_NOTES = formatRfqContactNotes("gm-rfq-1", "th-1", ago(10));

function item(o: Partial<ChaseItemSnapshot> = {}): ChaseItemSnapshot {
  return {
    itemId: "i-A",
    inquiryId: "inq-1",
    projectId: "p1",
    supplierName: "A 工厂",
    status: "sent",
    sentAt: ago(4),
    threadId: "th-1",
    chases: [],
    cards: [],
    quote: { unitPrice: null, totalPrice: null, deliveryDays: null, validUntil: null, quoteNotes: null, updatedAt: ago(4) },
    ...o,
  };
}
const snap = (items: ChaseItemSnapshot[], o: Partial<ChaseSnapshot> = {}): ChaseSnapshot => ({
  now: NOW,
  chaseAfterDays: 3,
  replyBy: new Date("2026-11-07T00:00:00Z"),
  items,
  ...o,
});
const note = (index: number, daysAgo: number, kind: "no_reply" | "missing_fields" = "no_reply") => ({ index, kind, messageId: `gm-c${index}`, at: ago(daysAgo) });
const payloadFor = (it: ChaseItemSnapshot, s: ChaseSnapshot) => {
  const plan = decideChases(s).drafts.find((d) => d.itemId === it.itemId)!;
  const b = buildChasePayload({
    plan, projectId: "p1", inquiryId: "inq-1", supplierName: it.supplierName, to: "a@supplier.example", threadId: "th-1",
    originalSubject: "询价：RCMP 战术背包（第 1 轮） — 请于 2026-11-07 前回复", sentAt: it.sentAt, replyBy: "2026-11-07",
    fromName: "Qyan-Sunny Purchasing", fromEmail: "project@sunnyshutter.ca",
  });
  assert.ok(b.ok);
  return b.payload;
};

console.log("tender-rfq chase");

/* 设置：owner 偏好 > 组织 > 3 */
{
  ok("催单天数：owner 偏好优先", resolveChaseAfterDays(5, { tenderRfq: { chaseAfterDays: 7 } }) === 5);
  ok("催单天数：无偏好取组织 tenderRfq.chaseAfterDays", resolveChaseAfterDays(null, { tenderRfq: { chaseAfterDays: 7 } }) === 7);
  ok("催单天数：都没有 → 3", resolveChaseAfterDays(null, null) === 3 && resolveChaseAfterDays(0, { tenderRfq: { chaseAfterDays: "x" } }) === 3);
}

/* contactNotes 往返 */
{
  const line = formatChaseNote({ index: 1, kind: "no_reply", messageId: "gm-9", at: ago(1) });
  const notes = appendContactNote(RFQ_NOTES, line);
  const back = parseChaseNotes(notes);
  ok("chase#N 行往返：写 → 读一致", back.length === 1 && back[0].index === 1 && back[0].kind === "no_reply" && back[0].messageId === "gm-9" && back[0].at.getTime() === ago(1).getTime());
  ok("追加后 P1-4 仍按首行 threadId 认领", parseRfqThreadId(notes) === "th-1");
  ok("原询价的 Gmail messageId 可读出（取 Message-ID 头用）", parseRfqMessageId(notes) === "gm-rfq-1");
  const noHdr = formatChaseNote({ index: 2, kind: "no_reply", messageId: "gm-10", at: ago(0), noMessageIdHeader: true });
  ok("取不到原 Message-ID 时 notes 注明，且仍可解析", noHdr.includes("未取到原 Message-ID") && parseChaseNotes(noHdr)[0]?.index === 2);
}

/* §4-1 */
{
  const it = item();
  const d = decideChases(snap([it]));
  ok("§4-1 sent 4 天、偏好 3 天 → 起草 chase#1", d.drafts.length === 1 && d.drafts[0].kind === "no_reply" && d.drafts[0].chaseIndex === 1 && d.drafts[0].idempotencyKey === "tender.send_chase:i-A:1", d);
  const p = payloadFor(it, snap([it]));
  ok("§4-1 正文含回复截止日期", p.body.includes("回复截止 2026-11-07") && p.body.includes("10 月 21 日的询价还没收到贵司报价"), p.body);
  ok("§4-1 主题 = Re: + 原主题", p.subject === "Re: 询价：RCMP 战术背包（第 1 轮） — 请于 2026-11-07 前回复" && chaseSubject("Re: x") === "Re: x");
  ok("§4-1 不到 3 天不起草", decideChases(snap([item({ sentAt: ago(2) })])).drafts.length === 0);
  ok("bodyHash 与 payload 一致", p.bodyHash === hashChaseBody(p));
  ok("审批卡标题「催 A 工厂」", chaseTitle(p, [], "RCMP 战术背包").startsWith("催 A 工厂"));
}

/* §4-2 */
{
  const live = item({ cards: [{ slot: chaseSlot("i-A", "no_reply", 1), state: "live" }] });
  const d = decideChases(snap([live]));
  ok("§4-2 已有待批 chase#1 → 不重复起草", d.drafts.length === 0 && d.skipped[0]?.reason === "pending_card");
  const dead = decideChases(snap([item({ cards: [{ slot: chaseSlot("i-A", "no_reply", 1), state: "dead" }] })]));
  ok("§4-2 待批卡过期 → 视为没催，重新起草（新幂等键）", dead.drafts.length === 1 && dead.drafts[0].idempotencyKey === "tender.send_chase:i-A:1:r1");
  const rejected = decideChases(snap([item({ cards: [{ slot: chaseSlot("i-A", "no_reply", 1), state: "rejected" }] })]));
  ok("被驳回过 → 扫描不再自动起草", rejected.drafts.length === 0 && rejected.skipped[0]?.reason === "rejected_card");
}

/* §4-3 */
{
  const it = item({ sentAt: ago(8), chases: [note(1, 3)] });
  const d = decideChases(snap([it]));
  ok("§4-3 chase#1 已发 3 天仍 sent → 起草 chase#2", d.drafts.length === 1 && d.drafts[0].chaseIndex === 2 && d.drafts[0].idempotencyKey === "tender.send_chase:i-A:2", d);
  ok("§4-3 正文含「视为不参与」", payloadFor(it, snap([it])).body.includes("如本周内无回复我们将视为不参与"));
  ok("§4-3 chase#1 才发 2 天 → 不起草", decideChases(snap([item({ sentAt: ago(8), chases: [note(1, 2)] })])).drafts.length === 0);
  ok("§4-1 首次催单正文不含「视为不参与」", !renderChaseEmail({ kind: "no_reply", chaseIndex: 1, supplierName: "A", originalSubject: "s", sentAt: ago(4), replyBy: null, missingFields: [], fromName: "X" }).body.includes("视为不参与"));
}

/* §4-4 */
{
  const it = item({ sentAt: ago(12), chases: [note(1, 6), note(2, 3)] });
  const d = decideChases(snap([it]));
  ok("§4-4 chase#2 已发 3 天仍 sent → 标 no_response", d.noResponse.join() === "i-A" && d.drafts.length === 0);
  ok("§4-4 最多催 2 次", CHASE_MAX === 2 && decideChases(snap([item({ sentAt: ago(12), chases: [note(1, 6), note(2, 1)] })])).drafts.length === 0);
  const base = { itemId: "i-A", orgId: "org_1", ownerId: "u1", projectId: "p1", projectName: "RCMP 战术背包", supplierName: "A 工厂", reason: "two_chases" as const };
  const two = buildMuseEvent(noResponseEventInput({ ...base, quotedCount: 2 }));
  ok("§4-4 no_response 事件：2 家 quoted → nextStep compare", !!two && two.type === "no_response" && two.action?.command.intent === "compare" && two.summary.startsWith("A 工厂催了两次没回，已标未响应"), two);
  const one = buildMuseEvent(noResponseEventInput({ ...base, quotedCount: 1 }));
  ok("§4-4 no_response 事件：不足 2 家 → nextStep rfq（补人）", !!one && one.action?.command.intent === "rfq" && one.summary.includes("当前 1 家有报价"));
}

/* §4-5 */
{
  const late = snap([item({ sentAt: ago(10) })], { replyBy: ago(3) });
  const d = decideChases(late);
  ok("§4-5 回复截止已过且未回 → 不起草，直接标 no_response", d.drafts.length === 0 && d.noResponse.join() === "i-A");
  const justSent = decideChases(snap([item({ sentAt: ago(1) })], { replyBy: ago(2) }));
  ok("§4-5 截止已过但最后一次联系不满 3 天 → 既不催也不标", justSent.drafts.length === 0 && justSent.noResponse.length === 0);
  ok("decideNoResponse：截止当天不算过期", !decideNoResponse(item({ sentAt: ago(10) }), NOW, 3, new Date("2026-10-25T00:00:00Z")));
}

/* §4-6 */
{
  const d = decideChases(snap([item({ threadId: null })]));
  ok("§4-6 item 无 threadId → 不起草", d.drafts.length === 0 && d.skipped[0]?.reason === "no_thread");
  const row: StatusProjectRow = {
    id: "p1", name: "RCMP 战术背包", createdAt: null, tenderStatus: null, publicDate: null, questionCloseDate: null, closeDate: "2026-11-30T00:00:00Z",
    dueDate: null, distributedAt: null, dispatchedAt: null, interpretedAt: null, supplierInquiredAt: "2026-10-15T00:00:00Z", supplierQuotedAt: null,
    submittedAt: null, awardDate: null, intakeStatus: null, sourceMetadataJson: null, analysisStatus: "APPROVED", pendingApprovals: 0, manualChase: 1,
  };
  const a = statusAdvisory([row], NOW, { singleProject: true });
  ok("§4-6 status 里提示「手工催」", a.reasons.some((r) => r.includes("请手工催")), a.reasons);
}

/* §4-7 */
{
  const notes = `[auto 2026-10-24T08:00:00.000Z msg=gm-r1] 单价=12.5；起订量=500；贸易条款=FOB；缺：币种、有效期`;
  const q = { unitPrice: "12.5", totalPrice: null, deliveryDays: 30, validUntil: null, quoteNotes: notes, updatedAt: new Date("2026-10-24T08:00:05Z") };
  ok("currentMissingFields：读最新 [auto] 段的「缺：」", currentMissingFields(q).join() === "currency,validUntil");
  const it = item({ status: "quoted", quote: q });
  const d = decideChases(snap([it]));
  ok("§4-7 quoted 且缺 [currency, validUntil] → 起草追问", d.drafts.length === 1 && d.drafts[0].kind === "missing_fields" && d.drafts[0].idempotencyKey === "tender.send_chase:i-A:missing_fields", d);
  const p = payloadFor(it, snap([it]));
  ok("§4-7 正文两条且顺序固定（币种在前，有效期在后）", /感谢报价。为便于比价，还需补充：\n1\. 币种\n2\. 报价有效期\n/.test(p.body), p.body);
  ok("§4-7 字段顺序与传入顺序无关", renderChaseEmail({ kind: "missing_fields", chaseIndex: 1, supplierName: "B", originalSubject: "s", sentAt: null, replyBy: null, missingFields: ["validUntil", "currency"], fromName: "X" }).body.includes("1. 币种\n2. 报价有效期"));
  ok("§4-7 审批卡标题「追问 A 工厂缺币种、报价有效期」", chaseTitle(p, ["currency", "validUntil"], "RCMP").startsWith("追问 A 工厂缺币种、报价有效期"));
  const asked = decideChases(snap([item({ status: "quoted", quote: q, chases: [note(1, 1, "missing_fields")] })]));
  ok("§4-7 已追问过（notes 含 chase#1 kind=missing_fields）→ 不重复", asked.drafts.length === 0 && asked.skipped[0]?.reason === "already_asked");
  ok("§4-7 追问 notes 行可解析", parseChaseNotes(formatChaseNote({ index: 1, kind: "missing_fields", messageId: "gm-x", at: NOW }))[0]?.kind === "missing_fields");
}

/* §4-8 */
{
  const notes = `[auto 2026-10-24T08:00:00.000Z msg=gm-r1] 单价=12.5；起订量=500；贸易条款=FOB；缺：币种、有效期`;
  const filled = { unitPrice: "12.5", totalPrice: null, deliveryDays: 30, validUntil: "2026-12-31", quoteNotes: notes, updatedAt: new Date("2026-10-24T10:00:00Z") };
  ok("§4-8 人工录入后 missingFields 清空 → 不起草追问", currentMissingFields(filled).length === 0 && decideChases(snap([item({ status: "quoted", quote: filled })])).drafts.length === 0);
  const later = `${notes}\n[auto 2026-10-24T12:00:00.000Z msg=gm-r2] 币种=USD；有效期=2026-12-31`;
  ok("§4-8 后到的回信补齐了（最新 [auto] 段没有「缺：」）→ 不起草", currentMissingFields({ ...filled, validUntil: null, quoteNotes: later, updatedAt: new Date("2026-10-24T12:00:01Z") }).length === 0);
  ok("§4-8 只补了有效期、币种没人动 → 只追问币种", currentMissingFields({ ...filled, updatedAt: new Date("2026-10-24T08:00:05Z") }).join() === "currency");
}

/* 起订量 / 贸易条款（入站不判缺，追问时补） */
{
  const at = new Date("2026-10-24T08:00:00Z");
  const q = (notes: string, updatedAt = new Date(at.getTime() + 5000)) => ({ unitPrice: "12.5", totalPrice: null, deliveryDays: 30, validUntil: "2026-12-31", quoteNotes: notes, updatedAt });
  ok("已报价、四项齐但没写贸易条款 → 追问贸易条款（起订量顺带）", currentMissingFields(q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5"), { quoted: true }).join() === "moq,incoterm");
  ok("没写起订量不单独追问（只在本来就追问时顺带）", currentMissingFields(q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5；贸易条款=DDP"), { quoted: true }).length === 0);
  ok("缺币种时顺带问起订量、贸易条款，顺序固定", currentMissingFields(q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5；缺：币种")).join() === "currency,moq,incoterm");
  ok("更早一段写过贸易条款 → 不再问", currentMissingFields(q("[auto 2026-10-20T08:00:00.000Z msg=g1] 贸易条款=FOB\n[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5"), { quoted: true }).length === 0);
  ok("[auto] 段之后人工改过这一行 → 起订量 / 贸易条款视为已核对", currentMissingFields(q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5", new Date(at.getTime() + 3600_000)), { quoted: true }).length === 0);
  ok("只回复了「收到」（replied、无缺字段）→ 不问贸易条款", currentMissingFields(q("[auto 2026-10-24T08:00:00.000Z msg=gm] 供应商回复（无报价内容）")).length === 0);
  const it = item({ status: "quoted", quote: q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5；缺：币种") });
  const p = payloadFor(it, snap([it]));
  ok("追问正文：币种 / 起订量 / 贸易条款三条", /1\. 币种\n2\. 起订量\n3\. 贸易条款\n/.test(p.body), p.body);
  const only = item({ status: "quoted", quote: q("[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=12.5") });
  ok("只缺贸易条款也会起草追问", decideChases(snap([only])).drafts[0]?.missingFields.join() === "moq,incoterm");
}

/* §4-11 */
{
  const it = item({ supplierName: "毛利测试厂" });
  const plan = decideChases(snap([it])).drafts[0];
  const b = buildChasePayload({
    plan, projectId: "p1", inquiryId: "inq-1", supplierName: it.supplierName, to: "a@x.com", threadId: "th-1", originalSubject: "询价：X",
    sentAt: it.sentAt, replyBy: "2026-11-07", fromName: "Qyan-Sunny Purchasing", fromEmail: "project@sunnyshutter.ca",
  });
  ok("§4-11 正文含「毛利」（人为注入）→ 闸门拒绝起草", !b.ok && b.errorCode === "SENSITIVE_LEAK");
  const clean = payloadFor(item(), snap([item()]));
  ok("§4-11 正常模板不触发闸门且不含任何金额", !/\d+\.\d{2}|CAD|USD|\$/.test(clean.body));
}

/* §4-12 */
{
  const sent = item({ itemId: "i-A", supplierName: "A 工厂", sentAt: ago(1) });
  const quoted = item({
    itemId: "i-B", supplierName: "B 贸易", status: "quoted",
    quote: { unitPrice: "10", totalPrice: null, deliveryDays: 20, validUntil: "2026-12-31", quoteNotes: "[auto 2026-10-24T08:00:00.000Z msg=gm] 单价=10；起订量=100；贸易条款=FOB", updatedAt: ago(1) },
  });
  const d = decideChases(snap([sent, quoted]), { manual: true });
  ok("§4-12 手动 chase：只为 sent 那家起草（不看天数）", d.drafts.length === 1 && d.drafts[0].itemId === "i-A", d);
  ok("§4-12 手动 chase：不标 no_response", decideChases(snap([item({ sentAt: ago(12), chases: [note(1, 6), note(2, 3)] })]), { manual: true }).noResponse.length === 0);
  const a = chaseAdvisory("p1", {
    drafted: [{ supplierName: "A 工厂", actionId: "pa-1", kind: "no_reply", chaseIndex: 1 }],
    skipped: d.skipped.map((s) => ({ supplierName: s.itemId === "i-B" ? "B 贸易" : "?", reason: s.reason })),
    failed: [],
  });
  const res = advisoryResponse("req-chase-0001", a);
  ok("§4-12 回复里说明另一家已报价", res.message.includes("B 贸易已报价"), res.message);
  ok("§4-12 下一步 = 批准这张催单卡", res.suggestedActions[0]?.command.intent === "approve" && (res.suggestedActions[0].command as { approvalId: string }).approvalId === "pa-1");
  ok("§4-12 回复第一行 ≤ 60 字且符合契约", firstLine(res.message).length <= 60 && museCommandResponseSchema.safeParse(res).success);
  const none = advisoryResponse("req-chase-0002", chaseAdvisory("p1", { drafted: [], skipped: [{ supplierName: "B 贸易", reason: "quoted" }], failed: [] }));
  ok("一家都不用催 → 如实说，下一步 next_step", none.message.startsWith("没有需要催的供应商") && none.suggestedActions[0]?.command.intent === "next_step");
}

console.log(`\ntender-rfq chase: ${passed} passed`);
