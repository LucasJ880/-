/**
 * T-2 询价追踪页（服务端取数，只读）
 *
 * - 可见项目：与 requireProjectReadAccess 同一规则（projectReadWhere）+ 组织 + workDomain=tender + 有在途询价；组织由调用方按登录者解析后传入。
 * - 在途条目：chase-service.loadItems（与催单扫描同一口径）+ 近 14 天标为未响应的（只显示）。
 * - 下一步：tracker-pure.nextChaseOutlook，间隔用 chaseDaysForRound（与扫描同一来源）。
 * - 待批催单卡：审批信息与正文复用 W-1 的 loadRfqApprovalInfo / loadRfqSendEmails。
 * - 价格：至少一家已报价的轮次调 loadCompareMatrix，按 itemId 对上；最多 50 轮。按白名单组装，不带估值、我方报价、毛利。
 * - CHAIN-2e：落地价只给对该行所在项目有财务查看权的人（与成本核算同一判定；组织级查一次，每个项目再并上「负责人是本人」）；
 *   没有的项目在组装前就把矩阵行的落地价置空，那一格写「落地价只给有财务查看权的人看」；有行被隐藏时整页带 landedHidden
 *   与提示原因（授权查询出错 unconfirmed；被隐藏的项目都没有真人负责人 no_owner；部分没有 mixed；默认不带）。
 */

import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { listEffectiveMemberships } from "@/lib/preview/server";
import { chaseDaysForRound, loadFollowUpRoundState, loadItems, type LoadedItem } from "./chase-service";
import { currentMissingFields } from "./chase-pure";
import { loadCompareMatrix } from "./compare-service";
import { resolveFinanceViewSafe } from "@/lib/project-finance/access";
import { hintReasonField, type FinanceHintReasonField } from "@/lib/project-finance/view-hint";
import { projectHasAssignedOwner } from "@/lib/projects/system-owner";
import type { CompareRow } from "./compare";
import type { InboundMissingField } from "./inbound-contract";
import { TENDER_SEND_CHASE_TYPE } from "./types";
import {
  NEEDS_ACTION_LABELS,
  classifyNeedsAction,
  isPermissionHiddenCell,
  trackerLandedHiddenReason,
  nextChaseOutlook,
  quoteCellView,
  trackerRowView,
  trackerSummary,
  type ChaseOutlook,
  type NeedsAction,
  parseChaseCardKey,
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

export type TrackerCard = { actionId: string; approval: RfqApprovalInfo; emails: RfqEmailPreview[]; chaseKind: "no_reply" | "missing_fields"; chaseIndex: number };


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
  /** CHAIN-2e：有报价行的落地价被隐藏（页面顶部写一次谁能看、找谁）；没有被隐藏的不带 */
  landedHidden?: true;
} & FinanceHintReasonField;

type ExtraFields = { currency: string | null; repliedAt: Date | null };

/**
 * 与 requireProjectReadAccess 同一条规则（价格的可见范围 = 项目里的询价明细，独立审查 H1）：
 * 平台超管全部；否则已派发、且（负责人 / 该组织 org_admin / 项目 active 成员）。普通组织成员不因同组织就能看。
 */
export async function projectReadWhere(user: AuthUser, orgId: string): Promise<Record<string, unknown>> {
  if (isSuperAdmin(user.role)) return { orgId };
  const memberships = await listEffectiveMemberships(user.id);
  const isOrgAdmin = memberships.some((m) => m.orgId === orgId && hasOrgRole(m.role, "org_admin"));
  return {
    orgId,
    intakeStatus: "dispatched",
    OR: [{ ownerId: user.id }, ...(isOrgAdmin ? [{ orgId }] : []), { members: { some: { userId: user.id, status: "active" } } }],
  };
}

/** 有在途询价的项目（截断上限之前先筛，避免没有询价的老项目挤掉有在途询价的，审查 M2） */
function inFlightWhere(now: Date): Record<string, unknown> {
  return {
    inquiries: {
      some: {
        status: { notIn: ["canceled", "completed"] },
        items: {
          some: {
            OR: [
              { status: { in: ["sent", "replied", "quoted"] }, sentAt: { gte: new Date(now.getTime() - 90 * DAY) } },
              { status: "no_response", updatedAt: { gte: new Date(now.getTime() - NO_RESPONSE_WINDOW_DAYS * DAY) } },
            ],
          },
        },
      },
    },
  };
}

/** 有界并发 */
async function mapLimit<T, R>(xs: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await f(xs[k]);
      }
    }),
  );
  return out;
}

