import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

export const BID_FIT_VALUES = ["HAVE", "BUILD", "PARTNER", "RFI", "NO_GO"] as const;

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
      mandatory: true,
      evidenceRequired: true,
    },
  });
  const matrix =
    ((run.summaryJson as Record<string, unknown>)?.bidFitMatrix as Record<
      string,
      unknown
    >) ?? {};
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
  };
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
  await db.tenderAnalysisRun.update({
    where: { id: run.id },
    data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, bidFitMatrix: matrix })) },
  });
  return NextResponse.json({ ok: true, matrix });
}
