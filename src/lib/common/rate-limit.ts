/**
 * 轻量内存限流器 — 滑动窗口计数
 *
 * 适用于 Vercel Serverless 单实例场景。
 * 多实例/长期运行场景建议替换为 Redis（@upstash/ratelimit）。
 */

interface Entry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, Entry>>();

const GC_INTERVAL_MS = 60_000;
let lastGc = Date.now();

function gc(store: Map<string, Entry>, windowMs: number) {
  const now = Date.now();
  if (now - lastGc < GC_INTERVAL_MS) return;
  lastGc = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export interface RateLimiterConfig {
  /** 限流器名称（同名共享计数） */
  name: string;
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(
  config: RateLimiterConfig,
  key: string,
): RateLimitResult {
  if (!stores.has(config.name)) {
    stores.set(config.name, new Map());
  }
  const store = stores.get(config.name)!;
  gc(store, config.windowMs);

  const now = Date.now();
  const cutoff = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: oldest + config.windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    retryAfterMs: 0,
  };
}
