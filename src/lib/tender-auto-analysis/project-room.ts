/**
 * Phase H（可与 G 同批）— 投影到既有 BidIntelligenceRoom
 * 不自动创建 room；仅当 roomId 已设或项目已有 room 时投影。
 * 禁止编造历史中标 / 竞争对手 / 供应链事实。
 */

import { db } from "@/lib/db";
import { INTELLIGENCE_MODULES } from "@/lib/bid-workflow/constants";

export type ProjectRoomInput = {
  runId: string;
  projectId: string;
  orgId: string;
  roomId?: string | null;
};

export type ProjectRoomResult = {
  projected: boolean;
  roomId: string | null;
  reason?: string;
};

const AWAITING = {
  awaitingInvestigation: true,
  messageZh: "待调查；尚无可靠来源；可启动后续情报调查。",
} as const;

async function resolveRoom(
  projectId: string,
  roomId?: string | null,
): Promise<{ id: string } | null> {
  if (roomId) {
    const byId = await db.bidIntelligenceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, projectId: true },
    });
    if (byId && byId.projectId === projectId) return { id: byId.id };
  }
  const byProject = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true },
  });
  return byProject;
}

export async function projectAnalysisToRoom(
  input: ProjectRoomInput,
): Promise<ProjectRoomResult> {
  const room = await resolveRoom(input.projectId, input.roomId);
  if (!room) {
    return {
      projected: false,
      roomId: null,
      reason: "room_missing_no_autocreate",
    };
  }

  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: input.runId },
    select: {
      summaryJson: true,
      summaryText: true,
      facts: {
        select: {
          contentZh: true,
          contentOriginal: true,
          statementKind: true,
          confidence: true,
        },
        take: 80,
      },
      requirements: {
        select: { requirementCode: true, chineseTranslation: true },
        orderBy: { requirementCode: "asc" },
        take: 20,
      },
      deliverables: {
        select: { deliverableKey: true, title: true, mandatory: true, status: true },
      },
      clarifications: {
        select: { question: true, priority: true },
        take: 12,
      },
    },
  });
  if (!run) {
    return { projected: false, roomId: room.id, reason: "run_not_found" };
  }

  const summary = (run.summaryJson ?? {}) as Record<string, unknown>;
  const confirmedFacts = run.facts.filter(
    (f) => f.statementKind === "CONFIRMED_FACT" || f.statementKind === "DOCUMENT_INTERPRETATION",
  );

  const moduleData: Record<
    string,
    { status: "confirmed" | "investigating" | "unknown"; dataJson: object }
  > = {
    project_understanding: {
      status: confirmedFacts.length > 0 ? "investigating" : "unknown",
      dataJson: {
        projectName: summary.projectName ?? null,
        solicitationNumber: summary.solicitationNumber ?? null,
        closing: summary.closing ?? null,
        procurementType: summary.procurementType ?? null,
        highlightsZh: confirmedFacts.slice(0, 12).map((f) => f.contentZh),
        source: "tender_analysis",
        runId: input.runId,
      },
    },
    contract_value: {
      status: "investigating",
      dataJson: {
        evaluationQuantity: summary.evaluationQuantity ?? null,
        purchaseGuarantee: summary.purchaseGuarantee ?? "无保证采购",
        evaluationAggregateNoteZh:
          "若出现 7,500，仅可作为评标合计解释，不是保证采购量。",
        officialSource: "tender_document_pages",
        inventedAmounts: false,
      },
    },
    commercial_judgment: {
      status: "investigating",
      dataJson: {
        aiRecommendation: summary.aiRecommendation ?? "HOLD_PENDING_CLARIFICATION",
        reviewStatus: summary.reviewStatus ?? "REVIEW_REQUIRED",
        topRisks: summary.topRisks ?? [],
        stanceZh: "审慎跟进；关键澄清完成前不自动 GO。",
        inventedCompetitors: false,
      },
    },
    deliverables: {
      status: run.deliverables.length > 0 ? "investigating" : "unknown",
      dataJson: {
        items: run.deliverables.map((d) => ({
          key: d.deliverableKey,
          title: d.title,
          mandatory: d.mandatory,
          status: d.status,
          ready: d.status === "DONE",
        })),
        clarificationsOpen: run.clarifications.length,
        requirementsExtracted: run.requirements.map((r) => r.requirementCode),
      },
    },
    series_identification: {
      status: "unknown",
      dataJson: { ...AWAITING },
    },
    historical_awards: {
      status: "unknown",
      dataJson: { ...AWAITING, awards: [] },
    },
    competitor_profile: {
      status: "unknown",
      dataJson: { ...AWAITING },
    },
    supply_chain: {
      status: "unknown",
      dataJson: { ...AWAITING },
    },
  };

  for (const mod of INTELLIGENCE_MODULES) {
    const payload = moduleData[mod.key] ?? {
      status: "unknown" as const,
      dataJson: { ...AWAITING },
    };
    await db.bidIntelligenceModule.upsert({
      where: {
        roomId_moduleKey: { roomId: room.id, moduleKey: mod.key },
      },
      create: {
        roomId: room.id,
        moduleKey: mod.key,
        title: mod.title,
        status: payload.status,
        sortOrder: mod.sortOrder,
        dataJson: payload.dataJson,
      },
      update: {
        status: payload.status,
        dataJson: payload.dataJson,
        title: mod.title,
        sortOrder: mod.sortOrder,
      },
    });
  }

  await db.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: {
      summaryText: run.summaryText ?? undefined,
      summaryJson: {
        ...(typeof run.summaryJson === "object" && run.summaryJson
          ? (run.summaryJson as object)
          : {}),
        projectedFromRunId: input.runId,
      },
      summaryStatus: "investigating",
    },
  });

  // 回写 run.roomId（若空）
  if (!input.roomId) {
    await db.tenderAnalysisRun.updateMany({
      where: { id: input.runId, roomId: null },
      data: { roomId: room.id },
    });
  }

  return { projected: true, roomId: room.id };
}
