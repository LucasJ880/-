/**
 * Trade 外贸获客 — 自动化流水线引擎
 *
 * 老板模式：一键启动，AI 全自动执行
 * 1. 生成搜索关键词（如果没有）
 * 2. 搜索发现潜在客户
 * 3. 批量研究 + 打分
 * 4. 合格客户生成开发信
 *
 * 返回每步执行结果，供前端实时展示进度
 */

import { db } from "@/lib/db";
import { getCampaign, updateCampaign, createProspect, updateProspect } from "./service";
import { generateSearchKeywords, generateOutreachEmail } from "./agents";
import { discoverProspects } from "./tools";
import { getResearchReportForAgents } from "./research-bundle";
import { runProspectResearch } from "./research-service";
import { logActivity } from "./activity-log";

export interface PipelineStep {
  step: string;
  status: "running" | "done" | "skipped" | "error";
  detail: string;
  count?: number;
}

export interface PipelineResult {
  steps: PipelineStep[];
  summary: {
    discovered: number;
    researched: number;
    qualified: number;
    outreachGenerated: number;
  };
}

export async function runFullPipeline(
  campaignId: string,
  opts?: { maxDiscover?: number; maxResearch?: number; maxOutreach?: number },
): Promise<PipelineResult> {
  const maxDiscover = opts?.maxDiscover ?? 20;
  const maxResearch = opts?.maxResearch ?? 10;
  const maxOutreach = opts?.maxOutreach ?? 5;

  const steps: PipelineStep[] = [];
  const summary = { discovered: 0, researched: 0, qualified: 0, outreachGenerated: 0 };

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    steps.push({ step: "init", status: "error", detail: "活动不存在" });
    return { steps, summary };
  }

  await logActivity({
    orgId: campaign.orgId,
    campaignId,
    action: "pipeline",
    detail: "自动化流水线启动",
  });

  // ── Step 1: Generate keywords ──
  let keywords = campaign.searchKeywords as string[] | null;
  if (!keywords || keywords.length === 0) {
    steps.push({ step: "keywords", status: "running", detail: "AI 生成搜索关键词..." });
    try {
      keywords = await generateSearchKeywords(campaign.productDesc, campaign.targetMarket);
      await updateCampaign(campaignId, { searchKeywords: keywords });
      steps[steps.length - 1] = {
        step: "keywords",
        status: "done",
        detail: `生成 ${keywords.length} 组搜索关键词`,
        count: keywords.length,
      };
    } catch (err) {
      steps[steps.length - 1] = {
        step: "keywords",
        status: "error",
        detail: `关键词生成失败: ${err instanceof Error ? err.message : "未知错误"}`,
      };
      return { steps, summary };
    }
  } else {
    steps.push({ step: "keywords", status: "skipped", detail: `已有 ${keywords.length} 组关键词`, count: keywords.length });
  }

  // ── Step 2: Discover prospects ──
  steps.push({ step: "discover", status: "running", detail: "搜索发现潜在客户..." });
  try {
    const discovered = await discoverProspects(keywords, Math.ceil(maxDiscover / keywords.length));

    const existingNames = new Set(
      (await db.tradeProspect.findMany({
        where: { campaignId },
        select: { companyName: true, website: true },
      })).flatMap((p) => [
        p.companyName.toLowerCase(),
        p.website ? new URL(p.website).hostname.replace(/^www\./, "") : "",
      ].filter(Boolean)),
    );

    let created = 0;
    for (const company of discovered) {
      const domain = (() => { try { return new URL(company.website).hostname.replace(/^www\./, ""); } catch { return ""; } })();
      if (existingNames.has(company.companyName.toLowerCase()) || (domain && existingNames.has(domain))) continue;

      await createProspect({
        campaignId,
        orgId: campaign.orgId,
        companyName: company.companyName,
        website: company.website,
        country: company.country,
        source: "google",
      });
      existingNames.add(company.companyName.toLowerCase());
      created++;
      if (created >= maxDiscover) break;
    }

    summary.discovered = created;
    steps[steps.length - 1] = {
      step: "discover",
      status: "done",
      detail: `发现 ${discovered.length} 家公司，新增 ${created} 条线索`,
      count: created,
    };

    await logActivity({
      orgId: campaign.orgId,
      campaignId,
      action: "discover",
      detail: `自动发现 ${created} 条新线索`,
      meta: { total: discovered.length, created },
    });
  } catch (err) {
    steps[steps.length - 1] = {
      step: "discover",
      status: "error",
      detail: `发现客户失败: ${err instanceof Error ? err.message : "未知错误"}`,
    };
  }

  // ── Step 3: Research + Score ──
  steps.push({ step: "research", status: "running", detail: "AI 研究 + 打分..." });
  try {
    const newProspects = await db.tradeProspect.findMany({
      where: { campaignId, stage: "new" },
      take: maxResearch,
      orderBy: { createdAt: "asc" },
    });

    let qualifiedCount = 0;
    for (const p of newProspects) {
      try {
        const researchResult = await runProspectResearch(
          { prospectId: p.id },
          { incrementCampaignQualifiedIfQualified: false },
        );
        if (!researchResult.success) {
          console.error(`[pipeline] Research failed for ${p.companyName}:`, researchResult.error);
          continue;
        }
        const { finalScore, newStage } = researchResult;

        if (newStage === "qualified") qualifiedCount++;

        await logActivity({
          orgId: campaign.orgId,
          campaignId,
          prospectId: p.id,
          action: "research",
          detail: `${p.companyName}: ${finalScore.toFixed(1)}分 → ${newStage}`,
          meta: { score: finalScore, stage: newStage },
        });
      } catch (err) {
        console.error(`[pipeline] Research failed for ${p.companyName}:`, err);
      }
    }

    summary.researched = newProspects.length;
    summary.qualified = qualifiedCount;

    if (qualifiedCount > 0) {
      await db.tradeCampaign.update({
        where: { id: campaignId },
        data: { qualified: { increment: qualifiedCount } },
      });
    }

    steps[steps.length - 1] = {
      step: "research",
      status: "done",
      detail: `研究 ${newProspects.length} 条线索，${qualifiedCount} 条合格`,
      count: newProspects.length,
    };
  } catch (err) {
    steps[steps.length - 1] = {
      step: "research",
      status: "error",
      detail: `研究失败: ${err instanceof Error ? err.message : "未知错误"}`,
    };
  }

  // ── Step 4: Generate outreach for qualified ──
  steps.push({ step: "outreach", status: "running", detail: "为合格线索生成开发信..." });
  try {
    const qualifiedProspects = await db.tradeProspect.findMany({
      where: { campaignId, stage: "qualified", outreachBody: null },
      take: maxOutreach,
    });

    let generated = 0;
    for (const p of qualifiedProspects) {
      try {
        const report = getResearchReportForAgents(p.researchReport);
        if (!report) continue;

        const draft = await generateOutreachEmail(
          { companyName: p.companyName, contactName: p.contactName, contactTitle: p.contactTitle, country: p.country },
          report,
          campaign.productDesc,
          { companyName: "Our Company", senderName: "Sales Team" },
        );

        await updateProspect(p.id, {
          outreachSubject: draft.subject,
          outreachBody: draft.body,
          outreachLang: "auto",
          stage: "outreach_draft",
        });
        generated++;

        await logActivity({
          orgId: campaign.orgId,
          campaignId,
          prospectId: p.id,
          action: "outreach",
          detail: `为 ${p.companyName} 生成开发信`,
        });
      } catch (err) {
        console.error(`[pipeline] Outreach failed for ${p.companyName}:`, err);
      }
    }

    summary.outreachGenerated = generated;
    steps[steps.length - 1] = {
      step: "outreach",
      status: "done",
      detail: `为 ${generated} 条合格线索生成开发信`,
      count: generated,
    };
  } catch (err) {
    steps[steps.length - 1] = {
      step: "outreach",
      status: "error",
      detail: `开发信生成失败: ${err instanceof Error ? err.message : "未知错误"}`,
    };
  }

  await logActivity({
    orgId: campaign.orgId,
    campaignId,
    action: "pipeline",
    detail: `流水线完成: 发现${summary.discovered} 研究${summary.researched} 合格${summary.qualified} 开发信${summary.outreachGenerated}`,
    meta: summary,
  });

  return { steps, summary };
}
