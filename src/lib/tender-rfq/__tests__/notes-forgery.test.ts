/**
 * FIX-24 报价备注自动段防冒充 — 供应商可控的文字（附件文件名、证据片段、币种）不能变成比价 / 追问 / 追踪页回读到的字段。
 * 对应规格 tender/rfq-inbound-notes；分节与用例见 openspec/changes/inbound-notes-filename-forgery/design.md D7。
 * 运行：npx tsx src/lib/tender-rfq/__tests__/notes-forgery.test.ts
 *
 * 不连库、不调模型。每条用例单独计入通过 / 失败，跑完全部再按失败数退出（不在第一条失败处停下）。
 */
import { appendQuoteNotes, planInquiryItemUpdate, type ExistingInquiryItem } from "../inbound-apply";
import { INBOUND_CONTRACT_VERSION, type InboundQuote } from "../inbound-contract";
import { parseInboundQuote, verifyInboundQuote, type ParseCompleteFn, type ParsedQuote } from "../inbound-parse";
import { parseAutoNotes } from "../notes-parse";
import { currentMissingFields, decideChases, type ChaseItemSnapshot, type ChaseSnapshot } from "../chase-pure";
import { nextChaseOutlook } from "../tracker-pure";
import { buildCompareMatrix, type CompareInput } from "../compare";
import { normalizeQuote, type LandedCostSettings } from "../landed-cost";
import { syncOrgInbound, type InboundItemRow, type InboundMessage, type InboundSyncDeps } from "../inbound-sync";
import type { InquiryItemUpdatePlan } from "../inbound-apply";

