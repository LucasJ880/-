import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import {
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";
import {
  QUOTE_UPDATE_EXISTING_SELECT,
  commitQuoteUpdate,
  prepareQuoteUpdate,
  type QuoteUpdateBody,
} from "@/lib/sales/quote-update";
import { decideSignedAmountChange } from "@/lib/sales/signed-quote-amount";
import { submitSignedQuoteAmountApproval } from "@/lib/sales/signed-quote-approval";
import { logAudit } from "@/lib/audit/logger";

/**
 * GET /api/sales/quotes/[quoteId]
 *
 * 返回单份报价单的完整数据（含 formDataJson、items、addons），
 * 供「编辑报价单」场景在前端恢复表单。
 *
 * 权限：销售仅可访问自己创建的 quote；admin/super_admin 可访问全部。
 */
export const GET = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      addons: true,
      customer: {
        select: { id: true, name: true, phone: true, email: true, address: true },
      },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  {
    // PERM-2：不再因平台 admin 跳过；super_admin 由平台管理员全权解析覆盖
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: "sales.quote.read",
      resource: {
        type: "sales_quote",
        id: quote.id,
        ownerId: quote.createdById,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "无权查看此报价单", code: decision.reasonCode },
        { status: 403 },
      );
    }
  }

  return NextResponse.json({ quote });
});

/**
 * PUT /api/sales/quotes/[quoteId]
 *
 * 更新已保存的报价单（保持 customerId / version / createdById / shareToken 不变）。
 * 行为与 POST /api/sales/quotes 一致：
 *   - pricing 失败不阻塞 → partial/shell 兜底
 *   - items / addons 全量替换（先 deleteMany 再 createMany）
 *   - status: full → 保持原 status（若原为 signed/accepted 等则不回退到 draft）
 *             partial/shell → 回到 draft
 *
 * 权限：
 *   - 销售仅可编辑自己创建的 quote
 *   - status === "signed" / "accepted" 的 quote，本人范围不可改（防误操作）；ORG 范围可改，
 *     但改了总价要走 sales.update_signed_quote 审批（PERM-4a，返回 202）；平台 super_admin 直接生效
 */
export const PUT = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const body = await request.json();
  const updateBody = body as QuoteUpdateBody;
  const { items, taxRate, formDataJson } = updateBody;

  if (
    taxRate !== undefined &&
    (typeof taxRate !== "number" || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1)
  ) {
    return NextResponse.json(
      { error: "税率必须是 0% 到 100% 之间的数字" },
      { status: 400 },
    );
  }

  const existing = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: QUOTE_UPDATE_EXISTING_SELECT,
  });

  if (!existing) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.quote.update");
  {
    const decision = await authorize({
      principal: humanPrincipal(user, orgRes.orgId),
      orgId: orgRes.orgId,
      permission: "sales.quote.update",
      resource: {
        type: "sales_quote",
        id: existing.id,
        ownerId: existing.createdById,
        orgId: orgRes.orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "无权编辑此报价单", code: decision.reasonCode },
        { status: 403 },
      );
    }
  }
  const ownOnly = scope.ownOnly;

  // 已签单 / 已接受的 quote 对销售锁定；ORG scope / 平台 admin 可强制改
  const lockedStatuses = new Set(["signed", "accepted"]);
  if (lockedStatuses.has(existing.status) && ownOnly) {
    return NextResponse.json(
      {
        error:
          "该报价单已签单 / 已被客户接受，销售账号无法再修改；如需调整请联系管理员。",
      },
      { status: 403 },
    );
  }

  if ((!items || items.length === 0) && !formDataJson) {
    return NextResponse.json(
      { error: "需要 items 或 formDataJson 至少之一" },
      { status: 400 },
    );
  }

  const overLimitSubmit = await authorize({
    principal: humanPrincipal(user, orgRes.orgId),
    orgId: orgRes.orgId,
    permission: "sales.quote.discount.over_limit.submit",
  });
  const actor = { userId: user.id, isPlatformSuperAdmin: isPlatformSuperAdmin(user.role), canSubmitOverLimit: overLimitSubmit.allowed };
  const prepared = await prepareQuoteUpdate({ orgId: orgRes.orgId, existing, body: updateBody, actor });

  // PERM-4a：已签约报价改总价 → 不落库，提交 sales.update_signed_quote 审批（202）；super_admin 直接生效并审计自批
  const signedDecision = decideSignedAmountChange({
    status: existing.status,
    currentTotal: existing.grandTotal,
    nextTotal: prepared.calc.grandTotal,
    isPlatformSuperAdmin: actor.isPlatformSuperAdmin,
  });
  if (signedDecision === "approval_required") {
    return submitSignedQuoteAmountApproval({
      request,
      user,
      orgId: orgRes.orgId,
      existing,
      body: updateBody,
      afterTotal: prepared.calc.grandTotal,
    });
  }

  const result = await commitQuoteUpdate({ orgId: orgRes.orgId, quoteId, existing, body: updateBody, prepared, actor });
  if (signedDecision === "platform_direct") {
    await logAudit({
      userId: user.id,
      orgId: orgRes.orgId,
      action: "sales.signed_quote.amount_changed",
      targetType: "sales_quote",
      targetId: quoteId,
      beforeData: { grandTotal: existing.grandTotal, status: existing.status },
      afterData: { grandTotal: prepared.calc.grandTotal, requestedById: user.id, approvedById: user.id, selfApproved: true, actorKind: "platform_admin" },
      request,
    });
  }
  return NextResponse.json(result);
});
