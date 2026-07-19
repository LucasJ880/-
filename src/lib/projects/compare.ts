/**
 * 批量项目对比（可见性内）
 */

import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { computePriceGap } from "@/lib/projects/price-gap";

export async function compareProjects(input: {
  userId: string;
  role: string;
  projectIds: string[];
}) {
  const ids = [...new Set(input.projectIds)].slice(0, 8);
  if (ids.length < 2) throw new Error("至少选择 2 个项目");

  const visible = await getVisibleProjectIds(input.userId, input.role);
  const allowed = visible ? ids.filter((id) => visible.includes(id)) : ids;
  if (allowed.length < 2) throw new Error("可见项目不足，无法对比");

  const projects = await db.project.findMany({
    where: { id: { in: allowed } },
    select: {
      id: true,
      name: true,
      clientOrganization: true,
      location: true,
      category: true,
      tenderStatus: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      projectTypes: true,
      aiAdviceStatus: true,
      intelligence: {
        select: { summary: true, riskLevel: true, recommendation: true },
      },
      reviews: {
        where: { status: "confirmed" },
        take: 1,
        select: { outcome: true, reasonTagsJson: true, narrative: true },
      },
      _count: {
        select: { similaritiesAsSource: true, documents: true, tasks: true },
      },
    },
  });

  return projects.map((p) => {
    const gap = computePriceGap({
      ourBidPrice: p.ourBidPrice,
      winningBidPrice: p.winningBidPrice,
      currency: p.currency,
    });
    let reasonTags: string[] = [];
    try {
      reasonTags = JSON.parse(p.reviews[0]?.reasonTagsJson || "[]") as string[];
    } catch {
      reasonTags = [];
    }
    return {
      id: p.id,
      name: p.name,
      clientOrganization: p.clientOrganization,
      location: p.location,
      category: p.category,
      tenderStatus: p.tenderStatus,
      aiAdviceStatus: p.aiAdviceStatus,
      projectTypes: p.projectTypes,
      ourBidPrice: p.ourBidPrice,
      winningBidPrice: p.winningBidPrice,
      currency: p.currency,
      priceGap: gap,
      intelligenceSummary: p.intelligence?.summary ?? null,
      riskLevel: p.intelligence?.riskLevel ?? null,
      recommendation: p.intelligence?.recommendation ?? null,
      reviewOutcome: p.reviews[0]?.outcome ?? null,
      reasonTags,
      counts: p._count,
    };
  });
}
