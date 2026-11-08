/**
 * T-1 rfq-tracking-notify：询价进展通知的投递（design D1–D3、D7、D12）
 *
 * 文案、去重键、收件人规则在 tracking-notify-pure.ts；这里只补上下文（名字、轮次、负责人、发起人），
 * 再统一交给 deliverCollabNotification（收件人过滤 / 偏好门禁 / 去重 / 失败隔离全部复用）。
 * 系统触发：actorId 为 null。整个模块不向外抛错——通知失败不影响收信与催单。
 *
 * 只挂自动路径：入站同步（inbound-sync.ts 的 notifyTracking 依赖）与定时催单扫描（chase-service.ts runChaseScan）。
 * 人工录报价、手动「现在就催」、Muse chase 意图都不经过这里。
 */

import { db } from "@/lib/db";
import {
  defaultCollabDeliverDeps,
  deliverCollabNotification,
  type CollabDeliverDeps,
  type CollabDeliverResult,
} from "@/lib/notifications/collab/deliver";
import type { InboundMissingField } from "./inbound-contract";
import {
  RFQ_CHASE_READY,
  RFQ_NO_RESPONSE,
  RFQ_QUOTE_RECEIVED,
  RFQ_REPLY_RECEIVED,
  chaseReadyNotice,
  noResponseNotice,
  quoteReceivedNotice,
  replyReceivedNotice,
  trackingRecipients,
  type DraftedCard,
  type NoResponseReason,
  type RoundRef,
  type TrackingNotice,
} from "./tracking-notify-pure";

const LOG_PREFIX = "[tender-rfq-tracking]";

function logError(message: string, err: unknown): void {
  console.error(`${LOG_PREFIX} ${message}`, err);
}

export async function deliverTrackingNotice(
  orgId: string,
  notice: TrackingNotice,
  recipientIds: readonly string[],
  deps: CollabDeliverDeps = defaultCollabDeliverDeps,
): Promise<CollabDeliverResult | null> {
  if (recipientIds.length === 0) return null;
  return deliverCollabNotification(
    {
      type: notice.type,
      priority: notice.priority,
      title: notice.title,
      summary: notice.summary,
      entityType: notice.entityType,
      entityId: notice.entityId,
      sourceKeyPrefix: notice.sourceKeyPrefix,
      orgId,
      projectId: notice.projectId,
      actorId: null,
      recipientIds,
      metadata: notice.metadata,
    },
    deps,
  );
}

// ── 入站：报价 / 回信（无报价） ─────────────────────────────────────

export type InboundTrackingContext = {
  round: RoundRef;
  supplierName: string;
  ownerId: string | null;
  roundCreatorId: string | null;
};

/** 按询价项 id 补齐轮次、项目、供应商与负责人 / 发起人；查不到返回 null */
export async function loadInboundTrackingContext(itemId: string): Promise<InboundTrackingContext | null> {
  const row = await db.inquiryItem.findUnique({
    where: { id: itemId },
    select: {
      supplier: { select: { name: true } },
      inquiry: {
        select: {
          id: true,
          roundNumber: true,
          createdById: true,
          projectId: true,
          project: { select: { name: true, ownerId: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    round: {
      inquiryId: row.inquiry.id,
      projectId: row.inquiry.projectId,
      projectName: row.inquiry.project.name,
      roundNumber: row.inquiry.roundNumber,
    },
    supplierName: row.supplier?.name ?? "供应商",
    ownerId: row.inquiry.project.ownerId,
    roundCreatorId: row.inquiry.createdById,
  };
}

export type InboundTrackingInput = {
  orgId: string;
  itemId: string;
  transition: "quoted" | "replied";
  messageId: string;
  missingFields: readonly InboundMissingField[];
};

/** 回信自动入表后调用（quoted → 报价通知；replied → 回信通知） */
export async function notifyInboundTracking(
  input: InboundTrackingInput,
  deps: { loadContext?: typeof loadInboundTrackingContext; deliver?: CollabDeliverDeps } = {},
): Promise<void> {
  try {
    const ctx = await (deps.loadContext ?? loadInboundTrackingContext)(input.itemId);
    if (!ctx) return;
    const notice =
      input.transition === "quoted"
        ? quoteReceivedNotice({ round: ctx.round, itemId: input.itemId, messageId: input.messageId, supplierName: ctx.supplierName, missingFields: input.missingFields })
        : replyReceivedNotice({ round: ctx.round, itemId: input.itemId, messageId: input.messageId, supplierName: ctx.supplierName });
    const type = input.transition === "quoted" ? RFQ_QUOTE_RECEIVED : RFQ_REPLY_RECEIVED;
    await deliverTrackingNotice(input.orgId, notice, trackingRecipients(type, ctx), deps.deliver);
  } catch (err) {
    logError(`入站通知失败 item=${input.itemId} message=${input.messageId}`, err);
  }
}

// ── 定时催单扫描：催单待批 / 未响应 ────────────────────────────────

/** 一轮、一次定时检查新起草的卡 → 一条催单待批（只给项目负责人） */
export async function notifyChaseRoundDrafted(
  input: { orgId: string; round: RoundRef; ownerId: string | null; days: number; cards: readonly DraftedCard[] },
  deps?: CollabDeliverDeps,
): Promise<void> {
  try {
    const notice = chaseReadyNotice({ round: input.round, days: input.days, cards: input.cards });
    if (!notice) return;
    await deliverTrackingNotice(input.orgId, notice, trackingRecipients(RFQ_CHASE_READY, { ownerId: input.ownerId, roundCreatorId: null }), deps);
  } catch (err) {
    logError(`催单待批通知失败 round=${input.round.inquiryId}`, err);
  }
}

/** 定时检查标了一家未响应 → 一条未响应（负责人 ∪ 本轮发起人） */
export async function notifyChaseNoResponse(
  input: {
    orgId: string;
    round: RoundRef;
    ownerId: string | null;
    roundCreatorId: string | null;
    itemId: string;
    supplierName: string;
    reason: NoResponseReason;
  },
  deps?: CollabDeliverDeps,
): Promise<void> {
  try {
    const notice = noResponseNotice({ round: input.round, itemId: input.itemId, supplierName: input.supplierName, reason: input.reason });
    await deliverTrackingNotice(input.orgId, notice, trackingRecipients(RFQ_NO_RESPONSE, input), deps);
  } catch (err) {
    logError(`未响应通知失败 item=${input.itemId}`, err);
  }
}
