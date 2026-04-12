/**
 * POST /api/trade/campaigns/[id]/discover
 *
 * 使用搜索关键词自动发现潜在客户，创建为线索
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getCampaign, createProspect } from "@/lib/trade/service";
import { discoverProspects } from "@/lib/trade/tools";
import { db } from "@/lib/db";

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

  const keywords = campaign.searchKeywords as string[] | null;
  if (!keywords || keywords.length === 0) {
    return NextResponse.json(
      { error: "请先生成搜索关键词" },
      { status: 400 },
    );
  }

  const discovered = await discoverProspects(keywords);

  const existingNames = new Set(
    (
      await db.tradeProspect.findMany({
        where: { campaignId: id },
        select: { companyName: true, website: true },
      })
    ).flatMap((p) => [
      p.companyName.toLowerCase(),
      p.website ? new URL(p.website).hostname.replace(/^www\./, "") : "",
    ]),
  );

  let created = 0;
  const results: { companyName: string; status: "created" | "skipped" }[] = [];

  for (const company of discovered) {
    const domain = (() => {
      try {
        return new URL(company.website).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();

    if (
      existingNames.has(company.companyName.toLowerCase()) ||
      (domain && existingNames.has(domain))
    ) {
      results.push({ companyName: company.companyName, status: "skipped" });
      continue;
    }

    await createProspect({
      campaignId: id,
      orgId: campaign.orgId,
      companyName: company.companyName,
      website: company.website,
      country: company.country,
      source: "google",
    });

    existingNames.add(company.companyName.toLowerCase());
    if (domain) existingNames.add(domain);
    created++;
    results.push({ companyName: company.companyName, status: "created" });
  }

  return NextResponse.json({ total: discovered.length, created, results });
}
