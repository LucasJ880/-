/**
 * Tender RFQ（P1-4）— 供应商回信 → 结构化报价
 *
 * 分工：确定性代码把正文/附件转成纯文本；LLM 只负责"读"（输出 inboundQuoteSchema JSON）；
 * 代码负责"信不信"：每个字段的 evidence 必须逐字出现在纯文本里，且值必须出现在 evidence 里，
 * 否则该字段作废（当作未填）。图片附件不 OCR，只记录"未解析"。
 *
 * LLM 调用通过 deps.complete 注入（测试用假实现）。
 */

import { extractDatesYmd } from "@/lib/tender-understanding/normalize";
import {
  INBOUND_CONTRACT_VERSION,
  inboundQuoteSchema,
  numberInEvidence,
  normalizeEvidenceText,
  verifyEvidence,
  type InboundQuote,
} from "./inbound-contract";

/* ---------------------------------- 类型 ---------------------------------- */

export type InboundAttachmentInput = {
  filename: string;
  mimeType: string;
  /** null = 未下载（超大小上限） */
  data: Buffer | null;
};

export type ParseInboundQuoteInput = {
  bodyText: string;
  attachments: InboundAttachmentInput[];
  emailDate: Date;
  /** RFQ 里的强制要求编号（mandatoryAnswers 只接受这些） */
  mandatoryCodes?: string[];
  /** 仅作提示，不参与校验 */
  firstTierQty?: number | null;
  /** 成本观测 / 月费用预检 */
  orgId?: string;
  userId?: string;
};

export type ParseCompleteFn = (opts: {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  workflow: string;
  orgId?: string;
  userId?: string;
}) => Promise<string>;

export type ParseInboundDeps = {
  complete?: ParseCompleteFn;
  extractPdfText?: (buffer: Buffer) => Promise<string>;
};

export type RejectedField = { field: string; reason: "EVIDENCE_NOT_IN_TEXT" | "VALUE_NOT_IN_EVIDENCE" | "NOT_DERIVABLE" | "UNKNOWN_CODE" };

/** 校验后的报价：InboundQuote 的字段都已过证据闸；missingFields 留给 planInquiryItemUpdate 按规则重算 */
export type ParsedQuote = InboundQuote & {
  /** 由"N 天有效"按邮件日期推算出的 validUntil */
  validUntilInferred: boolean;
  /** 被证据闸作废的字段（写进 AuditLog 便于复核） */
  rejected: RejectedField[];
};

export class InboundParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboundParseError";
  }
}

export const INBOUND_PARSE_WORKFLOW = "tender_rfq_inbound_parse";

/** 送给 LLM 的纯文本上限（证据也只在这段文本里校验） */
const MAX_LLM_TEXT_CHARS = 16_000;

/* ---------------------------------- 纯文本化 ---------------------------------- */

