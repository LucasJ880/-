/**
 * BIDPAGE-1 询价明细 → 计数（纯函数，零依赖；service.ts 取数后调用，单测直接测）
 *
 * 按供应商算：每家取它最近一次发出的那一轮（轮次号最大、没取消的轮次里状态不是「未发出」的明细）的状态；
 * 任何一轮报过价就算已报价；「在等」= 最近一次是已发出、那一轮没结束、发出不到 90 天
 * （与定时催单扫描 `tender-rfq/chase-service.ts` 的 OPEN_ITEM_WINDOW_DAYS、项目页「下一步」的 outOfScan 同一个时间窗）。
 * 没有发出时间的「已发出」明细（旧数据）仍算在等，只是不参与等待天数。
 */
import type { BidPageFacts } from "./next-step";

/** 与 tender-rfq/chase-service.ts 的 OPEN_ITEM_WINDOW_DAYS 相同（测试按源码核对） */
export const INQUIRY_SCAN_WINDOW_DAYS = 90;

/** 已回（回复了、报了价、或明确拒绝） */
const RESPONDED = new Set(["replied", "quoted", "declined"]);
const DAY = 86_400_000;

export type InquiryItemFact = { supplierId: string; status: string; sentAt: Date | null; roundNumber: number; roundStatus: string };

export function countInquiry(items: InquiryItemFact[], now: Date): BidPageFacts["inquiry"] {
  const latest = new Map<string, InquiryItemFact>();
  const quoted = new Set<string>();
  for (const it of items) {
    if (it.status === "quoted") quoted.add(it.supplierId);
    if (it.status === "pending") continue; // 没发出的不算「问过」
    const prev = latest.get(it.supplierId);
    if (!prev || it.roundNumber > prev.roundNumber) latest.set(it.supplierId, it);
  }
  const scanFloor = now.getTime() - INQUIRY_SCAN_WINDOW_DAYS * DAY;
  let responded = 0;
  let repliedNoQuote = 0;
  let waiting = 0;
  let waitingSince: number | null = null;
  for (const [supplierId, it] of latest) {
    if (RESPONDED.has(it.status)) responded += 1;
    if (it.status === "replied" && !quoted.has(supplierId)) repliedNoQuote += 1;
    if (it.status === "sent" && it.roundStatus !== "completed") {
      const t = it.sentAt ? new Date(it.sentAt).getTime() : NaN;
      if (Number.isFinite(t) && t < scanFloor) continue; // 发出超过 90 天：定时催单也不再看，不算在等
      waiting += 1;
      if (Number.isFinite(t)) waitingSince = waitingSince === null ? t : Math.min(waitingSince, t);
    }
  }
  return {
    askedCount: latest.size,
    respondedCount: responded,
    quotedCount: quoted.size,
    repliedNoQuoteCount: repliedNoQuote,
    waitingCount: waiting,
    waitingSince: waitingSince === null ? null : new Date(waitingSince),
  };
}
