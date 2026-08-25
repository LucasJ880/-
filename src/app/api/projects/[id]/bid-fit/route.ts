import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  listCompliancePositions,
  matchRequirementsToMemory,
  recordCompliancePosition,
} from "@/lib/tender-compliance-memory";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";

/**
 * 批次一 · 投标合规矩阵（对标 2026-08-20 人工分析样本的收尾建议）：
 * 把每条 Mandatory 要求标注为 已有/可开发/需 Partner/需 RFI/No-Go，
 * 一眼看清「我们到底缺什么」。标注存 run.summaryJson.bidFitMatrix
 * （additive JSON，零 schema），人工判定为准——AI 不代填。
 */

// 路由文件只准导出 HTTP 方法与路由配置（webpack 构建强校验；Turbopack 曾放过）——常量收为模块内私有
const BID_FIT_VALUES = ["HAVE", "BUILD", "PARTNER", "RFI", "NO_GO"] as const;

async function latestRun(projectId: string) {
  return db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const run = await latestRun(projectId);
  if (!run) return NextResponse.json({ runId: null, requirements: [], matrix: {} });

  const requirements = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: run.id },
    orderBy: [{ mandatory: "desc" }, { requirementCode: "asc" }],
    take: 300,
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
  const matrix =
    ((run.summaryJson as Record<string, unknown>)?.bidFitMatrix as Record<
      string,
      unknown
    >) ?? {};
  // 合规记忆（B）：组织历史人工确认 → 对未标要求给出 exact/fuzzy 建议（零模型花费）
  let suggestions: ReturnType<typeof matchRequirementsToMemory> = [];
  const project = await db.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
  if (project?.orgId) {
    const positions = await listCompliancePositions({ orgId: project.orgId, userId: access.user.id });
    if (positions.length > 0) {
      const unmarked = requirements.filter((r) => !matrix[r.id]);
      suggestions = matchRequirementsToMemory(
        unmarked.map((r) => ({ id: r.id, text: r.originalRequirement || r.chineseTranslation, category: r.category })),
        positions,
        { excludeProjectId: projectId },
      );
    }
  }
  return NextResponse.json({
    runId: run.id,
    requirements: requirements.map((r) => ({
      id: r.id,
      code: r.requirementCode,
      category: r.category,
      textZh: r.chineseTranslation.slice(0, 200),
      mandatory: r.mandatory,
      evidenceRequired: r.evidenceRequired,
    })),
    matrix,
    suggestions,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    requirementId?: string;
    /** 批量标注（「全部同意」）：与 requirementId 二选一，≤300 条 */
    requirementIds?: string[];
    fit?: string;
    noteZh?: string | null;
    /** 合规记忆：把历史确认带入未标要求（exact=指纹一致；all=含相似建议） */
    action?: "apply-memory";
    mode?: "exact" | "all";
  };
  if (body.action === "apply-memory") {
    return applyMemory({ projectId, runId: body.runId ?? null, mode: body.mode === "all" ? "all" : "exact", userId: access.user.id });
  }
  const fit = (body.fit ?? "").toUpperCase();
  const ids = Array.isArray(body.requirementIds)
    ? body.requirementIds.filter((v): v is string => typeof v === "string")
    : body.requirementId
      ? [body.requirementId]
      : [];
  if (
    !body.runId ||
    ids.length === 0 ||
    ids.length > 300 ||
    !(BID_FIT_VALUES as readonly string[]).includes(fit)
  ) {
    return NextResponse.json(
      { error: "runId/requirementId(s)/fit 必填且合法（批量 ≤300 条）" },
      { status: 400 },
    );
  }
  // 全部要求必须属于该 run（防跨项目写入）；任一无效 → 整体拒绝，不做半成功
  const owned = await db.tenderExtractedRequirement.count({
    where: { id: { in: ids }, analysisRunId: body.runId, projectId },
  });
  const run = await db.tenderAnalysisRun.findFirst({
    where: { id: body.runId, projectId },
    select: { id: true, summaryJson: true },
  });
  if (owned !== new Set(ids).size || !run) {
    return NextResponse.json({ error: "要求不属于该项目的该次分析" }, { status: 404 });
  }
  const sj = ((run.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const matrix = ((sj.bidFitMatrix as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const mark = {
    fit,
    noteZh: (body.noteZh ?? "").slice(0, 300) || null,
    by: access.user.id,
    at: new Date().toISOString(),
  };
  for (const id of ids) {
    matrix[id] = mark;
  }
  // 合规记忆（B）：人工标注 → 组织级立场（T3 claim，actor=user；失败不阻塞标注）
  void (async () => {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { orgId: true, name: true } });
    if (!project?.orgId) return;
    const rows = await db.tenderExtractedRequirement.findMany({
      where: { id: { in: ids } },
      select: { requirementCode: true, category: true, originalRequirement: true, chineseTranslation: true },
    });
    for (const r of rows) {
      await recordCompliancePosition({
        orgId: project.orgId,
        userId: access.user.id,
        requirement: { text: r.originalRequirement || r.chineseTranslation, code: r.requirementCode, category: r.category },
        fit,
        noteZh: mark.noteZh,
        project: { id: projectId, name: project.name },
      });
    }
  })().catch(() => undefined);
  await db.tenderAnalysisRun.update({
    where: { id: run.id },
    data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, bidFitMatrix: matrix })) },
  });
  return NextResponse.json({ ok: true, matrix });
}

/** 合规记忆带入：只填未标要求；带 provenance（via=memory），不回写记忆（防回声） */
async function applyMemory(input: { projectId: string; runId: string | null; mode: "exact" | "all"; userId: string }) {
  const run = input.runId
    ? await db.tenderAnalysisRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true, summaryJson: true } })
    : await latestRun(input.projectId);
  if (!run) return NextResponse.json({ error: "尚无已完成的分析" }, { status: 404 });
  const project = await db.project.findUnique({ where: { id: input.projectId }, select: { orgId: true } });
  if (!project?.orgId) return NextResponse.json({ applied: 0 });
  const sj = ((run.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const matrix = ((sj.bidFitMatrix as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const reqs = await db.tenderExtractedRequirement.findMany({
    where: { analysisRunId: run.id },
    take: 300,
    select: { id: true, category: true, originalRequirement: true, chineseTranslation: true },
  });
  const positions = await listCompliancePositions({ orgId: project.orgId, userId: input.userId });
  const unmarked = reqs.filter((r) => !matrix[r.id]);
  const suggestions = matchRequirementsToMemory(
    unmarked.map((r) => ({ id: r.id, text: r.originalRequirement || r.chineseTranslation, category: r.category })),
    positions,
    { excludeProjectId: input.projectId },
  ).filter((s) => input.mode === "all" || s.kind === "exact");
  let applied = 0;
  for (const sg of suggestions) {
    matrix[sg.requirementId] = {
      fit: sg.fit,
      noteZh: sg.noteZh,
      by: input.userId,
      at: new Date().toISOString(),
      provenance: { via: "memory", kind: sg.kind, score: sg.score, claimId: sg.claimId, sourceProjectName: sg.sourceProjectName, sourceRequirementCode: sg.sourceRequirementCode },
    };
    applied += 1;
  }
  if (applied > 0) {
    await db.tenderAnalysisRun.update({
      where: { id: run.id },
      data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, bidFitMatrix: matrix })) },
    });
  }
  return NextResponse.json({ ok: true, applied, mode: input.mode, matrix });
}
