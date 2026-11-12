/**
 * FIX-6 阶段已到、招投标状态落后时补状态（纯函数）
 *
 * 分析完成、询价发出（以及开启后的 FLOW-H1c）会只写阶段时间、不改招投标状态。
 * 之后人在对话里确认推进到同一阶段，原来只得到「无需重复推进」，状态与 BidToGo 回调就此跳过。
 * 这里判断「状态是否落后于这一阶段」；补写本身在 advanceProjectStage 里（人确认之后）。
 */
import { TERMINAL_TENDER_STATUSES } from "@/lib/projects/review";
import { TENDER_STAGE_ORDER, tenderStatusStageOf } from "./stage";
import type { TenderStage } from "./types";

/**
 * 招投标状态是否落后于 targetStage 对应的状态 targetStatus。
 * 已是结果、认不出的状态、与目标相同、对应的阶段不比目标早 → 不落后（不动）。
 */
export function tenderStatusLagsBehind(tenderStatus: string | null | undefined, targetStage: TenderStage, targetStatus: string | undefined): boolean {
  if (!targetStatus) return false;
  const s = (tenderStatus ?? "").trim();
  if (s === targetStatus) return false;
  if (TERMINAL_TENDER_STATUSES.has(s.toLowerCase())) return false;
  const statusStage = tenderStatusStageOf(s || null);
  if (!statusStage) return false;
  return TENDER_STAGE_ORDER.indexOf(statusStage) < TENDER_STAGE_ORDER.indexOf(targetStage);
}
