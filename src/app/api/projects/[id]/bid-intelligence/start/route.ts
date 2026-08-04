import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  startBidIntelligence,
  StartIntelligenceError,
} from "@/lib/bid-workflow";

/**
 * POST /api/projects/[id]/bid-intelligence/start
 * 确认进入投标调查（幂等）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const orgId = project.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  try {
    const result = await startBidIntelligence({
      orgId,
      projectId: id,
      actorUserId: user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StartIntelligenceError) {
      const status =
        err.code === "PROJECT_NOT_FOUND"
          ? 404
          : err.code === "FORBIDDEN"
            ? 403
            : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[bid-intelligence/start]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "启动调查失败" },
      { status: 500 },
    );
  }
}
