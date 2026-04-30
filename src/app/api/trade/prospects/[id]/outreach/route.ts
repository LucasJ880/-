/**
 * POST /api/trade/prospects/[id]/outreach
 *
 * AI 生成个性化开发信（中英双版本）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateProspect } from "@/lib/trade/service";
import { generateOutreachEmail } from "@/lib/trade/agents";
import { getResearchReportForAgents } from "@/lib/trade/research-bundle";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

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
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { prospect } = loaded;

  const reportForEmail = getResearchReportForAgents(prospect.researchReport);
  if (!reportForEmail) {
    return NextResponse.json(
      { error: "请先完成客户研究再生成开发信" },
      { status: 400 },
    );
  }

  const campaign = prospect.campaign;
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }

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
  });

  return NextResponse.json({ draft });
}
