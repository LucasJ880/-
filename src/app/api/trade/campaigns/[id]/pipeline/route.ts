/**
 * POST /api/trade/campaigns/[id]/pipeline
 *
 * 一键运行全自动化流水线：发现 → 研究 → 打分 → 生成开发信
 * body: { maxDiscover?, maxResearch?, maxOutreach?, orgId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { runFullPipeline } from "@/lib/trade/pipeline";
import { loadTradeCampaignForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeCampaignForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { campaign } = loaded;

  if (campaign.status !== "active") {
    return NextResponse.json({ error: "活动未激活" }, { status: 400 });
  }

  const result = await runFullPipeline(id, orgRes.orgId, {
    maxDiscover: body.maxDiscover,
    maxResearch: body.maxResearch,
    maxOutreach: body.maxOutreach,
  });

  return NextResponse.json(result);
}
