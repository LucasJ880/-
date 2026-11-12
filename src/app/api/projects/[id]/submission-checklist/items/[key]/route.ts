/**
 * PUT /api/projects/[id]/submission-checklist/items/[key]（FLOW-H4b）
 *
 * 把清单里的一条标为待办 / 备好了 / 不适用。项目写权限。只有清单里此刻实际存在的条目能标。
 * 开关关闭、或项目不是招投标项目 → 404。组织只取自服务端加载的项目记录。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { parseItemStatus } from "@/lib/tender-submission-checklist/contract";
import { isSubmissionChecklistEnabledForOrg } from "@/lib/tender-submission-checklist/flags";
import { setChecklistItemStatus } from "@/lib/tender-submission-checklist/service";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id: projectId, key } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user } = access;
  const orgId = project.orgId;
  if (!orgId || !isSubmissionChecklistEnabledForOrg(orgId) || project.workDomain !== "tender") {
    return NextResponse.json({ error: "交付前检查清单未启用" }, { status: 404 });
  }

  const parsed = parseItemStatus(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await setChecklistItemStatus({ projectId, orgId, key, status: parsed.status, actorId: user.id, request });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, view: result.view });
}
