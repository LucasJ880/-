/**
 * Muse Bridge — 销售意图取数（TASKFLOW S1，只读）
 *
 * 只做取数与编排；读范围、排序、回复格式全在 sales-pure.ts。
 * 每个查询都带 orgId；销售角色额外带 assignedToId = 本人。跨范围与不存在同一口径（OPPORTUNITY_NOT_FOUND）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { NEXT_ACTION_LABELS, NEXT_ACTION_TYPES, type NextActionType } from "@/lib/revenue-spine/next-action";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import type { Advisory } from "./advisory";
import type { MuseIdentity } from "./binding-pure";
import { loadFollowups } from "./followup";
import { loadInquiries } from "./inquiry";
import {
  OPEN_STAGE_RAW_VALUES,
  OPPORTUNITY_NOT_FOUND_MESSAGE,
  SALES_ASSIGNEE_DENIED_MESSAGE,
  SALES_PERMISSION_DENIED_MESSAGE,
  buildOpportunityStatus,
  buildSalesOverview,
  resolveAssigneeFilter,
  resolveSalesScope,
  type SalesOppRow,
} from "./sales-pure";

export type SalesIntentResult =
  | { ok: true; advisory: Advisory; data: unknown }
  | { ok: false; errorCode: "PERMISSION_DENIED" | "OPPORTUNITY_NOT_FOUND"; message: string };

const OPEN_ACTION_STATUSES = ["open", "in_progress"];
/**
 * 排序候选上限；Pilot 组织远小于此，超出时 data.truncated = true。
 * 超出时按"最久没互动"优先保留——停滞的商机正是排序要找出来的。
 */
const OVERVIEW_FETCH_CAP = 2000;

/** 阶段是自由字符串：按词表大小写不敏感匹配（排序层还会再 trim + 小写投影一次） */
const openStageWhere: Prisma.SalesOpportunityWhereInput = {
  OR: OPEN_STAGE_RAW_VALUES.map((stage) => ({ stage: { equals: stage, mode: "insensitive" as const } })),
};
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 10;

