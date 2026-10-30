/**
 * Tender RFQ（P1-7）— 催单与缺字段追问：决策 + 正文模板（纯函数，零 DB、零 AI）
 *
 * 节奏（任务书 §2.2）：
 *   - 首次催单：sent 超过 chaseAfterDays 未回（项目 owner 偏好 → 组织 tenderRfq.chaseAfterDays → 3 天）；
 *   - 第二次：首次催单发出后再 chaseAfterDays；最多 2 次；
 *   - 第二次发出后再 chaseAfterDays 仍 sent → 标 no_response；
 *   - 回复截止已过：不再起草催单，最后一次联系（询价或催单）满 chaseAfterDays 仍 sent → 直接标 no_response。
 * 追问：replied / quoted 且当前仍缺字段、未追问过 → 起草一次（chaseIndex 固定 1）。
 *
 * 催单计数不加列：从 InquiryItem.contactNotes 的 `chase#N kind=…` 行读（formatChaseNote / parseChaseNotes 成对）。
 * 正文纯代码模板，过 china-supplier-brief 全量敏感模式闸；模板里没有任何我方价格。
 */

import { createHash } from "node:crypto";
import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import type { InboundMissingField } from "./inbound-contract";
import { parseAutoNotes } from "./notes-parse";
import { TENDER_SEND_CHASE_TYPE, type TenderSendChasePayload } from "./types";

export const DEFAULT_CHASE_AFTER_DAYS = 3;
export const CHASE_MAX = 2;
/** 待批催单卡有效期 */
export const CHASE_TTL_HOURS = 48;
/**
 * currency 列有 schema 默认值（CAD），看不出"供应商没写币种"是否已被人工补上：
 * 最新 [auto] 段之后这一行又被人改过（超过这个容差）就视为已人工核对。
 */
const MANUAL_EDIT_GRACE_MS = 15 * 60 * 1000;
const DAY = 86_400_000;

export type ChaseKind = TenderSendChasePayload["kind"];

/* ---------------------------------- 设置 ---------------------------------- */

const validDays = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 60;

/** 首次催单天数：项目 owner 的偏好 > 组织 tenderRfq.chaseAfterDays > 3 */
export function resolveChaseAfterDays(ownerPrefDays: number | null | undefined, orgSettingsJson: unknown): number {
  if (validDays(ownerPrefDays)) return ownerPrefDays;
  const org = (orgSettingsJson as { tenderRfq?: { chaseAfterDays?: unknown } } | null)?.tenderRfq?.chaseAfterDays;
  return validDays(org) ? org : DEFAULT_CHASE_AFTER_DAYS;
}

/* ---------------------------------- contactNotes 里的催单记录 ---------------------------------- */

export type ChaseNote = { index: number; kind: ChaseKind; messageId: string | null; at: Date };

const CHASE_NOTE_RE = /^chase#(\d) kind=(no_reply|missing_fields)(?: messageId=(\S+))? · (\S+)/;

/** 追加到 contactNotes 的一行（首行仍是 P1-3 的 `Gmail messageId=… threadId=…`，P1-4 认领只读首个 threadId） */
export function formatChaseNote(n: { index: number; kind: ChaseKind; messageId: string; at: Date; noMessageIdHeader?: boolean }): string {
  return `chase#${n.index} kind=${n.kind} messageId=${n.messageId} · ${n.at.toISOString()}${n.noMessageIdHeader ? " · 未取到原 Message-ID，仅按 threadId 归线程" : ""}`;
}

