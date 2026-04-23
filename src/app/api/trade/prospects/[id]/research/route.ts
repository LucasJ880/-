/**
 * POST /api/trade/prospects/[id]/research
 *
 * 对单个线索执行 AI 研究 + 打分流水线：
 * 1. 搜索公司信息（Serper）
 * 2. 抓取官网内容
 * 3. AI 生成研究报告（含 sources / fieldSourceIds）
 * 4. AI 资格打分
 * 5. 更新线索状态
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/rbac/roles";
import { getProspect, updateProspect, getCampaign } from "@/lib/trade/service";
import { generateResearchReport, scoreProspect } from "@/lib/trade/agents";
import { searchGoogle, fetchPageContent } from "@/lib/trade/tools";
import {
  buildSourcesFromSerpAndPage,
  mergeResearchBundle,
} from "@/lib/trade/research-bundle";

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

  const campaign = await getCampaign(prospect.campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }

  // Step 1: Search for company info
  let rawData = "";
  const searchResults = await searchGoogle(
    `"${prospect.companyName}" ${prospect.country ?? ""} company products`,
    { num: 5 },
  );
  if (searchResults.length > 0) {
    rawData = searchResults
      .map((r) => `[${r.title}](${r.link})\n${r.snippet}`)
      .join("\n\n");
  }

  // Step 2: Fetch website content
  const website = prospect.website ?? searchResults[0]?.link;
  let homepagePage: Awaited<ReturnType<typeof fetchPageContent>> | null = null;
  if (website) {
    const page = await fetchPageContent(website);
    if (page.ok) {
      homepagePage = page;
      rawData += `\n\n--- 官网内容 ---\n${page.title}\n${page.text.slice(0, 3000)}`;
    }
  }

  const sources = buildSourcesFromSerpAndPage(
    searchResults,
    homepagePage,
    website && homepagePage?.ok ? website : null,
  );

  // Step 3: Generate research report (+ fieldSourceIds)
  const { report, fieldSourceIds } = await generateResearchReport(
    {
      name: prospect.companyName,
      website: prospect.website,
      country: prospect.country,
      rawData: rawData || undefined,
    },
    campaign.productDesc,
    campaign.targetMarket,
    sources,
  );

  // Step 4: Score the prospect（规则维度 + LLM 润色理由）
  const scoreResult = await scoreProspect(
    sources,
    report,
    campaign.productDesc,
    campaign.targetMarket,
    { includeDebug },
  );

  const researchBundle = mergeResearchBundle(
    sources,
    report,
    fieldSourceIds,
    scoreResult.scoring,
  );

  const finalScore =
    researchBundle.scoring?.totalFromDimensions ?? scoreResult.score;

  // Step 5: Update prospect
  const newStage =
    finalScore >= campaign.scoreThreshold ? "qualified" : "unqualified";

  const updated = await updateProspect(id, {
    researchReport: researchBundle,
    score: finalScore,
    scoreReason: scoreResult.reason,
    stage: newStage,
    website: website ?? prospect.website,
  });

  // Update campaign stats
  if (newStage === "qualified") {
    const { db } = await import("@/lib/db");
    await db.tradeCampaign.update({
      where: { id: campaign.id },
      data: { qualified: { increment: 1 } },
    });
  }

  return NextResponse.json({
    prospect: updated,
    researchBundle,
    report,
    score: { ...scoreResult, score: finalScore },
  });
}