/**
 * 去掉回信里引用的原询价（"On … wrote:" / "在 … 写道：" / Outlook 原始邮件头 / ">" 行）。
 * 否则 LLM 可以从我们自己发出的询价正文里摘到"数量 1500""交期 60 天"并通过证据校验。
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^On\b.+\bwrote:\s*$/i.test(t)) break;
    if (/^在.+写道[:：]\s*$/.test(t)) break;
    if (/^-{2,}\s*(Original Message|原始邮件|Forwarded message|转发的邮件)/i.test(t)) break;
    if (/^_{8,}\s*$/.test(t)) break;
    if (/^(From|发件人)\s*[:：]/i.test(t)) {
      const next = lines.slice(i + 1, i + 5).map((l) => l.trim());
      if (next.some((l) => /^(Sent|Date|发送时间|日期|时间)\s*[:：]/i.test(l))) break;
    }
    if (t.startsWith(">")) continue;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

type AttachmentKind = "pdf" | "docx" | "xlsx" | "text" | "image" | "other";

function attachmentKind(a: InboundAttachmentInput): AttachmentKind {
  const name = a.filename.toLowerCase();
  const mime = a.mimeType.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (/\.xlsx?$/.test(name) || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "xlsx";
  if (/\.(csv|txt)$/.test(name) || mime === "text/csv" || mime === "text/plain") return "text";
  return "other";
}

async function defaultExtractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer));
  const raw = result.text;
  return Array.isArray(raw) ? raw.join("\n") : String(raw || "");
}

export type AttachmentText = { filename: string; parsed: boolean; text: string; note: string | null };

/** 附件 → 纯文本。任何单个附件失败都不抛：parsed=false + 说明，其它内容照常解析。 */
export async function extractAttachmentTexts(
  attachments: InboundAttachmentInput[],
  deps: Pick<ParseInboundDeps, "extractPdfText"> = {},
): Promise<AttachmentText[]> {
  const out: AttachmentText[] = [];
  for (const a of attachments) {
    const kind = attachmentKind(a);
    if (kind === "image") {
      out.push({ filename: a.filename, parsed: false, text: "", note: "图片附件未解析" });
      continue;
    }
    if (kind === "other") {
      out.push({ filename: a.filename, parsed: false, text: "", note: "附件格式不支持，未解析" });
      continue;
    }
    if (!a.data) {
      out.push({ filename: a.filename, parsed: false, text: "", note: "附件过大，未下载" });
      continue;
    }
    try {
      let text = "";
      if (kind === "pdf") {
        text = await (deps.extractPdfText ?? defaultExtractPdfText)(a.data);
      } else if (kind === "docx") {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ buffer: a.data })).value ?? "";
      } else if (kind === "xlsx") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(a.data, { type: "buffer" });
        text = wb.SheetNames.map((n) => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }).trim();
          return csv ? `[${n}]\n${csv}` : "";
        }).filter(Boolean).join("\n");
      } else {
        text = a.data.toString("utf-8");
      }
      text = text.trim();
      out.push(text
        ? { filename: a.filename, parsed: true, text, note: null }
        : { filename: a.filename, parsed: false, text: "", note: "附件无可提取文本（可能是扫描件）" });
    } catch {
      out.push({ filename: a.filename, parsed: false, text: "", note: "附件无法解析（可能已损坏）" });
    }
  }
  return out;
}

/** LLM 实际看到、证据也在其中校验的文本 */
export function buildInboundText(body: string, attachments: AttachmentText[]): string {
  const parts = [`【邮件正文】\n${body || "（空）"}`];
  for (const a of attachments) {
    if (a.parsed) parts.push(`【附件 ${a.filename}】\n${a.text}`);
  }
  return parts.join("\n\n").slice(0, MAX_LLM_TEXT_CHARS);
}

/* ---------------------------------- 确定性推导（代码说了算） ---------------------------------- */

