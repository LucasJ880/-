import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { getExecutiveBrief } from "@/lib/tender-auto-analysis/executive-brief";
import { isTenderPackageAiExperienceEnabledWithEnv } from "@/lib/tender-auto-analysis/auto-flags";
import { EXTERNAL_INTEL_STATUS_KEY } from "@/lib/tender-intel/orchestrate";

/**
 * GET /api/projects/[id]/workbench-summary
 *
 * 工作台指挥台聚合（一次请求供给 关键信息条 / 项目摘要内联 / 情报摘要卡）。
 * 纯读投影：硬字段（项目行）+ 最新分析统计（真实计数）+ 30 秒看懂
 * （复用 getExecutiveBrief，含 readiness 语义）+ 情报态（externalIntelStatus /
 * 候选计数 / AI 策略草案首段）。禁假数据：无 run 时计数为 null（不是 0）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id },
    select: {
      orgId: true,
      name: true,
      clientOrganization: true,
      solicitationNumber: true,
      closeDate: true,
      estimatedValue: true,
      currency: true,
      tenderStatus: true,
      category: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const latestRun = await db.tenderAnalysisRun.findFirst({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, analysisVersion: true, createdAt: true },
  });

  let counts: {
    requirements: number;
    mandatory: number;
    clarifications: number;
    risks: number | null;
  } | null = null;
  if (latestRun) {
    const [requirements, mandatory, clarifications, riskSection] =
      await Promise.all([
        db.tenderExtractedRequirement.count({
          where: { analysisRunId: latestRun.id },
        }),
        db.tenderExtractedRequirement.count({
          where: { analysisRunId: latestRun.id, mandatory: true },
        }),
        db.tenderClarificationQuestion.count({
          where: { analysisRunId: latestRun.id },
        }),
        db.tenderAnalysisSection.findFirst({
          where: { runId: latestRun.id, sectionKey: "RISKS" },
          select: { structuredJson: true },
        }),
      ]);
    const risksRaw = (riskSection?.structuredJson as { risks?: unknown[] } | null)
      ?.risks;
    counts = {
      requirements,
      mandatory,
      clarifications,
      risks: Array.isArray(risksRaw) ? risksRaw.length : null,
    };
  }

  const experienceEnabled = isTenderPackageAiExperienceEnabledWithEnv({
    orgId: project.orgId ?? null,
  });
  const brief = experienceEnabled
    ? await getExecutiveBrief(id, project.category ?? null).catch(() => null)
    : null;

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId: id },
    select: { summaryJson: true },
  });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<
    string,
    unknown
  >;
  const candidates = (sj.externalCandidates ?? null) as {
    candidates?: unknown[];
  } | null;
  // 批次一：优先用文档接地的策略备忘录 v2（映射成 deck 兼容形状），
  // 老草案仅作存量兜底
  const memo = (sj.bidStrategyMemo ?? null) as {
    summaryZh?: string;
    riskGates?: Array<{ gateZh: string; statusZh: string }>;
    dataGapsZh?: string;
    generatedAt?: string;
  } | null;
  const legacyDraft = (sj.bidStrategyAuto ?? null) as {
    strategyZh?: string;
    keyPoints?: Array<{ pointZh: string; basedOn: string }>;
    dataGapsZh?: string;
    generatedAt?: string;
  } | null;
  const strategy = memo
    ? {
        strategyZh: memo.summaryZh ?? "",
        keyPoints: (memo.riskGates ?? [])
          .slice(0, 3)
          .map((g) => ({ pointZh: `${g.gateZh}（${g.statusZh}）`, basedOn: "风险门" })),
        dataGapsZh: memo.dataGapsZh,
        generatedAt: memo.generatedAt,
      }
    : legacyDraft;

  return NextResponse.json({
    project: {
      name: project.name,
      clientOrganization: project.clientOrganization,
      solicitationNumber: project.solicitationNumber,
      closeDate: project.closeDate ? project.closeDate.toISOString() : null,
      estimatedValue: project.estimatedValue,
      currency: project.currency,
      tenderStatus: project.tenderStatus,
    },
    analysis: latestRun
      ? { runId: latestRun.id, status: latestRun.status, counts }
      : null,
    brief,
    experienceEnabled,
    intel: {
      status: (sj[EXTERNAL_INTEL_STATUS_KEY] ?? null) as Record<
        string,
        unknown
      > | null,
      candidateCount: Array.isArray(candidates?.candidates)
        ? candidates.candidates.length
        : null,
      strategy: strategy
        ? {
            strategyZh: (strategy.strategyZh ?? "").slice(0, 400),
            keyPoints: (strategy.keyPoints ?? []).slice(0, 2),
            generatedAt: strategy.generatedAt ?? null,
          }
        : null,
    },
  });
}
