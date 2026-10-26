/**
 * P1-4 询价回信入站 — 纯逻辑测试（任务书 §5 的 12 个验收用例逐条在此，编号 §5-1 … §5-12）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts
 *
 * 不连库、不连 Gmail、不调真 LLM：解析走 parseInboundQuote + 假 complete（证据闸是真的），
 * 编排走 syncOrgInbound + 内存版 deps。
 */
import assert from "node:assert/strict";
import { appendQuoteNotes, planInquiryItemUpdate, type ExistingInquiryItem, type InquiryItemUpdatePlan } from "../inbound-apply";
import { INBOUND_CONTRACT_VERSION, type InboundQuote } from "../inbound-contract";
import { parseInboundQuote, type InboundAttachmentInput, type ParseCompleteFn, type ParsedQuote } from "../inbound-parse";
import { museQuoteEvent } from "@/lib/muse-bridge/hooks";
import { inboundQuoteHookArgs, isOwnMessage, syncAllOrgsInbound, syncOrgInbound, type InboundItemRow, type InboundMessage, type InboundOrgContext, type InboundSyncDeps } from "../inbound-sync";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const EMAIL_DATE = new Date("2026-10-25T09:00:00Z");
const NOW = new Date("2026-10-25T10:00:00Z");

/** 假 LLM：返回给定 JSON（未给的字段补成"什么都没读到"） */
function llm(partial: Partial<InboundQuote>): ParseCompleteFn {
  const full: InboundQuote = {
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: false, declined: false, currency: null, prices: [],
    deliveryDays: null, deliveryEvidence: null, validUntil: null, validUntilEvidence: null, moq: null,
    incoterm: null, incotermEvidence: null, mandatoryAnswers: [], missingFields: [], attachmentsSeen: [], ...partial,
  };
  return async () => JSON.stringify(full);
}

async function parse(bodyText: string, complete: ParseCompleteFn, attachments: InboundAttachmentInput[] = []): Promise<ParsedQuote & { attachmentNotes: string[] }> {
  return parseInboundQuote({ bodyText, attachments, emailDate: EMAIL_DATE, mandatoryCodes: ["R-01"], firstTierQty: 1500 }, { complete });
}

const sentItem: ExistingInquiryItem = { status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null };
const plan = (item: ExistingInquiryItem, parsed: ParsedQuote & { attachmentNotes?: string[] }) =>
  planInquiryItemUpdate(item, parsed, 1500, EMAIL_DATE, { messageId: "msg-1", now: NOW, attachmentNotes: parsed.attachmentNotes });

