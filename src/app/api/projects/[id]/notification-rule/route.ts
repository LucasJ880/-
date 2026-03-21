import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { getProjectRuleDTO, upsertProjectRule } from "@/lib/notifications/project-rules";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const rule = await getProjectRuleDTO(access.user.id, projectId, access.project.name);
  return NextResponse.json({ rule });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const patch: Parameters<typeof upsertProjectRule>[2] = {};
  if (typeof body.watchEnabled === "boolean") patch.watchEnabled = body.watchEnabled;
  if (typeof body.notifyProjectUpdates === "boolean")
    patch.notifyProjectUpdates = body.notifyProjectUpdates;
  if (typeof body.notifyRuntimeFailed === "boolean")
    patch.notifyRuntimeFailed = body.notifyRuntimeFailed;
  if (typeof body.notifyFeedbackCreated === "boolean")
    patch.notifyFeedbackCreated = body.notifyFeedbackCreated;
  if (typeof body.notifyLowEvaluations === "boolean")
    patch.notifyLowEvaluations = body.notifyLowEvaluations;
  if (typeof body.notifyTaskDue === "boolean") patch.notifyTaskDue = body.notifyTaskDue;
  if (typeof body.minimumPriority === "string") patch.minimumPriority = body.minimumPriority;

  const rule = await upsertProjectRule(access.user.id, projectId, patch);
  return NextResponse.json({ rule });
}
