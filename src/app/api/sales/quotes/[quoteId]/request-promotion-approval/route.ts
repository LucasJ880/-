import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { legacyApprovalFallback, listUsersWithPermission, pickApprovalRecipients } from "@/lib/sales/approvers";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { computePayloadHash } from "@/lib/capabilities/approvals/integrity";
import { logAudit } from "@/lib/audit/logger";

/**
 * 保存后的超额 Special Promotion 报价提交企业管理员审核。
 * 报价保持 draft；管理员从站内通知进入统一审批中心，批准后销售才能交付。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId: orgRes.orgId },
    select: {
      id: true,
      orgId: true,
      createdById: true,
      orderNumber: true,
      specialPromotion: true,
      finalDiscountPct: true,
      updatedAt: true,
      customerId: true,
      promotionApprovalStatus: true,
      promotionApprovalActionId: true,
      customer: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  // PERM-2：本人（PRINCIPAL）或持 ORG 范围报价修改权（合价 / 老板 / 平台管理员）可提交
  const submitAuthz = await authorize({
    principal: humanPrincipal(user, orgRes.orgId),
    orgId: orgRes.orgId,
    permission: "sales.quote.update",
    resource: { type: "sales_quote", id: quote.id, ownerId: quote.createdById, orgId: orgRes.orgId },
  });
  if (!submitAuthz.allowed) {
    return NextResponse.json({ error: "无权提交此报价单的审批", code: submitAuthz.reasonCode }, { status: 403 });
  }

  const settings = await db.quoteDiscountSettings.findUnique({
    where: { orgId: orgRes.orgId },
    select: { promoMaxPct: true },
  });
  const maxPct = settings?.promoMaxPct ?? 0.25;
  const ratio = quote.finalDiscountPct ?? 0;
  if (ratio <= maxPct) {
    return NextResponse.json(
      { error: "当前 Special Promotion 未超过公司上限，无需提交审核" },
      { status: 400 },
    );
  }

  if (quote.promotionApprovalStatus === "pending" && quote.promotionApprovalActionId) {
    const pending = await db.pendingAction.findFirst({
      where: { id: quote.promotionApprovalActionId, orgId: orgRes.orgId, status: "pending", expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (pending) return NextResponse.json({ ok: true, duplicate: true, approvalId: `PENDING_ACTION:${pending.id}`, quoteId: quote.id });
  }

  // PERM-2：审批人 = 持 sales.quote.discount.over_limit.approve 的人（老板岗），排除提交人；无人时回退 ownerId + org_admin
  const [holders, fallback] = await Promise.all([
    listUsersWithPermission(orgRes.orgId, "sales.quote.discount.over_limit.approve"),
    legacyApprovalFallback(orgRes.orgId),
  ]);
  const recipientIds = new Set<string>(
    pickApprovalRecipients({ holders, fallback, requesterId: user.id }),
  );

  if (recipientIds.size === 0) {
    return NextResponse.json(
      { error: "系统中尚未配置可审批超限折扣的人（老板岗位），请联系平台管理员" },
      { status: 409 },
    );
  }

  const orderLabel = quote.orderNumber || quote.id;
  const requester = quote.createdBy.name || quote.createdBy.email;
  const payload = {
    quoteId: quote.id,
    orderLabel,
    customerName: quote.customer.name,
    promotionAmount: quote.specialPromotion ?? 0,
    promotionRatio: ratio,
    maxPct,
    requestedById: user.id,
    resourceType: "sales_quote" as const,
    resourceId: quote.id,
    riskLevel: "HIGH" as const,
    metadata: {
      orgId: orgRes.orgId,
      quoteId: quote.id,
      customerId: quote.customerId,
      targetType: "sales_quote",
      targetId: quote.id,
      source: "quote_sheet",
    },
  };
  const approverUserId = [...recipientIds][0];
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const idempotencyKey = `quote-promotion:${quote.id}:${quote.updatedAt.getTime()}`;
  const approval = await db.$transaction(async (tx) => {
    const action = await tx.pendingAction.upsert({
      where: { orgId_idempotencyKey: { orgId: orgRes.orgId, idempotencyKey } },
      update: {},
      create: {
        type: "sales.approve_quote_promotion",
        title: `审批报价 ${orderLabel} 的超额让利`,
        preview: `${requester} 为 ${quote.customer.name} 申请 ${(ratio * 100).toFixed(1)}% Special Promotion，公司上限 ${(maxPct * 100).toFixed(1)}%。`,
        payload,
        status: "pending",
        createdById: user.id,
        orgId: orgRes.orgId,
        approverUserId,
        requiredRole: "org_admin",
        expiresAt,
        payloadVersion: 1,
        payloadHash: computePayloadHash(payload),
        policyVersion: "quote-promotion-v1",
        resourceVersion: quote.updatedAt.toISOString(),
        idempotencyKey,
      },
    });
    await tx.salesQuote.update({
      where: { id: quote.id },
      data: {
        promotionApprovalStatus: "pending",
        promotionApprovalActionId: action.id,
        promotionApprovalAmount: quote.specialPromotion ?? 0,
        promotionApprovalRatio: ratio,
        promotionApprovalMaxPct: maxPct,
        promotionApprovalRequestedAt: new Date(),
        promotionApprovalExpiresAt: expiresAt,
        promotionApprovalRequestedById: user.id,
        promotionApprovedAt: null,
        promotionApprovedById: null,
        promotionRejectedAt: null,
        promotionRejectedById: null,
        promotionRejectionReason: null,
      },
    });
    return action;
  });
  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "quote_promotion_approval_requested",
    targetType: "sales_quote",
    targetId: quote.id,
    afterData: { approvalId: approval.id, promotionAmount: quote.specialPromotion ?? 0, promotionRatio: ratio, maxPct },
  });
  const href = `/capabilities/approvals/${encodeURIComponent(`PENDING_ACTION:${approval.id}`)}`;
  const notified = await createNotificationsForUsers([...recipientIds], {
    sourceKeyPrefix: `quote-promotion-approval:${approval.id}`,
    orgId: orgRes.orgId,
    type: "quote_promotion_approval",
    category: "approval",
    title: `报价 ${orderLabel} 请求超额让利审核`,
    summary:
      `${requester} 为客户 ${quote.customer.name} 提交了 ` +
      `${(ratio * 100).toFixed(1)}% 的 Special Promotion（上限 ${(maxPct * 100).toFixed(1)}%）。`,
    entityType: "approval",
    entityId: `PENDING_ACTION:${approval.id}`,
    priority: "high",
    metadata: {
      href,
      promotionRatio: ratio,
      promotionAmount: quote.specialPromotion ?? 0,
      maxPct,
      requesterUserId: user.id,
    },
  });

  return NextResponse.json({ ok: true, notified, quoteId: quote.id, approvalId: `PENDING_ACTION:${approval.id}` });
});
