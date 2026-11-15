/**
 * GET /api/projects/[id]/next-step（FLOW-H1）
 *
 * 项目页「下一步」：这个标现在卡在哪、原因、去页面上的哪个位置。项目读权限。只读——不批准、不发送、不写任何东西。
 *
 * 开关 TENDER_WEB_NEXT_STEP_ENABLED 关闭（或组织不在白名单）、或项目不是招投标项目 → 404。
 * 组织只取自服务端加载的项目记录。响应里没有任何金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";
import { isWebNextStepEnabledForOrg } from "@/lib/tender-next-step/flags";
import { loadWebNextStep } from "@/lib/tender-next-step/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user, orgRole, projectRole } = access;
  const orgId = project.orgId;
  if (!orgId || !isWebNextStepEnabledForOrg(orgId) || project.workDomain !== "tender") {
    return NextResponse.json({ error: "下一步未启用" }, { status: 404 });
  }

  // 有没有项目写权限（与写接口同一组条件）：只用来在说明里提示「这一步要项目负责人来做」
  const canManage =
    isSuperAdmin(user.role) ||
    project.ownerId === user.id ||
    (!!orgRole && hasOrgRole(orgRole, "org_admin")) ||
    (!!projectRole && hasProjectRole(projectRole, "project_admin"));

  const view = await loadWebNextStep({
    project: {
      id: project.id,
      name: project.name,
      orgId,
      ownerId: project.ownerId,
      status: project.status ?? null,
      tenderStatus: project.tenderStatus ?? null,
      // 库结构落后时项目记录可能没有这两列：按没有处理。只认截标时间，不拿内部的到期日顶替
      closeDate: project.closeDate ?? null,
      submittedAt: project.submittedAt ?? null,
      // FLOW-H1b：阶段记录（只读，用来算「记录的阶段」）
      intakeStatus: project.intakeStatus ?? null,
      distributedAt: project.distributedAt ?? null,
      dispatchedAt: project.dispatchedAt ?? null,
      interpretedAt: project.interpretedAt ?? null,
      supplierInquiredAt: project.supplierInquiredAt ?? null,
      supplierQuotedAt: project.supplierQuotedAt ?? null,
    },
    userId: user.id,
    canManage,
  });
  return NextResponse.json({ view });
}
