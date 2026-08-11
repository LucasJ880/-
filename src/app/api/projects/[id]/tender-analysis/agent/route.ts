import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisRead,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import {
  cancelTenderWorkforceAnalysis,
  getTenderWorkforceAnalysisStatus,
  startTenderWorkforceAnalysis,
} from "@/lib/tender-workforce/trigger-service";

/**
 * Tender T1B — 一键 AI 分析（Workforce 路径）
 *
 * GET  /api/projects/[id]/tender-analysis/agent    → 状态投影（Project Read）
 * POST /api/projects/[id]/tender-analysis/agent    → start / restart / cancel
 *      （Project Write/Manage —— 启动会产生 AI 成本并写分析结果，§9）
 *
 * 授权复用 #95 同源 tender-analysis 门（requireTenderAnalysisRead/Write
 * → requireProjectReadAccess/WriteAccess），org 恒取自已授权项目。
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

  const status = await getTenderWorkforceAnalysisStatus({ orgId, projectId });
  return NextResponse.json({ agent: status });
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

  let body: {
    action?: string;
    requestId?: string;
    jobId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const action = body.action ?? "start";

  if (action === "cancel") {
    const jobId = (body.jobId ?? "").trim();
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }
    const cancelled = await cancelTenderWorkforceAnalysis({
      orgId,
      projectId,
      jobId,
    });
    if (!cancelled.ok) {
      return NextResponse.json(
        { error: cancelled.error },
        { status: cancelled.code === "NOT_FOUND" ? 404 : 409 },
      );
    }
    return NextResponse.json({ cancelled: true, jobId: cancelled.jobId });
  }

  if (action !== "start" && action !== "restart") {
    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  }

  try {
    const started = await startTenderWorkforceAnalysis({
      orgId,
      projectId,
      projectName: access.project.name,
      userId: access.user.id,
      role: access.user.role,
      requestId: body.requestId ?? null,
      restart: action === "restart",
    });
    if (!started.ok) {
      const status =
        started.code === "FEATURE_DISABLED" || started.code === "WORKFORCE_DISABLED"
          ? 403
          : started.code === "ACTIVE_JOB_EXISTS"
            ? 409
            : 500;
      return NextResponse.json(
        { error: started.error, code: started.code },
        { status },
      );
    }
    return NextResponse.json({
      jobId: started.jobId,
      reused: started.reused,
      restarted: started.restarted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // org 级 AI 配额（createAgentRun 治理）等运营性拒绝 → 429 人话
    if (message.includes("配额")) {
      return NextResponse.json(
        { error: "今日 AI 任务额度已用完，请明天再试或联系管理员" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "启动 AI 分析失败，请稍后重试" },
      { status: 500 },
    );
  }
}
