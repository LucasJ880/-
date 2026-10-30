/**
 * 报价保存时收口既有的超限折扣审批（PendingAction 归口在 pending-actions/，runtime-architecture 守卫要求）
 *
 * - approve：本次保存由合价上限内直批 / 平台自批覆盖 → 把待批动作标记 executed
 * - invalidate：让利内容已变化 → 把待批动作标记 failed，提示重新提交
 */

import type { Prisma } from "@prisma/client";

export async function settleQuotePromotionApprovalAction(
  tx: Pick<Prisma.TransactionClient, "pendingAction">,
  input: { actionId: string; orgId: string; mode: "approve" | "invalidate"; userId: string; quoteId: string },
): Promise<void> {
  if (input.mode === "approve") {
    await tx.pendingAction.updateMany({
      where: { id: input.actionId, orgId: input.orgId, status: "pending" },
      data: { status: "executed", decidedAt: new Date(), decidedById: input.userId, executedAt: new Date(), resultRef: input.quoteId },
    });
    return;
  }
  await tx.pendingAction.updateMany({
    where: { id: input.actionId, orgId: input.orgId, status: "pending" },
    data: { status: "failed", failureReason: "报价让利内容已变化，请重新提交审批" },
  });
}
