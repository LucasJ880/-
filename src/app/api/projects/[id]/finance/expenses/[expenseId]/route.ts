/**
 * GET   /api/projects/[id]/finance/expenses/[expenseId] — 详情（含附件 + 关联成本）
 * PATCH /api/projects/[id]/finance/expenses/[expenseId] — { action }
 *   submit | resubmit（提交人；cost:write + 本人）
 *   request_info | reject | approve（审核人；cost:review）
 *
 * 状态转移一律经 expense-service 命令，route 不直接改 status。
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS, hasProjectPermission } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import {
  approveExpense,
  rejectExpense,
  requestExpenseInfo,
  resubmitExpense,
  submitExpense,
  updateExpenseDraft,
  listExpenseAttachments,
  ExpenseStateError,
  FinanceContractError,
  FinanceTenantError,
  FxContractError,
  SelfApprovalError,
} from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

function financeError(e: unknown): NextResponse {
  if (e instanceof SelfApprovalError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
  if (e instanceof ExpenseStateError || e instanceof FinanceContractError || e instanceof FxContractError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: (e as { statusCode?: number }).statusCode ?? 409 });
  }
  if (e instanceof FinanceTenantError) return NextResponse.json({ error: "费用不存在", code: e.code }, { status: 404 });
  throw e;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, expenseId } = await ctx.params;
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_COST_READ);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;

  const expense = await db.projectExpenseSubmission.findFirst({ where: { id: expenseId, orgId, projectId: id } });
  if (!expense) return NextResponse.json({ error: "费用不存在" }, { status: 404 });
  // 非审核人仅可看本人
  const canReview =
    access.user.role === "super_admin" || access.orgRole === "org_admin" || access.project.ownerId === access.user.id ||
    (access.projectRole && hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_COST_REVIEW));
  if (!canReview && expense.submittedById !== access.user.id) {
    return NextResponse.json({ error: "无权查看该费用" }, { status: 403 });
  }
  const attachments = await listExpenseAttachments(orgId, id, expenseId);
  const cost = expense.approvedProjectCostId
    ? await db.projectCost.findUnique({ where: { id: expense.approvedProjectCostId } })
    : null;
  return NextResponse.json({ expense, attachments, cost });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id, expenseId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  // 审核动作（accounting/admin）需 REVIEW；提交人动作（submit/resubmit）走 EXPENSE_SUBMIT，
  // 使所有 active 项目成员均可提交/重提本人费用（本人归属由下方 submittedById 校验强制）。
  const reviewActions = new Set(["request_info", "reject", "approve"]);
  // update 与 submit/resubmit 同权（EXPENSE_SUBMIT）：改的是本人未锁定的费用；
  // 「本人」由 service 层 submittedById 校验强制，UI 不构成安全边界。
  const perm = reviewActions.has(action) ? PERMISSIONS.PROJECT_COST_REVIEW : PERMISSIONS.PROJECT_EXPENSE_SUBMIT;

  const access = await requireCostAccess(request, id, perm);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;
  const actor = serverActor(access.user.id);
  const uid = access.user.id;

  // 提交人动作需本人（防越权替他人提交/重提）
  if (action === "submit" || action === "resubmit") {
    const e = await db.projectExpenseSubmission.findFirst({ where: { id: expenseId, orgId, projectId: id }, select: { submittedById: true } });
    if (!e) return NextResponse.json({ error: "费用不存在" }, { status: 404 });
    const privileged = access.user.role === "super_admin" || access.orgRole === "org_admin" || access.project.ownerId === uid;
    if (e.submittedById !== uid && !privileged) {
      return NextResponse.json({ error: "只能提交本人的费用" }, { status: 403 });
    }
  }

  try {
    switch (action) {
      case "update":
        // 修改本人未锁定的费用（DRAFT / NEEDS_INFO）；金额变化 → 重算 FX + 重记确认事件
        await updateExpenseDraft({
          orgId,
          projectId: id,
          expenseId,
          actor,
          actorUserId: uid,
          changes: {
            ...(body.costCategory !== undefined ? { costCategory: String(body.costCategory) } : {}),
            ...(body.budgetLineId !== undefined ? { budgetLineId: (body.budgetLineId as string) ?? null } : {}),
            ...(body.expenseOccurredAt !== undefined ? { expenseOccurredAt: new Date(String(body.expenseOccurredAt)) } : {}),
            ...(body.vendorName !== undefined ? { vendorName: (body.vendorName as string) ?? null } : {}),
            ...(body.description !== undefined ? { description: String(body.description) } : {}),
            ...(body.subtotal !== undefined ? { subtotal: (body.subtotal as string) ?? null } : {}),
            ...(body.taxAmount !== undefined ? { taxAmount: (body.taxAmount as string) ?? null } : {}),
            ...(body.totalAmount !== undefined ? { totalAmount: String(body.totalAmount) } : {}),
            ...(body.currency !== undefined ? { currency: String(body.currency) } : {}),
            ...(body.fxRateCadPerOriginalUnit !== undefined ? { fxRateCadPerOriginalUnit: (body.fxRateCadPerOriginalUnit as string) ?? null } : {}),
            ...(body.fxRateDate !== undefined ? { fxRateDate: body.fxRateDate ? new Date(String(body.fxRateDate)) : null } : {}),
            ...(body.fxRateSource !== undefined ? { fxRateSource: (body.fxRateSource as never) ?? null } : {}),
            ...(body.fundingSource !== undefined ? { fundingSource: (body.fundingSource as string) ?? null } : {}),
            // 垫资人恒取服务端已认证用户，绝不接受客户端指定他人
            ...(body.fundingSource !== undefined ? { paidByUserId: body.fundingSource === "EMPLOYEE_PERSONAL" ? uid : null } : {}),
          },
        });
        break;
      case "submit":
        await submitExpense({ orgId, projectId: id, expenseId, actor, actorUserId: uid });
        break;
      case "resubmit":
        await resubmitExpense({ orgId, projectId: id, expenseId, actor, actorUserId: uid });
        break;
      case "request_info":
        await requestExpenseInfo({ orgId, projectId: id, expenseId, actor, reviewerUserId: uid, note: String(body.note ?? "") });
        break;
      case "reject":
        await rejectExpense({ orgId, projectId: id, expenseId, actor, reviewerUserId: uid, note: String(body.note ?? "") });
        break;
      case "approve": {
        const result = await approveExpense({ orgId, projectId: id, expenseId, actor, reviewerUserId: uid, reviewNote: (body.note as string) ?? null });
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ error: `未知 action: ${action}` }, { status: 400 });
    }
    const fresh = await db.projectExpenseSubmission.findUnique({ where: { id: expenseId } });
    return NextResponse.json({ ok: true, expense: fresh });
  } catch (e) {
    return financeError(e);
  }
}
