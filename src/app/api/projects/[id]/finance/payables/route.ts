/**
 * GET /api/projects/[id]/finance/payables — 结算子账（应付）列表
 *
 * 可见性与 expenses 一致：有 COST_REVIEW 能力者见全部（付款队列）；
 * 普通成员仅见「应付给自己」的行（我还有多少钱没报销）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { PERMISSIONS, hasProjectPermission } from "@/lib/rbac/permissions";
import { requireCostAccess } from "@/lib/project-finance/access";
import { listProjectPayables } from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;

  const canReview =
    access.user.role === "super_admin" ||
    access.orgRole === "org_admin" ||
    access.project.ownerId === access.user.id ||
    (access.projectRole &&
      hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_COST_REVIEW));
  const canRecordPayment =
    access.user.role === "super_admin" ||
    access.orgRole === "org_admin" ||
    access.project.ownerId === access.user.id ||
    (access.projectRole &&
      hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_PAYMENT_RECORD));

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const result = await listProjectPayables(access.orgId, id, {
    status,
    // 无审核权者强制只看自己（服务端过滤，不依赖前端）
    payeeUserId: canReview ? null : access.user.id,
  });

  return NextResponse.json({ ...result, canReview, canRecordPayment });
}
