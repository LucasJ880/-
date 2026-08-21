/**
 * 投标文件起草 · 输入装配（只读）：run / 合规矩阵 / 房间备忘录与报价输入 /
 * 品牌档案 / 企业记忆已验证事实 / 我方中标记录。任何一块缺失都降级为空，不阻塞。
 */

import { db } from "@/lib/db";
import { formatTenderProfileContext, isTenderProfileUsable } from "@/lib/tender-profile/contract";
import { getTenderProfile } from "@/lib/tender-profile/store";
import { complianceStatusFromFit, type BidDraftInputs, type BidDraftRequirement } from "./contract";

export async function gatherBidDraftInputs(params: {
  projectId: string;
  orgId: string | null;
  userId: string;
}): Promise<BidDraftInputs | null> {
  const project = await db.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, name: true, clientOrganization: true, closeDate: true },
  });
  if (!project) return null;
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId: project.id, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
  if (!run) return null;
  const sj = ((run.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const matrix = ((sj.bidFitMatrix as Record<string, { fit?: string; noteZh?: string | null }>) ?? {});
  const reqRows = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: run.id },
    orderBy: [{ mandatory: "desc" }, { requirementCode: "asc" }],
    take: 120,
    select: {
      id: true,
      requirementCode: true,
      category: true,
      chineseTranslation: true,
      originalRequirement: true,
      mandatory: true,
      evidenceRequired: true,
    },
  });
  const requirements: BidDraftRequirement[] = reqRows.map((r) => {
    const m = matrix[r.id];
    return {
      id: r.id,
      code: r.requirementCode,
      category: r.category,
      textZh: r.chineseTranslation.slice(0, 300),
      textOriginal: r.originalRequirement.slice(0, 400),
      mandatory: r.mandatory,
      evidenceRequired: r.evidenceRequired,
      fit: m?.fit ?? null,
      noteZh: m?.noteZh ?? null,
      status: complianceStatusFromFit(m?.fit),
    };
  });
  const factRows = await db.tenderAnalysisFact.findMany({
    where: { runId: run.id },
    take: 80,
    select: { contentZh: true, contentOriginal: true },
  });
  const cfRaw = (sj.criticalFacts ?? {}) as Record<string, { status?: string; text?: string | null }>;
  const criticalFacts: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfRaw)) {
    if (v && v.status === "KNOWN" && v.text) criticalFacts[k] = String(v.text).slice(0, 300);
  }

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId: project.id },
    select: { summaryJson: true },
  });
  const rsj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const memoRaw = (rsj.bidStrategyMemo ?? null) as {
    summaryZh?: string;
    riskGates?: Array<{ gateZh: string; statusZh: string; basisZh: string }>;
    teamingAdviceZh?: string;
    strategicRfis?: unknown[];
  } | null;
  const lead = (rsj.incumbentLead ?? null) as { vendor?: string } | null;
  const ext = (rsj.externalConfirmed ?? null) as { competitors?: Array<{ name: string }> } | null;
  const excludeNames = Array.from(
    new Set(
      [...(lead?.vendor ? [lead.vendor] : []), ...((ext?.competitors ?? []).map((c) => c.name))]
        .filter((n) => typeof n === "string" && n.trim().length >= 3)
        .map((n) => n.trim()),
    ),
  );
  const pricingInputs = (rsj.pricingInputs ?? {}) as { ourCostCad?: number | null; competitorPriceCad?: number | null; ourPriceCad?: number | null };

  // A：投标业务档案（与窗饰品牌档案分离）——只读 tenderProfile，绝不回退到 BrandProfile
  let brandContext: string | null = null;
  let forbiddenClaims: string | null = null;
  if (params.orgId) {
    try {
      const tp = await getTenderProfile(params.orgId);
      if (isTenderProfileUsable(tp)) {
        brandContext = formatTenderProfileContext(tp!);
        forbiddenClaims = tp!.forbiddenClaims || null;
      }
    } catch {
      brandContext = null;
    }
  }
  let memoryClaims: BidDraftInputs["org"]["memoryClaims"] = [];
  if (params.orgId) {
    try {
      const rows = await db.memoryClaim.findMany({
        where: { orgId: params.orgId, status: "ACTIVE", verificationStatus: { in: ["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"] }, claimType: { not: "COMPLIANCE_POSITION" } },
        orderBy: { capturedAt: "desc" },
        take: 40,
        select: { statement: true, claimType: true, verificationStatus: true },
      });
      memoryClaims = rows.map((r) => ({ statement: r.statement.slice(0, 300), claimType: r.claimType, verificationStatus: r.verificationStatus }));
    } catch {
      memoryClaims = [];
    }
  }
  let ownWins: BidDraftInputs["org"]["ownWins"] = [];
  if (params.orgId) {
    try {
      const rows = await db.awardRecord.findMany({
        where: { orgId: params.orgId, status: "ACTIVE", sources: { some: { sourceKey: { startsWith: "own-result:" } } } },
        orderBy: { awardDate: "desc" },
        take: 10,
        select: { buyerNameRaw: true, scopeSummary: true, awardDate: true, contractAmount: true },
      });
      ownWins = rows.map((r) => ({
        buyer: r.buyerNameRaw ?? null,
        title: r.scopeSummary ? String(r.scopeSummary).slice(0, 120) : null,
        awardDate: r.awardDate ? r.awardDate.toISOString().slice(0, 10) : null,
        amount: r.contractAmount == null ? null : Number(r.contractAmount),
      }));
    } catch {
      ownWins = [];
    }
  }

  return {
    project: {
      id: project.id,
      nameZh: project.name,
      buyer: criticalFacts.buyer ?? project.clientOrganization ?? null,
      tenderNumber: criticalFacts.tender_number ?? null,
      tenderTitle: criticalFacts.project_title ?? null,
      closing: criticalFacts.closing_datetime ?? (project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null),
      submissionMethod: criticalFacts.submission_method ?? null,
    },
    requirements,
    facts: factRows.map((f) => ({ zh: (f.contentZh ?? "").slice(0, 220), original: (f.contentOriginal ?? "").slice(0, 220) })),
    criticalFacts,
    analystBrief: sj.analystSynthesis ?? null,
    submissionChecklist: sj.submissionChecklist ?? null,
    memo: memoRaw
      ? {
          summaryZh: memoRaw.summaryZh ?? null,
          riskGates: (memoRaw.riskGates ?? []).slice(0, 8),
          teamingAdviceZh: memoRaw.teamingAdviceZh ?? null,
        }
      : null,
    rfiCount: Array.isArray(memoRaw?.strategicRfis) ? memoRaw!.strategicRfis!.length : 0,
    pricing: {
      ourPriceCad: typeof pricingInputs.ourPriceCad === "number" ? pricingInputs.ourPriceCad : null,
      competitorPriceCad: typeof pricingInputs.competitorPriceCad === "number" ? pricingInputs.competitorPriceCad : null,
      note: "报价以报价表助手人工确认为准；起草稿不决定价格",
    },
    org: { brandContext, forbiddenClaims, memoryClaims, ownWins },
    excludeNames,
  };
}
