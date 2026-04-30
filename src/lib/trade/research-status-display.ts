/**
 * 研究状态展示与历史兼容（无 DB 依赖，可供 Client Components 引用）
 */

import { normalizeTradeProspectStage } from "@/lib/trade/stage";

function inferResearchStatus(row: { stage: string; score: number | null }): string {
  if (row.stage === "new" && row.score == null) return "pending";
  if (row.score != null) return "scored";
  const n = normalizeTradeProspectStage(row.stage);
  if (
    [
      "researched",
      "qualified",
      "contacted",
      "replied",
      "quoted",
      "follow_up",
      "converted",
      "lost",
      "archived",
    ].includes(n)
  ) {
    return "researched";
  }
  return "unknown";
}

function hasResearchReportJson(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const rep = (json as { report?: unknown }).report;
  if (!rep || typeof rep !== "object") return false;
  return Object.values(rep as Record<string, unknown>).some((v) => String(v ?? "").trim().length > 0);
}

/** 列表/详情：优先持久化 researchStatus，否则兼容历史行 */
export function effectiveResearchStatusDisplay(row: {
  researchStatus: string | null;
  stage: string;
  score: number | null;
  website: string | null;
  researchReport: unknown;
}): string {
  if (row.researchStatus?.trim()) return row.researchStatus.trim();
  if (row.score != null && hasResearchReportJson(row.researchReport)) return "researched";
  if (row.score != null) return "researched";
  if (hasResearchReportJson(row.researchReport)) return "researched_with_warnings";
  if (row.website?.trim()) return "research_pending";
  if (!row.website?.trim()) return "website_needed";
  return inferResearchStatus({ stage: row.stage, score: row.score });
}

export function isEvidenceWeakDisplay(status: string, warnings: string[] | null | undefined): boolean {
  if (status === "researched_with_warnings" || status === "low_confidence") return true;
  const w = warnings ?? [];
  return w.some((x) => x === "insufficient_sources" || x === "only_homepage_used" || x === "firecrawl_failed");
}
