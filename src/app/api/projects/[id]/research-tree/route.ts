import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { isResearchTreeEnabledForOrg } from "@/lib/tender-research-tree/flags";
import { startResearchTree } from "@/lib/tender-research-tree/start";

/**
 * TREE-2 情报调研树 — 人发起
 *
 * POST /api/projects/[id]/research-tree   body: { action: "start", requestId? }
 *   → { jobId, reused }
 *
 * 第一步、不带条件地校验项目写权限（发起会花模型与搜索的钱，口径同一键分析的发起）；开关对该组织关着 → 404，
 * 不建 Job、不发任何外部请求；只收招投标项目。读取接口在 TREE-5。
 */

const NOT_FOUND = { error: "未找到" } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId || !isResearchTreeEnabledForOrg(orgId)) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  let body: { action?: unknown; requestId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const action = typeof body?.action === "string" ? body.action : "start";
  if (action !== "start") {
    return NextResponse.json({ error: "未知的 action" }, { status: 400 });
  }
  if (access.project.workDomain !== "tender") {
    return NextResponse.json({ error: "只有招投标项目能开始调研" }, { status: 409 });
  }

  try {
    const started = await startResearchTree({
      orgId,
      projectId: access.project.id,
      userId: access.user.id,
      role: access.user.role,
      trigger: "human_start",
      requestId: typeof body?.requestId === "string" ? body.requestId : null,
    });
    if (!started.ok) {
      if (started.code === "FEATURE_DISABLED") return NextResponse.json(NOT_FOUND, { status: 404 });
      if (started.code === "WORKFORCE_DISABLED") return NextResponse.json({ error: started.error, code: started.code }, { status: 503 });
      return NextResponse.json({ error: "开始调研失败，请稍后重试", code: started.code }, { status: 500 });
    }
    return NextResponse.json({ jobId: started.jobId, reused: started.reused });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("配额")) {
      return NextResponse.json({ error: "今日 AI 任务额度已用完，请明天再试或联系管理员" }, { status: 429 });
    }
    return NextResponse.json({ error: "开始调研失败，请稍后重试" }, { status: 500 });
  }
}
