/**
 * PERM-4a：已签约报价改总价——提交审批（服务端；PUT /api/sales/quotes/[quoteId] 调用）
 *
 * 查重（已有待批 → 409）→ 选收件人（持 sales.quote.signed_amount.approve 者优先、排除提交人；空则企业负责人 /
 * 企业管理员兜底；仍空 → 409 NO_APPROVER）→ requestApproval → 审计 + 站内通知 → 202。报价本身不写。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { requestApproval } from "@/lib/approval/port";
import { logAudit } from "@/lib/audit/logger";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { legacyApprovalFallback, listUsersWithPermission, pickApprovalRecipients } from "@/lib/sales/approvers";
import type { SalesUpdateSignedQuotePayload } from "@/lib/pending-actions/types";
import type { QuoteUpdateBody, QuoteUpdateExisting } from "@/lib/sales/quote-update";
import {
  SIGNED_QUOTE_ACTION_TYPE,
  SIGNED_QUOTE_APPROVE_PERMISSION,
  describeSignedQuoteChange,
  signedQuoteIdempotencyKey,
} from "@/lib/sales/signed-quote-amount";

export async function submitSignedQuoteAmountApproval(input: {
  request: NextRequest;
  user: AuthUser;
  orgId: string;
  existing: QuoteUpdateExisting;
  body: QuoteUpdateBody;
  afterTotal: number;
}): Promise<NextResponse> {
  const { request, user, orgId, existing, body, afterTotal } = input;

  const forQuote = { orgId, type: SIGNED_QUOTE_ACTION_TYPE, payload: { path: ["quoteId"], equals: existing.id } };
  const pending = await db.pendingAction.findFirst({
    where: { ...forQuote, status: "pending", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (pending) {
    return NextResponse.json(
      { error: "这份报价已有一条待批的改价申请，请等审批结果后再改", code: "SIGNED_QUOTE_APPROVAL_PENDING", approvalId: `PENDING_ACTION:${pending.id}` },
      { status: 409 },
    );
  }

  const [holders, fallback] = await Promise.all([
    listUsersWithPermission(orgId, SIGNED_QUOTE_APPROVE_PERMISSION),
    legacyApprovalFallback(orgId),
  ]);
  const recipients = pickApprovalRecipients({ holders, fallback, requesterId: user.id });
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "没有另一位可审批签约单改价的人（老板岗位），请联系平台管理员", code: "NO_APPROVER" },
      { status: 409 },
    );
  }

  const attempt = await db.pendingAction.count({ where: forQuote });
  const customer = await db.salesCustomer.findUnique({ where: { id: existing.customerId }, select: { name: true } });
  const baseUpdatedAt = existing.updatedAt.toISOString();
  const requesterName = user.name || user.email;
  const { title, preview } = describeSignedQuoteChange({
    quoteNumber: existing.orderNumber,
    customerName: customer?.name ?? null,
    beforeTotal: existing.grandTotal,
    afterTotal,
    requesterName,
  });
  const payload: SalesUpdateSignedQuotePayload = {
    orgId,
    requestedById: user.id,
    quoteId: existing.id,
    baseUpdatedAt,
    beforeTotal: existing.grandTotal,
    afterTotal,
    body: body as unknown as Record<string, unknown>,
    resourceType: "sales_quote",
    resourceId: existing.id,
    riskLevel: "HIGH",
    metadata: { orgId, quoteId: existing.id, targetType: "sales_quote", targetId: existing.id },
  };
  // 新审批一律走 canonical 入口 requestApproval（runtime-architecture 守卫禁止直接写 PendingAction）
  const approval = await requestApproval({
    orgId,
    principal: { userId: user.id, actorType: "user" },
    actionType: SIGNED_QUOTE_ACTION_TYPE,
    title,
    preview,
    payload: payload as unknown as Record<string, unknown>,
    risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
    source: { module: "sales.signed-quote", toolName: "signed_quote_update", stepKey: `signed-quote-amount:${existing.id}` },
    approver: { approverUserId: recipients[0], requiredRole: "org_owner" },
    ttlHours: 24 * 7,
    idempotencyKey: signedQuoteIdempotencyKey(existing.id, baseUpdatedAt, attempt),
    policyVersion: "signed-quote-amount-v1",
    resourceVersion: baseUpdatedAt,
  });
  if (!approval.ok) {
    return NextResponse.json({ error: `生成审批失败：${approval.error}` }, { status: 500 });
  }
  const actionId = approval.actionIds[0] ?? "";
  await logAudit({
    userId: user.id,
    orgId,
    action: "sales.signed_quote.amount_change_requested",
    targetType: "sales_quote",
    targetId: existing.id,
    beforeData: { grandTotal: existing.grandTotal, status: existing.status },
    afterData: { grandTotal: afterTotal, approvalId: actionId, approverCandidates: recipients.length },
    request,
  });
  const href = `/capabilities/approvals/${encodeURIComponent(`PENDING_ACTION:${actionId}`)}`;
  const notified = await createNotificationsForUsers(recipients, {
    sourceKeyPrefix: `signed-quote-amount:${actionId}`,
    orgId,
    type: "signed_quote_amount_approval",
    category: "approval",
    title,
    summary: preview,
    entityType: "approval",
    entityId: `PENDING_ACTION:${actionId}`,
    priority: "high",
    metadata: { href, requesterUserId: user.id },
  });
  return NextResponse.json(
    { pending: true, approvalId: `PENDING_ACTION:${actionId}`, notified, message: "改价已提交审批，批准后生效" },
    { status: 202 },
  );
}
