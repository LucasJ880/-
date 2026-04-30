/**
 * Trade 外贸获客 — 活动日志
 */

import { db } from "@/lib/db";

export async function logActivity(input: {
  orgId: string;
  campaignId?: string;
  prospectId?: string;
  action: string;
  detail?: string;
  meta?: Record<string, string | number | boolean | null>;
}) {
  return db.tradeActivityLog.create({
    data: {
      orgId: input.orgId,
      campaignId: input.campaignId,
      prospectId: input.prospectId,
      action: input.action,
      detail: input.detail,
      meta: input.meta ?? undefined,
    },
  });
}

export async function getProspectTimeline(prospectId: string, orgId: string, limit = 30) {
  return db.tradeActivityLog.findMany({
    where: { prospectId, orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getCampaignLogs(campaignId: string, orgId: string, limit = 50) {
  return db.tradeActivityLog.findMany({
    where: { campaignId, orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
