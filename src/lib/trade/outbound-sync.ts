/**
 * Trade 车道真实外发 → Revenue Spine 镜像（P0.5 Trade Outbound Sync）
 *
 * 触发点只有人类真实外发的 Trade 路径（询盘收件箱回复 / 收件箱「已处理」标记 / 开发信发送 / 通道消息）。
 * Revenue executor 自己的发送不会经过这里（它直接 logRevenueInteraction），因此不会形成镜像回路。
 *
 * 语义：
 *   1. 线索已链接商机（TradeProspect.convertedToSalesOpportunityId）→ 经 canonical logRevenueInteraction 写 outbound
 *      CustomerInteraction（lastOutboundAt / followUpCount / next action 由它统一维护；本模块不直接改商机字段）
 *   2. 同商机所有 pending 的 sales.send_inquiry_reply 草稿 → 经 approval/port 作废（SUPERSEDED_BY_MANUAL_REPLY）
 *   3. 幂等键 = tradeMessageId（存于 CustomerInteraction.analysisResult），重复调用不重复镜像
 *   4. 任何失败只记录（console + AuditLog），绝不回滚已经成功的客户回复
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { rejectApprovalItem } from "@/lib/approval/port";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";
import { logRevenueInteraction } from "@/lib/revenue-spine/interactions";

export const SUPERSEDED_BY_MANUAL_REPLY = "SUPERSEDED_BY_MANUAL_REPLY";

export type TradeOutboundSource =
  | "trade_inbox.reply"
  | "trade_inbox.mark_sent"
  | "trade_inbox.mark_handled"
  | "trade_prospect.manual_outbound"
  | "trade_outreach.send"
  | "trade_outreach.mark_sent"
  | "trade_channel.send";

export interface TradeOutboundSyncInput {
  orgId: string;
  prospectId: string;
  tradeMessageId: string;
  /** 真实外发的操作者（服务端会话推导） */
  actorUserId: string;
  actorRole: string | null | undefined;
  source: TradeOutboundSource;
  /** email / whatsapp / wechat / wechat_work / phone / other */
  channel: string;
  subject?: string | null;
  content: string;
  /** 邮件服务返回的 message id（Resend）；标记类为空 */
  emailMessageId?: string | null;
  occurredAt?: Date;
}

export interface TradeOutboundSyncResult {
  /** 线索是否链接到商机（未链接 = Trade-only 线索，不产生任何 Revenue 对象） */
  linked: boolean;
  opportunityId: string | null;
  interactionId: string | null;
  /** 同一 tradeMessageId 已镜像过 */
  replay: boolean;
  supersededPendingActionIds: string[];
  supersedeFailures: Array<{ pendingActionId: string; error: string }>;
  error?: string;
}

function interactionTypeFor(channel: string): string {
  if (channel === "email") return "email";
  if (channel === "wechat" || channel === "wechat_work") return "wechat";
  if (channel === "phone") return "phone_call";
  return "note";
}

async function findMirroredInteraction(orgId: string, opportunityId: string, tradeMessageId: string) {
  return db.customerInteraction.findFirst({
    where: {
      orgId,
      opportunityId,
      direction: "outbound",
      analysisResult: { path: ["tradeMessageId"], equals: tradeMessageId },
    },
    select: { id: true },
  });
}

/**
 * 作废同商机的 pending 回复草稿。先以真实操作者身份经 port 拒绝；无权（非审批人/非管理员）时
 * 以草稿指定审批人（服务端推导）身份拒绝，note 中保留真实操作者与证据。
 */