/** 最小可解析 PDF（Helvetica 文本），用于验证附件真实走 unpdf 提取 */
function makePdf(lines: string[]): Buffer {
  const content = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td", ...lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`), "ET"].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ---------------------------------- 编排用内存 deps ---------------------------------- */

type World = {
  audits: Array<{ messageId: string; action: string; data: Record<string, unknown> }>;
  applied: Array<{ itemId: string; plan: InquiryItemUpdatePlan }>;
  reminders: Date[];
  failedNotices: string[];
  cursors: Array<{ orgId: string; historyId: string }>;
};

function makeWorld(): World {
  return { audits: [], applied: [], reminders: [], failedNotices: [], cursors: [] };
}

const item = (o: Partial<InboundItemRow> = {}): InboundItemRow => ({
  ...sentItem, id: "item-1", inquiryId: "inq-1", projectId: "proj-1", ownerId: "owner-1", threadId: "thread-A", ...o,
});

function msg(id: string, threadId: string, bodyText: string, attachments: InboundAttachmentInput[] = []): InboundMessage {
  return { messageId: id, threadId, labelIds: ["INBOX"], date: EMAIL_DATE, from: "Sales <sales@supplier.example>", bodyText, attachments };
}

function makeDeps(world: World, opts: {
  messages: InboundMessage[];
  readScope?: boolean;
  parse?: InboundSyncDeps["parse"];
  clock?: () => Date;
}): InboundSyncDeps {
  const byId = new Map(opts.messages.map((m) => [m.messageId, m]));
  return {
    now: opts.clock ?? (() => NOW),
    findMailbox: async () => ({ userId: "mailbox-user", grantedScopes: opts.readScope === false ? "gmail.compose" : "gmail.compose gmail.readonly" }),
    hasReadScope: (s) => !!s && s.includes("gmail.readonly"),
    recentReadScopeReminder: async (_o, _u, since) => world.reminders.some((d) => d >= since),
    remindReadScope: async (_o, _u, now) => { world.reminders.push(now); },
    listReplies: async (_u, { sinceHistoryId }) => sinceHistoryId
      ? { messages: opts.messages.map((m) => ({ messageId: m.messageId, threadId: m.threadId })), historyId: "h-200", expired: false }
      : { messages: [], historyId: "h-200", expired: false },
    listThreadMessages: async () => [],
    getMessage: async (_u, id) => byId.get(id)!,
    alreadyProcessed: async (id) => world.audits.some((a) => a.messageId === id),
    loadRfqBody: async () => "二、商务条件\n- 数量：1500 / 3000（请分档报价）\n1. 【强制】R-01 规格",
    reloadItem: async (it) => it,
    parse: opts.parse ?? ((input) => parseInboundQuote(input, { complete: llm({ isQuote: false }) })),
    applyPlan: async (it, p) => { world.applied.push({ itemId: it.id, plan: p }); },
    writeAudit: async (e) => { world.audits.push({ messageId: e.messageId, action: e.action, data: e.data }); },
    notifyFailed: async (e) => { world.failedNotices.push(e.messageId); },
    saveCursor: async (orgId, c) => { world.cursors.push({ orgId, historyId: c.historyId }); },
  };
}

const org = (items: InboundItemRow[]): InboundOrgContext => ({ orgId: "org-1", settingsJson: { tenderRfq: { inbound: { historyId: "h-100", lastSyncAt: "" } } }, items });

async function main() {
console.log("tender-rfq inbound (§5 acceptance)");

/* §5-1 */
{
  const body = "您好，单价 CAD 42.50/个，1500 个，交期 35 天，报价有效至 2026-11-30。";
  const parsed = await parse(body, llm({
    isQuote: true, currency: "CAD",
    prices: [{ quantity: 1500, unitPrice: 42.5, totalPrice: null, evidence: "单价 CAD 42.50/个，1500 个" }],
    deliveryDays: 35, deliveryEvidence: "交期 35 天", validUntil: "2026-11-30", validUntilEvidence: "报价有效至 2026-11-30",
  }));
  const p = plan(sentItem, parsed);
  ok("§5-1 完整报价 → unitPrice=42.5", p.data.unitPrice === 42.5);
  ok("§5-1 currency=CAD（解析到，与默认相同不重复写）", parsed.currency === "CAD" && (p.data.currency ?? sentItem.currency) === "CAD");
  ok("§5-1 deliveryDays=35, validUntil=2026-11-30", p.data.deliveryDays === 35 && p.data.validUntil === "2026-11-30");
  ok("§5-1 missingFields=[]", p.missingFields.length === 0);
  ok("§5-1 状态 quoted，事件 quote.parsed", p.transition === "quoted" && p.events.join() === "quote.parsed");
  ok("§5-1 实际推送的事件类型 quote.parsed", museQuoteEvent(...inboundQuoteHookArgs(sentItem, p)).type === "quote.parsed");
}

/* §5-2 */
{
  const parsed = await parse("收到，周五前给你报价。", llm({ isQuote: false }));
  const p = plan(sentItem, parsed);
  ok("§5-2 只是回复 → isQuote=false", parsed.isQuote === false);
  ok("§5-2 状态 replied，不写任何价格", p.transition === "replied" && p.data.unitPrice === undefined && p.data.totalPrice === undefined);
  ok("§5-2 触发 reply.received（不触发 missing_fields）", p.events.join() === "reply.received");
}

/* §5-3 */
{
  const parsed = await parse("这个规格价格面议，看最终数量。", llm({ isQuote: true, missingFields: ["price"] }));
  const p = plan(sentItem, parsed);
  ok("§5-3 价格面议 → 价格 null", p.data.unitPrice === undefined && p.data.totalPrice === undefined && parsed.prices.length === 0);
  ok("§5-3 missingFields 含 price", p.missingFields.includes("price"));
  ok("§5-3 状态 replied（不是 quoted），触发 missing_fields", p.transition === "replied" && p.events.includes("missing_fields"));
  ok("§5-3 实际推送的事件类型 missing_fields", museQuoteEvent(...inboundQuoteHookArgs(sentItem, p)).type === "missing_fields");
}

/* §5-4 */
{
  const parsed = await parse("单价 39.80，交期 30 天，报价有效至 2026-12-15。", llm({
    isQuote: true, currency: null,
    prices: [{ quantity: null, unitPrice: 39.8, totalPrice: null, evidence: "单价 39.80" }],
    deliveryDays: 30, deliveryEvidence: "交期 30 天", validUntil: "2026-12-15", validUntilEvidence: "报价有效至 2026-12-15",
  }));
  const p = plan(sentItem, parsed);
  ok("§5-4 没写币种 → currency 保持默认（不写 currency）", p.data.currency === undefined && sentItem.currency === "CAD");
  ok("§5-4 missingFields 含 currency", p.missingFields.includes("currency"));
  // 入站 quoted 路径：recordQuote(skipMuseHook) 后用 inboundQuoteHookArgs 自己推，缺字段以 plan 为准
  const stored = { unitPrice: "39.8", totalPrice: null, currency: "CAD", deliveryDays: 30, validUntil: new Date("2026-12-15") };
  const [snapshot, override] = inboundQuoteHookArgs(sentItem, p, stored);
  const ev = museQuoteEvent(snapshot, override);
  ok("§5-4 触发的事件类型是 missing_fields（缺：币种）", ev.type === "missing_fields" && ev.missing.join() === "币种");
  ok("§5-4 反证：只按库里字段值推断（币种=默认 CAD）会误报 quote.parsed", museQuoteEvent(stored).type === "quote.parsed");
  // 反向：LLM 自称 USD 但原文没有 → 也作废（默认值 ≠ 供应商说了）
  const parsed2 = await parse("单价 39.80", llm({ isQuote: true, currency: "USD", prices: [{ quantity: null, unitPrice: 39.8, totalPrice: null, evidence: "单价 39.80" }] }));
  ok("§5-4 LLM 编造币种（原文无 USD）→ 作废并列缺", parsed2.currency === null && plan(sentItem, parsed2).missingFields.includes("currency"));
}

/* §5-5 */
{
  const manual: ExistingInquiryItem = { status: "quoted", unitPrice: null, totalPrice: "60000", currency: "CAD", deliveryDays: 40, validUntil: null, quoteNotes: "人工：电话确认 60000" };
  const parsed = await parse("总价 CAD 58,000，交期 40 天。", llm({
    isQuote: true, currency: "CAD", prices: [{ quantity: null, unitPrice: null, totalPrice: 58000, evidence: "总价 CAD 58,000" }],
    deliveryDays: 40, deliveryEvidence: "交期 40 天",
  }));
  const p = plan(manual, parsed);
  ok("§5-5 人工已录 totalPrice=60000 → 不覆盖", p.data.totalPrice === undefined);
  ok("§5-5 notes 追加「回信报价 58000 与已录 60000 不一致」", p.notesAppend.includes("回信报价 58000 与已录 60000 不一致"));
  const merged = appendQuoteNotes(manual.quoteNotes, p.notesAppend);
  ok("§5-5 原 notes 保留（只追加）", merged.startsWith("人工：电话确认 60000\n[auto "));
}

/* §5-6 */
{
  const body = "Unit price CAD 42.50, delivery 35 days.";
  const parsed = await parse(body, llm({
    isQuote: true, currency: "CAD",
    prices: [{ quantity: 1500, unitPrice: 42.5, totalPrice: null, evidence: "Unit price CAD 42.50" }],
    deliveryDays: 20, deliveryEvidence: "lead time 20 days", // 原文没有这句
    validUntil: "2026-12-31", validUntilEvidence: "valid until 2026-12-31", // 原文没有这句
  }));
  const p = plan(sentItem, parsed);
  ok("§5-6 编造的 deliveryEvidence → deliveryDays 作废，不写库", parsed.deliveryDays === null && p.data.deliveryDays === undefined);
  ok("§5-6 编造的 validUntilEvidence → validUntil 作废", parsed.validUntil === null && p.data.validUntil === undefined);
  ok("§5-6 作废原因记入 rejected", parsed.rejected.some((r) => r.field === "deliveryDays" && r.reason === "EVIDENCE_NOT_IN_TEXT"));
  ok("§5-6 其它字段照常（unitPrice=42.5）", p.data.unitPrice === 42.5 && p.transition === "quoted");
}

/* §5-7 */
{
  const world = makeWorld();
  const m = msg("m-7", "thread-A", "收到，下周报价。");
  const deps = makeDeps(world, { messages: [m] });
  const r1 = await syncOrgInbound(org([item()]), deps);
  const r2 = await syncOrgInbound(org([item()]), deps);
  ok("§5-7 第一次处理 1 封", r1.replied === 1 && world.applied.length === 1);
  ok("§5-7 同一 messageId 第二次 → 跳过", r2.duplicates === 1 && world.applied.length === 1);
  ok("§5-7 AuditLog 不重复", world.audits.filter((a) => a.messageId === "m-7").length === 1);
}

/* §5-8 */
{
  const world = makeWorld();
  const deps = makeDeps(world, { messages: [msg("m-8", "thread-UNKNOWN", "单价 10 元")] });
  const r = await syncOrgInbound(org([item()]), deps);
  ok("§5-8 threadId 命不中 → 忽略", r.ignored === 1 && r.quoted + r.replied + r.unchanged === 0);
  ok("§5-8 不写库、不写审计、不通知", world.applied.length === 0 && world.audits.length === 0 && world.failedNotices.length === 0);
}

/* §5-9 */
{
  const pdf = makePdf(["Quotation Q-2026-118", "Qty 1500 pcs  Unit price CAD 38.00", "Lead time 6 weeks"]);
  const parsed = await parse("报价见附件。", llm({
    isQuote: true, currency: "CAD",
    prices: [{ quantity: 1500, unitPrice: 38, totalPrice: null, evidence: "Qty 1500 pcs Unit price CAD 38.00" }],
    deliveryDays: 42, deliveryEvidence: "Lead time 6 weeks",
  }), [{ filename: "quotation.pdf", mimeType: "application/pdf", data: pdf }]);
  const p = plan(sentItem, parsed);
  ok("§5-9 附件 PDF 解析 → attachmentsSeen[0].parsed=true", parsed.attachmentsSeen[0]?.filename === "quotation.pdf" && parsed.attachmentsSeen[0].parsed === true);
  ok("§5-9 从附件取到价格 unitPrice=38", p.data.unitPrice === 38 && p.transition === "quoted");
  ok("§5-9 交期 6 周 → 42 天（代码换算）", p.data.deliveryDays === 42);
}

/* §5-10 */
{
  const parsed = await parse("产品照片见附件，报价稍后。", llm({ isQuote: false }), [
    { filename: "sample.jpg", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) },
  ]);
  const p = plan(sentItem, parsed);
  ok("§5-10 图片附件 → parsed=false，不报错", parsed.attachmentsSeen[0]?.parsed === false);
  ok("§5-10 notes 注明「图片附件未解析」", p.notesAppend.includes("sample.jpg 图片附件未解析"));
}

/* §5-11 */
{
  const world = makeWorld();
  let clock = NOW;
  const deps = makeDeps(world, { messages: [msg("m-11", "thread-A", "收到")], readScope: false, clock: () => clock });
  const r1 = await syncAllOrgsInbound(deps, async () => [org([item()])]);
  clock = new Date(NOW.getTime() + 3 * 3600 * 1000);
  const r2 = await syncAllOrgsInbound(deps, async () => [org([item()])]);
  ok("§5-11 缺 gmail.readonly → cron 返回 skipped: \"no_read_scope\"", r1.skipped === "no_read_scope" && r1.orgs[0].skipped === "no_read_scope");
  ok("§5-11 发一条站内提醒", world.reminders.length === 1 && r1.orgs[0].reminded === true);
  ok("§5-11 24h 内不重复提醒", r2.skipped === "no_read_scope" && world.reminders.length === 1 && r2.orgs[0].reminded === false);
  ok("§5-11 跳过时不读信、不入表", world.applied.length === 0 && world.audits.length === 0);
  clock = new Date(NOW.getTime() + 25 * 3600 * 1000);
  await syncAllOrgsInbound(deps, async () => [org([item()])]);
  ok("§5-11 超过 24h 再提醒一次", world.reminders.length === 2);
}

/* §5-12 */
{
  const world = makeWorld();
  const items = [item({ id: "i-1", threadId: "t-1" }), item({ id: "i-2", threadId: "t-2" }), item({ id: "i-3", threadId: "t-3" })];
  const messages = [msg("m-1", "t-1", "单价 CAD 10.00"), msg("m-2", "t-2", "坏信"), msg("m-3", "t-3", "收到")];
  const deps = makeDeps(world, {
    messages,
    parse: async (input) => {
      if (input.bodyText === "坏信") throw new Error("附件损坏，无法解析");
      if (input.bodyText.includes("10.00")) {
        return parseInboundQuote(input, { complete: llm({ isQuote: true, currency: "CAD", prices: [{ quantity: null, unitPrice: 10, totalPrice: null, evidence: "单价 CAD 10.00" }] }) });
      }
      return parseInboundQuote(input, { complete: llm({ isQuote: false }) });
    },
  });
  const r = await syncOrgInbound(org(items), deps);
  ok("§5-12 第一封正常入表（quoted）", world.applied.some((a) => a.itemId === "i-1" && a.plan.transition === "quoted"));
  ok("§5-12 第三封正常入表（replied）", world.applied.some((a) => a.itemId === "i-3" && a.plan.transition === "replied"));
  ok("§5-12 第二封记 failed + 站内通知手工录入", r.failed === 1 && world.audits.some((a) => a.messageId === "m-2" && a.action === "rfq_inbound:failed") && world.failedNotices.includes("m-2"));
  ok("§5-12 游标前进到新 historyId", world.cursors.at(-1)?.historyId === "h-200" && r.historyId === "h-200");
  const again = await syncOrgInbound(org(items), deps);
  ok("§5-12 失败的信下次不重试", again.duplicates === 3 && again.failed === 0);
}

// 邮箱拆分：显示地址 project@ 与授权账号 lucas@ 发出的信都算"我们自己的"
{
  const own = ["project@sunnyshutter.ca", "lucas@sunnyshutter.ca"];
  ok("邮箱拆分：isOwnMessage 对 lucas@ 发出的信返回 true", isOwnMessage({ labelIds: ["INBOX"], from: "Lucas <Lucas@SunnyShutter.ca>" }, own));
  ok("邮箱拆分：isOwnMessage 对 project@ 发出的信返回 true", isOwnMessage({ labelIds: [], from: "\"Qyan-Sunny Purchasing\" <project@sunnyshutter.ca>" }, own));
  ok("邮箱拆分：供应商的信返回 false", !isOwnMessage({ labelIds: ["INBOX"], from: "Sales <sales@supplier.example>" }, own));
  let asked = "";
  const deps = { ...makeDeps(makeWorld(), { messages: [] }), findMailbox: async (e: string) => { asked = e; return null; } };
  await syncOrgInbound({ orgId: "org-1", settingsJson: { tenderRfq: { fromEmail: "project@sunnyshutter.ca", mailboxEmail: "lucas@sunnyshutter.ca" } }, items: [] }, deps);
  ok("邮箱拆分：入站按 mailboxEmail 找授权邮箱", asked === "lucas@sunnyshutter.ca");
}

console.log(`\ntender-rfq inbound-apply: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
