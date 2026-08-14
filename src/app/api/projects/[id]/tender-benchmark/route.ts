import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisRead,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { readAnalystSynthesis } from "@/lib/tender-analyst/contract";
import {
  readTenderBenchmark,
  runTenderBenchmark,
} from "@/lib/tender-analyst/benchmark";

const READY = ["REVIEW_REQUIRED", "APPROVED"];

async function latestReadyRun(projectId: string, orgId: string) {
  return db.tenderAnalysisRun.findFirst({
    where: { projectId, orgId, status: { in: READY } },
    orderBy: { createdAt: "desc" },
    select: { id: true, summaryJson: true },
  });
}

/**
 * GET  /api/projects/[id]/tender-benchmark
 *   → { benchmark, candidates }：已存对标 + 同 org 可对标历史项目候选
 *     （tender 项目、已有分析、已录中标结果）
 * POST /api/projects/[id]/tender-benchmark { historicalProjectId, winnerName? }
 *   → 运行对比并写入当前最新 run summaryJson.benchmark
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireTenderAnalysisRead(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const run = await latestReadyRun(projectId, orgId);
  const benchmark = run ? readTenderBenchmark(run.summaryJson) : null;

  // 候选：同 org、tender 域、非本项目、已录结果（won/lost 且有中标价）
  const candidates = await db.project.findMany({
    where: {
      orgId,
      id: { not: projectId },
      workDomain: "tender",
      tenderStatus: { in: ["won", "lost"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      tenderStatus: true,
      winningBidPrice: true,
      currency: true,
      awardDate: true,
    },
  });
  // 仅保留已有 Analyst 分析的候选（单查询 + JS 取每项目最新，避免 N+1）
  const runs = await db.tenderAnalysisRun.findMany({
    where: {
      projectId: { in: candidates.map((c) => c.id) },
      orgId,
      status: { in: READY },
    },
    orderBy: [{ projectId: "asc" }, { createdAt: "desc" }],
    select: { projectId: true, summaryJson: true },
  });
  const latestByProject = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    if (!latestByProject.has(r.projectId)) latestByProject.set(r.projectId, r);
  }
  const withAnalysis = candidates.filter((c) => {
    const r = latestByProject.get(c.id);
    return r && readAnalystSynthesis(r.summaryJson);
  });

  return NextResponse.json({ benchmark, candidates: withAnalysis });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const body = (await request.json().catch(() => ({}))) as {
    historicalProjectId?: string;
    winnerName?: string;
  };
  const histId = (body.historicalProjectId ?? "").trim();
  if (!histId) {
    return NextResponse.json({ error: "缺少历史项目" }, { status: 400 });
  }

  const [curRun, histRun, histProject] = await Promise.all([
    latestReadyRun(projectId, orgId),
    latestReadyRun(histId, orgId),
    db.project.findFirst({
      where: { id: histId, orgId, workDomain: "tender" },
      select: {
        name: true,
        tenderStatus: true,
        winningBidPrice: true,
        ourBidPrice: true,
        currency: true,
        awardDate: true,
      },
    }),
  ]);

  const current = curRun ? readAnalystSynthesis(curRun.summaryJson) : null;
  const historical = histRun ? readAnalystSynthesis(histRun.summaryJson) : null;
  if (!current) {
    return NextResponse.json(
      { error: "当前项目还没有完成的招标分析" },
      { status: 409 },
    );
  }
  if (!histProject || !historical) {
    return NextResponse.json(
      { error: "历史项目缺少完成的招标分析（请先在该项目跑一次分析）" },
      { status: 409 },
    );
  }

  const { benchmark, errorCode } = await runTenderBenchmark({
    current,
    historical,
    historicalProjectId: histId,
    outcome: {
      projectName: histProject.name,
      winnerName: body.winnerName?.trim() || null,
      winningBidPrice: histProject.winningBidPrice,
      ourBidPrice: histProject.ourBidPrice,
      currency: histProject.currency,
      awardDate: histProject.awardDate?.toISOString().slice(0, 10) ?? null,
      tenderStatus: histProject.tenderStatus,
    },
  });
  if (!benchmark) {
    return NextResponse.json(
      { error: `对比生成失败（${errorCode}），请稍后重试` },
      { status: 502 },
    );
  }

  // 写入当前最新 run 的 summaryJson.benchmark（终态 run 的附加投影，非 canonical 抽取数据）
  const fresh = await db.tenderAnalysisRun.findUnique({
    where: { id: curRun!.id },
    select: { summaryJson: true },
  });
  const merged = {
    ...((fresh?.summaryJson as Record<string, unknown>) ?? {}),
    benchmark,
  };
  await db.tenderAnalysisRun.update({
    where: { id: curRun!.id },
    data: { summaryJson: merged },
  });

  return NextResponse.json({ benchmark });
}
