/**
 * Phase 3A-2：成本汇总 / 时序 / 按 run·trace 拉取
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CapabilitiesAccessContext } from "../types";
import {
  CapabilitiesAccessError,
  isOrgAdminRole,
  isWorkspaceMember,
  resolveDetailAccessMode,
} from "../access";
import {
  listDualWrittenPcSourceIds,
  listProductContentUsageViaAdapter,
} from "./pc-adapter";
import type {
  AiUsageLedgerView,
  AiUsagePricingMode,
  UsageSummaryBucket,
  UsageSummaryResult,
} from "./types";

export const USAGE_MAX_RANGE_DAYS = 90;

function decimalToNumber(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

function asPricingMode(meta: unknown): AiUsagePricingMode {
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = (meta as Record<string, unknown>).pricingMode;
    if (m === "exact") return "exact";
  }
  return "estimated";
}

function toView(row: {
  id: string;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  userId: string | null;
  traceId: string | null;
  runId: string | null;
  parentRunId: string | null;
  sourceType: string;
  sourceId: string | null;
  provider: string;
  model: string;
  usageType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  imageCount: number | null;
  audioSeconds: number | null;
  durationMs: number | null;
  costAmount: Prisma.Decimal;
  currency: string;
  pricingVersion: string | null;
  status: string;
  errorCode: string | null;
  occurredAt: Date;
  metadataJson: unknown;
}): AiUsageLedgerView {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    userId: row.userId,
    traceId: row.traceId,
    runId: row.runId,
    parentRunId: row.parentRunId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    provider: row.provider,
    model: row.model,
    usageType: row.usageType,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    imageCount: row.imageCount,
    audioSeconds: row.audioSeconds,
    durationMs: row.durationMs,
    costAmount: decimalToNumber(row.costAmount),
    currency: row.currency,
    pricingVersion: row.pricingVersion,
    pricingMode: asPricingMode(row.metadataJson),
    status: row.status,
    errorCode: row.errorCode,
    occurredAt: row.occurredAt,
  };
}

function clampRange(from: Date, to: Date): void {
  if (to.getTime() < from.getTime()) {
    throw new CapabilitiesAccessError("时间范围无效", "FORBIDDEN", 403);
  }
  const maxMs = USAGE_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    throw new CapabilitiesAccessError(
      `时间范围不得超过 ${USAGE_MAX_RANGE_DAYS} 天`,
      "FORBIDDEN",
      403,
    );
  }
}

function memberSafeWhere(
  access: CapabilitiesAccessContext,
): Prisma.AiUsageLedgerWhereInput {
  if (isOrgAdminRole(access.orgRole)) {
    return { orgId: access.orgId };
  }
  return {
    orgId: access.orgId,
    OR: [
      {
        workspaceId: {
          in: access.workspaceIds.length ? access.workspaceIds : ["__none__"],
        },
      },
      { userId: access.userId },
    ],
  };
}

export async function listLedgerForRun(
  access: CapabilitiesAccessContext,
  opts: { runId: string; traceId?: string | null },
): Promise<AiUsageLedgerView[]> {
  const run = await db.agentRun.findFirst({
    where: { id: opts.runId, orgId: access.orgId },
    select: { id: true, orgId: true, traceId: true, metadata: true },
  });
  if (!run) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }

  if (opts.traceId && run.traceId && opts.traceId !== run.traceId) {
    throw new CapabilitiesAccessError("Run 不存在", "NOT_FOUND", 404);
  }

  const or: Prisma.AiUsageLedgerWhereInput[] = [{ runId: run.id }];
  if (run.traceId) or.push({ traceId: run.traceId });

  const rows = await db.aiUsageLedger.findMany({
    where: { orgId: access.orgId, OR: or },
    orderBy: { occurredAt: "asc" },
    take: 200,
  });

  // 触发可见性解析（AGGREGATE 仍可看费用数字）
  resolveDetailAccessMode(
    access,
    typeof (run.metadata as { workspaceId?: string } | null)?.workspaceId ===
      "string"
      ? (run.metadata as { workspaceId: string }).workspaceId
      : null,
  );

  return rows.map((r) => toView(r));
}

type Acc = {
  cost: number;
  calls: number;
  inTok: number;
  outTok: number;
  currency: string;
};

function bump(
  map: Map<string, Acc>,
  key: string,
  row: { cost: number; inTok: number; outTok: number; currency: string },
) {
  const cur = map.get(key) ?? {
    cost: 0,
    calls: 0,
    inTok: 0,
    outTok: 0,
    currency: row.currency,
  };
  cur.cost += row.cost;
  cur.calls += 1;
  cur.inTok += row.inTok;
  cur.outTok += row.outTok;
  map.set(key, cur);
}

function toBuckets(map: Map<string, Acc>): UsageSummaryBucket[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: key,
      costAmount: Math.round(v.cost * 1_000_000) / 1_000_000,
      currency: v.currency,
      callCount: v.calls,
      inputTokens: v.inTok,
      outputTokens: v.outTok,
    }))
    .sort((a, b) => b.costAmount - a.costAmount);
}

export async function getUsageSummary(
  access: CapabilitiesAccessContext,
  opts?: { from?: Date; to?: Date },
): Promise<UsageSummaryResult> {
  const to = opts?.to ?? new Date();
  const from =
    opts?.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  clampRange(from, to);

  const monthStart = new Date(to.getFullYear(), to.getMonth(), 1);
  const last24h = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const baseWhere = memberSafeWhere(access);

  const [monthAgg, h24Agg, rows] = await Promise.all([
    db.aiUsageLedger.aggregate({
      where: { ...baseWhere, occurredAt: { gte: monthStart, lte: to } },
      _sum: { costAmount: true },
    }),
    db.aiUsageLedger.aggregate({
      where: { ...baseWhere, occurredAt: { gte: last24h, lte: to } },
      _sum: { costAmount: true },
    }),
    db.aiUsageLedger.findMany({
      where: { ...baseWhere, occurredAt: { gte: from, lte: to } },
      select: {
        workspaceId: true,
        userId: true,
        model: true,
        sourceType: true,
        costAmount: true,
        inputTokens: true,
        outputTokens: true,
        currency: true,
        metadataJson: true,
        occurredAt: true,
      },
      take: 5000,
    }),
  ]);

  const pcRaw = await listProductContentUsageViaAdapter({
    orgId: access.orgId,
    from,
    to,
    take: 2000,
  });
  const dual = await listDualWrittenPcSourceIds(
    access.orgId,
    pcRaw.map((p) => p.sourceId!).filter(Boolean),
  );
  const pcViews = pcRaw.filter((p) => !p.sourceId || !dual.has(p.sourceId));
  const pcFiltered = isOrgAdminRole(access.orgRole)
    ? pcViews
    : pcViews.filter((p) => !p.userId || p.userId === access.userId);

  const byWs = new Map<string, Acc>();
  const byUser = new Map<string, Acc>();
  const byModel = new Map<string, Acc>();
  const byAgent = new Map<string, Acc>();
  const bySkill = new Map<string, Acc>();
  const byDate = new Map<string, Acc>();

  for (const r of rows) {
    const payload = {
      cost: decimalToNumber(r.costAmount),
      inTok: r.inputTokens ?? 0,
      outTok: r.outputTokens ?? 0,
      currency: r.currency,
    };
    bump(byWs, r.workspaceId ?? "(no-workspace)", payload);
    bump(byUser, r.userId ?? "(unknown)", payload);
    bump(byModel, r.model, payload);
    const meta = r.metadataJson as Record<string, unknown> | null;
    const agent =
      typeof meta?.agentKey === "string"
        ? meta.agentKey
        : r.sourceType === "AGENT_RUNTIME"
          ? "agent"
          : r.sourceType;
    bump(byAgent, agent, payload);
    const skill =
      typeof meta?.skillKey === "string" ? meta.skillKey : "(none)";
    if (skill !== "(none)") bump(bySkill, skill, payload);
    bump(byDate, r.occurredAt.toISOString().slice(0, 10), payload);
  }

  for (const p of pcFiltered) {
    const payload = {
      cost: p.costAmount,
      inTok: 0,
      outTok: 0,
      currency: p.currency,
    };
    bump(byWs, p.workspaceId ?? "(no-workspace)", payload);
    bump(byUser, p.userId ?? "(unknown)", payload);
    bump(byModel, p.model, payload);
    bump(byAgent, "product_content", payload);
    bump(byDate, p.occurredAt.toISOString().slice(0, 10), payload);
  }

  const pcMonth = pcFiltered
    .filter((p) => p.occurredAt >= monthStart)
    .reduce((s, p) => s + p.costAmount, 0);
  const pc24 = pcFiltered
    .filter((p) => p.occurredAt >= last24h)
    .reduce((s, p) => s + p.costAmount, 0);

  return {
    orgId: access.orgId,
    currency: "USD",
    monthTotal: decimalToNumber(monthAgg._sum.costAmount) + pcMonth,
    last24hTotal: decimalToNumber(h24Agg._sum.costAmount) + pc24,
    byWorkspace: toBuckets(byWs),
    byAgent: toBuckets(byAgent),
    bySkill: toBuckets(bySkill),
    byModel: toBuckets(byModel),
    byUser: toBuckets(byUser),
    byDate: toBuckets(byDate).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function getUsageTimeseries(
  access: CapabilitiesAccessContext,
  opts?: { from?: Date; to?: Date },
): Promise<UsageSummaryBucket[]> {
  const summary = await getUsageSummary(access, opts);
  return summary.byDate;
}

export async function getLedgerById(
  access: CapabilitiesAccessContext,
  ledgerId: string,
): Promise<AiUsageLedgerView> {
  if (ledgerId.startsWith("pc_adapter:")) {
    const sourceId = ledgerId.slice("pc_adapter:".length);
    const entry = await db.productContentCostEntry.findFirst({
      where: { id: sourceId, orgId: access.orgId },
      include: { job: { select: { createdById: true } } },
    });
    if (!entry) {
      throw new CapabilitiesAccessError("Ledger 不存在", "NOT_FOUND", 404);
    }
    if (
      !isOrgAdminRole(access.orgRole) &&
      entry.job?.createdById &&
      entry.job.createdById !== access.userId
    ) {
      throw new CapabilitiesAccessError("Ledger 不存在", "NOT_FOUND", 404);
    }
    const views = await listProductContentUsageViaAdapter({
      orgId: access.orgId,
      from: new Date(entry.createdAt.getTime() - 1000),
      to: new Date(entry.createdAt.getTime() + 1000),
      take: 20,
    });
    const hit = views.find((v) => v.sourceId === sourceId);
    if (!hit) {
      throw new CapabilitiesAccessError("Ledger 不存在", "NOT_FOUND", 404);
    }
    return hit;
  }

  const row = await db.aiUsageLedger.findFirst({
    where: { id: ledgerId, orgId: access.orgId },
  });
  if (!row) {
    throw new CapabilitiesAccessError("Ledger 不存在", "NOT_FOUND", 404);
  }
  if (
    row.workspaceId &&
    !isOrgAdminRole(access.orgRole) &&
    !isWorkspaceMember(access, row.workspaceId) &&
    row.userId !== access.userId
  ) {
    throw new CapabilitiesAccessError("Ledger 不存在", "NOT_FOUND", 404);
  }
  return toView(row);
}
