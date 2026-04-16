/**
 * 限流器
 *
 * 两套实现：
 * - 生产（Vercel 多实例）：Upstash Redis 滑动窗口
 *   需要 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 环境变量
 * - Fallback（本地开发 / 未配置 Upstash）：内存计数器
 *
 * 同步 API checkRateLimit 始终走内存实现，用于冷启动 / 对延迟敏感的场景，
 * 且保持旧调用点 100% 兼容。
 *
 * 异步 API checkRateLimitAsync 在配置了 Upstash 时走 Redis，实现真正的
 * 跨实例限流。未配置时自动 fallback 到内存实现（无额外网络开销）。
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

// ─────────────────────────────────────────────────────────────
// Redis (Upstash) 实现 —— 仅在配置了环境变量时启用
// ─────────────────────────────────────────────────────────────

type UpstashLimiter = {
  limit: (key: string) => Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
  }>;
};

const redisLimiters = new Map<string, UpstashLimiter>();
let redisInitAttempted = false;
let redisAvailable = false;

async function getOrCreateRedisLimiter(
  config: RateLimiterConfig,
): Promise<UpstashLimiter | null> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  const cached = redisLimiters.get(config.name);
  if (cached) return cached;

  if (redisInitAttempted && !redisAvailable) return null;
  redisInitAttempted = true;

  try {
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import("@upstash/ratelimit"),
      import("@upstash/redis"),
    ]);
    const redis = Redis.fromEnv();
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        config.maxRequests,
        `${Math.max(1, Math.floor(config.windowMs / 1000))} s`,
      ),
      analytics: false,
      prefix: `rl:${config.name}`,
    });
    redisLimiters.set(config.name, limiter);
    redisAvailable = true;
    return limiter;
  } catch (err) {
    console.warn(
      "[rate-limit] Upstash init failed, falling back to in-memory:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 异步限流检查 —— 生产环境推荐。
 * 有 Upstash 配置 → Redis 滑动窗口（跨实例生效）
 * 无配置 → 退回内存实现（同 checkRateLimit）
 */
export async function checkRateLimitAsync(
  config: RateLimiterConfig,
  key: string,
): Promise<RateLimitResult> {
  const limiter = await getOrCreateRedisLimiter(config);
  if (!limiter) {
    return checkRateLimit(config, key);
  }

  try {
    const res = await limiter.limit(key);
    const now = Date.now();
    return {
      allowed: res.success,
      remaining: res.remaining,
      retryAfterMs: res.success ? 0 : Math.max(0, res.reset - now),
    };
  } catch (err) {
    // Redis 失败时 fallback 到内存，避免因监控层问题连带挂业务
    console.warn(
      "[rate-limit] Upstash call failed, using in-memory fallback:",
      err instanceof Error ? err.message : err,
    );
    return checkRateLimit(config, key);
  }
}
