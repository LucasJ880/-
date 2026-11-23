/**
 * Tender RFQ（P1-4）— 回信报价 → InquiryItem 写入计划（纯函数，零 DB）
 *
 * §2.4 写入规则全部在这里：
 *   - 只填空字段，绝不覆盖人工已录值；不一致写进 notes；
 *   - 多档价取与询价第一档数量对应的那档；对不上又有多档 → 不猜，全部写 notes；
 *   - currency 解析不到 → 保持默认（CAD）且列入缺字段（默认值 ≠ 供应商说了）；
 *   - quoteNotes 只追加，永不覆盖；
 *   - 有价格 → quoted；无价格但有回信 → replied。
 *
 * ⚠ notesAppend 的格式被 notes-parse.ts（parseAutoNotes，P1-5 比价回读起订量/贸易条款/多档价/强制项）
 *   逐字解析：改这里的措辞或分隔符必须同步改 notes-parse.ts，并跑 __tests__/notes-parse.test.ts 往返测试。
 *   notes-parse.ts 还按这里事实的先后认段（FIX-24 R5）：加字段或调整顺序要同步改它的写入顺序表。
 *
 * FIX-24：供应商可控的文字（附件文件名、币种、已录币种、证据片段）拼进段之前先中和，
 *   让它们开不了新的一块（「；」）、开不了新的一行（换行类字符）、也关不掉证据引号（「"）」）。
 *   只用于显示：查附件说明、写入字段与审计照旧用原文。见 __tests__/notes-forgery.test.ts。
 */

import { toStorableText } from "@/lib/files/extracted-text";
import { INBOUND_MISSING_LABEL, type InboundMissingField } from "./inbound-contract";
import type { AttachmentSeen, ParsedQuote } from "./inbound-parse";

export type ExistingInquiryItem = {
  status: string;
  unitPrice: number | string | { toString(): string } | null;
  totalPrice: number | string | { toString(): string } | null;
  currency: string | null;
  deliveryDays: number | null;
  validUntil: Date | string | null;
  quoteNotes: string | null;
};

export type InquiryItemUpdateData = {
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  deliveryDays?: number;
  validUntil?: string; // YYYY-MM-DD
};

export type InboundEvent = "reply.received" | "quote.parsed" | "missing_fields";

export type InquiryItemUpdatePlan = {
  data: InquiryItemUpdateData;
  /** 追加到 quoteNotes 末尾的一段（调用方负责与原 notes 拼接，不覆盖） */
  notesAppend: string;
  missingFields: InboundMissingField[];
  transition: "quoted" | "replied" | "none";
  /** 期望触发的 Muse 事件（quoted 由 recordQuote 的 hook 推，replied 由 markItemReplied 的 hook 推） */
  events: InboundEvent[];
};

export type PlanMeta = { messageId: string; now: Date; attachmentNotes?: string[] };

/** InquiryItem.currency 的 schema 默认值（prisma: @default("CAD")） */
export const INQUIRY_ITEM_DEFAULT_CURRENCY = "CAD";

export { INBOUND_MISSING_LABEL } from "./inbound-contract";

function toNum(v: ExistingInquiryItem["unitPrice"]): number | null {
  if (v == null) return null;
  const n = Number(typeof v === "object" ? v.toString() : v);
  return Number.isFinite(n) ? n : null;
}

function toYmd(v: Date | string | null): string | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** 控制字符（C0、DEL、C1，含 \n \r \t 与 NEL）与 U+2028、U+2029：回读按行切、按行内容认段 */
function isControlOrLineSeparator(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

function controlsToSpaces(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += isControlOrLineSeparator(code) ? " " : text[i];
  }
  return out;
}

/** 证据引号的收尾：回读把「（证据："」到第一个「"）」之间遮住，片段里自带的会把引号提前关掉 */
const EVIDENCE_CLOSER = /"）/g;
/** 证据引号的开头：拼进段里的非证据文字带着它，会和后面某条证据的收尾配成一对，吞掉中间的字段 */
const EVIDENCE_OPENER = /（证据：/g;

