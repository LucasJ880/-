/**
 * POST /api/trade/campaigns/[id]/pipeline
 *
 * 一键运行全自动化流水线：发现 → 研究 → 打分 → 生成开发信
 * body: { maxDiscover?, maxResearch?, maxOutreach? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getCampaign } from "@/lib/trade/service";
import { runFullPipeline } from "@/lib/trade/pipeline";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }

  if (campaign.status !== "active") {
    return NextResponse.json({ error: "活动未激活" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await runFullPipeline(id, {
    maxDiscover: body.maxDiscover,
    maxResearch: body.maxResearch,
    maxOutreach: body.maxOutreach,
  });

  return NextResponse.json(result);
}
