/**
 * T2-P1.5 财务路由授权守卫（复用既有 per-project RBAC，不建第二套 auth）
 *
 * - 先 requireProjectReadAccess（租户 + 成员 + 存在性），再叠加细粒度 project:cost:* 权限。
 * - owner / super_admin / org_admin 视为特权直通；其余按 hasProjectPermission(projectRole, perm)。
 * - 全部财务路由先过 isFinancialControlEnabled()（default OFF → 404，dark）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, type ProjectAccessContext } from "@/lib/projects/access";
import { hasProjectPermission } from "@/lib/rbac/permissions";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { isFinancialControlEnabled } from "./flags";

export type CostPermission =
  | typeof PERMISSIONS.PROJECT_COST_READ
  | typeof PERMISSIONS.PROJECT_EXPENSE_SUBMIT
  | typeof PERMISSIONS.PROJECT_COST_WRITE
  | typeof PERMISSIONS.PROJECT_COST_REVIEW;

/** flag 关闭 → 404（feature dark） */
export function financeDisabledResponse(): NextResponse | null {
  if (isFinancialControlEnabled()) return null;
  return NextResponse.json({ error: "财务控制功能未启用" }, { status: 404 });
}

/** 授权成功上下文：orgId 已保证非空（财务资源必须 org-scoped） */
export type CostAccessContext = ProjectAccessContext & { orgId: string };

export async function requireCostAccess(
  request: NextRequest,
  projectId: string,
  permission: CostPermission,
): Promise<CostAccessContext | NextResponse> {
  const disabled = financeDisabledResponse();
  if (disabled) return disabled;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "项目缺少组织归属，财务操作不可用" }, { status: 400 });
  }

  const privileged =
    access.user.role === "super_admin" ||
    access.orgRole === "org_admin" ||
    access.project.ownerId === access.user.id;
  if (privileged) return { ...access, orgId };

  if (access.projectRole && hasProjectPermission(access.projectRole, permission)) {
    return { ...access, orgId };
  }
  return NextResponse.json({ error: "无权执行该财务操作" }, { status: 403 });
}

/** 服务端可信 actor（禁客户端伪造） */
export function serverActor(userId: string) {
  return { actorType: "user" as const, actorId: userId };
}
