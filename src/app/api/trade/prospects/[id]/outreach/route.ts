/**
 * POST /api/trade/prospects/[id]/outreach
 *
 * AI 生成个性化开发信（中英双版本）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getProspect, updateProspect, getCampaign } from "@/lib/trade/service";
import { generateOutreachEmail } from "@/lib/trade/agents";
import { getResearchReportForAgents } from "@/lib/trade/research-bundle";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) {
    return NextResponse.json({ error: "线索不存在" }, { status: 404 });
  }

  const reportForEmail = getResearchReportForAgents(prospect.researchReport);
  if (!reportForEmail) {
    return NextResponse.json(
      { error: "请先完成客户研究再生成开发信" },
      { status: 400 },
    );
  }

  const campaign = await getCampaign(prospect.campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  const draft = await generateOutreachEmail(
    {
      companyName: prospect.companyName,
      contactName: prospect.contactName,
      contactTitle: prospect.contactTitle,
      country: prospect.country,
    },
    reportForEmail,
    campaign.productDesc,
    {
      companyName: body.senderCompany ?? "Our Company",
      senderName: body.senderName ?? auth.user.name,
    },
  );

  await updateProspect(id, {
    outreachSubject: draft.subject,
    outreachBody: draft.body,
    outreachLang: "en",
    stage: prospect.stage === "qualified" ? "outreach_draft" : prospect.stage,
  });

  return NextResponse.json({ draft });
}
