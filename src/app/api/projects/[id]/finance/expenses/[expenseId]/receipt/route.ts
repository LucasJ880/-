/**
 * POST /api/projects/[id]/finance/expenses/[expenseId]/receipt — 上传票据/发票证据（multipart）
 * 复用 putPrivateBlob + validateUploadedFileAsync；原件不可变、内容寻址去重。
 */
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { PERMISSIONS, hasProjectPermission } from "@/lib/rbac/permissions";
import { requireCostAccess, serverActor } from "@/lib/project-finance/access";
import { addExpenseAttachment, FinanceContractError, FinanceTenantError } from "@/lib/project-finance";

type Ctx = { params: Promise<{ id: string; expenseId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, expenseId } = await ctx.params;
  // 上传票据是费用提交流程的一部分 → EXPENSE_SUBMIT（所有成员）；「本人」归属由下方 submittedById 校验强制
  const access = await requireCostAccess(request, id, PERMISSIONS.PROJECT_EXPENSE_SUBMIT);
  if (access instanceof NextResponse) return access;
  const orgId = access.orgId;

  // 仅提交人（或特权）可为其费用加票据
  const expense = await db.projectExpenseSubmission.findFirst({
    where: { id: expenseId, orgId, projectId: id },
    select: { submittedById: true },
  });
  if (!expense) return NextResponse.json({ error: "费用不存在" }, { status: 404 });
  const privileged =
    access.user.role === "super_admin" || access.orgRole === "org_admin" || access.project.ownerId === access.user.id ||
    (access.projectRole && hasProjectPermission(access.projectRole, PERMISSIONS.PROJECT_COST_REVIEW));
  if (expense.submittedById !== access.user.id && !privileged) {
    return NextResponse.json({ error: "只能为本人费用上传票据" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file" }, { status: 400 });
  }

  try {
    const attachment = await addExpenseAttachment({
      orgId, projectId: id, expenseSubmissionId: expenseId, file, uploadedById: access.user.id,
      // 服务端可信 actor → 同事务写 expense.receipt_uploaded 业务事件（时间线可追溯）
      actor: serverActor(access.user.id),
    });
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (e) {
    if (e instanceof FinanceContractError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode });
    if (e instanceof FinanceTenantError) return NextResponse.json({ error: "费用不存在", code: e.code }, { status: 404 });
    throw e;
  }
}