const opportunitySelect = {
  id: true,
  title: true,
  stage: true,
  priority: true,
  estimatedValue: true,
  createdAt: true,
  updatedAt: true,
  stageChangedAt: true,
  lastInteractionAt: true,
  lastCustomerReplyAt: true,
  lastOutboundAt: true,
  nextFollowupAt: true,
  nextActionType: true,
  nextActionReason: true,
  customer: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.SalesOpportunitySelect;

type OpportunityRecord = Prisma.SalesOpportunityGetPayload<{ select: typeof opportunitySelect }>;

function toRow(o: OpportunityRecord, counts: { open: number; overdue: number }): SalesOppRow {
  const { assignedTo, ...rest } = o;
  return { ...rest, assignee: assignedTo, openActionCount: counts.open, overdueActionCount: counts.overdue };
}

/** 每个商机未结束 / 已逾期的跟进行动数（一次查询，两个数出自同一份快照） */
async function countOpenActions(orgId: string, opportunityIds: string[], now: Date): Promise<Map<string, { open: number; overdue: number }>> {
  const out = new Map<string, { open: number; overdue: number }>();
  if (opportunityIds.length === 0) return out;
  const rows = await db.salesAction.findMany({
    where: { orgId, opportunityId: { in: opportunityIds }, status: { in: OPEN_ACTION_STATUSES } },
    select: { opportunityId: true, dueAt: true },
  });
  for (const r of rows) {
    if (!r.opportunityId) continue;
    const c = out.get(r.opportunityId) ?? { open: 0, overdue: 0 };
    c.open += 1;
    if (r.dueAt && r.dueAt.getTime() < now.getTime()) c.overdue += 1;
    out.set(r.opportunityId, c);
  }
  return out;
}

function nextActionLabel(type: string | null): string | null {
  return type && (NEXT_ACTION_TYPES as readonly string[]).includes(type) ? NEXT_ACTION_LABELS[type as NextActionType].zh : null;
}

const denied = (message: string): SalesIntentResult => ({ ok: false, errorCode: "PERMISSION_DENIED", message });

export async function salesOverview(
  identity: MuseIdentity,
  args: { days?: number; assigneeUserId?: string; limit?: number },
  now: Date = new Date(),
): Promise<SalesIntentResult> {
  const scope = resolveSalesScope(identity);
  if (!scope) return denied(SALES_PERMISSION_DENIED_MESSAGE);
  const filter = resolveAssigneeFilter(scope, args.assigneeUserId);
  if (!filter.ok) return denied(SALES_ASSIGNEE_DENIED_MESSAGE);

  const days = args.days ?? DEFAULT_DAYS;
  const since = new Date(now.getTime() - days * 86_400_000);
  const base: Prisma.SalesOpportunityWhereInput = {
    orgId: identity.orgId,
    ...(filter.assigneeId ? { assignedToId: filter.assigneeId } : {}),
  };

  const [records, newInWindow, wonInWindow, lostInWindow, policy] = await Promise.all([
    db.salesOpportunity.findMany({
      where: { ...base, ...openStageWhere },
      select: opportunitySelect,
      orderBy: [{ lastInteractionAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: OVERVIEW_FETCH_CAP + 1,
    }),
    db.salesOpportunity.count({ where: { ...base, createdAt: { gte: since } } }),
    db.salesOpportunity.count({ where: { ...base, wonAt: { gte: since } } }),
    db.salesOpportunity.count({ where: { ...base, lostAt: { gte: since } } }),
    loadRevenueSpinePolicy(identity.orgId),
  ]);
  const kept = records.slice(0, OVERVIEW_FETCH_CAP);
  const actions = await countOpenActions(identity.orgId, kept.map((o) => o.id), now);

  const { advisory, data } = buildSalesOverview({
    scope,
    filteredByAssignee: scope.kind === "org" && !!filter.assigneeId,
    rows: kept.map((o) => toRow(o, actions.get(o.id) ?? { open: 0, overdue: 0 })),
    counts: { newInWindow, wonInWindow, lostInWindow },
    days,
    limit: args.limit ?? DEFAULT_LIMIT,
    staleAfterDays: policy.followUp.staleAfterDays,
    truncated: records.length > OVERVIEW_FETCH_CAP,
    now,
  });
  return { ok: true, advisory, data };
}

export async function opportunityStatus(
  identity: MuseIdentity,
  args: { opportunityId: string },
  now: Date = new Date(),
): Promise<SalesIntentResult> {
  const scope = resolveSalesScope(identity);
  if (!scope) return denied(SALES_PERMISSION_DENIED_MESSAGE);

  const record = await db.salesOpportunity.findFirst({
    where: {
      id: args.opportunityId,
      orgId: identity.orgId,
      ...(scope.kind === "own" ? { assignedToId: scope.userId } : {}),
    },
    select: opportunitySelect,
  });
  if (!record) return { ok: false, errorCode: "OPPORTUNITY_NOT_FOUND", message: OPPORTUNITY_NOT_FOUND_MESSAGE };

  const [interactions, actions, counts, policy, inquiries, followups] = await Promise.all([
    // 记在客户上、没挂商机的互动也算这条商机的事实（标 level=customer），否则会把"有联系"误判为"CRM 无互动"
    db.customerInteraction.findMany({
      where: {
        orgId: identity.orgId,
        OR: [{ opportunityId: record.id }, { customerId: record.customer.id, opportunityId: null }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 5,
      select: { id: true, type: true, direction: true, channel: true, summary: true, createdAt: true, opportunityId: true },
    }),
    db.salesAction.findMany({
      where: { orgId: identity.orgId, opportunityId: record.id, status: { in: OPEN_ACTION_STATUSES } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true, title: true, status: true, priority: true, dueAt: true, source: true, assignedTo: { select: { id: true, name: true } } },
    }),
    countOpenActions(identity.orgId, [record.id], now),
    loadRevenueSpinePolicy(identity.orgId),
    loadInquiries(record.id),
    loadFollowups(record.id),
  ]);

  const { advisory, data } = buildOpportunityStatus({
    scope,
    row: toRow(record, counts.get(record.id) ?? { open: 0, overdue: 0 }),
    interactions,
    actions: actions.map(({ assignedTo, ...a }) => ({ ...a, assignee: assignedTo })),
    nextActionLabel: nextActionLabel(record.nextActionType),
    inquiries,
    followups,
    staleAfterDays: policy.followUp.staleAfterDays,
    now,
  });
  return { ok: true, advisory, data };
}
