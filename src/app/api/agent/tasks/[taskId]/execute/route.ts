import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { executeTask, resumeAfterApproval } from "@/lib/agent/executor";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * POST /api/agent/tasks/:taskId/execute
 * 开始或继续执行任务
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { taskId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const isResume = (body as { resume?: boolean }).resume === true;

  try {
    const result = isResume
      ? await resumeAfterApproval(taskId)
      : await executeTask(taskId);

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
