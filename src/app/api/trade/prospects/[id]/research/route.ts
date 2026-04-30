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
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

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

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const result = await runProspectResearch(
    { prospectId: id, orgId: orgRes.orgId },
    { includeScoringDebug: includeDebug, incrementCampaignQualifiedIfQualified: true },
  );

  if (!result.success) {
    if (
      result.code === "website_needed" ||
      result.code === "website_confirmation_needed" ||
      result.code === "research_failed"
    ) {
      const updated = await getProspect(id);
      const status = result.code === "research_failed" ? 500 : 200;
      return NextResponse.json(
        { error: result.error, code: result.code, prospect: updated },
        { status },
      );
    }
    const status = result.code === "forbidden" ? 403 : 404;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  const updated = await getProspect(id);

  return NextResponse.json({
    prospect: updated,
    researchBundle: result.researchBundle,
    report: result.researchBundle.report,
    score: { ...result.scoreForApi, score: result.finalScore },
  });
}
