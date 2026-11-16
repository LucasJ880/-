/**
 * 起草之后写进 room.summaryJson.bidDraft 的元信息（纯函数）
 *
 * FLOW-H5：basis 有值（两道闸的开关开着）时一并记下起草所用的分析与它当时是否已批准；没有就与原来相同。
 */
import type { BidDraftResult } from "./contract";

export function bidDraftMetaOf(result: BidDraftResult, basis: { runId: string; approved: boolean } | null): Record<string, unknown> {
  return {
    version: result.version,
    generatedAt: result.generatedAt,
    placeholders: result.placeholders,
    toConfirm: result.compliance.filter((c) => c.status === "TO_CONFIRM").length,
    excludedNameHits: result.excludedNameHits,
    forbiddenHits: result.forbiddenHits,
    requirementCount: result.compliance.length,
    internalNotesZh: result.sections.internalNotesZh.slice(0, 12),
    ...(basis ? { analysisRunId: basis.runId, basedOnApprovedAnalysis: basis.approved } : {}),
  };
}
