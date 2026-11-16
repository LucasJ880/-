/**
 * P2-3b「今日新标」早报的纯规则：时间窗口、去重键、正文排版。
 */

import { formatLocal } from "./schedule";

export const NOTICE_BRIEF_TYPE = "procurement_notice_brief";
export const NOTICE_BRIEF_CATEGORY = "procurement_watch";
/** 通知跳转对象（src/lib/notifications/href.ts 映射到采购监控的新标视图） */
export const NOTICE_BRIEF_ENTITY_TYPE = "procurement_new_notices";
export const NOTICE_BRIEF_HREF = "/projects/intelligence/monitor?view=new";
export const NOTICE_BRIEF_MAX_LINES = 5;
export const NOTICE_BRIEF_WINDOW_MS = 24 * 3600_000;

/** 窗口起点：过去 24 小时内首次发现的（07:00 每天一次，与「上次早报之后」等价，design D2） */
export const briefWindowStart = (now: Date): Date => new Date(now.getTime() - NOTICE_BRIEF_WINDOW_MS);

/** 同一组织同一当地日期每人一条 */
export const noticeBriefSourceKey = (orgId: string, day: string, userId: string): string => `procurement-notice-brief:${orgId}:${day}:${userId}`;

export type BriefNotice = { title: string | null; officialNumber: string; closingAt: Date | null };

/** 截标写法：多伦多时间 MM-DD HH:mm；未知写「截标未知」 */
export function closingText(closingAt: Date | null, timeZone = "America/Toronto"): string {
  if (!closingAt) return "截标未知";
  return `截标 ${formatLocal(closingAt, timeZone).slice(5)}`;
}

/** 正文（design D4）：标题写总数；前 5 条「· 标题（截标 …）」；多出的写「另有 N 条」；只用公开的标题 / 编号 / 截标时间 */
export function formatNoticeBrief(items: BriefNotice[], total: number): { title: string; summary: string } {
  const lines = items.slice(0, NOTICE_BRIEF_MAX_LINES).map((n) => {
    const name = (n.title?.trim() || n.officialNumber).slice(0, 80);
    return `· ${name}（${closingText(n.closingAt)}）`;
  });
  const more = total - lines.length;
  return {
    title: `今日新标 ${total} 条`,
    summary: [...lines, ...(more > 0 ? [`另有 ${more} 条`] : []), "点开看全部（采购监控 · 新标）"].join("\n"),
  };
}
