/**
 * 嵌入表单限流（纯函数 + 常量；计数在 embed-intake.ts 里按收据查库）
 *
 * 嵌入表单的公开 key 写在网页里，Origin 头也能被非浏览器伪造，所以真正挡滥用的是限流。
 * Vercel 多实例 / 冷启动下内存计数不可靠，因此权威计数来自数据库：本组织 source=embed 的收据
 * （每次新事件写一张，访客 IP 的 HMAC 存在收据载荷 meta.ipHash 里，不进业务指纹）。
 *
 * - 每组织 × 每访客 IP（HMAC）：10 分钟内新事件数
 * - 每组织：1 小时 / 24 小时内新事件数
 *
 * 另有一层按通道 × IP 的请求次数限流（checkRateLimitAsync：配了 Upstash 走 Redis，否则内存），
 * 拦住不落库的无效请求洪水；它只是前置粗筛，不作为唯一依据。
 */

export interface EmbedRateLimits {
  /** 每访客 IP（HMAC）窗口内最多新事件数 */
  perIp: number;
  perIpWindowMs: number;
  /** 每组织 1 小时内最多新事件数 */
  perOrgHour: number;
  /** 每组织 24 小时内最多新事件数 */
  perOrgDay: number;
}

export const EMBED_RATE_LIMITS: EmbedRateLimits = {
  perIp: 5,
  perIpWindowMs: 10 * 60 * 1000,
  perOrgHour: 40,
  perOrgDay: 300,
};

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** 前置粗筛：每通道 × 每访客 IP 10 分钟内的请求次数（含无效请求、蜜罐、重发） */
export const EMBED_ATTEMPT_LIMIT = {
  name: "trade-embed-attempts",
  windowMs: 10 * 60 * 1000,
  maxRequests: 30,
} as const;

export interface EmbedSubmissionCounts {
  ipWindow: number;
  orgHour: number;
  orgDay: number;
}

export type EmbedRateDecision =
  | { allowed: true }
  | { allowed: false; reason: "ip" | "org_hour" | "org_day"; retryAfterSec: number };

/**
 * 纯函数：按已有计数判断本次新事件能否受理（计数 ≥ 上限即拒绝）。
 * retryAfterSec 取对应窗口长度（保守值，不精确到最早一条过期的时刻）。
 * 顺序：先 IP（最具体），再组织小时、组织日。
 */
export function decideEmbedRateLimit(counts: EmbedSubmissionCounts, limits: EmbedRateLimits = EMBED_RATE_LIMITS): EmbedRateDecision {
  if (counts.ipWindow >= limits.perIp) {
    return { allowed: false, reason: "ip", retryAfterSec: Math.ceil(limits.perIpWindowMs / 1000) };
  }
  if (counts.orgHour >= limits.perOrgHour) {
    return { allowed: false, reason: "org_hour", retryAfterSec: Math.ceil(HOUR_MS / 1000) };
  }
  if (counts.orgDay >= limits.perOrgDay) {
    return { allowed: false, reason: "org_day", retryAfterSec: Math.ceil(DAY_MS / 1000) };
  }
  return { allowed: true };
}