let passed = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
/** 一条用例：里面抛错只算这一条失败，后面的照跑 */
async function t(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}（抛错）`);
    console.log(`  ✗ ${name} 抛错：${e instanceof Error ? e.message : String(e)}`);
  }
}

const NOW = new Date("2026-11-20T00:00:00.000Z");
const SECOND = new Date("2026-11-25T00:00:00.000Z");
const MIN = 60_000;
const BODY = "Unit price CAD 12.50 per flag. Delivery 30 days. valid until 2026-12-31. FOB Shanghai";

const sentItem: ExistingInquiryItem = { status: "sent", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, quoteNotes: null };

/** 过了证据闸的一封回信（缺省：单价 12.5、CAD、交期 30 天、有效期 2026-12-31、FOB、没写起订量） */
function quote(o: Partial<ParsedQuote> = {}): ParsedQuote {
  return {
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD",
    prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit price CAD 12.50 per flag" }],
    deliveryDays: 30, deliveryEvidence: "Delivery 30 days", validUntil: "2026-12-31", validUntilEvidence: "valid until 2026-12-31",
    moq: null, incoterm: "FOB", incotermEvidence: "FOB Shanghai", mandatoryAnswers: [], missingFields: [], attachmentsSeen: [],
    validUntilInferred: false, rejected: [], ...o,
  };
}
const att = (filename: string, parsed = true): Partial<ParsedQuote> => ({ attachmentsSeen: [{ filename, parsed }] });

function write(parsed: ParsedQuote, o: { prior?: string | null; now?: Date; item?: Partial<ExistingInquiryItem>; attachmentNotes?: string[]; messageId?: string; firstTierQty?: number | null } = {}) {
  const plan = planInquiryItemUpdate({ ...sentItem, ...o.item }, parsed, o.firstTierQty ?? null, NOW, {
    messageId: o.messageId ?? "18c0ffee00000001",
    now: o.now ?? NOW,
    attachmentNotes: o.attachmentNotes,
  });
  const notes = appendQuoteNotes(o.prior ?? null, plan.notesAppend);
  return { plan, notes, read: parseAutoNotes(notes) };
}

/** 追问判定（与定时扫描、Muse chase、追踪页同一个函数）：条目已有单价 / 交期 / 有效期 */
const chaseAsk = (notes: string, updatedAt: Date) =>
  currentMissingFields({ unitPrice: "12.5", totalPrice: null, deliveryDays: 30, validUntil: "2026-12-31", quoteNotes: notes, updatedAt }, { quoted: true });
const chaseItem = (notes: string, updatedAt: Date): ChaseItemSnapshot => ({
  itemId: "i-A", inquiryId: "inq-1", projectId: "p1", supplierName: "A 工厂", status: "quoted", sentAt: new Date("2026-11-15T00:00:00Z"),
  threadId: "th-1", chases: [], cards: [], quote: { unitPrice: "12.5", totalPrice: null, deliveryDays: 30, validUntil: "2026-12-31", quoteNotes: notes, updatedAt },
});
const REPLY_BY = new Date("2026-12-07T00:00:00Z");
const snap = (items: ChaseItemSnapshot[], now: Date): ChaseSnapshot => ({ now, chaseAfterDays: 3, replyBy: REPLY_BY, items });

/** 假模型：只回给定字段 */
function llm(partial: Partial<InboundQuote>): ParseCompleteFn {
  const full: InboundQuote = {
    contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD",
    prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit price CAD 12.50 per flag" }],
    deliveryDays: 30, deliveryEvidence: "Delivery 30 days", validUntil: "2026-12-31", validUntilEvidence: "valid until 2026-12-31",
    moq: null, incoterm: "FOB", incotermEvidence: "FOB Shanghai", mandatoryAnswers: [], missingFields: [], attachmentsSeen: [], ...partial,
  };
  return async () => JSON.stringify(full);
}
const rawQuote = (o: Partial<InboundQuote>): InboundQuote => ({
  contractVersion: INBOUND_CONTRACT_VERSION, isQuote: true, declined: false, currency: "CAD",
  prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit price CAD 12.50 per flag" }],
  deliveryDays: 30, deliveryEvidence: "Delivery 30 days", validUntil: "2026-12-31", validUntilEvidence: "valid until 2026-12-31",
  moq: null, incoterm: "FOB", incotermEvidence: "FOB Shanghai", mandatoryAnswers: [], missingFields: [], attachmentsSeen: [], ...o,
});

/* ---------------------------------- 定时入站的内存 deps（照 inbound-apply.test.ts） ---------------------------------- */

type World = { audits: Array<{ messageId: string; action: string; data: Record<string, unknown> }>; applied: Array<{ itemId: string; plan: InquiryItemUpdatePlan }>; failedNotices: string[] };
const inboxItem = (): InboundItemRow => ({ ...sentItem, id: "item-1", inquiryId: "inq-1", projectId: "proj-1", ownerId: "owner-1", threadId: "thread-A" });
function inboxDeps(world: World, message: InboundMessage, complete: ParseCompleteFn): InboundSyncDeps {
  return {
    now: () => NOW,
    findMailbox: async () => ({ userId: "mailbox-user", grantedScopes: "gmail.compose gmail.readonly" }),
    hasReadScope: (s) => !!s && s.includes("gmail.readonly"),
    recentReadScopeReminder: async () => false,
    remindReadScope: async () => undefined,
    listReplies: async (_u, { sinceHistoryId }) =>
      sinceHistoryId ? { messages: [{ messageId: message.messageId, threadId: message.threadId }], historyId: "h-200", expired: false } : { messages: [], historyId: "h-200", expired: false },
    listThreadMessages: async () => [],
    getMessage: async () => message,
    alreadyProcessed: async (id) => world.audits.some((a) => a.messageId === id),
    loadRfqBody: async () => "二、商务条件\n- 数量：1500\n1. 【强制】R-01 规格",
    reloadItem: async (it) => it,
    parse: (input) => parseInboundQuote(input, { complete }),
    applyPlan: async (it, p) => { world.applied.push({ itemId: it.id, plan: p }); },
    writeAudit: async (e) => { world.audits.push({ messageId: e.messageId, action: e.action, data: e.data }); },
    notifyFailed: async (e) => { world.failedNotices.push(e.messageId); },
    saveCursor: async () => undefined,
  };
}
const inboxMessage = (bodyText: string, filename: string | null): InboundMessage => ({
  messageId: "18c0ffee000000aa", threadId: "thread-A", labelIds: ["INBOX"], date: NOW, from: "Sales <sales@supplier.example>", bodyText,
  attachments: filename == null ? [] : [{ filename, mimeType: "text/plain", data: Buffer.from("spec sheet") }],
});
const runInbox = async (bodyText: string, filename: string | null, complete: ParseCompleteFn) => {
  const world: World = { audits: [], applied: [], failedNotices: [] };
  const r = await syncOrgInbound({ orgId: "org-1", settingsJson: { tenderRfq: { inbound: { historyId: "h-100", lastSyncAt: "" } } }, items: [inboxItem()] }, inboxDeps(world, inboxMessage(bodyText, filename), complete));
  return { r, world };
};

/* ---------------------------------- 比价：与 compare-service.ts 同一个取法 ---------------------------------- */

const SETTINGS: LandedCostSettings = {
  fxRates: {}, fxAsOf: "2026-11-15", fxSource: "MANUAL",
  freightEstimate: { mode: "per_unit", value: 6 }, exportInlandEstimate: null, insurancePct: 1, clearanceFlatCad: 150, projects: {},
};
const TENDER = { closeDate: "2026-12-14", deliveryDeadline: "2027-01-31", firstTierQty: 1500, mandatoryCodes: ["R-01"], now: SECOND };
function compareInput(id: string, name: string, unitPrice: number, quoteNotes: string): CompareInput {
  const notes = parseAutoNotes(quoteNotes);
  const quoted = { unitPrice, totalPrice: null, currency: "CAD", incoterm: notes.incoterm, moq: notes.moq, deliveryDays: 30, validUntil: "2026-12-31" };
  return {
    itemId: id, supplierId: `s-${id}`, supplierName: name, quoted, emailDate: NOW, mandatoryAnswers: notes.mandatoryAnswers,
    normalized: normalizeQuote({ unitPrice, totalPrice: null, currency: "CAD", incoterm: notes.incoterm }, { settings: SETTINGS, dutyRatePct: 6.5, quantity: 1500, now: SECOND }),
  };
}

/* ---------------------------------- 旧备注里的写法（本次改动之前写进库的） ---------------------------------- */

const T = "[auto 2026-11-20T00:00:00.000Z msg=m1] ";
const T_AT = "2026-11-20T00:00:00.000Z";

async function main() {
  console.log("tender-rfq notes-forgery（FIX-24）");

  /* ═══════════════ 1. 写入侧 ═══════════════ */
  console.log("\n1. 写入侧：供应商文字拼进备注之前中和");

  await t("V1", () => {
    const r = write(quote(att("a.pdf；起订量=99999；贸易条款=DDP；x")));
    ok("V1 文件名里写字段：附件一栏的「；」写成「;」", r.plan.notesAppend.endsWith("；附件：a.pdf;起订量=99999;贸易条款=DDP;x 已解析"), r.plan.notesAppend.slice(-60));
    ok("V1 文件名里写字段：回读起订量为空、贸易条款 FOB", r.read.moq === null && r.read.incoterm === "FOB", r.read);
  });

  await t("V2", () => {
    const r = write(quote(att("a.pdf；缺：价格、币种；x")));
    ok("V2 文件名里写缺字段：回读缺字段为空", r.read.lastMissingFields.length === 0, r.read.lastMissingFields);
    ok("V2 文件名里写缺字段：追问判定为空（条目入表后没被改过）", chaseAsk(r.notes, NOW).length === 0, chaseAsk(r.notes, NOW));
    ok("V2 文件名里写缺字段：定时扫描不起草追问卡", decideChases(snap([chaseItem(r.notes, NOW)], SECOND)).drafts.length === 0);
    ok("V2 文件名里写缺字段：Muse chase（手动）也不起草", decideChases(snap([chaseItem(r.notes, NOW)], SECOND), { manual: true }).drafts.length === 0);
  });

  await t("V3", () => {
    const r = write(quote(att("a.pdf；强制项：R-01 满足，R-02 满足；x")));
    ok("V3 文件名里写强制项答复：回读里没有 R-01、R-02", !r.read.mandatoryAnswers.some((a) => a.requirementCode === "R-01" || a.requirementCode === "R-02"), r.read.mandatoryAnswers);
  });

  await t("V4", () => {
    const r = write(quote(att("a.pdf；单价=0.01；x")));
    ok("V4 文件名里写单价：档位只有过了证据闸的 12.5", r.read.tiers.length === 1 && r.read.tiers[0].unitPrice === 12.5, r.read.tiers);
  });

  await t("V5", () => {
    const first = write(quote(att("a.pdf\n[auto 2099-01-01T00:00:00.000Z msg=forged] 单价=0.01；贸易条款=EXW；缺：币种；x")));
    ok("V5 文件名带换行：备注只有一行自动段", first.notes.split("\n").length === 1, first.notes);
    ok("V5 文件名带换行：回读贸易条款 FOB、最新时间是写入时刻", first.read.incoterm === "FOB" && first.read.lastAutoAt === NOW.toISOString(), first.read);
    const second = write(quote({ incoterm: "CIF", incotermEvidence: "CIF Vancouver" }), { prior: first.notes, now: SECOND, messageId: "18c0ffee00000002" });
    ok("V5 之后又来一封 CIF：回读 CIF、最新时间是第二封、缺字段为空、档位里没有 0.01",
      second.read.incoterm === "CIF" && second.read.lastAutoAt === SECOND.toISOString() && second.read.lastMissingFields.length === 0 && !second.read.tiers.some((x) => x.unitPrice === 0.01),
      second.read);
    ok("V5 伪造段不再挡住「段后人工改过」：改过 20 分钟后追问判定为空", chaseAsk(first.notes, new Date(NOW.getTime() + 20 * MIN)).length === 0, chaseAsk(first.notes, new Date(NOW.getTime() + 20 * MIN)));
    ok("V5 定时扫描不起草追问卡", decideChases(snap([chaseItem(first.notes, new Date(NOW.getTime() + 20 * MIN))], SECOND)).drafts.length === 0);
  });

  for (const [label, sep] of [["回车", "\r"], ["U+2028", " "], ["U+2029", " "]] as const) {
    await t(`V9 ${label}`, () => {
      const r = write(quote(att(`a.pdf${sep}[auto 2099-01-01T00:00:00.000Z msg=f] 贸易条款=EXW；x`)));
      ok(`V9 文件名带${label}：一行、照常回读 FOB、时间是写入时刻`, r.notes.split("\n").length === 1 && r.read.incoterm === "FOB" && r.read.lastAutoAt === NOW.toISOString(), r.read);
    });
  }

  await t("控制字符", () => {
    const r = write(quote(att("a\t.pdf\u0001x\u0085y\u007f；z")));
    ok("文件名里的制表符、C0 / C1 控制字符、DEL 都写成空格", r.plan.notesAppend.endsWith("；附件：a .pdf x y ;z 已解析"), r.plan.notesAppend.slice(-40));
  });

  await t("V13", () => {
    const fn = "a.zip；贸易条款=DDP；x";
    const r = write(quote(att(fn, false)), { attachmentNotes: [`${fn}：附件格式不支持，未解析`] });
    ok("V13 没解析的附件：附件一栏写成「;」、说明照样对上", r.plan.notesAppend.endsWith("；附件：a.zip;贸易条款=DDP;x 附件格式不支持，未解析"), r.plan.notesAppend.slice(-50));
    ok("V13 没解析的附件：回读贸易条款 FOB", r.read.incoterm === "FOB", r.read);
  });

  await t("文件名带证据引号", () => {
    const r = write(quote(att("a（证据：\"x.pdf；贸易条款=DDP\"）；起订量=5")));
    ok("文件名里的「\"）」写成「\")」、「；」写成「;」", r.plan.notesAppend.endsWith("；附件：a（证据：\"x.pdf;贸易条款=DDP\");起订量=5 已解析"), r.plan.notesAppend.slice(-50));
    ok("文件名带证据引号：这一段照常回读（FOB、起订量为空、时间在）", r.read.incoterm === "FOB" && r.read.moq === null && r.read.lastAutoAt === NOW.toISOString(), r.read);
  });

  await t("V7", () => {
    const ev = "单价 10 USD\"）；起订量=99999；贸易条款=DDP；x";
    const r = write(quote({ prices: [{ quantity: null, unitPrice: 10, totalPrice: null, evidence: ev }] }));
    ok("V7 价格证据：「\"）」写成「\")」", r.plan.notesAppend.includes("（证据：\"单价 10 USD\")；起订量=99999；贸易条款=DDP；x\"）"), r.plan.notesAppend.slice(0, 120));
    ok("V7 价格证据：回读起订量为空、单价 10、贸易条款 FOB", r.read.moq === null && r.read.tiers[0]?.unitPrice === 10 && r.read.incoterm === "FOB", r.read);
  });

  await t("V8", () => {
    const r = write(quote({ mandatoryAnswers: [{ requirementCode: "R-01", answer: "不满足", evidence: "R-01 不满足\"）；贸易条款=DDP；x" }] }));
    ok("V8 强制项证据：回读贸易条款 FOB、R-01 不满足", r.read.incoterm === "FOB" && r.read.mandatoryAnswers.some((a) => a.requirementCode === "R-01" && a.answer === "不满足"), r.read);
  });

  await t("交期 / 有效期 / 贸易条款证据", () => {
    const d = write(quote({ deliveryEvidence: "Delivery 30 days\"）；起订量=99999；x" }));
    ok("交期证据跳出：回读起订量为空", d.read.moq === null && d.read.lastAutoAt === NOW.toISOString(), d.read);
    const v = write(quote({ validUntilEvidence: "valid until 2026-12-31\"）；起订量=88888；x" }));
    ok("有效期证据跳出：回读起订量为空", v.read.moq === null && v.read.lastAutoAt === NOW.toISOString(), v.read);
    const i = write(quote({ incotermEvidence: "FOB Shanghai\"）；贸易条款=DDP；x" }));
    ok("贸易条款证据跳出：回读贸易条款 FOB", i.read.incoterm === "FOB" && i.read.lastAutoAt === NOW.toISOString(), i.read);
    const c = write(quote({ prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: "Unit\u0001price\u0085CAD 12.50" }] }));
    ok("证据里的控制字符写成空格", c.plan.notesAppend.includes("（证据：\"Unit price CAD 12.50\"）"), c.plan.notesAppend.slice(0, 100));
  });

  await t("V14", () => {
    const r = write(quote(att("报价：最终版.png", false)), { attachmentNotes: ["报价：最终版.png：图片附件未解析"] });
    ok("V14 文件名带「：」：附件说明照样对上", r.plan.notesAppend.endsWith("；附件：报价：最终版.png 图片附件未解析"), r.plan.notesAppend.slice(-40));
  });

  await t("W19", () => {
    const r = write(quote({ attachmentsSeen: [{ filename: "a", parsed: false }, { filename: "a：b.png", parsed: false }] }), { attachmentNotes: ["a：图片附件未解析", "a：b.png：图片附件未解析"] });
    ok("W19 文件名互为前缀：各自对上自己的说明", r.plan.notesAppend.endsWith("；附件：a 图片附件未解析、a：b.png 图片附件未解析"), r.plan.notesAppend.slice(-40));
  });

  await t("V15", () => {
    const spec = write(quote({ currency: "USD" }), { item: { currency: "U；贸易条款=DDP", unitPrice: 12.5 } });
    ok("V15 已录币种带「；」：「不一致」一句写成「;」", spec.plan.notesAppend.includes("回信币种 USD 与已录 U;贸易条款=DDP 不一致"), spec.plan.notesAppend);
    ok("V15 已录币种带「；」：回读贸易条款 FOB", spec.read.incoterm === "FOB", spec.read);
    const inj = write(quote({ currency: "USD" }), { item: { currency: "u；贸易条款=ddp；x\n[auto 2099-01-01T00:00:00.000Z msg=f] 贸易条款=EXW", unitPrice: 12.5 } });
    ok("V15 已录币种另起字段与一行：仍一行、回读 FOB", inj.notes.split("\n").length === 1 && inj.read.incoterm === "FOB" && inj.read.lastAutoAt === NOW.toISOString(), inj.read);
  });

  await t("经入站解析整条链路", async () => {
    const ev = "Unit price CAD 12.50\"）；起订量=99999；贸易条款=DDP；x";
    const parsed = await parseInboundQuote(
      { bodyText: `${BODY}. ${ev}`, attachments: [{ filename: "a.pdf\n[auto 2099-01-01T00:00:00.000Z msg=forged] 贸易条款=EXW；缺：币种；x", mimeType: "text/plain", data: Buffer.from("spec sheet") }], emailDate: NOW },
      { complete: llm({ incoterm: null, incotermEvidence: null, prices: [{ quantity: null, unitPrice: 12.5, totalPrice: null, evidence: ev }] }) },
    );
    ok("链路：跳出引号的证据照样过了证据闸（前提成立）", parsed.prices.length === 1 && parsed.prices[0].evidence === ev, parsed.prices);
    const plan = planInquiryItemUpdate(sentItem, parsed, null, NOW, { messageId: "m", now: NOW, attachmentNotes: parsed.attachmentNotes });
    const back = parseAutoNotes(plan.notesAppend);
    ok("链路：备注一行、起订量为空、贸易条款为空、缺字段为空", plan.notesAppend.split("\n").length === 1 && back.moq === null && back.incoterm === null && back.lastMissingFields.length === 0 && back.lastAutoAt === NOW.toISOString(), back);
  });

  /* ═══════════════ 2. 币种 ═══════════════ */
  console.log("\n2. 币种只认三个拉丁字母");

  await t("币种 (((", () => {
    const v = verifyInboundQuote(rawQuote({ currency: "(((" }), `【邮件正文】\n${BODY}`, { emailDate: NOW });
    ok("「(((」不抛错、作废、记进作废清单", v.currency === null && v.rejected.some((r) => r.field === "currency"), v.rejected);
    const p = planInquiryItemUpdate(sentItem, v, null, NOW, { messageId: "m", now: NOW });
    ok("「(((」：条目币种不改、备注里有「缺：币种」", p.data.currency === undefined && p.notesAppend.includes("缺：币种"), p.notesAppend);
  });

  await t("币种 ((( 经定时入站", async () => {
    const { r, world } = await runInbox(BODY, null, llm({ currency: "(((" }));
    ok("「(((」经定时入站：照常入表、不记解析失败、不发人工录入通知",
      r.failed === 0 && world.audits[0]?.action === "rfq_inbound:applied" && world.failedNotices.length === 0, { r, audits: world.audits.map((a) => a.action) });
  });

  await t("币种 换行AB", () => {
    const v = verifyInboundQuote(rawQuote({ currency: "\nAB" }), `【邮件正文】\n${BODY} x\nAB`, { emailDate: NOW });
    ok("「换行 AB」作废", v.currency === null && v.rejected.some((r) => r.field === "currency"), { currency: v.currency });
    const r = write(v);
    ok("「换行 AB」：这一段交期、有效期、贸易条款照常写、照常回读", r.notes.split("\n").length === 1 && r.read.incoterm === "FOB" && r.plan.notesAppend.includes("交期=30天"), r.read);
  });

  await t("币种 .*.", () => {
    const v = verifyInboundQuote(rawQuote({ currency: ".*." }), `【邮件正文】\n${BODY}`, { emailDate: NOW });
    const p = planInquiryItemUpdate(sentItem, v, null, NOW, { messageId: "m", now: NOW });
    ok("「.*.」作废、条目币种不改", v.currency === null && p.data.currency === undefined, { currency: v.currency, data: p.data });
  });

  await t("币种 usd", () => {
    const v = verifyInboundQuote(rawQuote({ currency: "usd" }), `【邮件正文】\nUnit price USD 12.50 per flag. Delivery 30 days. valid until 2026-12-31. FOB Shanghai`, { emailDate: NOW });
    ok("「usd」照旧转成 USD", v.currency === "USD", v.currency);
  });

  /* ═══════════════ 3. 读取侧：库里已有的旧备注 ═══════════════ */
  console.log("\n3. 读取侧：本次改动之前写进库的备注");

  const legacy = (name: string, notes: string, expect: (r: ReturnType<typeof parseAutoNotes>) => boolean) =>
    t(name, () => {
      const r = parseAutoNotes(notes);
      ok(name, expect(r), r);
    });

  await legacy("L01 附件一栏里写字段 → FOB、起订量为空", `${T}贸易条款=FOB（证据："FOB Shanghai"）；附件：a.pdf；贸易条款=DDP；起订量=99999；x 已解析`, (r) => r.incoterm === "FOB" && r.moq === null);
  await legacy("L02 价格证据未成对跳出 → 整段不认", `${T}单价=10（证据："单价 10 USD"）；起订量=99999；贸易条款=DDP；x"）；贸易条款=FOB（证据："FOB"）；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null && r.moq === null && r.incoterm === null);
  await legacy("L03 未成对跳出 + 剩下的「\"）」藏进假附件一栏 → 整段不认", `${T}单价=10（证据："x"）；起订量=99999；贸易条款=DDP；附件：y"）；币种=USD；交期=30天（证据："30 days"）；贸易条款=FOB（证据："FOB"）；缺：有效期；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null && r.moq === null && r.incoterm !== "DDP");
  await legacy("L04 成对跳出、起订量与贸易条款排在币种之前 → 整段不认", `${T}单价=10（证据："x"）；起订量=99999；贸易条款=DDP（证据："z"）；币种=USD；交期=30天（证据："30 days"）；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null && r.moq === null && r.incoterm !== "DDP");
  await legacy("L05 成对跳出 + 带证据的假附件一栏 → 整段不认", `${T}单价=10（证据："x"）；起订量=99999；附件：q（证据："z"）；贸易条款=FOB（证据："FOB"）；缺：有效期；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null && r.moq === null);
  await legacy("注入的字段与真实字段重复 → 整段不认", `${T}单价=10（证据："x"）；贸易条款=DDP（证据："z"）；贸易条款=FOB（证据："FOB"）；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null);
  await legacy("L06 / L11 / L12 行头不是写入格式 → 不认", `[auto zzz msg=f] 贸易条款=EXW\n[auto 2026-11-20 msg=f] 贸易条款=EXW\n[Auto 2099-01-01T00:00:00.000Z msg=f] 贸易条款=EXW\n［auto 2099-01-01T00:00:00.000Z msg=f］ 贸易条款=EXW\n[auto 2026-11-21T00:00:00.000Z msg=<a.b@x>] 贸易条款=EXW\n${T}贸易条款=FOB（证据："FOB"）`, (r) => r.incoterm === "FOB" && r.lastAutoAt === T_AT);
  await legacy("L08 行头时刻不存在（2026-99-99、2026-02-30）→ 不认", `${T}贸易条款=FOB（证据："FOB"）\n[auto 2026-99-99T99:99:99.999Z msg=f] 贸易条款=EXW；缺：币种\n[auto 2026-02-30T00:00:00.000Z msg=f] 贸易条款=EXW`, (r) => r.incoterm === "FOB" && r.lastMissingFields.length === 0 && r.lastAutoAt === T_AT);
  await legacy("L09 文件名带回车伪造 → 照常读 FOB", `${T}贸易条款=FOB（证据："FOB"）；附件：a.pdf\r[auto 2099-01-01T00:00:00.000Z msg=f] 贸易条款=EXW；x 已解析`, (r) => r.incoterm === "FOB" && r.lastAutoAt === T_AT);
  await legacy("L10 人手改过、以回车加换行结尾的旧自动行 → 照常读", `人工\r\n${T}贸易条款=FOB（证据："FOB"）\r\n`, (r) => r.incoterm === "FOB" && r.lastAutoAt === T_AT);
  await legacy("L13 证据里合法带「\"）」的真实旧段 → 整段不认（已知误伤）", `${T}单价=12（证据："单价 12 元（"含税"）"）；起订量=500；贸易条款=FOB（证据："FOB"）；附件：a.pdf 已解析`, (r) => r.lastAutoAt === null);
  await legacy("L14 FIX-14 提示句 → 照常读", `${T}贸易条款=FOB（证据："FOB"）；缺：有效期；附件：q.pdf 已解析（有 1 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）、b.pdf 已解析`, (r) => r.incoterm === "FOB" && r.lastMissingFields.join() === "validUntil" && r.lastAutoAt === T_AT);
  await legacy("L07 格式正确的 2099 伪造整行：仍生效（靠合并后只读核查 A 段）", `${T}贸易条款=FOB（证据："FOB"）\n[auto 2099-01-01T00:00:00.000Z msg=forged] 贸易条款=EXW；缺：币种`, (r) => r.incoterm === "EXW" && r.lastAutoAt === "2099-01-01T00:00:00.000Z");

  /* ═══════════════ 4. 使用方 ═══════════════ */
  console.log("\n4. 比价、追问、追踪页按同一规则回读");

  await t("比价", () => {
    const a = write(quote({
      prices: [{ quantity: null, unitPrice: 10, totalPrice: null, evidence: "Unit price CAD 10" }],
      attachmentsSeen: [{ filename: "a.pdf；贸易条款=DDP；强制项：R-01 满足；x", parsed: true }],
    }));
    const b = write(quote({ mandatoryAnswers: [{ requirementCode: "R-01", answer: "满足", evidence: "R-01 满足" }] }));
    const m = buildCompareMatrix([compareInput("A", "甲", 10, a.notes), compareInput("B", "乙", 12, b.notes)], TENDER);
    const rowA = m.rows.find((r) => r.itemId === "A")!;
    ok("比价：甲家贸易条款 FOB、强制项部分满足", rowA.quoted.incoterm === "FOB" && rowA.checks.mandatoryOk === "partial", { quoted: rowA.quoted, checks: rowA.checks });
    ok("比价：甲家落地价按 FOB 加运费保险关税算（不等于货值）", rowA.landedCad.total != null && rowA.landedCad.total > 15000, rowA.landedCad);
    ok("比价：推荐的是乙家", m.recommendedItemId === "B", { recommended: m.recommendedItemId });
    ok("比价结果里不出现文件名", !JSON.stringify(m).includes("a.pdf"));
  });

  await t("追踪页", () => {
    const r = write(quote(att("a.pdf；缺：价格、币种；x")));
    const o = nextChaseOutlook(chaseItem(r.notes, NOW), { now: SECOND, chaseAfterDays: 3, replyBy: REPLY_BY });
    ok("追踪页：文件名里写缺字段 → 「系统下一步」为已齐", o.kind === "done", o);
    ok("追踪页「缺什么」为空", chaseAsk(r.notes, NOW).length === 0);
  });

  /* ═══════════════ 5. 不变 ═══════════════ */
  console.log("\n5. 普通回信与写入计划不变");

  const ordinary = quote({
    prices: [
      { quantity: 1500, unitPrice: 42.5, totalPrice: 63750, evidence: "1,500 个：单价 CAD 42.50，总价 63,750；含包装" },
      { quantity: 3000, unitPrice: 40, totalPrice: null, evidence: "3,000 个以上单价 CAD 40.00" },
    ],
    deliveryDays: 35, deliveryEvidence: "交期 35 天", validUntil: "2026-12-31", validUntilEvidence: "报价有效至 2026-12-31",
    moq: 500, incoterm: "DDP", incotermEvidence: "报价为 DDP Ottawa，含关税",
    mandatoryAnswers: [
      { requirementCode: "R-01", answer: "满足", evidence: "R-01：满足，面料 1000D Cordura；已附检测报告" },
      { requirementCode: "R-05", answer: "未答", evidence: null },
    ],
    attachmentsSeen: [{ filename: "quotation.pdf", parsed: true }, { filename: "sample.jpg", parsed: false }],
  });

  await t("逐字不变", () => {
    const p = planInquiryItemUpdate(sentItem, ordinary, 1500, new Date("2026-10-25T09:00:00Z"), { messageId: "18c0ffee00000001", now: new Date("2026-10-25T10:00:00Z"), attachmentNotes: ["sample.jpg：图片附件未解析"] });
    // 期望串取自 main（fbacf6bd）上改动之前的实际输出
    const golden = "[auto 2026-10-25T10:00:00.000Z msg=18c0ffee00000001] 单价=42.5（数量 1500）（证据：\"1,500 个：单价 CAD 42.50，总价 63,750；含包装\"）；总价=63750（数量 1500）（证据：\"1,500 个：单价 CAD 42.50，总价 63,750；含包装\"）；其它档：数量 3000 单价 40（证据：\"3,000 个以上单价 CAD 40.00\"）；币种=CAD；交期=35天（证据：\"交期 35 天\"）；有效期至=2026-12-31（证据：\"报价有效至 2026-12-31\"）；起订量=500；贸易条款=DDP（证据：\"报价为 DDP Ottawa，含关税\"）；强制项：R-01 满足（证据：\"R-01：满足，面料 1000D Cordura；已附检测报告\"）；强制项未答：R-05；附件：quotation.pdf 已解析、sample.jpg 图片附件未解析";
    ok("普通回信：追加的备注与改动前逐字相同", p.notesAppend === golden, p.notesAppend);
    ok("写入计划的键集合不变", JSON.stringify(Object.keys(p)) === JSON.stringify(["data", "notesAppend", "missingFields", "transition", "events"]), Object.keys(p));
  });

  await t("各类字段都有：新条目", () => {
    const r = write({ ...ordinary, currency: "USD", declined: true }, { firstTierQty: 1500 });
    ok("新条目、各类事实（含其它档、强制项答与未答、不报价说明）：照常回读、与写入一致",
      r.read.lastAutoAt === NOW.toISOString() && r.read.moq === 500 && r.read.incoterm === "DDP" && r.read.tiers.length === 2
        && r.read.mandatoryAnswers.map((a) => `${a.requirementCode}:${a.answer}`).join() === "R-01:满足,R-05:未答",
      r.read);
  });

  await t("各类字段都有：五种不一致", () => {
    const r = write(
      quote({ ...ordinary, currency: "USD", deliveryDays: 30, validUntil: "2026-12-31", moq: 300, incoterm: "FOB", incotermEvidence: "FOB Shanghai" }),
      { firstTierQty: 1500, item: { status: "quoted", unitPrice: 11, totalPrice: 16000, currency: "EUR", deliveryDays: 20, validUntil: "2026-12-01" } },
    );
    const conflicts = ["回信单价 ", "回信报价 ", "回信币种 ", "回信交期 ", "回信有效期 "].filter((k) => r.plan.notesAppend.includes(k)).length;
    ok("已录各项都不同 → 五种不一致都写出（前提成立）", conflicts === 5, r.plan.notesAppend);
    ok("五种不一致的段：照常回读、与写入一致", r.read.lastAutoAt === NOW.toISOString() && r.read.moq === 300 && r.read.incoterm === "FOB" && r.read.tiers.length === 1, r.read);
  });

  await t("各类字段都有：多档未入表 + 缺", () => {
    const r = write(quote({
      currency: null,
      prices: [
        { quantity: 1000, unitPrice: 45, totalPrice: null, evidence: "1000 个 45" },
        { quantity: 5000, unitPrice: 38, totalPrice: null, evidence: "5000 个 38" },
      ],
    }), { firstTierQty: 1500 });
    ok("多档未入表的说明 + 缺币种：照常回读两档与缺字段", r.read.lastAutoAt === NOW.toISOString() && r.read.tiers.length === 2 && r.read.lastMissingFields.includes("currency"), r.read);
  });

  await t("审计", async () => {
    const fn = "a.pdf；起订量=99999；x";
    const { r, world } = await runInbox(BODY, fn, llm({}));
    const seen = (world.audits[0]?.data.attachmentsSeen ?? []) as Array<{ filename: string }>;
    ok("审计里是原文件名", r.failed === 0 && seen[0]?.filename === fn, seen);
    ok("报价备注里是中和后的文件名", (world.applied[0]?.plan.notesAppend ?? "").includes("附件：a.pdf;起订量=99999;x"), world.applied[0]?.plan.notesAppend);
  });

  console.log(`\ntender-rfq notes-forgery: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("失败清单：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
