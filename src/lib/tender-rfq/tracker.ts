/**
 * T-2 询价追踪页（服务端取数，只读）
 *
 * - 可见项目：buildProjectVisibilityWhere(user) + 组织 + workDomain=tender；组织由调用方按登录者解析后传入。
 * - 在途条目：chase-service.loadItems（与催单扫描同一口径）+ 近 14 天标为未响应的（只显示）。
 * - 下一步：tracker-pure.nextChaseOutlook，间隔用 chaseDaysForRound（与扫描同一来源）。
 * - 待批催单卡：审批信息与正文复用 W-1 的 loadRfqApprovalInfo / loadRfqSendEmails。
 * - 价格：至少一家已报价的轮次调 loadCompareMatrix，按 itemId 对上；最多 50 轮。按白名单组装，不带估值、我方报价、毛利。
 */

import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import { chaseDaysForRound, loadFollowUpRoundState, loadItems, type LoadedItem } from "./chase-service";
import { currentMissingFields } from "./chase-pure";
import { loadCompareMatrix } from "./compare-service";
import type { CompareRow } from "./compare";
import type { InboundMissingField } from "./inbound-contract";
import { TENDER_SEND_CHASE_TYPE } from "./types";
import {
  NEEDS_ACTION_LABELS,
  classifyNeedsAction,
  nextChaseOutlook,
  quoteCellView,
  trackerRowView,
  trackerSummary,
  type ChaseOutlook,
  type NeedsAction,
  type QuoteCell,
  type TrackerRowView,
  type TrackerSummary,
} from "./tracker-pure";
import { loadRfqApprovalInfo, loadRfqSendEmails, type RfqApprovalInfo, type RfqEmailPreview } from "./web-entry-approval";

export const TRACKER_PROJECT_LIMIT = 200;
export const TRACKER_ROW_LIMIT = 1000;
export const TRACKER_MATRIX_ROUND_LIMIT = 50;
export const NO_RESPONSE_WINDOW_DAYS = 14;

const DAY = 86_400_000;
const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(typeof v === "object" ? String(v) : v);
  return Number.isFinite(n) ? n : null;
};

export type TrackerCard = { actionId: string; approval: RfqApprovalInfo; emails: RfqEmailPreview[] };

export type TrackerRow = {
  itemId: string;
  supplierName: string;
  status: string;
  view: TrackerRowView;
  needsAction: NeedsAction | null;
  needsActionLabel: string | null;
  outlookKind: ChaseOutlook["kind"];
  quote: QuoteCell | null;
  cards: TrackerCard[];
  /** 「现在就催」可用（有邮件线程、没有待批卡、还能催） */
  canChaseNow: boolean;
};

export type TrackerRound = { inquiryId: string; roundNumber: number; replyByText: string | null; compareHref: string; projectHref: string; rows: TrackerRow[] };
export type TrackerGroup = { project: { id: string; name: string }; rounds: TrackerRound[] };

export type TrackerPayload = {
  summary: TrackerSummary;
  groups: TrackerGroup[];
  timeZone: string;
  truncated: boolean;
};

type ExtraFields = { currency: string | null; repliedAt: Date | null; deliveryDays: number | null; validUntil: Date | null; unitPrice: number | null; totalPrice: number | null };

