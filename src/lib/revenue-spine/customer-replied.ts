/**
 * Revenue Spine — 买家在青砚之外回了信（回到 Cathy 邮箱、WhatsApp、电话）
 *
 * 回信不经过青砚，系统会以为买家没回、继续起草跟进。业务点「买家已回复」：
 * 1. 记一条来信互动（内容不在青砚，只记渠道和备注）——之后不再起草无回复跟进（见 no-reply-followup）
 * 2. 作废这个商机还没批的回复 / 跟进草稿（系统作废，不是人工拒绝）
 * 3. 勾了「我们也已回复」再记一条外发，免得一直挂在「待回复客户」队列里
 */

import { db } from "@/lib/db";
import { supersedePendingAction } from "@/lib/pending-actions/supersede";
import { INQUIRY_REPLY_ACTION_TYPE } from "./fde/inbound-sales";
import { logRevenueInteraction } from "./interactions";

export const OUTSIDE_REPLY_CHANNELS = {
  email: "邮件",
  whatsapp: "WhatsApp",
  phone: "电话",
  in_person: "当面",
} as const;
export type OutsideReplyChannel = keyof typeof OUTSIDE_REPLY_CHANNELS;

export function isOutsideReplyChannel(v: unknown): v is OutsideReplyChannel {
  return typeof v === "string" && v in OUTSIDE_REPLY_CHANNELS;
}

export async function markCustomerRepliedOutside(input: {
  orgId: string;
  opportunityId: string;
  channel: OutsideReplyChannel;
  /** 我们也已经在邮箱 / WhatsApp 回复了买家 */
  alsoReplied: boolean;
  note?: string | null;
  actorUserId: string;
}): Promise<{ interactionId: string; outboundInteractionId: string | null; superseded: number }> {
  const label = OUTSIDE_REPLY_CHANNELS[input.channel];
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 500) || "";
  const inbound = await logRevenueInteraction({
    orgId: input.orgId,
    opportunityId: input.opportunityId,
    direction: "inbound",
    channel: input.channel,
    summary: `买家已通过${label}回复`,
    content: `买家已通过${label}回复（内容不在青砚）${note ? `：${note}` : ""}`,
    actorUserId: input.actorUserId,
    source: "manual_customer_replied",
    extra: { outsideReply: true },
  });

  const pending = await db.pendingAction.findMany({
    where: {
      orgId: input.orgId,
      type: INQUIRY_REPLY_ACTION_TYPE,
      status: "pending",
      payload: { path: ["opportunityId"], equals: input.opportunityId },
    },
    select: { id: true },
  });
  let superseded = 0;
  for (const p of pending) {
    const r = await supersedePendingAction({
      pendingActionId: p.id,
      orgId: input.orgId,
      expectedType: INQUIRY_REPLY_ACTION_TYPE,
      reasonCode: "SUPERSEDED_BY_NEWER_INBOUND",
      triggeredByUserId: input.actorUserId,
      auditActorUserId: input.actorUserId,
      evidence: { inboundInteractionId: inbound.interactionId },
    });
    if (r.ok && !r.duplicate) superseded += 1;
  }

  let outboundInteractionId: string | null = null;
  if (input.alsoReplied) {
    const out = await logRevenueInteraction({
      orgId: input.orgId,
      opportunityId: input.opportunityId,
      direction: "outbound",
      channel: input.channel,
      summary: `已通过${label}回复买家`,
      content: `已通过${label}回复买家（内容不在青砚）`,
      actorUserId: input.actorUserId,
      source: "manual_customer_replied",
      extra: { outsideReply: true },
    });
    outboundInteractionId = out.interactionId;
  }
  return { interactionId: inbound.interactionId, outboundInteractionId, superseded };
}
