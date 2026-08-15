/**
 * GET  /api/projects/[id]/finance/expenses — 费用列表（审核人见全部；普通成员仅见本人）
 * POST /api/projects/[id]/finance/expenses — 创建费用草稿；{ submit: true } 则同时提交
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS, hasProjectPermission } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  createExpenseDraft,
  submitExpense,
  FinanceContractError,
  FinanceTenantError,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  // 审核能力（accounting/admin/owner）→ 全部；否则仅本人
  const canReview =
    access.user.role === "super_admin" ||
    access.orgRole === "org_admin" ||
    access.project.ownerId === access.user.id ||
    (access.projectRole && hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_COST_REVIEW));

  const expenses = await db.projectExpenseSubmission.findMany({
    where: {
      orgId,
      projectId: id,
      ...(canReview ? {} : { submittedById: access.user.id }),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ expenses, canReview });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  // 所有 active 项目成员均可提交本人费用（EXPENSE_SUBMIT，与预算编辑权 COST_WRITE 解耦）
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_EXPENSE_SUBMIT);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;
  const actor = serverActor(access.user.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const expense = await createExpenseDraft({
      orgId, projectId: id, actor, submittedById: access.user.id,
      costCategory: String(body.costCategory ?? "OTHER"),
      budgetLineId: (body.budgetLineId as string) ?? null,
      expenseOccurredAt: body.expenseOccurredAt ? new Date(String(body.expenseOccurredAt)) : new Date(),
      vendorName: (body.vendorName as string) ?? null,
      description: String(body.description ?? ""),
      subtotal: (body.subtotal as string) ?? null,
      taxAmount: (body.taxAmount as string) ?? null,
      totalAmount: String(body.totalAmount ?? "0"),
      currency: String(body.currency ?? "CAD"),
      projectPhaseSnapshot: (body.projectPhaseSnapshot as string) ?? null,
      projectStageSnapshot: (body.projectStageSnapshot as string) ?? null,
      // T2-P1.6：多币种 FX 快照 + 出资来源
      fxRateCadPerOriginalUnit: (body.fxRateCadPerOriginalUnit as string) ?? null,
      fxRateDate: body.fxRateDate ? new Date(String(body.fxRateDate)) : null,
      fxRateSource: (body.fxRateSource as never) ?? null,
      fundingSource: (body.fundingSource as string) ?? null,
      // 垫资人恒取服务端已认证用户；service 层再次强制「个人垫付人 = 提交人」
      paidByUserId: body.fundingSource === "EMPLOYEE_PERSONAL" ? access.user.id : null,
      amountConfirmedById: access.user.id,
    });
    if (body.submit === true) {
      await submitExpense({ orgId, projectId: id, expenseId: expense.id, actor, actorUserId: access.user.id });
    }
    const fresh = await db.projectExpenseSubmission.findUnique({ where: { id: expense.id } });
    return NextResponse.json({ expense: fresh }, { status: 201 });
  } catch (e) {
    if (e instanceof FinanceContractError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    }
    if (e instanceof FinanceTenantError) {
      return NextResponse.json({ error: "项目不存在", code: e.code }, { status: 404 });
    }
    throw e;
  }
}
