import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";

/**
 * S4-A 候选路由的 canonical 项目门：候选 → 其 Run → projectId → requireProjectWriteAccess。
 * 候选不存在 / 跨 org / 非项目绑定 一律 404（不泄露存在性）。服务层会再断言一次（defense-in-depth）。
 */
export async function requireCandidateProjectWrite(
  request: NextRequest,
  orgId: string,
  candidateId: string,
): Promise<{ projectId: string } | NextResponse> {
  const candidate = await db.supplierCandidate.findFirst({
    where: { id: candidateId, orgId },
    select: { searchRun: { select: { projectId: true } } },
  });
  const projectId = candidate?.searchRun.projectId ?? null;
  if (!projectId) return NextResponse.json({ error: "候选不存在" }, { status: 404 });
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== orgId) return NextResponse.json({ error: "候选不存在" }, { status: 404 });
  return { projectId };
}
