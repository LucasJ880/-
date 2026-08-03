import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { ensureProjectJoinBrief } from "@/lib/bid-workflow";

/**
 * POST — 为指定内部成员生成/取得加入简报（幂等）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  let body: { userId?: string; roleHint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const targetUserId = body.userId || user.id;

  try {
    const brief = await ensureProjectJoinBrief({
      orgId: project.orgId,
      projectId: id,
      userId: targetUserId,
      roleHint: body.roleHint,
      actorUserId: user.id,
    });
    return NextResponse.json(brief);
  } catch (err) {
    console.error("[join-brief]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成简报失败" },
      { status: 500 },
    );
  }
}