export function parseChaseNotes(contactNotes: string | null | undefined): ChaseNote[] {
  const out: ChaseNote[] = [];
  for (const line of (contactNotes ?? "").split("\n")) {
    const m = line.trim().match(CHASE_NOTE_RE);
    if (!m) continue;
    const at = new Date(m[4]);
    if (Number.isNaN(at.getTime())) continue;
    out.push({ index: Number(m[1]), kind: m[2] as ChaseKind, messageId: m[3] ?? null, at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** P1-3 首行里的 Gmail messageId（发催单前用它取原信的 Message-ID 头） */
export function parseRfqMessageId(contactNotes: string | null | undefined): string | null {
  const m = contactNotes?.match(/\bGmail messageId=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function appendContactNote(contactNotes: string | null | undefined, line: string): string {
  const base = (contactNotes ?? "").trimEnd();
  return base ? `${base}\n${line}` : line;
}

/* ---------------------------------- 当前缺字段 ---------------------------------- */

/** 追问时的固定顺序与措辞（任务书 §2.3） */
export const CHASE_FIELD_ORDER: readonly InboundMissingField[] = ["price", "currency", "deliveryDays", "validUntil", "moq", "incoterm"];
const CHASE_FIELD_ASK: Record<InboundMissingField, string> = {
  price: "各档单价",
  currency: "币种",
  deliveryDays: "交期（天）",
  validUntil: "报价有效期",
  moq: "起订量",
  incoterm: "贸易条款",
};

export type ChaseQuoteFields = {
  unitPrice: unknown;
  totalPrice: unknown;
  deliveryDays: number | null;
  validUntil: Date | string | null;
  quoteNotes: string | null;
  updatedAt: Date;
};

/**
 * 现在还缺什么：以最新 [auto] 段的「缺：…」为准，再去掉后来已补上的
 * （价格 / 交期 / 有效期看字段值；币种看 [auto] 段之后有没有人工改过这一行）。
 *
 * 起订量 / 贸易条款：入站按 P1-4 口径不判缺（否则几乎每份报价都成了 missing_fields），这里补问——
 *   - 贸易条款：已报价但所有 [auto] 段都没读到 → 单独就值得追问（落地价换算会卡在「贸易条款未注明」）；
 *   - 起订量：只在本来就要追问时顺带问，不单独发一封。
 * 两者都没有列，人工补录只能体现为 [auto] 段之后这一行被改过（同币种）。
 */
export function currentMissingFields(item: ChaseQuoteFields, opts: { quoted?: boolean } = {}): InboundMissingField[] {
  const notes = parseAutoNotes(item.quoteNotes);
  if (!notes.lastAutoAt) return [];
  const editedAfterAuto = item.updatedAt.getTime() - new Date(notes.lastAutoAt).getTime() > MANUAL_EDIT_GRACE_MS;
  const still = notes.lastMissingFields.filter((f) => {
    if (f === "price") return item.unitPrice == null && item.totalPrice == null;
    if (f === "deliveryDays") return item.deliveryDays == null;
    if (f === "validUntil") return !item.validUntil;
    return !editedAfterAuto;
  });
  if (!editedAfterAuto) {
    if (!notes.incoterm && (opts.quoted || still.length > 0) && !still.includes("incoterm")) still.push("incoterm");
    if (notes.moq == null && still.length > 0 && !still.includes("moq")) still.push("moq");
  }
  return CHASE_FIELD_ORDER.filter((f) => still.includes(f));
}

/* ---------------------------------- 正文模板 ---------------------------------- */

export type ChaseEmailInput = {
  kind: ChaseKind;
  chaseIndex: 1 | 2;
  supplierName: string;
  originalSubject: string;
  sentAt: Date | null;
  /** 回复截止 YYYY-MM-DD；无 → 不写 */
  replyBy: string | null;
  missingFields: readonly InboundMissingField[];
  fromName: string;
};

export function chaseSubject(originalSubject: string): string {
  const s = originalSubject.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function renderChaseEmail(input: ChaseEmailInput): { subject: string; body: string } {
  const L: string[] = [`${input.supplierName} 您好：`, ""];
  if (input.kind === "no_reply") {
    const when = input.sentAt ? `${input.sentAt.getUTCMonth() + 1} 月 ${input.sentAt.getUTCDate()} 日` : "此前";
    L.push(`我们 ${when}的询价还没收到贵司报价${input.replyBy ? `，回复截止 ${input.replyBy}` : ""}，请问是否能报？若不参与请直接告知，方便我们安排。`);
    if (input.chaseIndex === 2) L.push("如本周内无回复我们将视为不参与。");
  } else {
    L.push("感谢报价。为便于比价，还需补充：");
    CHASE_FIELD_ORDER.filter((f) => input.missingFields.includes(f)).forEach((f, i) => L.push(`${i + 1}. ${CHASE_FIELD_ASK[f]}`));
  }
  L.push("", input.fromName);
  return { subject: chaseSubject(input.originalSubject), body: L.join("\n") };
}

export function hashChaseBody(p: Pick<TenderSendChasePayload, "inquiryItemId" | "to" | "threadId" | "subject" | "body">): string {
  return createHash("sha256").update(`${p.inquiryItemId}|${p.to}|${p.threadId}|${p.subject}|${p.body}`).digest("hex").slice(0, 16);
}

/* ---------------------------------- 决策 ---------------------------------- */

/** 该 item 某一次催单的已有审批卡（按 idempotencyKey 前缀查出） */
export type ChaseCardState = {
  slot: string;
  /** live = 待批未过期 / 执行中；rejected = 人驳回了；dead = 过期或执行失败 */
  state: "live" | "rejected" | "dead";
};

export type ChaseItemSnapshot = {
  itemId: string;
  inquiryId: string;
  projectId: string;
  supplierName: string;
  status: string;
  sentAt: Date | null;
  threadId: string | null;
  chases: ChaseNote[];
  cards: ChaseCardState[];
  quote: ChaseQuoteFields;
};

export type ChaseSnapshot = {
  now: Date;
  chaseAfterDays: number;
  /** 轮次回复截止（ProjectInquiry.dueDate） */
  replyBy: Date | null;
  items: ChaseItemSnapshot[];
};

export type ChaseDraftPlan = {
  itemId: string;
  kind: ChaseKind;
  chaseIndex: 1 | 2;
  missingFields: InboundMissingField[];
  idempotencyKey: string;
};

export type ChaseSkipReason =
  | "not_due"
  | "no_thread"
  | "pending_card"
  | "rejected_card"
  | "max_reached"
  | "already_asked"
  | "complete"
  | "quoted"
  | "not_open";

export type ChaseDecision = {
  drafts: ChaseDraftPlan[];
  /** 该标 no_response 的 item */
  noResponse: string[];
  skipped: Array<{ itemId: string; reason: ChaseSkipReason }>;
};

/** 每个 item + 每一次催单一个槽位；同一槽位过期后重起草时加 :r<n> 后缀（草稿层按 idempotencyKey 复用旧卡，含过期的） */
export function chaseSlot(itemId: string, kind: ChaseKind, chaseIndex: number): string {
  return `${TENDER_SEND_CHASE_TYPE}:${itemId}:${kind === "missing_fields" ? "missing_fields" : chaseIndex}`;
}

function slotVerdict(cards: ChaseCardState[], slot: string, manual: boolean): { block: ChaseSkipReason | null; key: string } {
  const mine = cards.filter((c) => c.slot === slot);
  if (mine.some((c) => c.state === "live")) return { block: "pending_card", key: slot };
  if (!manual && mine.some((c) => c.state === "rejected")) return { block: "rejected_card", key: slot };
  return { block: null, key: mine.length ? `${slot}:r${mine.length}` : slot };
}

/** 第二次催单后满 chaseAfterDays 仍 sent，或回复截止已过且最后一次联系满 chaseAfterDays → no_response */
export function decideNoResponse(item: Pick<ChaseItemSnapshot, "status" | "sentAt" | "chases">, now: Date, chaseAfterDays: number, replyBy: Date | null): boolean {
  if (item.status !== "sent" || !item.sentAt) return false;
  const nudges = item.chases.filter((c) => c.kind === "no_reply");
  const lastContact = nudges.length ? nudges[nudges.length - 1].at : item.sentAt;
  const waited = now.getTime() - lastContact.getTime() >= chaseAfterDays * DAY;
  return waited && (nudges.length >= CHASE_MAX || deadlinePassed(replyBy, now));
}

function deadlinePassed(replyBy: Date | null, now: Date): boolean {
  // dueDate 是日期（当天 00:00 UTC）：过了当天才算过期
  return !!replyBy && now.getTime() >= replyBy.getTime() + DAY;
}

/**
 * scan（cron）：只起草到期的；manual（chase 意图）：不看天数，其它规则一样，也不标 no_response。
 */
export function decideChases(s: ChaseSnapshot, opts: { manual?: boolean } = {}): ChaseDecision {
  const manual = !!opts.manual;
  const out: ChaseDecision = { drafts: [], noResponse: [], skipped: [] };
  const skip = (itemId: string, reason: ChaseSkipReason) => out.skipped.push({ itemId, reason });

  for (const item of s.items) {
    if (item.status === "sent") {
      if (!manual && decideNoResponse(item, s.now, s.chaseAfterDays, s.replyBy)) {
        out.noResponse.push(item.itemId);
        continue;
      }
      if (!item.threadId) {
        skip(item.itemId, "no_thread");
        continue;
      }
      const nudges = item.chases.filter((c) => c.kind === "no_reply");
      if (nudges.length >= CHASE_MAX) {
        skip(item.itemId, "max_reached");
        continue;
      }
      if (!manual) {
        if (deadlinePassed(s.replyBy, s.now)) {
          skip(item.itemId, "not_due"); // 截止已过不再催，等 no_response 判断
          continue;
        }
        const last = nudges.length ? nudges[nudges.length - 1].at : item.sentAt;
        if (!last || s.now.getTime() - last.getTime() < s.chaseAfterDays * DAY) {
          skip(item.itemId, "not_due");
          continue;
        }
      }
      const chaseIndex = (nudges.length + 1) as 1 | 2;
      const v = slotVerdict(item.cards, chaseSlot(item.itemId, "no_reply", chaseIndex), manual);
      if (v.block) skip(item.itemId, v.block);
      else out.drafts.push({ itemId: item.itemId, kind: "no_reply", chaseIndex, missingFields: [], idempotencyKey: v.key });
      continue;
    }

    if (item.status === "replied" || item.status === "quoted") {
      const missing = currentMissingFields(item.quote, { quoted: item.status === "quoted" });
      if (missing.length === 0) {
        skip(item.itemId, item.status === "quoted" ? "quoted" : "complete");
        continue;
      }
      if (item.chases.some((c) => c.kind === "missing_fields")) {
        skip(item.itemId, "already_asked");
        continue;
      }
      if (!item.threadId) {
        skip(item.itemId, "no_thread");
        continue;
      }
      const v = slotVerdict(item.cards, chaseSlot(item.itemId, "missing_fields", 1), manual);
      if (v.block) skip(item.itemId, v.block);
      else out.drafts.push({ itemId: item.itemId, kind: "missing_fields", chaseIndex: 1, missingFields: missing, idempotencyKey: v.key });
      continue;
    }

    skip(item.itemId, "not_open");
  }
  return out;
}

/* ---------------------------------- payload ---------------------------------- */

export type BuildChasePayloadInput = {
  plan: ChaseDraftPlan;
  projectId: string;
  inquiryId: string;
  supplierName: string;
  to: string;
  threadId: string;
  originalSubject: string;
  sentAt: Date | null;
  replyBy: string | null;
  fromName: string;
  fromEmail: string;
};

/** 渲染 + 敏感闸 + hash。正文命中 china-supplier-brief 全量模式 → 拒绝起草（不是 scrub）。 */
export function buildChasePayload(input: BuildChasePayloadInput): { ok: true; payload: TenderSendChasePayload } | { ok: false; errorCode: "SENSITIVE_LEAK"; message: string } {
  const mail = renderChaseEmail({
    kind: input.plan.kind,
    chaseIndex: input.plan.chaseIndex,
    supplierName: input.supplierName,
    originalSubject: input.originalSubject,
    sentAt: input.sentAt,
    replyBy: input.replyBy,
    missingFields: input.plan.missingFields,
    fromName: input.fromName,
  });
  // 主题是原询价主题（P1-1 起草时已过闸）原样加 Re:，只闸正文——正文里是称呼、日期、字段名与落款
  if (containsSensitiveSupplierBriefText(mail.body)) {
    return { ok: false, errorCode: "SENSITIVE_LEAK", message: `给「${input.supplierName}」的${input.plan.kind === "no_reply" ? "催单" : "追问"}正文含内部敏感字样，已拒绝起草。` };
  }
  const base = {
    projectId: input.projectId,
    inquiryId: input.inquiryId,
    inquiryItemId: input.plan.itemId,
    supplierName: input.supplierName,
    to: input.to,
    kind: input.plan.kind,
    chaseIndex: input.plan.chaseIndex,
    threadId: input.threadId,
    originalSubject: input.originalSubject,
    subject: mail.subject,
    body: mail.body,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
  };
  return { ok: true, payload: { ...base, bodyHash: hashChaseBody(base) } };
}

/** 审批卡标题：「催 A厂」/「第二次催 A厂」/「追问 B厂缺币种」 */
export function chaseTitle(p: Pick<TenderSendChasePayload, "kind" | "chaseIndex" | "supplierName">, missingFields: readonly InboundMissingField[], projectName: string): string {
  if (p.kind === "no_reply") return `${p.chaseIndex === 2 ? "第二次催" : "催"} ${p.supplierName} — ${projectName}`;
  const labels = missingFields.map((f) => CHASE_FIELD_ASK[f].replace(/（天）/, "")).join("、");
  return `追问 ${p.supplierName}缺${labels} — ${projectName}`;
}

export function previewChasePayload(p: TenderSendChasePayload): string {
  return `${p.kind === "no_reply" ? `第 ${p.chaseIndex} 次催单` : "缺字段追问"}，回复到原询价线程，发件人 "${p.fromName}" <${p.fromEmail}> → ${p.supplierName} <${p.to}>\n主题：${p.subject}\n\n${p.body}`;
}
