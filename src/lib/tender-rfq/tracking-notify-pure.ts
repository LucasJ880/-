/**
 * T-1 rfq-tracking-notify：询价进展通知的纯函数（spec tender/rfq-notifications，design D3–D7）
 *
 * 四类自动事件 → 站内通知的标题、摘要、优先级、对象、去重键与 metadata；不连库、不发信。
 * 收件人补全与投递在 tracking-notify.ts（统一经 deliverCollabNotification）。
 *
 * - 供应商名、项目名各自按 collab/redact 的规则逐段脱敏，再拼进固定模板（D6）；
 *   入参里没有任何价格，标题摘要天然不含金额。
 * - 缺字段标签复用 inbound-contract 的纯表，顺序用 CHASE_FIELD_ORDER（D5）。
 * - 去重键与任务书逐字一致（D4），收件人 id 由投递入口拼在末尾。
 */

import { createHash } from "node:crypto";
import { redactText } from "@/lib/notifications/collab/redact";
import { CHASE_FIELD_ORDER, CHASE_TTL_HOURS, type ChaseKind } from "./chase-pure";
import { INBOUND_MISSING_LABEL, type InboundMissingField } from "./inbound-contract";

export const RFQ_QUOTE_RECEIVED = "rfq_quote_received" as const;
export const RFQ_REPLY_RECEIVED = "rfq_reply_received" as const;
export const RFQ_CHASE_READY = "rfq_chase_ready" as const;
export const RFQ_NO_RESPONSE = "rfq_no_response" as const;
export type RfqNotifyType =
  | typeof RFQ_QUOTE_RECEIVED
  | typeof RFQ_REPLY_RECEIVED
  | typeof RFQ_CHASE_READY
  | typeof RFQ_NO_RESPONSE;

/** 通知对象：询价轮次（跳转 /projects/{projectId}?tab=bid#rfq-round-{entityId}） */
export const RFQ_ROUND_ENTITY_TYPE = "tender_rfq_round" as const;

/** 项目名超过 24 个字截断加「…」 */
export const PROJECT_NAME_MAX_CHARS = 24;
/** 名单超过 3 家写「甲厂、乙厂、丙厂等 k 家」 */
export const NAME_LIST_MAX = 3;

export type RoundRef = {
  inquiryId: string;
  projectId: string;
  projectName: string;
  roundNumber: number;
};

export type TrackingNotice = {
  type: RfqNotifyType;
  priority: "high" | "medium";
  title: string;
  summary: string;
  entityType: typeof RFQ_ROUND_ENTITY_TYPE;
  entityId: string;
  projectId: string;
  /** 去重键前缀（不含收件人 id） */
  sourceKeyPrefix: string;
  metadata: { objectLabel: string };
};

// ── 文字规则 ─────────────────────────────────────────────────────

/** 项目名：先整段脱敏，再按字（不是 UTF-16 码元）截断 */
export function projectLabel(name: string | null | undefined): string {
  const safe = redactText((name ?? "").trim() || "未命名项目");
  const chars = Array.from(safe);
  return chars.length > PROJECT_NAME_MAX_CHARS ? `${chars.slice(0, PROJECT_NAME_MAX_CHARS).join("")}…` : safe;
}

export function supplierLabel(name: string | null | undefined): string {
  return redactText((name ?? "").trim() || "供应商");
}

/** 多家名单：「、」连接；超过 3 家写「甲厂、乙厂、丙厂等 k 家」 */
export function nameList(names: readonly string[]): string {
  const labels = names.map(supplierLabel);
  if (labels.length <= NAME_LIST_MAX) return labels.join("、");
  return `${labels.slice(0, NAME_LIST_MAX).join("、")}等 ${labels.length} 家`;
}

/** 缺的字段：按 价格、币种、交期、有效期、起订量、贸易条款 排序去重，「、」连接 */
export function missingFieldList(fields: readonly InboundMissingField[]): string {
  const set = new Set(fields);
  return CHASE_FIELD_ORDER.filter((f) => set.has(f))
    .map((f) => INBOUND_MISSING_LABEL[f])
    .join("、");
}

/** 邮件里的对象名：项目「{项目}」第 {n} 轮询价 */
export function roundObjectLabel(round: RoundRef): string {
  return `项目「${projectLabel(round.projectName)}」第 ${round.roundNumber} 轮询价`;
}

function notice(round: RoundRef, fields: Pick<TrackingNotice, "type" | "priority" | "title" | "summary" | "sourceKeyPrefix">): TrackingNotice {
  return {
    ...fields,
    entityType: RFQ_ROUND_ENTITY_TYPE,
    entityId: round.inquiryId,
    projectId: round.projectId,
    metadata: { objectLabel: roundObjectLabel(round) },
  };
}

const EXPIRY_NOTE = `${CHASE_TTL_HOURS} 小时内不批会过期。`;

// ── 去重键 ───────────────────────────────────────────────────────

export function quoteSourceKey(itemId: string, messageId: string): string {
  return `${RFQ_QUOTE_RECEIVED}:${itemId}:${messageId}`;
}

export function replySourceKey(itemId: string, messageId: string): string {
  return `${RFQ_REPLY_RECEIVED}:${itemId}:${messageId}`;
}

/** 同一轮、同一批新建卡：actionId 升序后以「,」连接取 sha256 前 16 位（顺序不同键相同） */
export function chaseReadySourceKey(inquiryId: string, actionIds: readonly string[]): string {
  const h = createHash("sha256").update([...actionIds].sort().join(",")).digest("hex").slice(0, 16);
  return `${RFQ_CHASE_READY}:${inquiryId}:${h}`;
}

export function noResponseSourceKey(itemId: string): string {
  return `${RFQ_NO_RESPONSE}:${itemId}`;
}