/**
 * FIX-24：拼进段里的非证据文字（附件文件名、币种、已录币种、强制项编号；编号另见 neutralizeRequirementCode）。
 * 控制字符与各类换行 → 空格；全角「；」→ 半角「;」；「"）」→「")」；「（证据：」→「（证据:」（半角冒号）。
 * 不做 NFKC，其它字符原样。
 */
function neutralizeNoteText(text: string): string {
  return controlsToSpaces(text).replace(/；/g, ";").replace(EVIDENCE_CLOSER, '")').replace(EVIDENCE_OPENER, "（证据:");
}

/**
 * 强制项编号：在 neutralizeNoteText 之外，全角「，」「、」也写成半角「,」——回读按「，」切强制项答复、
 * 按「、」切未答编号，编号里带着它们会把一条答复拆成两条（「X，R-01 满足」读出 R-01 满足）。
 */
function neutralizeRequirementCode(code: string): string {
  return neutralizeNoteText(code).replace(/[，、]/g, ",");
}

/** 证据片段：控制字符与各类换行 → 空格，空白归一，最后「"）」→「")」；「；」「，」留着（回读时在引号里被遮住） */
function q(evidence: string | null | undefined): string {
  return evidence
    ? `（证据："${controlsToSpaces(evidence).replace(/\s+/g, " ").trim().replace(EVIDENCE_CLOSER, '")')}"）`
    : "";
}

/**
 * 附件说明（「文件名：说明」）对上文件名：取本封回信里使说明以「文件名：」开头的最长文件名
 * （文件名里带「：」、或两个文件名互为前缀时也对得上）；同名的后一条覆盖前一条。
 */
function attachmentNotesByName(filenames: string[], attachmentNotes: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of attachmentNotes) {
    let best: string | null = null;
    for (const f of filenames) {
      if (n.startsWith(`${f}：`) && (best == null || f.length > best.length)) best = f;
    }
    if (best != null) out.set(best, n.slice(best.length + 1));
  }
  return out;
}

/**
 * FIX-14：附件里有 U+0000 被换成空格（勾选框之类的字形抽不出字）且仍记为已解析时，在「已解析」后注明
 * （措辞按文案审查调整）。这句话里有一个「；」：比价回读（notes-parse.ts）按「；」切开后，
 * 两半分别以「附件：」与「请打开原件」开头，都不进任何回读字段（notes-parse.test.ts 往返测试与
 * extracted-text-other-paths.test.ts「带与不带这句话 parseAutoNotes 结果相同」覆盖）。
 */
function unreadableSymbolsNote(nulCount: number): string {
  return `（有 ${nulCount} 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）`;
}

function attachmentParsedLabel(a: AttachmentSeen): string {
  return a.nulCount && a.nulCount > 0 ? `已解析${unreadableSymbolsNote(a.nulCount)}` : "已解析";
}

/** 多档价选档：与询价第一档数量相同的那档；只有一档时就用它；否则不选（不猜）。 */
export function pickPriceTier(prices: ParsedQuote["prices"], rfqFirstTierQty: number | null): { chosen: ParsedQuote["prices"][number] | null; others: ParsedQuote["prices"] } {
  if (prices.length === 0) return { chosen: null, others: [] };
  if (rfqFirstTierQty != null) {
    const idx = prices.findIndex((p) => p.quantity != null && Math.abs(p.quantity - rfqFirstTierQty) < 1e-9);
    if (idx >= 0) return { chosen: prices[idx], others: prices.filter((_, i) => i !== idx) };
  }
  if (prices.length === 1) return { chosen: prices[0], others: [] };
  return { chosen: null, others: prices };
}

