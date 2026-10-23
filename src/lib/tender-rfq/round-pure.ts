/**
 * Tender RFQ — 轮次决策（纯函数，零 DB）
 */

import { createHash } from "node:crypto";
import type { RfqFactInput } from "./build";
import { TENDER_RFQ_DEFAULTS, type ResolvedTenderRfqSettings, type TenderSendRfqPayload } from "./types";

const DAY = 86_400_000;

/* ---------------------------------- 组织设置 ---------------------------------- */

export function readTenderRfqSettings(settingsJson: unknown, env: NodeJS.ProcessEnv = process.env): ResolvedTenderRfqSettings {
  const raw =
    settingsJson && typeof settingsJson === "object"
      ? ((settingsJson as Record<string, unknown>).tenderRfq as Record<string, unknown> | undefined)
      : undefined;
  const str = (k: string, envKey: string, d: string) => {
    const v = raw?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    const e = env[envKey]?.trim();
    return e || d;
  };
  const num = (k: string, d: number) => {
    const v = raw?.[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
  };
  const fromEmail = str("fromEmail", "TENDER_RFQ_FROM_EMAIL", TENDER_RFQ_DEFAULTS.fromEmail).toLowerCase();
  return {
    fromName: str("fromName", "TENDER_RFQ_FROM_NAME", TENDER_RFQ_DEFAULTS.fromName),
    fromEmail,
    // 授权账号与显示地址可以不同（Gmail「以别名发送」）：缺省 = fromEmail
    mailboxEmail: str("mailboxEmail", "TENDER_RFQ_MAILBOX_EMAIL", fromEmail).toLowerCase(),
    replyLeadDays: num("replyLeadDays", TENDER_RFQ_DEFAULTS.replyLeadDays),
    roundLockDays: num("roundLockDays", TENDER_RFQ_DEFAULTS.roundLockDays),
  };
}

/* ---------------------------------- 轮次锁 ---------------------------------- */

export type ExistingRound = {
  inquiryId: string;
  roundNumber: number;
  status: string;
  createdAt: Date;
  createdByName: string | null;
  /** 该轮已发出的 item 数 */
  sentCount: number;
  /** 该轮是否已有待批的 tender.send_rfq */
  hasPendingSend: boolean;
};

export type RoundLockVerdict =
  | { locked: false }
  | { locked: true; reason: "pending_approval" | "recently_sent"; message: string; inquiryId: string };

/**
 * 同一项目：
 *   - 已有待批的发送草稿 → 锁（告知谁、何时建的）
 *   - 最近 roundLockDays 天内有已发出的轮次且未结束 → 锁（告知谁、何时发的）
 */
export function decideRoundLock(rounds: ExistingRound[], now: Date, roundLockDays: number): RoundLockVerdict {
  const pending = rounds.find((r) => r.hasPendingSend);
  if (pending) {
    return {
      locked: true,
      reason: "pending_approval",
      inquiryId: pending.inquiryId,
      message: `第 ${pending.roundNumber} 轮询价已有一张待批的发送草稿（${pending.createdByName ?? "同事"} 于 ${fmt(pending.createdAt)} 创建），先批或驳回它，不要再建一轮。`,
    };
  }
  const recent = rounds
    .filter((r) => r.sentCount > 0 && r.status !== "completed" && r.status !== "canceled")
    .filter((r) => now.getTime() - r.createdAt.getTime() < roundLockDays * DAY)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (recent) {
    return {
      locked: true,
      reason: "recently_sent",
      inquiryId: recent.inquiryId,
      message: `第 ${recent.roundNumber} 轮询价 ${recent.createdByName ?? "同事"} 已于 ${fmt(recent.createdAt)} 发给 ${recent.sentCount} 家，${roundLockDays} 天内不重复发。要补发给新供应商，请在青砚里往这一轮加人。`,
    };
  }
  return { locked: false };
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/* ---------------------------------- 供应商就绪 ---------------------------------- */

export type SupplierCandidate = { id: string; name: string; contactEmail: string | null; status: string };

export function partitionSuppliers(suppliers: SupplierCandidate[]): {
  ready: Array<SupplierCandidate & { contactEmail: string }>;
  blocked: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
} {
  const ready: Array<SupplierCandidate & { contactEmail: string }> = [];
  const blocked: Array<{ id: string; name: string; reason: "no_email" | "inactive" }> = [];
  for (const s of suppliers) {
    if (s.status !== "active") blocked.push({ id: s.id, name: s.name, reason: "inactive" });
    else if (!s.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail)) blocked.push({ id: s.id, name: s.name, reason: "no_email" });
    else ready.push({ ...s, contactEmail: s.contactEmail.trim() });
  }
  return { ready, blocked };
}

/* ---------------------------------- 发件账号 ---------------------------------- */

export type SenderProvider = { userId: string; accountEmail: string; grantedScopes: string | null };

export type SenderVerdict =
  | { ok: true; userId: string }
  | { ok: false; errorCode: "SENDER_NOT_CONNECTED" | "SENDER_NO_COMPOSE_SCOPE"; message: string };

/**
 * 执行时只允许用组织配置的授权邮箱（mailboxEmail）发出；谁审批不影响发件人。
 * From / Reply-To 显示的是 fromEmail（可以是该账号的 Gmail 别名），与这里查的账号分开。
 */
export function resolveSender(
  providers: SenderProvider[],
  mailboxEmail: string,
  hasComposeScope: (scopes: string | null) => boolean,
): SenderVerdict {
  const p = providers.find((x) => x.accountEmail.toLowerCase() === mailboxEmail.toLowerCase());
  if (!p) {
    return {
      ok: false,
      errorCode: "SENDER_NOT_CONNECTED",
      message: `授权邮箱 ${mailboxEmail} 未连接：请用该邮箱登录青砚 → 设置 → 连接 Gmail，再审批发送。`,
    };
  }
  if (!hasComposeScope(p.grantedScopes)) {
    return {
      ok: false,
      errorCode: "SENDER_NO_COMPOSE_SCOPE",
      message: `授权邮箱 ${mailboxEmail} 的 Gmail 授权缺少 compose 权限，请重新授权后再审批发送。`,
    };
  }
  return { ok: true, userId: p.userId };
}

/* ---------------------------------- 关键事实读取 ---------------------------------- */

/**
 * summaryJson.criticalFacts[type] 兼容三种形状：{status:"KNOWN", factId} / {status:"KNOWN", text} / 字符串。
 * 返回 factId（优先，调用方再查 TenderAnalysisFact 取置信与原文）或直接文本。
 */
export function readCriticalFactSlot(summaryJson: unknown, type: string): { factId: string } | { text: string } | null {
  const cf = (summaryJson as Record<string, unknown> | null)?.criticalFacts as Record<string, unknown> | undefined;
  const slot = cf?.[type];
  if (typeof slot === "string") return slot.trim() ? { text: slot.trim() } : null;
  if (slot && typeof slot === "object") {
    const o = slot as { status?: unknown; factId?: unknown; text?: unknown; value?: unknown };
    if (o.status !== undefined && o.status !== "KNOWN") return null;
    if (typeof o.factId === "string" && o.factId) return { factId: o.factId };
    const t = typeof o.text === "string" ? o.text : typeof o.value === "string" ? o.value : "";
    return t.trim() && t.trim().toUpperCase() !== "N/A" ? { text: t.trim() } : null;
  }
  return null;
}

/** 把 slot 文本包装成 RfqFactInput（文本形状视为已确认——它来自人工审阅过的汇总）。 */
export function factFromText(type: string, text: string): RfqFactInput {
  return { type, contentZh: text, contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true };
}

/* ---------------------------------- Payload ---------------------------------- */

export function hashRfqPayloadItems(items: TenderSendRfqPayload["items"]): string {
  const h = createHash("sha256");
  for (const i of items) h.update(`${i.inquiryItemId}|${i.to}|${i.subject}|${i.body}\n`);
  return h.digest("hex").slice(0, 16);
}

/** 审批卡预览：每家一行，不贴正文（正文在青砚里看）。 */
export function previewRfqPayload(p: TenderSendRfqPayload): string {
  const lines = p.items.map((i) => `· ${i.supplierName} <${i.to}>`);
  return `第 ${p.roundNumber} 轮询价，${p.items.length} 封邮件，发件人 "${p.fromName}" <${p.fromEmail}>：\n${lines.join("\n")}\n主题：${p.items[0]?.subject ?? ""}`;
}