// ── 四类事件 ─────────────────────────────────────────────────────

export function quoteReceivedNotice(input: {
  round: RoundRef;
  itemId: string;
  messageId: string;
  supplierName: string;
  missingFields: readonly InboundMissingField[];
}): TrackingNotice {
  const p = projectLabel(input.round.projectName);
  const missing = missingFieldList(input.missingFields);
  const n = input.round.roundNumber;
  return notice(input.round, {
    type: RFQ_QUOTE_RECEIVED,
    priority: "medium",
    title: `${supplierLabel(input.supplierName)}报价了 · ${p}`,
    summary: missing
      ? `第 ${n} 轮询价：报价已自动进表；还缺：${missing}。`
      : `第 ${n} 轮询价：报价已自动进表，可以去比价了。`,
    sourceKeyPrefix: quoteSourceKey(input.itemId, input.messageId),
  });
}

export function replyReceivedNotice(input: {
  round: RoundRef;
  itemId: string;
  messageId: string;
  supplierName: string;
}): TrackingNotice {
  return notice(input.round, {
    type: RFQ_REPLY_RECEIVED,
    priority: "medium",
    title: `${supplierLabel(input.supplierName)}回信了，没有报价 · ${projectLabel(input.round.projectName)}`,
    summary: `第 ${input.round.roundNumber} 轮询价：需要你看一眼原文。`,
    sourceKeyPrefix: replySourceKey(input.itemId, input.messageId),
  });
}

export type DraftedCard = {
  actionId: string;
  supplierName: string;
  kind: ChaseKind;
  missingFields: readonly InboundMissingField[];
};

/** 一轮、一次定时检查里新起草的全部卡 → 一条催单待批；没有卡 → null */
export function chaseReadyNotice(input: { round: RoundRef; days: number; cards: readonly DraftedCard[] }): TrackingNotice | null {
  const { round, days, cards } = input;
  if (cards.length === 0) return null;
  const p = projectLabel(round.projectName);
  const n = round.roundNumber;
  const chases = cards.filter((c) => c.kind === "no_reply");
  const asks = cards.filter((c) => c.kind === "missing_fields");
  const askFields = (c: DraftedCard) => missingFieldList(c.missingFields) || "信息";
  const sourceKeyPrefix = chaseReadySourceKey(round.inquiryId, cards.map((c) => c.actionId));

  if (asks.length === 0) {
    const single = chases.length === 1;
    return notice(round, {
      type: RFQ_CHASE_READY,
      priority: "high",
      title: single
        ? `${supplierLabel(chases[0].supplierName)}该催了，催单已起草，等你批准 · ${p}`
        : `${chases.length} 家供应商该催了，催单已起草，等你批准 · ${p}`,
      summary: single
        ? `第 ${n} 轮：超过 ${days} 天没回。${EXPIRY_NOTE}`
        : `第 ${n} 轮：${nameList(chases.map((c) => c.supplierName))}超过 ${days} 天没回。${EXPIRY_NOTE}`,
      sourceKeyPrefix,
    });
  }

  if (chases.length === 0) {
    return notice(round, {
      type: RFQ_CHASE_READY,
      priority: "medium",
      title:
        asks.length === 1
          ? `${supplierLabel(asks[0].supplierName)}的报价缺${askFields(asks[0])}，追问已起草 · ${p}`
          : `${asks.length} 家报价缺信息，追问已起草 · ${p}`,
      summary: `第 ${n} 轮：批准后在原邮件线程里追问。${EXPIRY_NOTE}`,
      sourceKeyPrefix,
    });
  }

  const askPart =
    asks.length === 1
      ? `${supplierLabel(asks[0].supplierName)}报价缺${askFields(asks[0])}`
      : `${nameList(asks.map((c) => c.supplierName))}报价缺信息`;
  return notice(round, {
    type: RFQ_CHASE_READY,
    priority: "high",
    title: `${cards.length} 封催单 / 追问已起草，等你批准 · ${p}`,
    summary: `第 ${n} 轮：${nameList(chases.map((c) => c.supplierName))}超过 ${days} 天没回；${askPart}。${EXPIRY_NOTE}`,
    sourceKeyPrefix,
  });
}

export type NoResponseReason = "two_chases" | "deadline";

export function noResponseNotice(input: {
  round: RoundRef;
  itemId: string;
  supplierName: string;
  reason: NoResponseReason;
}): TrackingNotice {
  const why = input.reason === "two_chases" ? "催了两次仍未回复" : "回复截止已过仍未回复";
  return notice(input.round, {
    type: RFQ_NO_RESPONSE,
    priority: "medium",
    title: `${supplierLabel(input.supplierName)}没有回复，已标未响应 · ${projectLabel(input.round.projectName)}`,
    summary: `第 ${input.round.roundNumber} 轮：${why}。可以换一家供应商再问。`,
    sourceKeyPrefix: noResponseSourceKey(input.itemId),
  });
}

// ── 收件人 ───────────────────────────────────────────────────────

/**
 * 报价 / 回信 / 未响应：项目负责人 ∪ 本轮发起人；催单待批：只给项目负责人
 * （定时检查起草的卡以负责人为发起人，本轮发起人不一定能批，见 design D7）。
 * 在职 / active 成员过滤与去重仍由投递入口再做一遍。
 */
export function trackingRecipients(
  type: RfqNotifyType,
  people: { ownerId: string | null | undefined; roundCreatorId: string | null | undefined },
): string[] {
  const ids = type === RFQ_CHASE_READY ? [people.ownerId] : [people.ownerId, people.roundCreatorId];
  return [...new Set(ids.filter((id): id is string => !!id))];
}
