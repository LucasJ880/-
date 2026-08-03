import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { setGoHoldNoGo } from "@/lib/bid-workflow";

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

  let body: { decision?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const result = await setGoHoldNoGo({
    orgId: project.orgId,
    projectId: id,
    actorUserId: user.id,
    decision: String(body.decision || ""),
    note: typeof body.note === "string" ? body.note : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
