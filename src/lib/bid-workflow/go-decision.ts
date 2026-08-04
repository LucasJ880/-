import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { isGoDecision, type GoDecision } from "./constants";

/**
 * 人工 GO/HOLD/NO_GO。
 * - 不写入 tenderStatus
 * - 不把人工决定写入 aiAdviceStatus（AI 建议与人工决定分离）
 */
export async function setGoHoldNoGo(input: {
  orgId: string;
  projectId: string;
  actorUserId: string;
  decision: string;
  note?: string;
}): Promise<
  | {
      ok: true;
      decision: GoDecision;
      previousDecision: string | null;
    }
  | { ok: false; error: string }
> {
  if (!isGoDecision(input.decision)) {
    return { ok: false, error: "decision 必须是 GO | HOLD | NO_GO" };
  }
  const decision = input.decision;
  const note = input.note?.trim().slice(0, 2000) || null;

  const room = await db.bidIntelligenceRoom.findFirst({
    where: { projectId: input.projectId, orgId: input.orgId },
    select: {
      id: true,
      goDecision: true,
      goDecisionNote: true,
    },
  });
  if (!room) {
    return { ok: false, error: "请先确认进入投标调查" };
  }

  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId },
    select: {
      id: true,
      bidPhaseStatus: true,
      aiAdviceStatus: true,
      intelligence: { select: { recommendation: true } },
    },
  });
  if (!project) {
    return { ok: false, error: "项目不存在" };
  }

  const previousDecision = room.goDecision;
  const aiSuggestion =
    project.intelligence?.recommendation || project.aiAdviceStatus || null;

  await db.$transaction(async (tx) => {
    await tx.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: {
        goDecision: decision,
        goDecisionById: input.actorUserId,
        goDecidedAt: new Date(),
        goDecisionNote: note,
      },
    });
    await tx.project.update({
      where: { id: input.projectId },
      data: {
        bidPhaseStatus: decision,
        // 刻意不更新 aiAdviceStatus / tenderStatus
      },
    });
    await tx.bidIntelligenceModule.updateMany({
      where: { roomId: room.id, moduleKey: "commercial_judgment" },
      data: {
        status: "confirmed",
        dataJson: {
          humanDecision: decision,
          aiSuggestion,
          note,
          decidedById: input.actorUserId,
          decidedAt: new Date().toISOString(),
          previousDecision,
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
    beforeData: {
      decision: previousDecision,
      note: room.goDecisionNote?.slice(0, 200) ?? null,
    },
    afterData: {
      decision,
      note: note?.slice(0, 200) ?? null,
      previousDecision,
      changed: previousDecision !== decision,
      aiSuggestionKeptSeparate: true,
    },
  });

  return { ok: true, decision, previousDecision };
}