export function planInquiryItemUpdate(
  existingItem: ExistingInquiryItem,
  parsed: ParsedQuote,
  rfqFirstTierQty: number | null,
  emailDate: Date,
  meta: PlanMeta = { messageId: "unknown", now: new Date() },
): InquiryItemUpdatePlan {
  const data: InquiryItemUpdateData = {};
  const facts: string[] = [];
  const conflicts: string[] = [];

  const exUnit = toNum(existingItem.unitPrice);
  const exTotal = toNum(existingItem.totalPrice);
  const exHasPrice = exUnit != null || exTotal != null;

  // ── 价格 ──
  const { chosen, others } = pickPriceTier(parsed.prices, rfqFirstTierQty);
  if (chosen) {
    const qty = chosen.quantity != null ? `（数量 ${chosen.quantity}）` : "";
    if (chosen.unitPrice != null) {
      if (exUnit == null) {
        data.unitPrice = chosen.unitPrice;
        facts.push(`单价=${chosen.unitPrice}${qty}${q(chosen.evidence)}`);
      } else if (Math.abs(exUnit - chosen.unitPrice) > 1e-9) {
        conflicts.push(`回信单价 ${chosen.unitPrice} 与已录 ${exUnit} 不一致${q(chosen.evidence)}`);
      }
    }
    if (chosen.totalPrice != null) {
      if (exTotal == null) {
        data.totalPrice = chosen.totalPrice;
        facts.push(`总价=${chosen.totalPrice}${qty}${q(chosen.evidence)}`);
      } else if (Math.abs(exTotal - chosen.totalPrice) > 1e-9) {
        conflicts.push(`回信报价 ${chosen.totalPrice} 与已录 ${exTotal} 不一致${q(chosen.evidence)}`);
      }
    }
  }
  for (const p of others) {
    const parts = [p.quantity != null ? `数量 ${p.quantity}` : "数量未注明", p.unitPrice != null ? `单价 ${p.unitPrice}` : null, p.totalPrice != null ? `总价 ${p.totalPrice}` : null].filter(Boolean);
    facts.push(`其它档：${parts.join(" ")}${q(p.evidence)}`);
  }
  if (!chosen && others.length > 1) {
    facts.push(`多档报价均不对应询价第一档数量${rfqFirstTierQty != null ? ` ${rfqFirstTierQty}` : "（未知）"}，未自动入表`);
  }

  // ── 币种：列默认值是 CAD，无法区分"默认"与"人工填 CAD"。
  //    只在没有人工价格且仍是默认值时写；已有人工价格、或已被改成非默认值 → 视为人工已定，不覆盖，只记不一致 ──
  const exCur = existingItem.currency?.toUpperCase() ?? null;
  const manualCurrency = exHasPrice || (exCur != null && exCur !== INQUIRY_ITEM_DEFAULT_CURRENCY);
  if (parsed.currency) {
    if (!manualCurrency) {
      if (exCur !== parsed.currency) data.currency = parsed.currency;
      facts.push(`币种=${neutralizeNoteText(parsed.currency)}`);
    } else if (exCur && exCur !== parsed.currency) {
      conflicts.push(`回信币种 ${neutralizeNoteText(parsed.currency)} 与已录 ${neutralizeNoteText(exCur)} 不一致`);
    } else {
      facts.push(`币种=${neutralizeNoteText(parsed.currency)}`);
    }
  }

  // ── 交期 ──
  if (parsed.deliveryDays != null) {
    if (existingItem.deliveryDays == null) {
      data.deliveryDays = parsed.deliveryDays;
      facts.push(`交期=${parsed.deliveryDays}天${q(parsed.deliveryEvidence)}`);
    } else if (existingItem.deliveryDays !== parsed.deliveryDays) {
      conflicts.push(`回信交期 ${parsed.deliveryDays} 天与已录 ${existingItem.deliveryDays} 天不一致${q(parsed.deliveryEvidence)}`);
    }
  }

  // ── 有效期 ──
  if (parsed.validUntil) {
    const exValid = toYmd(existingItem.validUntil);
    const inferred = parsed.validUntilInferred ? `（由邮件日期 ${emailDate.toISOString().slice(0, 10)} 推算）` : "";
    if (!exValid) {
      data.validUntil = parsed.validUntil;
      facts.push(`有效期至=${parsed.validUntil}${inferred}${q(parsed.validUntilEvidence)}`);
    } else if (exValid !== parsed.validUntil) {
      conflicts.push(`回信有效期 ${parsed.validUntil}${inferred} 与已录 ${exValid} 不一致`);
    }
  }

  // ── 只记 notes 的字段（InquiryItem 无对应列） ──
  if (parsed.moq != null) facts.push(`起订量=${parsed.moq}`);
  if (parsed.incoterm) facts.push(`贸易条款=${parsed.incoterm}${q(parsed.incotermEvidence)}`);
  const answered = parsed.mandatoryAnswers.filter((a) => a.answer !== "未答");
  const unanswered = parsed.mandatoryAnswers.filter((a) => a.answer === "未答");
  // FIX-24：强制项编号从询价正文里扫出（含供应商名所在的称呼行），也按非证据文字中和
  if (answered.length) facts.push(`强制项：${answered.map((a) => `${neutralizeRequirementCode(a.requirementCode)} ${a.answer}${q(a.evidence)}`).join("，")}`);
  if (unanswered.length) facts.push(`强制项未答：${unanswered.map((a) => neutralizeRequirementCode(a.requirementCode)).join("、")}`);
  if (parsed.declined) facts.push("供应商明确表示不报价（未自动标记为已拒绝，请人工确认）");

  // ── 缺字段：回信涉及报价时，按"写入后"的值判缺（四个核心字段；起订量/贸易条款只记录不判缺，P1-7 追问时再补问） ──
  const priceAfter = exHasPrice || data.unitPrice != null || data.totalPrice != null;
  const quoteish = !parsed.declined && (parsed.isQuote || parsed.missingFields.length > 0);
  const missingFields: InboundMissingField[] = [];
  if (quoteish) {
    if (!priceAfter) missingFields.push("price");
    if (!parsed.currency && !manualCurrency) missingFields.push("currency");
    if (existingItem.deliveryDays == null && data.deliveryDays == null) missingFields.push("deliveryDays");
    if (!toYmd(existingItem.validUntil) && !data.validUntil) missingFields.push("validUntil");
  }

  // ── 状态 ──
  const status = existingItem.status;
  const newPrice = data.unitPrice != null || data.totalPrice != null;
  let transition: InquiryItemUpdatePlan["transition"] = "none";
  if ((status === "sent" || status === "replied" || status === "quoted") && (newPrice || (exHasPrice && status !== "quoted" && parsed.isQuote))) {
    transition = "quoted";
  } else if (status === "sent") {
    transition = "replied";
  }

  const events: InboundEvent[] = [];
  if (transition === "quoted") events.push(missingFields.length ? "missing_fields" : "quote.parsed");
  if (transition === "replied") {
    events.push("reply.received");
    if (missingFields.length) events.push("missing_fields");
  }

  // ── notes ──
  const segs: string[] = [];
  segs.push(facts.length ? facts.join("；") : parsed.isQuote ? "回信涉及报价但未提取到可核验字段" : "供应商回复（无报价内容）");
  if (conflicts.length) segs.push(conflicts.join("；"));
  if (missingFields.length) segs.push(`缺：${missingFields.map((f) => INBOUND_MISSING_LABEL[f]).join("、")}`);
  if (parsed.attachmentsSeen.length) {
    const notesByName = attachmentNotesByName(parsed.attachmentsSeen.map((a) => a.filename), meta.attachmentNotes ?? []);
    // FIX-24：文件名只在显示时中和；系统写的说明（含 FIX-14 的提示句）原样
    segs.push(`附件：${parsed.attachmentsSeen.map((a) => `${neutralizeNoteText(a.filename)} ${a.parsed ? attachmentParsedLabel(a) : notesByName.get(a.filename) ?? "未解析"}`).join("、")}`);
  }
  // FIX-14：写库前把这次追加的整段清理一遍（证据可能以半个表情符号结尾：按码元仍能在原文里找到）
  const notesAppend = toStorableText(`[auto ${meta.now.toISOString()} msg=${meta.messageId}] ${segs.join("；")}`);

  return { data, notesAppend, missingFields, transition, events };
}

/** 追加而非覆盖 */
export function appendQuoteNotes(existing: string | null | undefined, append: string): string {
  const base = existing?.trim();
  return base ? `${base}\n${append}` : append;
}
