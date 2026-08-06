/**
 * Phase H（可与 G 同批）— 投影到既有 BidIntelligenceRoom
 * 不自动创建 room；仅当 roomId 已设或项目已有 room 时投影。
 * 禁止编造历史中标 / 竞争对手 / 供应链事实。
 * 禁止覆盖人工 GO（commercial_judgment.humanDecision / room.goDecision）。
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
): Promise<{ id: string; goDecision: string | null } | null> {
  if (roomId) {
    const byId = await db.bidIntelligenceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, projectId: true, goDecision: true },
    });
    if (byId && byId.projectId === projectId) {
      return { id: byId.id, goDecision: byId.goDecision };
    }
  }
  const byProject = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, goDecision: true },
  });
  return byProject;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ...(v as Record<string, unknown>) };
  }
  return {};
}

/** 合并投影：保留人工 GO 字段，不降级已 confirmed 的商业判断模块 */
export function mergeCommercialJudgmentProjection(input: {
  incoming: Record<string, unknown>;
  existingDataJson: unknown;
  existingStatus: string | null | undefined;
  roomGoDecision: string | null | undefined;
}): { status: "confirmed" | "investigating" | "unknown"; dataJson: object } {
  const existing = asRecord(input.existingDataJson);
  const humanDecision =
    (typeof existing.humanDecision === "string" && existing.humanDecision) ||
    (typeof input.roomGoDecision === "string" && input.roomGoDecision) ||
    null;

  if (!humanDecision) {
    return {
      status: "investigating",
      dataJson: input.incoming,
    };
  }

  return {
    status: input.existingStatus === "confirmed" ? "confirmed" : "investigating",
    dataJson: {
      ...input.incoming,
      humanDecision,
      note: existing.note ?? null,
      decidedById: existing.decidedById ?? null,
      decidedAt: existing.decidedAt ?? null,
      previousDecision: existing.previousDecision ?? null,
      aiSuggestion: existing.aiSuggestion ?? null,
      // 明确：投影不改写人工决定
      goDecisionUntouched: true,
    },
  };
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
      status: true,
      summaryJson: true,
      summaryText: true,
      facts: {
        select: {
          contentZh: true,
          contentOriginal: true,
          statementKind: true,
          confidence: true,
          manuallyConfirmed: true,
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

  // 已被替代的 Run 不得回写 Room
  if (run.status === "SUPERSEDED") {
    return { projected: false, roomId: room.id, reason: "run_superseded" };
  }

  const summary = (run.summaryJson ?? {}) as Record<string, unknown>;
  // 拒绝事实（confidence=UNKNOWN）不进入投影亮点
  const confirmedFacts = run.facts.filter(
    (f) =>
      f.confidence !== "UNKNOWN" &&
      (f.statementKind === "CONFIRMED_FACT" ||
        f.statementKind === "DOCUMENT_INTERPRETATION"),
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
        runId: input.runId,
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
        runId: input.runId,
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
        runId: input.runId,
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

    let status = payload.status;
    let dataJson = payload.dataJson;

    if (mod.key === "commercial_judgment") {
      const existing = await db.bidIntelligenceModule.findUnique({
        where: {
          roomId_moduleKey: { roomId: room.id, moduleKey: "commercial_judgment" },
        },
        select: { status: true, dataJson: true },
      });
      const merged = mergeCommercialJudgmentProjection({
        incoming: asRecord(payload.dataJson),
        existingDataJson: existing?.dataJson,
        existingStatus: existing?.status,
        roomGoDecision: room.goDecision,
      });
      status = merged.status;
      dataJson = merged.dataJson;
    }

    await db.bidIntelligenceModule.upsert({
      where: {
        roomId_moduleKey: { roomId: room.id, moduleKey: mod.key },
      },
      create: {
        roomId: room.id,
        moduleKey: mod.key,
        title: mod.title,
        status,
        sortOrder: mod.sortOrder,
        dataJson,
      },
      update: {
        status,
        dataJson,
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
      // 刻意不更新 goDecision / goDecisionById / goDecidedAt
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