/** 只读；不建卡、不发信、不改任何状态 */
export async function loadTracker(input: {
  request: NextRequest;
  user: AuthUser;
  orgId: string;
  now?: Date;
  projectId?: string | null;
  /** /bids 汇总卡：只要计数——不取比价矩阵、不取审批信息、不算催单间隔（计数与这三样无关，和整页的计数相同） */
  summaryOnly?: boolean;
  /** 测试用：覆盖上限 */
  limits?: { matrixRounds?: number; rows?: number };
}): Promise<TrackerPayload> {
  const matrixRoundLimit = input.limits?.matrixRounds ?? TRACKER_MATRIX_ROUND_LIMIT;
  const rowLimit = input.limits?.rows ?? TRACKER_ROW_LIMIT;
  const now = input.now ?? new Date();
  const org = await db.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } });
  const timeZone = resolveOrgTimezone(org?.settingsJson ?? null);

  const readable = await projectReadWhere(input.user, input.orgId);
  const projects = await db.project.findMany({
    where: { AND: [readable, { workDomain: "tender" }, inFlightWhere(now), ...(input.projectId ? [{ id: input.projectId }] : [])] },
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
        select: { id: true, currency: true, repliedAt: true },
      })
    ).map((r) => [r.id, { currency: r.currency, repliedAt: r.repliedAt }]),
  );

  // 还活着的催单卡（与 loadItems 同一口径：待批未过期，或已批准正在执行）：按条目 id 归类
  const liveCards = await db.pendingAction.findMany({
    where: {
      orgId: input.orgId,
      type: TENDER_SEND_CHASE_TYPE,
      AND: [
        { OR: [{ status: "approved" }, { status: "pending", expiresAt: { gt: now } }] },
        { OR: items.map((i) => ({ idempotencyKey: { startsWith: `${TENDER_SEND_CHASE_TYPE}:${i.snapshot.itemId}:` } })) },
      ],
    },
    select: { id: true, idempotencyKey: true },
    orderBy: { createdAt: "asc" },
  });
  const cardIdsByItem = new Map<string, Array<{ id: string; chaseKind: "no_reply" | "missing_fields"; chaseIndex: number }>>();
  for (const c of liveCards) {
    const k = parseChaseCardKey(c.idempotencyKey);
    if (k) cardIdsByItem.set(k.itemId, [...(cardIdsByItem.get(k.itemId) ?? []), { id: c.id, chaseKind: k.chaseKind, chaseIndex: k.chaseIndex }]);
  }
  const actionIds = input.summaryOnly ? [] : liveCards.map((c) => c.id);
  const [approvals, emails] = await Promise.all([
    loadRfqApprovalInfo(input.request, input.user, input.orgId, actionIds),
    loadRfqSendEmails(input.orgId, actionIds),
  ]);

  // 每轮的催单间隔（与扫描同一来源）
  const ownerOf = new Map(visible.map((p) => [p.id, p.ownerId]));
  const roundIds = [...new Set([...items.map((i) => i.inquiryId), ...noResp.map((n) => n.inquiry.id)])];
  const daysByRound = new Map<string, number>();
  if (!input.summaryOnly) {
    const firstOfRound = [...new Map(items.map((it) => [it.inquiryId, it])).values()];
    const days = await mapLimit(firstOfRound, 5, async (it) => {
      const followUp = await loadFollowUpRoundState(input.orgId, it.inquiryId);
      return chaseDaysForRound(org?.settingsJson ?? null, ownerOf.get(it.snapshot.projectId) ?? it.ownerId, followUp);
    });
    firstOfRound.forEach((it, k) => daysByRound.set(it.inquiryId, days[k]));
  }

  // 比价矩阵：至少一家已报价的轮次，按最近报价时间取前 50 轮
  const quotedRounds = new Map<string, { projectId: string; latest: number }>();
  for (const it of items) {
    if (it.snapshot.status !== "quoted") continue;
    const t = extras.get(it.snapshot.itemId)?.repliedAt?.getTime() ?? 0;
    const prev = quotedRounds.get(it.inquiryId);
    if (!prev || t > prev.latest) quotedRounds.set(it.inquiryId, { projectId: it.snapshot.projectId, latest: t });
  }
  const matrixRounds = input.summaryOnly ? [] : [...quotedRounds.entries()].sort((a, b) => b[1].latest - a[1].latest).slice(0, matrixRoundLimit);
  const matrixRowByItem = new Map<string, Pick<CompareRow, "landedCad" | "flags" | "blockers">>();
  const matrices = await mapLimit(matrixRounds, 5, ([inquiryId, r]) => loadCompareMatrix({ projectId: r.projectId, orgId: input.orgId, inquiryId, now }));
  // 财务查看权：组织级判定（平台超管 / 组织范围结算键；出错时只剩平台超管）查一次，每个项目再并上「负责人是本人」。汇总卡不取矩阵，不查
  const orgFinance = input.summaryOnly ? null : await resolveFinanceViewSafe(input.user, input.orgId, null);
  const canViewCostOf = (projectId: string) => !!orgFinance && (orgFinance.canReadAll || ownerOf.get(projectId) === input.user.id);
  for (const m of matrices) {
    if (!m.ok) continue;
    const canView = canViewCostOf(m.projectId);
    for (const row of m.matrix.rows) matrixRowByItem.set(row.itemId, { landedCad: canView ? row.landedCad : { unit: null, total: null }, flags: row.flags, blockers: row.blockers });
  }

  // 组装行（白名单）
  type Built = TrackerRow & { inquiryId: string; projectId: string; roundNumber: number; replyBy: Date | null; repliedAt: Date | null };
  const built: Built[] = [];
  const quoteOf = (s: LoadedItem["snapshot"]): QuoteCell | null => {
    if (s.status !== "quoted" && s.status !== "replied") return null;
    const unitPrice = toNum(s.quote.unitPrice);
    const totalPrice = toNum(s.quote.totalPrice);
    if (unitPrice == null && totalPrice == null) return null;
    const vu = s.quote.validUntil;
    const row = matrixRowByItem.get(s.itemId) ?? null;
    // 已报价却没有矩阵行（超过上限没算、或矩阵算不出来）：写「请到比价面板查看」，不悄悄空着（审查 L4）
    return quoteCellView(
      { unitPrice, totalPrice, currency: extras.get(s.itemId)?.currency ?? null, deliveryDays: s.quote.deliveryDays, validUntil: vu ? new Date(vu) : null },
      row,
      { matrixLoaded: s.status !== "quoted" || row != null, timeZone, canViewCost: canViewCostOf(s.projectId), costUnconfirmed: !!orgFinance?.unconfirmed },
    );
  };

  for (const it of items as LoadedItem[]) {
    const s = it.snapshot;
    const replyBy = it.roundDueDate;
    const outlook = nextChaseOutlook(s, { now, chaseAfterDays: daysByRound.get(it.inquiryId) ?? 3, replyBy });
    const missing: InboundMissingField[] = s.status === "replied" || s.status === "quoted" ? currentMissingFields(s.quote, { quoted: s.status === "quoted" }) : [];
    const needsAction = classifyNeedsAction({ status: s.status, outlook, missing, replyBy, now });
    const noReplyChases = s.chases.filter((c) => c.kind === "no_reply").length;
    const cards = (cardIdsByItem.get(s.itemId) ?? [])
      .filter((c) => approvals[c.id])
      .map((c) => ({ actionId: c.id, approval: approvals[c.id], emails: emails[c.id] ?? [], chaseKind: c.chaseKind, chaseIndex: c.chaseIndex }));
    built.push({
      itemId: s.itemId,
      supplierName: s.supplierName,
      status: s.status,
      view: trackerRowView({ status: s.status, sentAt: s.sentAt, noReplyChases, outlook, missing, replyBy, hasThread: !!s.threadId }, timeZone, now),
      needsAction,
      needsActionLabel: needsAction ? NEEDS_ACTION_LABELS[needsAction] : null,
      outlookKind: outlook.kind,
      quote: quoteOf(s),
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
  if (input.summaryOnly) return { summary, groups: [], timeZone, truncated };

  let rows = built;
  if (rows.length > rowLimit) {
    truncated = true;
    // 需要我处理的优先留下
    rows = [...rows].sort((a, b) => Number(b.needsAction != null) - Number(a.needsAction != null)).slice(0, rowLimit);
  }

  // 有格子因权限被隐藏 → 页面顶部写一次谁能看、找谁（只看截断后留下的行；换算不出的不算；按被隐藏的项目有没有真人负责人换句）
  const hiddenProjects = [...new Set(rows.filter((r) => isPermissionHiddenCell(r.quote) && !canViewCostOf(r.projectId)).map((r) => r.projectId))];
  let landed: { landedHidden?: true } & FinanceHintReasonField = {};
  let hiddenWithOwner = 0;
  if (hiddenProjects.length > 0 && !orgFinance?.unconfirmed) {
    const ownerIds = [...new Set(hiddenProjects.map((p) => ownerOf.get(p)).filter((x): x is string => !!x))];
    const owners = new Map((await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, email: true } })).map((u) => [u.id, u]));
    hiddenWithOwner = hiddenProjects.filter((p) => projectHasAssignedOwner(owners.get(ownerOf.get(p) ?? "") ?? null)).length;
  }
  const reason = trackerLandedHiddenReason({ unconfirmed: !!orgFinance?.unconfirmed, hiddenProjects: hiddenProjects.length, hiddenWithOwner });
  if (reason) landed = { landedHidden: true, ...hintReasonField(reason) };

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

  return { summary, groups, timeZone, truncated, ...landed };
}
