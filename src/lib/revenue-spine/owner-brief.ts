/**
 * Revenue Spine — 老板询盘早报 + 新草稿微信提醒（PRD F5）
 *
 * - formatOwnerBrief：纯函数，四栏计数 + 按评分前 3 封待审批 + 今日询盘页链接
 * - sendOwnerInquiryBrief：照展会小结的做法发给管理层（青砚通知 + 微信），同一组织同一当地日期每人只发一次；
 *   四栏全为 0 不发；只对显式启用外贸模块的组织发
 * - pushNewDraftToApprover：FDE 生成新草稿时微信提醒审批人（policy.notify.wechatOnNewDraft），每人每小时最多一条
 *
 * 微信正文绝不出现买家邮箱或电话：只用评分、国家、来源、公司名（公司名里夹带的邮箱 / 电话会被去掉）。
 * 审批一律回青砚页面看完草稿再批，微信里不提供直接批准。
 */

import { db } from "@/lib/db";
import { resolveAppOrigin } from "@/lib/agent-runtime/workbench-link";
import { createNotification } from "@/lib/notifications/create";
import { parseOrgModulesJson } from "@/lib/tenancy/modules";
import { managementOf } from "@/lib/trade/booth-summary";
import { buildOwnerToday, type OwnerToday, type OwnerTodayCounts } from "./owner-today";
import { opportunitySourceLabel } from "./source-labels";

export type PushFn = (userId: string, title: string, text: string) => Promise<unknown>;

const TOP_APPROVALS = 3;
export const OWNER_TODAY_PATH = "/revenue/today";

const EMAIL_RE = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+/g;
const PHONE_RE = /\+?\(?\d[\d\s().\-/]{5,}\d/g;

/** 去掉文本里的邮箱与电话（7 位以上数字串）；剩下为空则返回 null */
export function stripContactDetails(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(EMAIL_RE, " ")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 7 ? " " : m))
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·,;:—-]+|[\s·,;:—-]+$/g, "")
    .trim();
  return cleaned || null;
}

/** 微信里的买家称呼：公司名（客户没留公司名时系统会拿邮箱 / 电话当名字，这里一律去掉） */
export function safeBuyerName(name: string | null | undefined): string {
  return (stripContactDetails(name) ?? "未留公司名").slice(0, 40);
}

export interface BuyerLine {
  scoreGrade: string | null;
  score: number | null;
  market: string | null;
  source: string | null;
  customerName: string | null;
}

/** "HOT 82 · Canada · 官网 · Maple Home Goods" */
export function buyerLine(b: BuyerLine): string {
  const grade = b.scoreGrade ? `${b.scoreGrade}${b.score !== null && b.score !== undefined ? ` ${b.score}` : ""}` : "未评分";
  const market = stripContactDetails(b.market) ?? "国家未知";
  return [grade, market, opportunitySourceLabel(b.source), safeBuyerName(b.customerName)].join(" · ");
}

function shortDate(day: string): string {
  const [, mm, dd] = day.split("-");
  return `${Number(mm)}/${Number(dd)}`;
}

export function ownerBriefIsEmpty(c: OwnerTodayCounts): boolean {
  return !c.newToday && !c.overdue && !c.approvals && !c.samplesQuotesDue;
}

/** 早报正文（纯函数） */
export function formatOwnerBrief(today: OwnerToday, opts: { origin: string }): { title: string; text: string } {
  const c = today.counts;
  const date = shortDate(today.day);
  const title = `今日询盘 ${date}：新 ${c.newToday} · 超时 ${c.overdue} · 待审批 ${c.approvals} · 样品/报价 ${c.samplesQuotesDue}`;
  const lines: string[] = [];
  lines.push(`【今日询盘】${date}`);
  lines.push(`今日新询盘 ${c.newToday} · 回复超时 ${c.overdue} · 待审批 ${c.approvals} · 样品/报价到期 ${c.samplesQuotesDue}`);
  const top = today.approvals.slice(0, TOP_APPROVALS);
  if (top.length) {
    lines.push("");
    lines.push(`待审批（按评分前 ${top.length} 封）：`);
    top.forEach((a, i) => {
      const o = a.opportunity;
      lines.push(`${i + 1}. ${o ? buyerLine(o) : "未关联商机的回复草稿"}`);
    });
    if (c.approvals > top.length) lines.push(`…另 ${c.approvals - top.length} 封`);
  }
  if (c.overdue && today.overdue[0]) {
    const hours = Math.floor(today.overdue[0].overdueMinutes / 60);
    lines.push("");
    lines.push(`回复超时 ${c.overdue} 条，最久已超 ${hours >= 1 ? `${hours} 小时` : `${today.overdue[0].overdueMinutes} 分钟`}`);
  }
  lines.push("");
  lines.push(`打开处理（先看草稿再批准）：${opts.origin.replace(/\/+$/, "")}${OWNER_TODAY_PATH}`);
  return { title, text: lines.join("\n") };
}

