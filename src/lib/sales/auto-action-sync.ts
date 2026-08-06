import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scanSalesDomain } from "@/lib/secretary/domains/sales";
import type { BriefingItem } from "@/lib/secretary/types";
import {
  buildSalesActionActiveKey,
  defaultSalesActionDueAt,
} from "@/lib/sales/action-loop";

export const SALES_AUTO_ACTION_SOURCE = "digital_employee_auto";
export const SALES_AUTO_ACTION_SCAN_LIMIT = 500;

type AutoActionRule = {
  signalKey: string;
  category: "contact" | "record_followup";
  rank: number;
};

const SAFE_RULES: Record<string, AutoActionRule> = {
  followup_due: { signalKey: "overdue_followup", category: "record_followup", rank: 0 },
  viewed_not_signed: { signalKey: "viewed_not_signed", category: "contact", rank: 1 },
  quote_pending: { signalKey: "quote_pending", category: "record_followup", rank: 2 },
  new_lead_stale: { signalKey: "new_lead_stale", category: "contact", rank: 3 },
  stale_opportunity: { signalKey: "stale_opportunity", category: "record_followup", rank: 4 },
};

export type SalesAutoActionCandidate = {
  customerId: string;
  opportunityId: string;
  signalKey: string;
  category: "contact" | "record_followup";
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium";
  rank: number;
};

export function buildSalesAutoActionCandidates(items: BriefingItem[]): SalesAutoActionCandidate[] {
  const byOpportunity = new Map<string, SalesAutoActionCandidate>();
  for (const item of items) {
    const rule = SAFE_RULES[item.category];
    const customerId = item.action?.payload?.customerId;
    const opportunityId = item.action?.payload?.opportunityId;
    if (!rule || typeof customerId !== "string" || typeof opportunityId !== "string") continue;
    const candidate: SalesAutoActionCandidate = {
      customerId,
      opportunityId,
      signalKey: rule.signalKey,
      category: rule.category,
      title: item.title,
      description: item.description,
      priority: item.severity === "urgent" ? "urgent" : item.severity === "warning" ? "high" : "medium",
      rank: rule.rank,
    };
    const current = byOpportunity.get(opportunityId);
    if (!current || candidate.rank < current.rank) byOpportunity.set(opportunityId, candidate);
  }
  return [...byOpportunity.values()];
}

export type SalesActionSyncResult = {
  scannedCount: number;
  createdCount: number;
  updatedCount: number;
  autoResolvedCount: number;
  truncated: boolean;
};

export async function syncSalesAutoActions(
  orgId: string,
  trigger: "cron" | "manual" = "cron",
): Promise<SalesActionSyncResult> {
  const run = await db.salesActionSyncRun.create({ data: { orgId, trigger } });
  try {
    const scan = await scanSalesDomain("system", orgId, {
      ownOnly: false,
      maxOpportunities: SALES_AUTO_ACTION_SCAN_LIMIT,
    });
    const candidates = buildSalesAutoActionCandidates(scan.items);
    const opportunityIds = candidates.map((candidate) => candidate.opportunityId);
    const opportunities = opportunityIds.length
      ? await db.salesOpportunity.findMany({
          where: {
            orgId,
            id: { in: opportunityIds },
            customer: { archivedAt: null },
          },
          select: { id: true, customerId: true, assignedToId: true, createdById: true },
        })
      : [];
    const opportunityById = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const now = new Date();
    let createdCount = 0;
    let updatedCount = 0;
    const observedKeys: string[] = [];

    for (const candidate of candidates) {
      const opportunity = opportunityById.get(candidate.opportunityId);
      if (!opportunity || opportunity.customerId !== candidate.customerId) continue;
      const activeKey = buildSalesActionActiveKey({ orgId, ...candidate });
      observedKeys.push(activeKey);
      const existing = await db.salesAction.findUnique({ where: { activeKey }, select: { id: true, source: true } });
      if (existing) {
        // 人工加入队列的行动也能覆盖同一信号，但自动扫描绝不改写人工行动。
        if (existing.source === SALES_AUTO_ACTION_SOURCE) {
          await db.salesAction.update({
            where: { id: existing.id },
            data: {
              title: candidate.title.slice(0, 160),
              description: candidate.description.slice(0, 2000),
              priority: candidate.priority,
              lastObservedAt: now,
            },
          });
          updatedCount += 1;
        }
        continue;
      }
      try {
        await db.salesAction.create({
          data: {
            orgId,
            customerId: candidate.customerId,
            opportunityId: candidate.opportunityId,
            source: SALES_AUTO_ACTION_SOURCE,
            signalKey: candidate.signalKey,
            activeKey,
            category: candidate.category,
            title: candidate.title.slice(0, 160),
            description: candidate.description.slice(0, 2000),
            priority: candidate.priority,
            dueAt: defaultSalesActionDueAt(candidate.priority, now),
            assignedToId: opportunity.assignedToId ?? opportunity.createdById,
            createdById: opportunity.createdById,
            lastObservedAt: now,
          },
        });
        createdCount += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }

    const truncated = scan.stats.scanLimitReached === 1;
    let autoResolvedCount = 0;
    if (!truncated) {
      const resolved = await db.salesAction.updateMany({
        where: {
          orgId,
          source: SALES_AUTO_ACTION_SOURCE,
          status: { in: ["open", "in_progress"] },
          activeKey: {
            not: null,
            ...(observedKeys.length ? { notIn: observedKeys } : {}),
          },
        },
        data: {
          status: "auto_resolved",
          activeKey: null,
          autoResolvedAt: now,
          resolutionNote: "触发信号已消失，数字员工自动收口",
        },
      });
      autoResolvedCount = resolved.count;
    }

    const result = {
      scannedCount: scan.stats.scannedOpportunities ?? 0,
      createdCount,
      updatedCount,
      autoResolvedCount,
      truncated,
    };
    await db.salesActionSyncRun.update({
      where: { id: run.id },
      data: { ...result, status: "completed", completedAt: new Date() },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.salesActionSyncRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message.slice(0, 2000), completedAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}