/** 只读；不建卡、不发信、不改任何状态 */
export async function loadTracker(input: { request: NextRequest; user: AuthUser; orgId: string; now?: Date; projectId?: string | null }): Promise<TrackerPayload> {
  const now = input.now ?? new Date();
  const org = await db.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } });
  const timeZone = resolveOrgTimezone(org?.settingsJson ?? null);

  const vis = await buildProjectVisibilityWhere(input.user);
  const projects = await db.project.findMany({
    where: { AND: [vis ?? {}, { orgId: input.orgId, workDomain: "tender" }, ...(input.projectId ? [{ id: input.projectId }] : [])] },
    select: { id: true, name: true, ownerId: true },
    orderBy: { updatedAt: "desc" },
    take: TRACKER_PROJECT_LIMIT + 1,
  });
  let truncated = projects.length > TRACKER_PROJECT_LIMIT;
  const visible = projects.slice(0, TRACKER_PROJECT_LIMIT);
  const empty: TrackerPayload = { summary: trackerSummary([], now), groups: [], timeZone, truncated };
  if (visible.length === 0) return empty;
  const projectIds = visible.map((p) => p.id);

  const items = await loadItems({ orgId: input.orgId, projectIds }, now);
  const noResp = await db.inquiryItem.findMany({
    where: {
      status: "no_response",
      updatedAt: { gte: new Date(now.getTime() - NO_RESPONSE_WINDOW_DAYS * DAY) },
      inquiry: { status: { notIn: ["canceled", "completed"] }, projectId: { in: projectIds } },
    },
    select: {
      id: true,
      sentAt: true,
      contactNotes: true,
      supplier: { select: { name: true } },
      inquiry: { select: { id: true, dueDate: true, projectId: true, roundNumber: true } },
    },
  });

  const allIds = [...items.map((i) => i.snapshot.itemId), ...noResp.map((n) => n.id)];
  if (allIds.length === 0) return empty;

  const extras = new Map<string, ExtraFields>(
    (
      await db.inquiryItem.findMany({
        where: { id: { in: allIds } },
        select: { id: true, currency: true, repliedAt: true, deliveryDays: true, validUntil: true, unitPrice: true, totalPrice: true },
      })
    ).map((r) => [r.id, { currency: r.currency, repliedAt: r.repliedAt, deliveryDays: r.deliveryDays, validUntil: r.validUntil, unitPrice: toNum(r.unitPrice), totalPrice: toNum(r.totalPrice) }]),
  );

  // 待批的催单卡（未过期）：按条目 id 归类
  const liveCards = await db.pendingAction.findMany({
    where: {
      orgId: input.orgId,
      type: TENDER_SEND_CHASE_TYPE,
      status: "pending",
      expiresAt: { gt: now },
      OR: items.map((i) => ({ idempotencyKey: { startsWith: `${TENDER_SEND_CHASE_TYPE}:${i.snapshot.itemId}:` } })),
    },
    select: { id: true, idempotencyKey: true },
    orderBy: { createdAt: "asc" },
  });
  const cardIdsByItem = new Map<string, string[]>();
  for (const c of liveCards) {
    const itemId = (c.idempotencyKey ?? "").split(":")[1];
    if (itemId) cardIdsByItem.set(itemId, [...(cardIdsByItem.get(itemId) ?? []), c.id]);
  }
  const actionIds = liveCards.map((c) => c.id);
  const [approvals, emails] = await Promise.all([
    loadRfqApprovalInfo(input.request, input.user, input.orgId, actionIds),
    loadRfqSendEmails(input.orgId, actionIds),
  ]);

  // 每轮的催单间隔（与扫描同一来源）
  const ownerOf = new Map(visible.map((p) => [p.id, p.ownerId]));
  const roundIds = [...new Set([...items.map((i) => i.inquiryId), ...noResp.map((n) => n.inquiry.id)])];
  const daysByRound = new Map<string, number>();
  for (const it of items) {
    if (daysByRound.has(it.inquiryId)) continue;
    const followUp = await loadFollowUpRoundState(input.orgId, it.inquiryId);
    daysByRound.set(it.inquiryId, chaseDaysForRound(org?.settingsJson ?? null, ownerOf.get(it.snapshot.projectId) ?? it.ownerId, followUp));
  }

  // 比价矩阵：至少一家已报价的轮次，按最近报价时间取前 50 轮
  const quotedRounds = new Map<string, { projectId: string; latest: number }>();
  for (const it of items) {
    if (it.snapshot.status !== "quoted") continue;
    const t = extras.get(it.snapshot.itemId)?.repliedAt?.getTime() ?? 0;
    const prev = quotedRounds.get(it.inquiryId);
    if (!prev || t > prev.latest) quotedRounds.set(it.inquiryId, { projectId: it.snapshot.projectId, latest: t });
  }
  const matrixRounds = [...quotedRounds.entries()].sort((a, b) => b[1].latest - a[1].latest).slice(0, TRACKER_MATRIX_ROUND_LIMIT);
  const matrixLoaded = new Set<string>();
  const matrixRowByItem = new Map<string, Pick<CompareRow, "landedCad" | "flags" | "blockers">>();
  for (const [inquiryId, r] of matrixRounds) {
    const m = await loadCompareMatrix({ projectId: r.projectId, orgId: input.orgId, inquiryId, now });
    matrixLoaded.add(inquiryId);
    if (!m.ok) continue;
    for (const row of m.matrix.rows) matrixRowByItem.set(row.itemId, { landedCad: row.landedCad, flags: row.flags, blockers: row.blockers });
  }

  // 组装行（白名单）
  type Built = TrackerRow & { inquiryId: string; projectId: string; roundNumber: number; replyBy: Date | null; repliedAt: Date | null };
  const built: Built[] = [];
  const quoteOf = (itemId: string, status: string, inquiryId: string): QuoteCell | null => {
    if (status !== "quoted" && status !== "replied") return null;
    const x = extras.get(itemId);
    if (!x || (x.unitPrice == null && x.totalPrice == null)) return null;
    return quoteCellView(
      { unitPrice: x.unitPrice, totalPrice: x.totalPrice, currency: x.currency, deliveryDays: x.deliveryDays, validUntil: x.validUntil },
      matrixRowByItem.get(itemId) ?? null,
      { matrixLoaded: status !== "quoted" || matrixLoaded.has(inquiryId), timeZone },
    );
  };

  for (const it of items as LoadedItem[]) {
    const s = it.snapshot;
    const replyBy = it.roundDueDate;
    const outlook = nextChaseOutlook(s, { now, chaseAfterDays: daysByRound.get(it.inquiryId) ?? 3, replyBy });
    const missing: InboundMissingField[] = s.status === "replied" || s.status === "quoted" ? currentMissingFields(s.quote, { quoted: s.status === "quoted" }) : [];
    const needsAction = classifyNeedsAction({ status: s.status, outlook, missing, replyBy, now });
    const noReplyChases = s.chases.filter((c) => c.kind === "no_reply").length;
    const cards = (cardIdsByItem.get(s.itemId) ?? []).filter((id) => approvals[id]).map((id) => ({ actionId: id, approval: approvals[id], emails: emails[id] ?? [] }));
    built.push({
      itemId: s.itemId,
      supplierName: s.supplierName,
      status: s.status,
      view: trackerRowView({ status: s.status, sentAt: s.sentAt, noReplyChases, outlook, missing, replyBy, hasThread: !!s.threadId }, timeZone, now),
      needsAction,
      needsActionLabel: needsAction ? NEEDS_ACTION_LABELS[needsAction] : null,
      outlookKind: outlook.kind,
      quote: quoteOf(s.itemId, s.status, it.inquiryId),
      cards,
      canChaseNow: !!s.threadId && (outlook.kind === "chase_on" || outlook.kind === "no_response_on" || outlook.kind === "rejected_wait"),
      inquiryId: it.inquiryId,
      projectId: s.projectId,
      roundNumber: it.roundNumber,
      replyBy,
      repliedAt: extras.get(s.itemId)?.repliedAt ?? null,
    });
  }
  for (const n of noResp) {
    const outlook: ChaseOutlook = { kind: "done" };
    built.push({
      itemId: n.id,
      supplierName: n.supplier?.name ?? "供应商",
      status: "no_response",
      view: trackerRowView({ status: "no_response", sentAt: n.sentAt, noReplyChases: 0, outlook, missing: [], replyBy: n.inquiry.dueDate, hasThread: false }, timeZone, now),
      needsAction: null,
      needsActionLabel: null,
      outlookKind: "done",
      quote: null,
      cards: [],
      canChaseNow: false,
      inquiryId: n.inquiry.id,
      projectId: n.inquiry.projectId,
      roundNumber: n.inquiry.roundNumber,
      replyBy: n.inquiry.dueDate,
      repliedAt: null,
    });
  }

  /** 白名单：只把这些字段交给页面 */
  const publicRow = (b: Built): TrackerRow => ({
    itemId: b.itemId,
    supplierName: b.supplierName,
    status: b.status,
    view: b.view,
    needsAction: b.needsAction,
    needsActionLabel: b.needsActionLabel,
    outlookKind: b.outlookKind,
    quote: b.quote,
    cards: b.cards,
    canChaseNow: b.canChaseNow,
  });

  const summary = trackerSummary(built, now);
  let rows = built;
  if (rows.length > TRACKER_ROW_LIMIT) {
    truncated = true;
    // 需要我处理的优先留下
    rows = [...rows].sort((a, b) => Number(b.needsAction != null) - Number(a.needsAction != null)).slice(0, TRACKER_ROW_LIMIT);
  }

  const nameOf = new Map(visible.map((p) => [p.id, p.name]));
  const groups: TrackerGroup[] = [];
  for (const p of visible) {
    const mine = rows.filter((r) => r.projectId === p.id);
    if (mine.length === 0) continue;
    const rounds: TrackerRound[] = [];
    for (const inquiryId of roundIds) {
      const rr = mine.filter((r) => r.inquiryId === inquiryId);
      if (rr.length === 0) continue;
      rounds.push({
        inquiryId,
        roundNumber: rr[0].roundNumber,
        replyByText: rr[0].view.replyByText,
        compareHref: `/projects/${p.id}?tab=bid#rfq-round-${inquiryId}`,
        projectHref: `/projects/${p.id}?tab=bid#rfq-round-${inquiryId}`,
        rows: rr.map(publicRow),
      });
    }
    rounds.sort((a, b) => b.roundNumber - a.roundNumber);
    groups.push({ project: { id: p.id, name: nameOf.get(p.id) ?? p.name }, rounds });
  }
  // 需要我处理多的项目排前面
  const needCount = (g: TrackerGroup) => g.rounds.reduce((a, r) => a + r.rows.filter((x) => x.needsAction).length, 0);
  groups.sort((a, b) => needCount(b) - needCount(a));

  return { summary, groups, timeZone, truncated };
}
