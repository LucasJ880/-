import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { resolveOwnerReplies } from "@/lib/tender-auto-analysis/reply-resolution";

/**
 * POST /api/projects/[id]/questions/check-replies
 * FB-15 手动兜底：对已发送问题在新上传文档中检索业主答复（自动通道 = worker FINALIZE）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  try {
    const result = await resolveOwnerReplies({ projectId });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "回复检索失败，请稍后重试" },
      { status: 502 },
    );
  }
}
