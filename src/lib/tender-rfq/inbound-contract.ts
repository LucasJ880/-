/**
 * Tender RFQ（P1-4）— 回信解析契约 + 证据校验（纯函数，零 DB）
 *
 * 纪律（与 muse-bridge/contract.ts、tender-understanding/verify.ts 一致）：
 *   - LLM 输出必须过 inboundQuoteSchema（版本字面量 + .strip()），不过 → fail-closed；
 *   - 每个字段的 evidence 必须逐字（去空白、NFKC、忽略大小写）出现在本封信的纯文本里，否则作废。
 */

import { z } from "zod";

export const INBOUND_CONTRACT_VERSION = "tender-rfq-inbound/v1" as const;

export const INBOUND_MISSING_FIELDS = ["price", "currency", "deliveryDays", "validUntil", "moq", "incoterm"] as const;
export type InboundMissingField = (typeof INBOUND_MISSING_FIELDS)[number];

export const inboundQuoteSchema = z.object({
  contractVersion: z.literal(INBOUND_CONTRACT_VERSION),
  isQuote: z.boolean(), // false = 只是回复（如"收到，明天给你"）
  declined: z.boolean(), // 明确拒绝报价
  currency: z.string().length(3).nullable(),
  prices: z.array(z.object({
    quantity: z.number().positive().nullable(),
    unitPrice: z.number().positive().nullable(),
    totalPrice: z.number().positive().nullable(),
    evidence: z.string().min(1).max(200),
  })).max(10),
  deliveryDays: z.number().int().min(0).nullable(),
  deliveryEvidence: z.string().max(200).nullable(),
  validUntil: z.string().date().nullable(), // YYYY-MM-DD
  validUntilEvidence: z.string().max(200).nullable(),
  moq: z.number().positive().nullable(),
  incoterm: z.enum(["EXW", "FOB", "CIF", "DDP", "DAP"]).nullable(),
  incotermEvidence: z.string().max(200).nullable(),
  mandatoryAnswers: z.array(z.object({ // 对应 RFQ Q1 逐条回复
    requirementCode: z.string(),
    answer: z.enum(["满足", "部分满足", "不满足", "未答"]),
    evidence: z.string().max(200).nullable(),
  })).max(60),
  missingFields: z.array(z.enum(INBOUND_MISSING_FIELDS)),
  attachmentsSeen: z.array(z.object({ filename: z.string(), parsed: z.boolean() })),
}).strip();

export type InboundQuote = z.infer<typeof inboundQuoteSchema>;

/* ---------------------------------- 证据校验 ---------------------------------- */

/** 去全部空白 + NFKC + 小写：全角/半角、换行、表格对齐空格都不影响逐字比较 */
export function normalizeEvidenceText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** evidence 是否逐字出现在原文里（空 evidence 一律不算） */
export function verifyEvidence(text: string, evidence: string | null | undefined): boolean {
  if (!evidence) return false;
  const e = normalizeEvidenceText(evidence);
  if (!e) return false;
  return normalizeEvidenceText(text).includes(e);
}

/** 片段里出现的全部数字（去千分位逗号），用于"值必须出现在证据里"的二次校验 */
export function numbersIn(snippet: string): number[] {
  const t = snippet.normalize("NFKC");
  const out: number[] = [];
  for (const m of t.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function numberInEvidence(value: number, evidence: string): boolean {
  return numbersIn(evidence).some((n) => Math.abs(n - value) < 1e-9);
}

/* ---------------------------------- contactNotes / RFQ 上下文 ---------------------------------- */

/** P1-3 发信后写入 InquiryItem.contactNotes 的固定格式（P1-4 只认其中的 threadId） */
export function formatRfqContactNotes(messageId: string, threadId: string, at: Date): string {
  return `Gmail messageId=${messageId} threadId=${threadId} · ${at.toISOString()}`;
}

export function parseRfqThreadId(contactNotes: string | null | undefined): string | null {
  const m = contactNotes?.match(/\bthreadId=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * 从已发出的 RFQ 正文（renderRfqEmail 的输出，存于 tender.send_rfq PendingAction payload）
 * 取第一档数量与强制要求编号。零 schema：数量阶梯没有单独落库，发出去的正文就是事实来源。
 */
export function rfqContextFromBody(body: string | null | undefined): { firstTierQty: number | null; mandatoryCodes: string[] } {
  if (!body) return { firstTierQty: null, mandatoryCodes: [] };
  const qtyLine = body.split("\n").find((l) => /^-\s*数量：/.test(l.trim()));
  const firstTierQty = qtyLine && /\d/.test(qtyLine) && !qtyLine.includes("未明确")
    ? numbersIn(qtyLine.replace(/^-\s*数量：/, ""))[0] ?? null
    : null;
  const mandatoryCodes = [...body.matchAll(/【强制】(\S+)/g)].map((m) => m[1]);
  return { firstTierQty, mandatoryCodes: [...new Set(mandatoryCodes)] };
}
