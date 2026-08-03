import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  goDecisionToAiAdvice,
  isGoDecision,
  type GoDecision,
} from "./constants";

export async function setGoHoldNoGo(input: {
  orgId: string;
  projectId: string;
  actorUserId: string;
  decision: string;
  note?: string;
}): Promise<{ ok: true; decision: GoDecision } | { ok: false; error: string }> {
  if (!isGoDecision(input.decision)) {
    return { ok: false, error: "decision 必须是 GO | HOLD | NO_GO" };
  }
  const decision = input.decision;

  const room = await db.bidIntelligenceRoom.findFirst({
    where: { projectId: input.projectId, orgId: input.orgId },
    select: { id: true },
  });
  if (!room) {
    return { ok: false, error: "请先确认进入投标调查" };
  }

  const aiAdvice = goDecisionToAiAdvice(decision);

  await db.$transaction(async (tx) => {
    await tx.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: {
        goDecision: decision,
        goDecisionById: input.actorUserId,
        goDecidedAt: new Date(),
        goDecisionNote: input.note?.slice(0, 2000) ?? null,
      },
    });
    await tx.project.update({
      where: { id: input.projectId },
      data: {
        bidPhaseStatus: decision,
        aiAdviceStatus: aiAdvice,
      },
    });
    await tx.bidIntelligenceModule.updateMany({
      where: { roomId: room.id, moduleKey: "commercial_judgment" },
      data: {
        status: "confirmed",
        dataJson: {
          humanDecision: decision,
          aiSuggestion: null,
          note: input.note ?? null,
          decidedById: input.actorUserId,
          decidedAt: new Date().toISOString(),
        },
      },
    });
  });

  await logAudit({
    userId: input.actorUserId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: "bid_go_decision",
    targetType: "bid_intelligence_room",
    targetId: room.id,
    afterData: { decision, note: input.note?.slice(0, 200) ?? null },
  });

  return { ok: true, decision };
}
