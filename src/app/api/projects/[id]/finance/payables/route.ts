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

  // PERM-4c1：财务特权 / 项目角色；结算只读（会计）可看全部、不可登记付款
  const canReview =
    access.finance.privileged ||
    (!!access.projectRole && hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_COST_REVIEW));
  const canRecordPayment =
    access.finance.privileged ||
    (!!access.projectRole && hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_PAYMENT_RECORD));

  // 看全部 = 能审核 / 结算只读（会计）；其余强制只看应付给自己的
  const seeAll = canReview || access.finance.canReadAll;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const result = await listProjectPayables(access.orgId, id, {
    status,
    // 无审核权者强制只看自己（服务端过滤，不依赖前端）
    payeeUserId: seeAll ? null : access.user.id,
  });

  return NextResponse.json({ ...result, canReview, canRecordPayment });
}
