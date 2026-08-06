import { NextRequest, NextResponse } from "next/server";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisWrite,
} from "@/lib/tender-auto-analysis/api-access";
import { editSectionContent } from "@/lib/tender-auto-analysis/review";

/** PATCH — 编辑 contentZh，reviewStatus → HUMAN_EDITED */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; runId: string; sectionId: string }> },
) {
  const { id: projectId, runId, sectionId } = await params;
  const access = await requireTenderAnalysisWrite(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  let body: { contentZh?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const contentZh = typeof body.contentZh === "string" ? body.contentZh : "";
  if (!contentZh.trim()) {
    return NextResponse.json({ error: "contentZh 不能为空" }, { status: 400 });
  }

  const result = await editSectionContent({
    runId,
    sectionId,
    projectId,
    orgId,
    actorUserId: access.user.id,
    contentZh,
    note: typeof body.note === "string" ? body.note : undefined,
  });

  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "locked" ? 422 : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    sectionId: result.sectionId,
    reviewStatus: result.reviewStatus,
    reviewStatusLabel: "人工已改",
  });
}
