/**
 * Trade 外贸获客 — 数据服务层
 */

import { db } from "@/lib/db";

// ── Campaign ────────────────────────────────────────────────

export interface CreateCampaignInput {
  orgId: string;
  name: string;
  productDesc: string;
  targetMarket: string;
  scoreThreshold?: number;
}

export async function createCampaign(input: CreateCampaignInput, userId: string) {
  return db.tradeCampaign.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      productDesc: input.productDesc,
      targetMarket: input.targetMarket,
      scoreThreshold: input.scoreThreshold ?? 7,
      createdById: userId,
    },
  });
}

export async function listCampaigns(orgId: string, opts?: { status?: string }) {
  return db.tradeCampaign.findMany({
    where: {
      orgId,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { prospects: true } },
    },
  });
}

export async function getCampaign(id: string) {
  return db.tradeCampaign.findUnique({
    where: { id },
    include: {
      _count: { select: { prospects: true } },
    },
  });
}

export async function updateCampaign(
  id: string,
  data: Partial<Pick<CreateCampaignInput, "name" | "productDesc" | "targetMarket" | "scoreThreshold">> & {
    status?: string;
    searchKeywords?: string[];
  },
) {
  return db.tradeCampaign.update({ where: { id }, data });
}

export async function deleteCampaign(id: string) {
  return db.tradeCampaign.delete({ where: { id } });
}

// ── Prospect ────────────────────────────────────────────────

export interface CreateProspectInput {
  campaignId: string;
  orgId: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactTitle?: string;
  website?: string;
  country?: string;
  source?: string;
  /** 默认 new；discover 流水线传 discovered */
  stage?: string;
}

export async function createProspect(input: CreateProspectInput) {
  const prospect = await db.tradeProspect.create({
    data: {
      ...input,
      stage: input.stage ?? "new",
    },
  });
  await db.tradeCampaign.update({
    where: { id: input.campaignId },
    data: { totalProspects: { increment: 1 } },
  });
  return prospect;
}

export async function listProspects(
  campaignId: string,
  orgId: string,
  opts?: { stage?: string; page?: number; pageSize?: number },
) {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;

  const where = {
    campaignId,
    orgId,
    ...(opts?.stage ? { stage: opts.stage } : {}),
  };

  const [items, total] = await Promise.all([
    db.tradeProspect.findMany({
      where,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.tradeProspect.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getProspect(id: string) {
  return db.tradeProspect.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function updateProspect(id: string, data: Record<string, unknown>) {
  return db.tradeProspect.update({ where: { id }, data });
}

// ── Message ─────────────────────────────────────────────────

export async function createMessage(data: {
  prospectId: string;
  direction: string;
  channel?: string;
  subject?: string;
  content: string;
  intent?: string;
  sentiment?: string;
  aiDraft?: boolean;
}) {
  return db.tradeMessage.create({ data });
}
