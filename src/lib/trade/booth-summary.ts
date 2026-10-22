/**
 * 展会小结 — 一天录入的速记卡汇总成一段中文，给管理层第二天开馆前看
 *
 * 「展会日」从当地 07:00 到次日 07:00（夜里录到凌晨也算前一天）。数据来自速记卡收据（source = trade_show）：
 * 收据记着每张卡的归一化内容、下游商机 / 草稿；卡上的中文勾选项从「展会」一行读回。
 * 发送：青砚通知 + 微信推送（已绑定的）给管理层；同一天同样张数只发一次，补录后张数变了会再发一版。
 */

import { db } from "@/lib/db";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import { createNotification } from "@/lib/notifications/create";
import { parseBoothCardContext } from "./booth-cards";
import { fromReceiptPayload } from "./website-inquiry-receipts";

export const BOOTH_DAY_START_HOUR = 7;
const A_LIST_MAX = 20;
const MANAGEMENT_ROLES = ["boss", "manager", "admin", "super_admin"];
const MANAGEMENT_ORG_ROLES = ["org_owner", "org_admin"];

const pad = (n: number) => String(n).padStart(2, "0");

/** 时刻所属的展会日（当地日期，07:00 前算前一天） */
export function boothDayOf(now: Date, timeZone: string): string {
  return getLocalTimeParts(new Date(now.getTime() - BOOTH_DAY_START_HOUR * 3_600_000), timeZone).date;
}

/** 当地某天 hh:00 对应的 UTC 时刻 */
function zonedHourToUtc(day: string, hour: number, timeZone: string): Date {
  const guess = Date.parse(`${day}T${pad(hour)}:00:00Z`);
  const p = getLocalTimeParts(new Date(guess), timeZone);
  const offset = Date.parse(`${p.date}T${pad(p.hour)}:${pad(p.minute)}:00Z`) - guess;
  return new Date(guess - offset);
}

export function boothDayWindow(day: string, timeZone: string): { from: Date; to: Date } {
  const from = zonedHourToUtc(day, BOOTH_DAY_START_HOUR, timeZone);
  return { from, to: new Date(from.getTime() + 24 * 3_600_000) };
}

export interface BoothSummaryCard {
  cardNo: string;
  company: string;
  contact: string;
  country: string;
  grade: "A" | "B" | "C" | null;
  sales: string;
  nextStep: string;
  noteOriginal: string;
  hasEmail: boolean;
  /** pending / executed / … ；null = 没有草稿 */
  draftStatus: string | null;
  unknownStyles: string[];
}

export interface BoothSummary {
  day: string;
  event: string | null;
  cards: BoothSummaryCard[];
}

