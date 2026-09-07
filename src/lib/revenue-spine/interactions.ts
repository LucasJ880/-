/**
 * Revenue Spine — 互动记录（CustomerInteraction）+ 时间戳 + CUSTOMER_REPLIED 结果
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { applyNextAction } from "./next-action";
import { recordRevenueOutcome } from "./outcomes";
import type { RevenueSpinePolicy } from "./policy";

export interface LogInteractionInput {
  orgId: string;
  opportunityId: string;
  direction: "inbound" | "outbound";
  /** website / email / whatsapp / wechat / phone / other */
  channel: string;
  /** CustomerInteraction.type：web_form / email / note / phone_call … */
  type?: string;
  summary?: string;
  content: string;
  actorUserId: string;
  occurredAt?: Date;
  rawMessages?: unknown;
  emailMessageId?: string | null;
  language?: string | null;
  /** 触发来源（写入 analysisResult.source） */
  source?: string;
  extra?: Record<string, unknown>;
  policy?: RevenueSpinePolicy;
}

export interface LogInteractionResult {
  interactionId: string;
  customerReplied: boolean;
  outcomeId: string | null;
}

export async function logRevenueInteraction(input: LogInteractionInput): Promise<LogInteractionResult> {
  const now = input.occurredAt ?? new Date();
  const opp = await db.salesOpportunity.findFirst({
    where: { id: input.opportunityId, orgId: input.orgId },
    select: { id: true, customerId: true, lastOutboundAt: true, lastCustomerReplyAt: true, followUpCount: true },
  });
  if (!opp) throw new Error("商机不存在或跨组织");

  const summary = (input.summary ?? input.content).replace(/\s+/g, " ").trim().slice(0, 240) || "(empty)";
  const interaction = await db.customerInteraction.create({
    data: {
      orgId: input.orgId,
      customerId: opp.customerId,
      opportunityId: opp.id,
      type: input.type ?? (input.channel === "website" ? "web_form" : input.channel === "email" ? "email" : "note"),
      direction: input.direction,
      summary,
      content: input.content.slice(0, 20_000),
      channel: input.channel,
      language: input.language ?? null,
      emailMessageId: input.emailMessageId ?? null,
      rawMessages: input.rawMessages ? JSON.stringify(input.rawMessages).slice(0, 50_000) : null,
      analysisStatus: null,
      analysisResult: { source: input.source ?? "revenue_spine", ...(input.extra ?? {}) } as Prisma.InputJsonValue,
      createdById: input.actorUserId,
    },
    select: { id: true },
  });

  const customerReplied = input.direction === "inbound" && !!opp.lastOutboundAt;
  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: {
      lastInteractionAt: now,
      ...(input.direction === "inbound" ? { lastCustomerReplyAt: now } : {}),
      ...(input.direction === "outbound" ? { lastOutboundAt: now, followUpCount: { increment: 1 } } : {}),
    },
  });

  let outcomeId: string | null = null;
  if (customerReplied) {
    const r = await recordRevenueOutcome({
      orgId: input.orgId,
      opportunityId: opp.id,
      outcomeType: "CUSTOMER_REPLIED",
      actionType: `inbound_message:${input.channel}`,
      sourceType: "business_record",
      sourceId: `interaction:${interaction.id}`,
      userId: input.actorUserId,
      value: { channel: input.channel, interactionId: interaction.id },
      actionOccurredAt: now,
    });
    outcomeId = r.id;
  }

  await applyNextAction(input.orgId, opp.id, { policy: input.policy, now });
  return { interactionId: interaction.id, customerReplied, outcomeId };
}