export async function supersedePendingInquiryReplies(input: {
  orgId: string;
  opportunityId: string;
  actorUserId: string;
  actorRole: string | null | undefined;
  tradeMessageId: string;
  outboundInteractionId: string | null;
}): Promise<{ superseded: string[]; failures: Array<{ pendingActionId: string; error: string }> }> {
  const now = new Date();
  const drafts = await db.pendingAction.findMany({
    where: {
      orgId: input.orgId,
      type: INQUIRY_REPLY_ACTION_TYPE,
      status: "pending",
      expiresAt: { gt: now },
      payload: { path: ["opportunityId"], equals: input.opportunityId },
    },
    select: { id: true, approverUserId: true, createdById: true },
  });
  const superseded: string[] = [];
  const failures: Array<{ pendingActionId: string; error: string }> = [];
  const note = `${SUPERSEDED_BY_MANUAL_REPLY} tradeMessageId=${input.tradeMessageId} outboundInteractionId=${input.outboundInteractionId ?? "none"} actor=${input.actorUserId}`;
  for (const d of drafts) {
    try {
      let r = await rejectApprovalItem("pending_action", d.id, {
        userId: input.actorUserId,
        role: input.actorRole,
        orgId: input.orgId,
        note,
      });
      const principal = d.approverUserId ?? d.createdById;
      if (!r.ok && /无权/.test(r.error ?? "") && principal && principal !== input.actorUserId) {
        // 系统性作废：以草稿指定审批人身份执行（服务端推导），真实操作者保留在 note
        r = await rejectApprovalItem("pending_action", d.id, { userId: principal, role: null, orgId: input.orgId, note });
      }
      if (r.ok || r.status === "rejected") superseded.push(d.id);
      else failures.push({ pendingActionId: d.id, error: r.error ?? r.message ?? "reject failed" });
    } catch (err) {
      failures.push({ pendingActionId: d.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (failures.length) {
    console.error("[trade/outbound-sync] supersede failed", failures);
    await logAudit({
      userId: input.actorUserId,
      orgId: input.orgId,
      action: "revenue_spine.trade_outbound.supersede_failed",
      targetType: "sales_opportunity",
      targetId: input.opportunityId,
      afterData: { tradeMessageId: input.tradeMessageId, outboundInteractionId: input.outboundInteractionId, failures },
    }).catch(() => undefined);
  }
  return { superseded, failures };
}

/**
 * 主入口：在 Trade 侧外发消息已持久化之后调用。永不抛出。
 */
export async function syncTradeOutboundToRevenueSpine(input: TradeOutboundSyncInput): Promise<TradeOutboundSyncResult> {
  const base: TradeOutboundSyncResult = {
    linked: false,
    opportunityId: null,
    interactionId: null,
    replay: false,
    supersededPendingActionIds: [],
    supersedeFailures: [],
  };
  try {
    const prospect = await db.tradeProspect.findFirst({
      where: { id: input.prospectId, orgId: input.orgId },
      select: { id: true, convertedToSalesOpportunityId: true },
    });
    if (!prospect?.convertedToSalesOpportunityId) return base;
    const opportunity = await db.salesOpportunity.findFirst({
      where: { id: prospect.convertedToSalesOpportunityId, orgId: input.orgId },
      select: { id: true },
    });
    if (!opportunity) {
      // 链接指向他组织/已删除商机：fail-closed，不镜像
      console.error("[trade/outbound-sync] linked opportunity missing or cross-org", { prospectId: prospect.id });
      return { ...base, error: "LINKED_OPPORTUNITY_MISSING" };
    }
    const opportunityId = opportunity.id;

    const existing = await findMirroredInteraction(input.orgId, opportunityId, input.tradeMessageId);
    let interactionId: string;
    let replay = false;
    if (existing) {
      interactionId = existing.id;
      replay = true;
    } else {
      const logged = await logRevenueInteraction({
        orgId: input.orgId,
        opportunityId,
        direction: "outbound",
        channel: input.channel,
        type: interactionTypeFor(input.channel),
        summary: input.subject?.trim() || input.content,
        content: input.content,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
        emailMessageId: input.emailMessageId ?? null,
        source: input.source,
        extra: {
          tradeProspectId: prospect.id,
          tradeMessageId: input.tradeMessageId,
          emailMessageId: input.emailMessageId ?? null,
          mode: input.source,
        },
      });
      interactionId = logged.interactionId;
    }

    const sup = await supersedePendingInquiryReplies({
      orgId: input.orgId,
      opportunityId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      tradeMessageId: input.tradeMessageId,
      outboundInteractionId: interactionId,
    });

    if (!replay) {
      await logAudit({
        userId: input.actorUserId,
        orgId: input.orgId,
        action: "revenue_spine.trade_outbound.mirrored",
        targetType: "sales_opportunity",
        targetId: opportunityId,
        afterData: {
          source: input.source,
          channel: input.channel,
          tradeProspectId: prospect.id,
          tradeMessageId: input.tradeMessageId,
          interactionId,
          supersededPendingActionIds: sup.superseded,
        },
      }).catch(() => undefined);
    }

    return {
      linked: true,
      opportunityId,
      interactionId,
      replay,
      supersededPendingActionIds: sup.superseded,
      supersedeFailures: sup.failures,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[trade/outbound-sync] mirror failed (Trade send already persisted):", message);
    await logAudit({
      userId: input.actorUserId,
      orgId: input.orgId,
      action: "revenue_spine.trade_outbound.mirror_failed",
      targetType: "trade_prospect",
      targetId: input.prospectId,
      afterData: { tradeMessageId: input.tradeMessageId, source: input.source, error: message },
    }).catch(() => undefined);
    return { ...base, error: message };
  }
}
