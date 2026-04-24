/**
 * POST /api/trade/campaigns/[id]/batch-research
 *
 * 批量研究 + 打分未研究的线索
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getCampaign, updateProspect } from "@/lib/trade/service";
import { generateResearchReport, scoreProspect } from "@/lib/trade/agents";
import { mergeResearchBundle } from "@/lib/trade/research-bundle";
import { gatherTradeResearchInputs } from "@/lib/trade/research-input";
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

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(body.limit ?? 5, 10);

  const prospects = await db.tradeProspect.findMany({
    where: { campaignId: id, stage: "new" },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  if (prospects.length === 0) {
    return NextResponse.json({ message: "没有待研究的线索", processed: 0 });
  }

  let qualifiedCount = 0;
  const results: { id: string; companyName: string; score: number; stage: string }[] = [];

  for (const p of prospects) {
    try {
      const { rawData, sources, website: resolvedWebsite } = await gatherTradeResearchInputs({
        companyName: p.companyName,
        country: p.country,
        website: p.website,
      });

      const { report, fieldSourceIds } = await generateResearchReport(
        { name: p.companyName, website: p.website, country: p.country, rawData: rawData || undefined },
        campaign.productDesc,
        campaign.targetMarket,
        sources,
      );

      const scoreResult = await scoreProspect(
        sources,
        report,
        campaign.productDesc,
        campaign.targetMarket,
      );
      const researchBundle = mergeResearchBundle(
        sources,
        report,
        fieldSourceIds,
        scoreResult.scoring,
      );
      const finalScore =
        researchBundle.scoring?.totalFromDimensions ?? scoreResult.score;
      const newStage =
        finalScore >= campaign.scoreThreshold ? "qualified" : "unqualified";

      await updateProspect(p.id, {
        researchReport: researchBundle,
        score: finalScore,
        scoreReason: scoreResult.reason,
        stage: newStage,
        website: resolvedWebsite ?? p.website,
      });

      if (newStage === "qualified") qualifiedCount++;
      results.push({
        id: p.id,
        companyName: p.companyName,
        score: finalScore,
        stage: newStage,
      });
    } catch (err) {
      results.push({
        id: p.id,
        companyName: p.companyName,
        score: 0,
        stage: "new",
      });
      console.error(`[batch-research] Failed for ${p.companyName}:`, err);
    }
  }

  if (qualifiedCount > 0) {
    await db.tradeCampaign.update({
      where: { id: campaign.id },
      data: { qualified: { increment: qualifiedCount } },
    });
  }

  return NextResponse.json({ processed: results.length, qualified: qualifiedCount, results });
}
