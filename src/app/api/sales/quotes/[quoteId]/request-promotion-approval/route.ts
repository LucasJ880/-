import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
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
  if (quote.createdById !== user.id && !isAdmin(user.role)) {
    return NextResponse.json({ error: "只能提交自己创建的报价单" }, { status: 403 });
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

  const [organization, orgAdmins] = await Promise.all([
    db.organization.findUnique({ where: { id: orgRes.orgId }, select: { ownerId: true } }),
    db.organizationMember.findMany({
      where: { orgId: orgRes.orgId, role: "org_admin", status: "active" },
      select: { userId: true },
    }),
  ]);

  const recipientIds = new Set<string>([
    ...(organization?.ownerId ? [organization.ownerId] : []),
    ...orgAdmins.map((member) => member.userId),
  ]);

  if (recipientIds.size === 0) {
    return NextResponse.json(
      { error: "系统中尚未配置可接收审核的企业管理员" },
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
