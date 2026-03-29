import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cancelTask } from "@/lib/agent/executor";

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * POST /api/agent/tasks/:taskId/cancel
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { taskId } = await ctx.params;

  try {
    await cancelTask(taskId);
    return NextResponse.json({ success: true, status: "cancelled" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
