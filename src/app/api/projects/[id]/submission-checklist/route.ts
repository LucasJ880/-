/**
 * GET /api/projects/[id]/submission-checklist（FLOW-H4b）
 *
 * 交付前检查清单：由当前可用的招标分析里已确认的强制提交类要求确定性生成，每条能回到原文。项目读权限。只读，不调模型。
 * 开关 TENDER_SUBMISSION_CHECKLIST_ENABLED 关闭（或组织不在名单）、或项目不是招投标项目 → 404。
 * 没有可用的分析、或可用的那份是旧的分析（不逐条带依据）→ 200 { view: null, unavailable }，页面照旧。
 * 组织只取自服务端加载的项目记录。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";
import { isSubmissionChecklistEnabledForOrg } from "@/lib/tender-submission-checklist/flags";
import { loadSubmissionChecklist } from "@/lib/tender-submission-checklist/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user, orgRole, projectRole } = access;
  const orgId = project.orgId;
  if (!orgId || !isSubmissionChecklistEnabledForOrg(orgId) || project.workDomain !== "tender") {
    return NextResponse.json({ error: "交付前检查清单未启用" }, { status: 404 });
  }

  // 能不能标状态：与 requireProjectWriteAccess 逐条相同——超级管理员不看分发；其余人项目须已分发，
  // 且是负责人、组织管理员或项目管理员
  const canEdit =
    isSuperAdmin(user.role) ||
    (project.intakeStatus === "dispatched" &&
      (project.ownerId === user.id ||
        (!!orgRole && hasOrgRole(orgRole, "org_admin")) ||
        (!!projectRole && hasProjectRole(projectRole, "project_admin"))));

  const loaded = await loadSubmissionChecklist({ projectId, orgId, canEdit });
  if (loaded.kind === "not_found") return NextResponse.json({ error: "交付前检查清单未启用" }, { status: 404 });
  // 没有能用来生成的分析（还没分析，或是旧的分析）：确定性清单不可用，页面照旧显示模型生成的那份
  if (loaded.kind === "unavailable") return NextResponse.json({ view: null, unavailable: loaded.reason });
  return NextResponse.json({ view: loaded.view });
}