/** 早报只发给显式启用外贸模块的组织（未配置模块的存量组织不发，避免意外推送） */
export function orgHasTradeModule(modulesJson: unknown): boolean {
  return parseOrgModulesJson(modulesJson)?.enabled.includes("trade") === true;
}

const defaultPush: PushFn = async (userId, title, text) => {
  const { pushNotification } = await import("@/lib/messaging/push-service");
  return pushNotification(userId, title, text);
};

export interface OwnerBriefResult {
  skipped: "no_trade_module" | "empty" | null;
  day: string | null;
  counts: OwnerTodayCounts | null;
  recipients: number;
  sent: number;
}

/**
 * 早报：管理层（与展会小结同一规则）。sourceKey = owner-inquiry-brief:<orgId>:<当地日期>:<userId>，
 * 同一天重跑不重发。
 */
export async function sendOwnerInquiryBrief(
  orgId: string,
  timeZone: string,
  opts?: { now?: Date; push?: PushFn; origin?: string },
): Promise<OwnerBriefResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { modulesJson: true } });
  if (!org || !orgHasTradeModule(org.modulesJson)) return { skipped: "no_trade_module", day: null, counts: null, recipients: 0, sent: 0 };

  const today = await buildOwnerToday(orgId, { now: opts?.now, timeZone });
  if (ownerBriefIsEmpty(today.counts)) return { skipped: "empty", day: today.day, counts: today.counts, recipients: 0, sent: 0 };

  const { title, text } = formatOwnerBrief(today, { origin: opts?.origin ?? resolveAppOrigin() });
  const recipients = await managementOf(orgId);
  const push = opts?.push ?? defaultPush;

  let sent = 0;
  for (const userId of recipients) {
    const sourceKey = `owner-inquiry-brief:${orgId}:${today.day}:${userId}`;
    const existing = await db.notification.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) continue;
    await createNotification({
      userId,
      orgId,
      type: "revenue_owner_brief",
      category: "trade",
      title,
      summary: text,
      entityType: "revenue_owner_today",
      entityId: today.day,
      priority: today.counts.overdue || today.counts.approvals ? "high" : "medium",
      sourceKey,
      metadata: { day: today.day, counts: today.counts },
    });
    sent++;
    await push(userId, title, text).catch((e) => console.warn("[owner-brief] 微信推送失败：", e instanceof Error ? e.message : e));
  }
  return { skipped: null, day: today.day, counts: today.counts, recipients: recipients.length, sent };
}

/** 新草稿提醒去重键：同一组织、同一审批人、同一 UTC 小时只推一条 */
export function newDraftPushSourceKey(orgId: string, userId: string, now: Date): string {
  return `revenue-draft-wechat:${orgId}:${userId}:${now.toISOString().slice(0, 13)}`;
}

/** 新草稿提醒正文（纯函数） */
export function formatNewDraftPush(b: BuyerLine, opts: { origin: string }): { title: string; text: string } {
  return {
    title: "新询盘回复草稿待审批",
    text: [
      buyerLine(b),
      `先看草稿再批准：${opts.origin.replace(/\/+$/, "")}${OWNER_TODAY_PATH}`,
      "（一小时内的其他新草稿不再单独提醒）",
    ].join("\n"),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

/**
 * 先占位再推送：用通知的唯一 sourceKey 占住「本小时」，并发的两次 FDE 也只有一次能推。
 * 占位通知标为已读（审批待办通知另有一条），只作去重与留痕。
 */
export async function pushNewDraftToApprover(input: {
  orgId: string;
  userId: string;
  opportunityId: string;
  pendingActionId: string;
  buyer: BuyerLine;
  now?: Date;
  origin?: string;
  push?: PushFn;
}): Promise<{ pushed: boolean; reason?: "duplicate_hour" | "push_failed" }> {
  const now = input.now ?? new Date();
  const { title, text } = formatNewDraftPush(input.buyer, { origin: input.origin ?? resolveAppOrigin() });
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        orgId: input.orgId,
        type: "revenue_draft_wechat",
        category: "trade",
        title,
        summary: text,
        entityType: "revenue_opportunity",
        entityId: input.opportunityId,
        priority: "medium",
        status: "read",
        readAt: now,
        sourceKey: newDraftPushSourceKey(input.orgId, input.userId, now),
        metadata: JSON.stringify({ pendingActionId: input.pendingActionId, opportunityId: input.opportunityId }),
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { pushed: false, reason: "duplicate_hour" };
    throw e;
  }
  try {
    await (input.push ?? defaultPush)(input.userId, title, text);
    return { pushed: true };
  } catch (e) {
    console.warn("[owner-brief] 新草稿微信提醒失败：", e instanceof Error ? e.message : e);
    return { pushed: false, reason: "push_failed" };
  }
}