/** 交期片段 → 天数：天/日/days 原值；周 ×7；月 ×30；工作日 ×7/5 向上取整；区间取上限；"现货" → 0 */
export function deriveDeliveryDays(evidence: string): number | null {
  const t = evidence.normalize("NFKC").toLowerCase();
  const m = t.match(
    /(\d+)(?:\s*[-~～至到]\s*(\d+))?\s*(?:个)?\s*(工作日|business days?|working days?|天|日|calendar days?|days?|周|星期|礼拜|weeks?|wks?|月|months?)/,
  );
  if (m) {
    const n = Math.max(Number(m[1]), m[2] ? Number(m[2]) : 0);
    const unit = m[3];
    if (/^(工作日|business|working)/.test(unit)) return Math.ceil((n * 7) / 5);
    if (/^(周|星期|礼拜|week|wk)/.test(unit)) return n * 7;
    if (/^(月|month)/.test(unit)) return n * 30;
    return n;
  }
  if (/现货|有货|库存充足|in stock|ex-stock|from stock|stock available/.test(t)) return 0;
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 片段中的明确日期（ISO / 英文月份 / 2026年11月30日 / 2026/11/30 / 2026.11.30） */
export function datesIn(snippet: string): string[] {
  const out = new Set(extractDatesYmd(snippet));
  const t = snippet.normalize("NFKC");
  for (const m of t.matchAll(/(\d{4})\s*[年/.]\s*(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?/g)) {
    out.add(`${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`);
  }
  return [...out];
}

/** "有效期 30 天" / "valid for 30 days" → 天数（只认带"有效/valid"的说法） */
export function validityDaysIn(snippet: string): number | null {
  const t = snippet.normalize("NFKC").toLowerCase();
  if (!/有效|valid/.test(t)) return null;
  const m = t.match(/(\d+)\s*(?:个)?\s*(天|日|days?)/);
  return m ? Number(m[1]) : null;
}

export function addDaysYmd(base: Date, days: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const CURRENCY_ALIASES: Record<string, RegExp> = {
  CAD: /\bcad\b|c\$|加元|加币|加拿大元/i,
  USD: /\busd\b|us\$|美元|美金/i,
  CNY: /\bcny\b|\brmb\b|人民币|¥|￥/i,
  EUR: /\beur\b|€|欧元/i,
  GBP: /\bgbp\b|£|英镑/i,
  HKD: /\bhkd\b|hk\$|港币|港元/i,
  JPY: /\bjpy\b|日元/i,
};

/** 币种只在原文明确出现（代码或无歧义别名）时才采信；裸 "$" 有歧义，不算 */
export function currencySupported(text: string, code: string): boolean {
  const c = code.toUpperCase();
  const alias = CURRENCY_ALIASES[c];
  if (alias) return alias.test(text.normalize("NFKC"));
  return new RegExp(`\\b${c}\\b`, "i").test(text);
}

function moqSupported(text: string, moq: number): boolean {
  const t = text.normalize("NFKC");
  for (const m of t.matchAll(/(moq|minimum order(?: quantity)?|最小起订量?|起订量?|最低起订)/gi)) {
    const window = t.slice(m.index ?? 0, (m.index ?? 0) + 40);
    if (numberInEvidence(moq, window)) return true;
  }
  return false;
}

/* ---------------------------------- LLM ---------------------------------- */

const SYSTEM_PROMPT = `你是采购助理，负责读供应商对询价邮件的回信，提取报价。只输出一个 JSON 对象，不要任何解释或 markdown。

JSON 结构（字段名、类型必须完全一致）：
{
  "contractVersion": "${INBOUND_CONTRACT_VERSION}",
  "isQuote": boolean,            // 回信是否给出了报价（哪怕不完整）；只是"收到/稍后报价" → false
  "declined": boolean,           // 明确表示不报价/不接单
  "currency": "CAD" | "USD" | ... | null,   // 三位币种代码；原文没写明 → null
  "prices": [ { "quantity": number|null, "unitPrice": number|null, "totalPrice": number|null, "evidence": "原文片段" } ],
  "deliveryDays": integer|null, "deliveryEvidence": "原文片段"|null,
  "validUntil": "YYYY-MM-DD"|null, "validUntilEvidence": "原文片段"|null,
  "moq": number|null,
  "incoterm": "EXW"|"FOB"|"CIF"|"DDP"|"DAP"|null, "incotermEvidence": "原文片段"|null,
  "mandatoryAnswers": [ { "requirementCode": "R-01", "answer": "满足"|"部分满足"|"不满足"|"未答", "evidence": "原文片段"|null } ],
  "missingFields": [ "price"|"currency"|"deliveryDays"|"validUntil"|"moq"|"incoterm" ],
  "attachmentsSeen": [ { "filename": "...", "parsed": boolean } ]
}

硬规则：
- 每个 evidence 必须是原文里逐字照抄的连续片段（≤200 字），不得改写、翻译、拼接。找不到原文依据的字段一律填 null。
- 价格只接受写了数字的明确报价。"面议""待定""看数量""TBD" → unitPrice/totalPrice 为 null，并把 "price" 放进 missingFields。
- 多档数量报价时 prices 每档一条，quantity 填该档数量。
- 不要换算币种，不要推算总价，不要猜交期或有效期。
- mandatoryAnswers 只针对给出的强制要求编号；供应商没逐条回应的写 "未答"。`;

function buildUserPrompt(text: string, input: ParseInboundQuoteInput, attachmentsSeen: Array<{ filename: string; parsed: boolean }>): string {
  const lines = [
    `邮件日期：${input.emailDate.toISOString().slice(0, 10)}`,
    `询价第一档数量：${input.firstTierQty ?? "未知"}`,
    `强制要求编号：${input.mandatoryCodes?.length ? input.mandatoryCodes.join("、") : "无"}`,
    `附件：${attachmentsSeen.length ? attachmentsSeen.map((a) => `${a.filename}${a.parsed ? "" : "（未解析）"}`).join("、") : "无"}`,
    "",
    "以下是回信纯文本：",
    "---",
    text,
    "---",
  ];
  return lines.join("\n");
}

async function defaultComplete(opts: Parameters<ParseCompleteFn>[0]): Promise<string> {
  const { createCompletion } = await import("@/lib/ai/client");
  return createCompletion({ ...opts, mode: "normal" });
}

function parseJsonLoose(raw: string): unknown {
  const s = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(s);
}

/* ---------------------------------- 证据闸 ---------------------------------- */

/** 逐字段校验；不通过的作废并记入 rejected（纯函数，便于单测） */
export function verifyInboundQuote(raw: InboundQuote, text: string, opts: { emailDate: Date; mandatoryCodes?: string[] }): ParsedQuote {
  const rejected: RejectedField[] = [];
  const reject = (field: string, reason: RejectedField["reason"]) => rejected.push({ field, reason });

  const prices: InboundQuote["prices"] = [];
  raw.prices.forEach((p, i) => {
    const f = `prices[${i}]`;
    if (!verifyEvidence(text, p.evidence)) return reject(f, "EVIDENCE_NOT_IN_TEXT");
    const unitPrice = p.unitPrice != null && numberInEvidence(p.unitPrice, p.evidence) ? p.unitPrice : null;
    const totalPrice = p.totalPrice != null && numberInEvidence(p.totalPrice, p.evidence) ? p.totalPrice : null;
    if (p.unitPrice != null && unitPrice == null) reject(`${f}.unitPrice`, "VALUE_NOT_IN_EVIDENCE");
    if (p.totalPrice != null && totalPrice == null) reject(`${f}.totalPrice`, "VALUE_NOT_IN_EVIDENCE");
    if (unitPrice == null && totalPrice == null) return;
    // 数量不在证据片段里也可能写在别处：此时不作废价格，只清空数量（档位匹配将视为未知）
    const quantity = p.quantity != null && numberInEvidence(p.quantity, p.evidence) ? p.quantity : null;
    prices.push({ quantity, unitPrice, totalPrice, evidence: p.evidence });
  });

  const currency = raw.currency && currencySupported(text, raw.currency) ? raw.currency.toUpperCase() : null;
  if (raw.currency && !currency) reject("currency", "VALUE_NOT_IN_EVIDENCE");

  let deliveryDays: number | null = null;
  let deliveryEvidence: string | null = null;
  if (raw.deliveryEvidence != null || raw.deliveryDays != null) {
    if (!verifyEvidence(text, raw.deliveryEvidence)) reject("deliveryDays", "EVIDENCE_NOT_IN_TEXT");
    else {
      const derived = deriveDeliveryDays(raw.deliveryEvidence!);
      if (derived == null) reject("deliveryDays", "NOT_DERIVABLE");
      else {
        deliveryDays = derived;
        deliveryEvidence = raw.deliveryEvidence;
      }
    }
  }

  let validUntil: string | null = null;
  let validUntilEvidence: string | null = null;
  let validUntilInferred = false;
  if (raw.validUntilEvidence != null || raw.validUntil != null) {
    if (!verifyEvidence(text, raw.validUntilEvidence)) reject("validUntil", "EVIDENCE_NOT_IN_TEXT");
    else {
      const ev = raw.validUntilEvidence!;
      const dates = datesIn(ev);
      const days = validityDaysIn(ev);
      if (raw.validUntil && dates.includes(raw.validUntil)) validUntil = raw.validUntil;
      else if (dates.length === 1) validUntil = dates[0];
      else if (days != null) {
        validUntil = addDaysYmd(opts.emailDate, days);
        validUntilInferred = true;
      }
      if (validUntil) validUntilEvidence = ev;
      else reject("validUntil", "NOT_DERIVABLE");
    }
  }

  const moq = raw.moq != null && moqSupported(text, raw.moq) ? raw.moq : null;
  if (raw.moq != null && moq == null) reject("moq", "VALUE_NOT_IN_EVIDENCE");

  let incoterm: InboundQuote["incoterm"] = null;
  let incotermEvidence: string | null = null;
  if (raw.incoterm) {
    if (!verifyEvidence(text, raw.incotermEvidence)) reject("incoterm", "EVIDENCE_NOT_IN_TEXT");
    else if (!normalizeEvidenceText(raw.incotermEvidence!).includes(raw.incoterm.toLowerCase())) reject("incoterm", "VALUE_NOT_IN_EVIDENCE");
    else {
      incoterm = raw.incoterm;
      incotermEvidence = raw.incotermEvidence;
    }
  }

  const known = new Set(opts.mandatoryCodes ?? []);
  const mandatoryAnswers: InboundQuote["mandatoryAnswers"] = [];
  for (const a of raw.mandatoryAnswers) {
    if (!known.has(a.requirementCode)) {
      reject(`mandatoryAnswers.${a.requirementCode}`, "UNKNOWN_CODE");
      continue;
    }
    if (a.answer !== "未答" && !verifyEvidence(text, a.evidence)) {
      reject(`mandatoryAnswers.${a.requirementCode}`, "EVIDENCE_NOT_IN_TEXT");
      mandatoryAnswers.push({ requirementCode: a.requirementCode, answer: "未答", evidence: null });
      continue;
    }
    mandatoryAnswers.push(a.answer === "未答" ? { ...a, evidence: null } : a);
  }

  return {
    contractVersion: INBOUND_CONTRACT_VERSION,
    isQuote: raw.isQuote || prices.length > 0,
    declined: raw.declined,
    currency,
    prices,
    deliveryDays,
    deliveryEvidence,
    validUntil,
    validUntilEvidence,
    moq,
    incoterm,
    incotermEvidence,
    mandatoryAnswers,
    missingFields: raw.missingFields,
    attachmentsSeen: raw.attachmentsSeen,
    validUntilInferred,
    rejected,
  };
}

/* ---------------------------------- 入口 ---------------------------------- */

/**
 * 解析一封回信。LLM 输出不是合法 JSON / 不符合契约 → 抛 InboundParseError（调用方记 failed、游标照常前进）。
 * attachmentsSeen 以代码实际处理结果为准，覆盖 LLM 自报。
 */
export async function parseInboundQuote(
  input: ParseInboundQuoteInput,
  deps: ParseInboundDeps = {},
): Promise<ParsedQuote & { attachmentNotes: string[] }> {
  const body = stripQuotedReply(input.bodyText);
  const attachments = await extractAttachmentTexts(input.attachments, deps);
  const attachmentsSeen = attachments.map((a) => ({ filename: a.filename, parsed: a.parsed }));
  const attachmentNotes = attachments.filter((a) => a.note).map((a) => `${a.filename}：${a.note}`);
  const text = buildInboundText(body, attachments);

  const complete = deps.complete ?? defaultComplete;
  const raw = await complete({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(text, input, attachmentsSeen),
    temperature: 0,
    maxTokens: 2000,
    workflow: INBOUND_PARSE_WORKFLOW,
    orgId: input.orgId,
    userId: input.userId,
  });

  let json: unknown;
  try {
    json = parseJsonLoose(raw);
  } catch {
    throw new InboundParseError("LLM 返回内容不是合法 JSON");
  }
  const parsed = inboundQuoteSchema.safeParse(json);
  if (!parsed.success) {
    throw new InboundParseError(`LLM 输出不符合 ${INBOUND_CONTRACT_VERSION}：${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".")).join(", ")}`);
  }

  const verified = verifyInboundQuote(parsed.data, text, { emailDate: input.emailDate, mandatoryCodes: input.mandatoryCodes });
  return { ...verified, attachmentsSeen, attachmentNotes };
}
