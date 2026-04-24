/**
 * POST /api/trade/prospects/[id]/research
 *
 * 对单个线索执行 AI 研究 + 打分；逻辑委托 trade research-service。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac/roles";
import { getProspect } from "@/lib/trade/service";
import { runProspectResearch } from "@/lib/trade/research-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const includeDebug =
    new URL(request.url).searchParams.get("debugScore") === "1" &&
    isAdmin(auth.user.role);

  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) {
    return NextResponse.json({ error: "线索不存在" }, { status: 404 });
  }

  const result = await runProspectResearch(
    { prospectId: id },
    { includeScoringDebug: includeDebug, incrementCampaignQualifiedIfQualified: true },
  );

  if (!result.success) {
    const status = result.code === "forbidden" ? 403 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  const updated = await getProspect(id);

  return NextResponse.json({
    prospect: updated,
    researchBundle: result.researchBundle,
    report: result.researchBundle.report,
    score: { ...result.scoreForApi, score: result.finalScore },
  });
}
