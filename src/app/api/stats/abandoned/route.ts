import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getVisibleProjectIds } from "@/lib/projects/visibility";

const STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const daysParam = request.nextUrl.searchParams.get("days");
  const days = [30, 60, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;

  const since = new Date(Date.now() - days * 24 * 3600_000);

  const projectIds = await getVisibleProjectIds(user.id, user.role);
  const projectScope = projectIds === null ? {} : { id: { in: projectIds } };

  const projects = await db.project.findMany({
    where: {
      ...projectScope,
      status: "abandoned",
      abandonedAt: { gte: since },
    },
    select: {
      id: true,
      name: true,
      color: true,
      abandonedAt: true,
      abandonedStage: true,
      abandonedReason: true,
      abandonedById: true,
      sourceSystem: true,
      clientOrganization: true,
      estimatedValue: true,
      currency: true,
      org: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
    orderBy: { abandonedAt: "desc" },
  });

  const stageBreakdown: Record<string, number> = {};
  for (const p of projects) {
    const stage = p.abandonedStage ?? "unknown";
    stageBreakdown[stage] = (stageBreakdown[stage] ?? 0) + 1;
  }

  const stageStats = Object.entries(stageBreakdown).map(([stage, count]) => ({
    stage,
    label: STAGE_LABELS[stage] ?? stage,
    count,
  }));

  return NextResponse.json({
    days,
    total: projects.length,
    stageStats,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      abandonedAt: p.abandonedAt,
      abandonedStage: p.abandonedStage,
      abandonedStageLabel: STAGE_LABELS[p.abandonedStage ?? ""] ?? p.abandonedStage,
      abandonedReason: p.abandonedReason,
      sourceSystem: p.sourceSystem,
      clientOrganization: p.clientOrganization,
      estimatedValue: p.estimatedValue,
      currency: p.currency,
      org: p.org,
      owner: p.owner,
    })),
  });
}
