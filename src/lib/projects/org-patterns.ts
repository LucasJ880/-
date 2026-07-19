/**
 * 客户 / 竞争规律（轻量聚合，非完整知识图谱）
 */

import { db } from "@/lib/db";

export async function getOrgClientCompetitorPatterns(orgId: string) {
  const projects = await db.project.findMany({
    where: { orgId },
    take: 200,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      clientOrganization: true,
      tenderStatus: true,
      location: true,
      category: true,
      ourBidPrice: true,
      winningBidPrice: true,
      reviews: {
        where: { status: "confirmed" },
        take: 1,
        select: { outcome: true, reasonTagsJson: true },
      },
    },
  });

  type ClientAgg = {
    client: string;
    total: number;
    won: number;
    lost: number;
    topReasons: Record<string, number>;
  };
  const clients = new Map<string, ClientAgg>();

  for (const p of projects) {
    const client = (p.clientOrganization || "").trim() || "(未填写客户)";
    const cur = clients.get(client) || {
      client,
      total: 0,
      won: 0,
      lost: 0,
      topReasons: {},
    };
    cur.total += 1;
    const outcome = p.reviews[0]?.outcome || p.tenderStatus;
    if (outcome === "awarded" || outcome === "won") cur.won += 1;
    if (outcome === "lost") cur.lost += 1;
    try {
      const tags = JSON.parse(p.reviews[0]?.reasonTagsJson || "[]") as string[];
      for (const t of tags) {
        cur.topReasons[t] = (cur.topReasons[t] || 0) + 1;
      }
    } catch {
      /* ignore */
    }
    clients.set(client, cur);
  }

  const clientRows = [...clients.values()]
    .map((c) => ({
      client: c.client,
      total: c.total,
      won: c.won,
      lost: c.lost,
      winRate: c.total ? Math.round((c.won / c.total) * 1000) / 10 : 0,
      topReasons: Object.entries(c.topReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // 竞争规律：从失败标签中聚合
  const competitionReasons: Record<string, number> = {};
  for (const p of projects) {
    try {
      const tags = JSON.parse(p.reviews[0]?.reasonTagsJson || "[]") as string[];
      for (const t of tags) {
        if (/竞争|竞品|现有供应商|指定品牌|本地竞争/.test(t)) {
          competitionReasons[t] = (competitionReasons[t] || 0) + 1;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const competitors = await db.marketCompetitor
    .findMany({
      where: { orgId },
      take: 20,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        primaryProduct: true,
        websiteUrl: true,
      },
    })
    .catch(() => []);

  return {
    clients: clientRows,
    competitionReasonTags: Object.entries(competitionReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([reason, count]) => ({ reason, count })),
    marketCompetitors: competitors,
  };
}

/** 最小「图谱」边：客户-项目-结果、规则-标签 */
export async function getOrgProjectGraphSummary(orgId: string) {
  const [rules, reviews, suppliers] = await Promise.all([
    db.organizationProjectRule.count({ where: { orgId, status: "active" } }),
    db.projectReview.count({
      where: { orgId, status: "confirmed" },
    }),
    db.supplier.count({ where: { orgId, status: "active" } }),
  ]);
  const projects = await db.project.count({ where: { orgId } });
  return {
    nodes: {
      projects,
      activeRules: rules,
      confirmedReviews: reviews,
      suppliers,
    },
    note: "Phase2 轻量图谱摘要；完整知识图谱可后续扩展边表",
  };
}
