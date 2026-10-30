/**
 * T2-P1.5 财务路由授权守卫（复用既有 per-project RBAC，不建第二套 auth）
 *
 * - 先 requireProjectReadAccess（租户 + 成员 + 存在性），再叠加细粒度 project:cost:* 权限。
 * - PERM-4c1：特权 = super_admin / 企业内持 project.finance.manage（ORG）/ 项目负责人（不再认 org_admin）；
 *   持 project.finance.read（ORG）= 只读全量（看全部费用 / 应付 / 预算），且非项目成员也可只读进入。
 *   其余按 hasProjectPermission(projectRole, perm)。
 * - 全部财务路由先过 isFinancialControlEnabled()（default OFF → 404，dark）。
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  findProjectForAccess,
  requireProjectReadAccess,
  type ProjectAccessContext,
} from "@/lib/projects/access";
import { getCurrentUser, getOrgMembership, type AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { hasProjectPermission } from "@/lib/rbac/permissions";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { isFinancialControlEnabled } from "./flags";

export const PROJECT_FINANCE_MANAGE = "project.finance.manage";
export const PROJECT_FINANCE_READ = "project.finance.read";

/** 岗位层面的财务能力（与项目角色无关） */
export type FinancePrivilege = {
  /** 编辑预算 / 审核费用 / 登记付款 / 替他人操作 / 看全部 */
  privileged: boolean;
  /** 看全部费用 / 应付 / 预算（含 privileged） */
  canReadAll: boolean;
};

async function holdsOrgKey(user: AuthUser, orgId: string, permission: string): Promise<boolean> {
  const d = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission });
  return d.allowed && d.scopes.includes("ORG");
}

/** 纯决策：岗位键 + 负责人 → 财务能力 */
export function decideFinancePrivilege(input: {
  isPlatformSuperAdmin: boolean;
  isProjectOwner: boolean;
  holdsManage: boolean;
  holdsRead: boolean;
}): FinancePrivilege {
  const privileged = input.isPlatformSuperAdmin || input.holdsManage || input.isProjectOwner;
  return { privileged, canReadAll: privileged || input.holdsRead };
}

export async function resolveFinancePrivilege(
  user: AuthUser,
  orgId: string,
  projectOwnerId: string | null,
): Promise<FinancePrivilege> {
  const [holdsManage, holdsRead] = await Promise.all([
    holdsOrgKey(user, orgId, PROJECT_FINANCE_MANAGE),
    holdsOrgKey(user, orgId, PROJECT_FINANCE_READ),
  ]);
  return decideFinancePrivilege({
    isPlatformSuperAdmin: isPlatformSuperAdmin(user.role),
    isProjectOwner: !!projectOwnerId && projectOwnerId === user.id,
    holdsManage,
    holdsRead,
  });
}

/** 纯决策：请求的细粒度权限是否放行 */
export function allowCostPermission(input: {
  finance: FinancePrivilege;
  projectRole: string | null;
  permission: CostPermission;
}): boolean {
  if (input.finance.privileged) return true;
  if (input.finance.canReadAll && input.permission === PERMISSIONS.PROJECT_COST_READ) return true;
  return !!input.projectRole && hasProjectPermission(input.projectRole, input.permission);
}

export type CostPermission =
  | typeof PERMISSIONS.PROJECT_COST_READ
  | typeof PERMISSIONS.PROJECT_EXPENSE_SUBMIT
  | typeof PERMISSIONS.PROJECT_COST_WRITE
  | typeof PERMISSIONS.PROJECT_COST_REVIEW
  // T2-P1.6：付款 / FX 结算确认（审批 ≠ 付款，RULE 6）
  | typeof PERMISSIONS.PROJECT_PAYMENT_RECORD;

/** flag 关闭 → 404（feature dark） */
export function financeDisabledResponse(): NextResponse | null {
  if (isFinancialControlEnabled()) return null;
  return NextResponse.json({ error: "财务控制功能未启用" }, { status: 404 });
}

/** 授权成功上下文：orgId 已保证非空（财务资源必须 org-scoped）；finance = 岗位层面的财务能力 */
export type CostAccessContext = ProjectAccessContext & { orgId: string; finance: FinancePrivilege };

/**
 * PERM-4c1：非项目成员的只读进入——本企业 active 成员、项目已派发、持 project.finance.read / manage（ORG）。
 * 其余项目接口的口径不变（只在财务守卫内生效）。
 */
async function resolveNonMemberFinanceAccess(
  request: NextRequest,
  projectId: string,
): Promise<ProjectAccessContext | null> {
  const user = await getCurrentUser(request);
  if (!user) return null;
  const project = await findProjectForAccess(projectId);
  if (!project || !project.orgId || project.intakeStatus !== "dispatched") return null;
  const om = await getOrgMembership(user.id, project.orgId);
  if (!om || om.status !== "active") return null;
  const [read, manage] = await Promise.all([
    holdsOrgKey(user, project.orgId, PROJECT_FINANCE_READ),
    holdsOrgKey(user, project.orgId, PROJECT_FINANCE_MANAGE),
  ]);
  if (!read && !manage) return null;
  return { user, project, orgRole: om.role, projectRole: null };
}

export async function requireCostAccess(
  request: NextRequest,
  projectId: string,
  permission: CostPermission,
): Promise<CostAccessContext | NextResponse> {
  const disabled = financeDisabledResponse();
  if (disabled) return disabled;

  let access: ProjectAccessContext | NextResponse = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) {
    if (access.status !== 403) return access;
    const viaFinanceKey = await resolveNonMemberFinanceAccess(request, projectId);
    if (!viaFinanceKey) return access;
    access = viaFinanceKey;
  }

  const orgId = access.project.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "项目缺少组织归属，财务操作不可用" }, { status: 400 });
  }

  const finance = await resolveFinancePrivilege(access.user, orgId, access.project.ownerId);
  if (allowCostPermission({ finance, projectRole: access.projectRole, permission })) {
    return { ...access, orgId, finance };
  }
  return NextResponse.json({ error: "无权执行该财务操作" }, { status: 403 });
}

/** 服务端可信 actor（禁客户端伪造） */
export function serverActor(userId: string) {
  return { actorType: "user" as const, actorId: userId };
}