function gradeOf(v: string | undefined): BoothSummaryCard["grade"] {
  return v === "A" || v === "B" || v === "C" ? v : null;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** 某个展会日录入的卡（按卡号排序） */
export async function collectBoothSummary(orgId: string, day: string, timeZone: string): Promise<BoothSummary> {
  const { from, to } = boothDayWindow(day, timeZone);
  const receipts = await db.websiteInquiryReceipt.findMany({
    where: { orgId, source: "trade_show", duplicateOfReceiptId: null, firstSeenAt: { gte: from, lt: to } },
    select: { eventId: true, payload: true, interactionId: true, pendingActionId: true },
    orderBy: { eventId: "asc" },
  });
  const interactionIds = receipts.map((r) => r.interactionId).filter((v): v is string => Boolean(v));
  const actionIds = receipts.map((r) => r.pendingActionId).filter((v): v is string => Boolean(v));
  const [interactions, actions] = await Promise.all([
    interactionIds.length
      ? db.customerInteraction.findMany({ where: { orgId, id: { in: interactionIds } }, select: { id: true, analysisResult: true } })
      : [],
    actionIds.length ? db.pendingAction.findMany({ where: { orgId, id: { in: actionIds } }, select: { id: true, status: true } }) : [],
  ]);
  const metaById = new Map(interactions.map((i) => [i.id, (i.analysisResult ?? {}) as Record<string, unknown>]));
  const statusById = new Map(actions.map((a) => [a.id, a.status]));

  const cards = receipts.map((r): BoothSummaryCard => {
    const v = fromReceiptPayload(r.payload);
    const ctx = parseBoothCardContext(v.page);
    const meta = (r.interactionId && metaById.get(r.interactionId)) || {};
    const styles = Array.isArray(meta.styles) ? (meta.styles as Array<{ code?: unknown; name?: unknown }>) : [];
    return {
      cardNo: r.eventId.replace(/^card:/, ""),
      company: v.company,
      contact: v.name,
      country: v.country,
      grade: gradeOf(ctx.grade),
      sales: ctx.sales ?? "",
      nextStep: ctx.nextStep ?? "",
      noteOriginal: ctx.noteOriginal ?? "",
      hasEmail: Boolean(v.email),
      draftStatus: (r.pendingActionId && statusById.get(r.pendingActionId)) || null,
      unknownStyles: styles.filter((st) => typeof st.code === "string" && !st.name).map((st) => st.code as string),
    };
  });
  return { day, event: mostCommon(receipts.map((r) => fromReceiptPayload(r.payload).utm.campaign)), cards };
}

/** 小结正文（纯函数）：总数和等级、待审批、只有 WhatsApp、草稿未完成、A 级名单、不在参考表的款号 */
export function formatBoothSummary(s: BoothSummary): { title: string; text: string } {
  const [, mm, dd] = s.day.split("-");
  const date = `${Number(mm)}/${Number(dd)}`;
  const count = (g: BoothSummaryCard["grade"]) => s.cards.filter((c) => c.grade === g).length;
  const a = s.cards.filter((c) => c.grade === "A");
  const title = `展会小结 ${date}：录入 ${s.cards.length} 张，A 级 ${a.length} 张`;
  if (!s.cards.length) return { title, text: `【展会小结】${date}\n当天没有录入速记卡。` };

  const lines: string[] = [];
  lines.push(`【展会小结】${s.event ? `${s.event} · ` : ""}${date}`);
  lines.push(`录入 ${s.cards.length} 张：A ${count("A")} · B ${count("B")} · C ${count("C")}`);
  const pending = s.cards.filter((c) => c.draftStatus === "pending").length;
  const sent = s.cards.filter((c) => c.draftStatus === "executed").length;
  lines.push(`跟进邮件：待审批 ${pending} 封${sent ? `，已发出 ${sent} 封` : ""}（青砚 → 审批中心）`);
  const wa = s.cards.filter((c) => !c.hasEmail);
  if (wa.length) lines.push(`只有 WhatsApp ${wa.length} 张，请用 WhatsApp 跟进：${wa.map((c) => `${c.cardNo} ${c.company || c.contact}`).join("；")}`);
  const unfinished = s.cards.filter((c) => c.hasEmail && !c.draftStatus);
  if (unfinished.length) lines.push(`草稿未完成 ${unfinished.length} 张（重新上传当天的表格即可补齐）：${unfinished.map((c) => c.cardNo).join("、")}`);

  if (a.length) {
    lines.push("");
    lines.push(`A 级 ${a.length} 张，今天排报价 / 寄样：`);
    a.slice(0, A_LIST_MAX).forEach((c, i) => {
      const who = [c.company, c.country && `（${c.country}）`, c.contact && ` ${c.contact}`].filter(Boolean).join("");
      const tail = [c.nextStep && `下一步：${c.nextStep}`, c.sales && `业务员 ${c.sales}`, c.cardNo].filter(Boolean).join(" · ");
      lines.push(`${i + 1}. ${who} · ${tail}`);
      if (c.noteOriginal) lines.push(`   备注：${c.noteOriginal}`);
    });
    if (a.length > A_LIST_MAX) lines.push(`…另 ${a.length - A_LIST_MAX} 张见青砚「重点线索」`);
  }

  const unknown = new Map<string, number>();
  for (const c of s.cards) for (const code of c.unknownStyles) unknown.set(code, (unknown.get(code) ?? 0) + 1);
  if (unknown.size) {
    lines.push("");
    lines.push(`不在参考表的款号（请补进款号参考表）：${[...unknown].map(([code, n]) => (n > 1 ? `${code}（${n}）` : code)).join("、")}`);
  }
  return { title, text: lines.join("\n") };
}

/** 管理层：平台角色老板 / 经理 / 管理员，或组织所有者 / 管理员（在职） */
async function managementOf(orgId: string): Promise<string[]> {
  const members = await db.organizationMember.findMany({
    where: { orgId, status: "active" },
    select: { userId: true, role: true, user: { select: { role: true } } },
  });
  return members.filter((m) => MANAGEMENT_ORG_ROLES.includes(m.role) || MANAGEMENT_ROLES.includes(m.user.role ?? "")).map((m) => m.userId);
}

/**
 * 发给管理层：青砚通知 + 微信推送。同一天、同样张数只发一次（sourceKey），补录后张数变了再发新的一版。
 * 当天没有卡不发。
 */
export async function sendBoothSummary(
  orgId: string,
  day: string,
  timeZone: string,
  opts?: { push?: (userId: string, title: string, text: string) => Promise<unknown> },
): Promise<{ total: number; recipients: number; sent: number }> {
  const summary = await collectBoothSummary(orgId, day, timeZone);
  if (!summary.cards.length) return { total: 0, recipients: 0, sent: 0 };
  const { title, text } = formatBoothSummary(summary);
  const recipients = await managementOf(orgId);
  const push =
    opts?.push ??
    (async (userId: string, t: string, body: string) => {
      const { pushNotification } = await import("@/lib/messaging/push-service");
      return pushNotification(userId, t, body);
    });

  let sent = 0;
  for (const userId of recipients) {
    const sourceKey = `booth-summary:${orgId}:${day}:${summary.cards.length}:${userId}`;
    const existing = await db.notification.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) continue;
    await createNotification({
      userId,
      orgId,
      type: "trade_booth_summary",
      category: "trade",
      title,
      summary: text,
      entityType: "trade_booth_summary",
      entityId: day,
      priority: "high",
      sourceKey,
      metadata: { day, total: summary.cards.length },
    });
    sent++;
    await push(userId, title, text).catch((e) => console.warn("[booth-summary] 微信推送失败：", e instanceof Error ? e.message : e));
  }
  return { total: summary.cards.length, recipients: recipients.length, sent };
}
