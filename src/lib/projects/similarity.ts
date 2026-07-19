/**
 * 相似历史项目检索（可见性隔离 + 规则/文本相似度，MVP）
 */

import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { computePriceGap } from "@/lib/projects/price-gap";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function recomputeProjectSimilarities(input: {
  projectId: string;
  userId: string;
  role: string | null | undefined;
  limit?: number;
}) {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      orgId: true,
      name: true,
      description: true,
      category: true,
      clientOrganization: true,
      location: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      projectTypes: true,
      intelligence: { select: { summary: true } },
    },
  });
  if (!project) throw new Error("项目不存在");

  const visibleIds = await getVisibleProjectIds(
    input.userId,
    input.role ?? "user",
  );
  const candidateIds = visibleIds
    ? visibleIds.filter((id) => id !== project.id)
    : null;
  const candidates = await db.project.findMany({
    where: {
      ...(candidateIds
        ? { id: { in: candidateIds } }
        : { id: { not: project.id } }),
      ...(project.orgId ? { orgId: project.orgId } : {}),
    },
    take: 80,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      clientOrganization: true,
      location: true,
      tenderStatus: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      projectTypes: true,
      intelligence: { select: { summary: true } },
      reviews: {
        where: { status: "confirmed" },
        take: 1,
        orderBy: { confirmedAt: "desc" },
        select: {
          outcome: true,
          narrative: true,
          reasonTagsJson: true,
          priceAnalysisJson: true,
        },
      },
    },
  });

  const baseText = [
    project.name,
    project.description,
    project.category,
    project.clientOrganization,
    project.location,
    project.intelligence?.summary,
    JSON.stringify(project.projectTypes ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const baseTokens = tokenize(baseText);

  type Ranked = {
    similarProjectId: string;
    score: number;
    reasons: string[];
    impactText: string;
    recommendations: string[];
    redacted: boolean;
  };

  const ranked: Ranked[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    let score = 0;
    const otherText = [
      c.name,
      c.description,
      c.category,
      c.clientOrganization,
      c.location,
      c.intelligence?.summary,
      JSON.stringify(c.projectTypes ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    const sim = jaccard(baseTokens, tokenize(otherText));
    if (sim > 0.08) {
      score += sim * 0.55;
      reasons.push(`文本/关键词相似约 ${Math.round(sim * 100)}%`);
    }
    if (
      project.category &&
      c.category &&
      project.category.toLowerCase() === c.category.toLowerCase()
    ) {
      score += 0.15;
      reasons.push("品类相同");
    }
    if (
      project.clientOrganization &&
      c.clientOrganization &&
      project.clientOrganization === c.clientOrganization
    ) {
      score += 0.12;
      reasons.push("同一客户组织");
    }
    if (
      project.location &&
      c.location &&
      project.location.toLowerCase().includes(c.location.toLowerCase().slice(0, 4))
    ) {
      score += 0.08;
      reasons.push("地区相近");
    }

    if (score < 0.18 || reasons.length === 0) continue;

    const review = c.reviews[0];
    const gap = computePriceGap({
      ourBidPrice: c.ourBidPrice,
      winningBidPrice: c.winningBidPrice,
      currency: c.currency,
    });

    const recommendations: string[] = [];
    let impactText = "历史经验可供参考，请结合当前规格与 Addendum 复核。";

    if (review?.outcome === "lost" || c.tenderStatus === "lost") {
      impactText =
        "历史同类项目未中标。若供应链与利润结构相同，本次仍可能价格或资格不足。";
      recommendations.push(
        "至少取得三家供应商报价",
        "单独核算安装/运输成本",
        "检查是否重复加入风险预留",
        "设置目标报价上限并对照历史中标价",
      );
      if (gap) {
        impactText += ` 历史价格：中标价为我方 ${gap.winningAsPctOfOurs}%，我方相对中标高 ${gap.oursPremiumPctVsWinning}%。`;
      }
      if (review?.reasonTagsJson) {
        try {
          const tags = JSON.parse(review.reasonTagsJson) as string[];
          if (tags.length) {
            reasons.push(`历史失败标签：${tags.slice(0, 4).join("、")}`);
          }
        } catch {
          /* ignore */
        }
      }
    } else if (review?.outcome === "awarded" || c.tenderStatus === "won") {
      impactText = "历史同类项目曾中标，可复用供应商与技术方案，但需校验过期与规格差异。";
      recommendations.push(
        "复用前检查供应商报价是否过期",
        "核对产品型号与认证是否仍有效",
        "对照当前 Addendum 是否有新要求",
      );
    } else {
      recommendations.push("对比历史风险清单与询价范围，补齐当前信息缺口");
    }

    ranked.push({
      similarProjectId: c.id,
      score: Math.round(score * 1000) / 1000,
      reasons,
      impactText,
      recommendations,
      redacted: false,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, input.limit ?? 5);

  await db.projectSimilarity.deleteMany({ where: { projectId: project.id } });
  if (top.length) {
    await db.projectSimilarity.createMany({
      data: top.map((r) => ({
        orgId: project.orgId,
        projectId: project.id,
        similarProjectId: r.similarProjectId,
        score: r.score,
        reasonsJson: JSON.stringify(r.reasons),
        impactText: r.impactText,
        recommendationsJson: JSON.stringify(r.recommendations),
        redacted: r.redacted,
      })),
    });
  }

  return top.length;
}

export async function listProjectSimilaritiesForApi(projectId: string) {
  const rows = await db.projectSimilarity.findMany({
    where: { projectId },
    orderBy: { score: "desc" },
    take: 10,
    include: {
      similarProject: {
        select: {
          id: true,
          name: true,
          tenderStatus: true,
          ourBidPrice: true,
          winningBidPrice: true,
          currency: true,
          clientOrganization: true,
        },
      },
    },
  });

  return rows.map((r) => {
    const gap = computePriceGap({
      ourBidPrice: r.similarProject.ourBidPrice,
      winningBidPrice: r.similarProject.winningBidPrice,
      currency: r.similarProject.currency,
    });
    let reasons: string[] = [];
    let recommendations: string[] = [];
    try {
      reasons = JSON.parse(r.reasonsJson) as string[];
    } catch {
      reasons = [];
    }
    try {
      recommendations = r.recommendationsJson
        ? (JSON.parse(r.recommendationsJson) as string[])
        : [];
    } catch {
      recommendations = [];
    }

    return {
      id: r.id,
      score: r.score,
      reasons,
      impactText: r.impactText,
      recommendations,
      redacted: r.redacted,
      similarProject: r.redacted
        ? {
            id: null,
            name: "脱敏同类项目",
            tenderStatus: r.similarProject.tenderStatus,
            ourBidPrice: null,
            winningBidPrice: null,
            currency: null,
            clientOrganization: null,
          }
        : {
            id: r.similarProject.id,
            name: r.similarProject.name,
            tenderStatus: r.similarProject.tenderStatus,
            ourBidPrice: r.similarProject.ourBidPrice,
            winningBidPrice: r.similarProject.winningBidPrice,
            currency: r.similarProject.currency,
            clientOrganization: r.similarProject.clientOrganization,
          },
      priceGap: r.redacted ? null : gap,
    };
  });
}
