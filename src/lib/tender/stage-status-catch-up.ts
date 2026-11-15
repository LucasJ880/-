/**
 * FIX-6 阶段已到、招投标状态落后时补状态（纯函数，不读库）
 *
 * 分析完成、询价发出（以及开启后的 FLOW-H1c）会只写阶段时间、不改招投标状态。
 * 之后人在对话里确认推进，原来只得到「无需重复推进」或「不允许回退」，状态与 BidToGo 回调就此跳过。
 * 这里判断「状态是否落后于人确认的那一阶段」；补写本身在 advanceProjectStage 里（人确认之后）。
 */
import { TENDER_STAGE_ORDER, tenderStatusStageOf } from "./stage";
import type { TenderStage } from "./types";

/**
 * 招投标状态是否落后于 targetStage：状态为空、或它对应的阶段比 targetStage 靠前。
 * 认不出的状态（含大小写不同的写法）不算——不覆盖人填的值；已是结果的状态都对应「项目提交」，也不算。
 */
export function tenderStatusLagsBehind(tenderStatus: string | null | undefined, targetStage: TenderStage): boolean {
  const statusStage = tenderStatusStageOf(tenderStatus);
  if (!statusStage) return false;
  return TENDER_STAGE_ORDER.indexOf(statusStage) < TENDER_STAGE_ORDER.indexOf(targetStage);
}
