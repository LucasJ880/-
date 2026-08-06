/**
 * 自动入队门闸。
 * 仅允许：workDomain === "tender" OR 已存在 BidIntelligenceRoom。
 * 禁止：文件名启发式（RFP/Tender/Bid）、PDF mime 等作为自动触发条件。
 */

import type { CanAutoEnqueueInput, CanAutoEnqueueResult } from "./types";

export function canAutoEnqueueAnalysis(
  input: CanAutoEnqueueInput,
): CanAutoEnqueueResult {
  const domain = (input.workDomain ?? "").trim().toLowerCase();
  if (domain === "tender") {
    return { ok: true, reason: "tender_domain" };
  }
  if (input.hasIntelligenceRoom) {
    return { ok: true, reason: "intelligence_room" };
  }
  return { ok: false, reason: "gate_closed" };
}
