/**
 * Aivora 成片拉取适配器（冻结契约版）
 *
 * 契约：《Aivora → 青砚 成片同步接入说明（aivora-sync）》2026-08-04，
 * 对应 Aivora PRD §9，契约已冻结。见 docs/AIVORA_SYNC_CONTRACT.md。
 *
 * 要点：
 * - GET {AIVORA_API_URL}/api/videos，HTTP 头 `Authorization: Bearer <AIVORA_API_KEY>`
 * - 增量游标 `since`（ISO 8601，语义为"该时刻之后完成"）；响应 meta.next_since 供下一轮
 * - limit 1–200；单轮拉满 limit 时立即用 next_since 续拉（由 service 层循环）
 * - 接口只读幂等；`videos[].id` 是跨轮次稳定的幂等键 → VideoAsset.externalId
 * - 配方字段（recipe_id / hook_type / template_id / aspect_ratio / brand_placement）
 *   与 duration 的 null 表示"未知"，不是默认值；入库保持 null，不得归入默认桶
 *
 * 环境变量：
 * - AIVORA_API_URL：基地址（如 https://reelforge-delta.vercel.app）
 * - AIVORA_API_KEY：Bearer token（Lucas 安全渠道提供；勿写入仓库/日志）
 */

export const AIVORA_PAGE_LIMIT = 200;

/** 契约 §4 枚举（仅用于类型提示；入库按原文存储，不做归一化改写） */
export type AivoraHookType = "POV" | "Curiosity" | "Stat" | "Reveal" | "Pain" | "Demo";
export type AivoraBrandPlacement = "natural" | "planar_track" | "corner_badge";

export interface AivoraVideo {
  externalId: string;
  title: string;
  videoUrl: string;
  coverUrl: string | null;
  /** null = 拿不到实际时长（不是 0，也不是目标时长） */
  durationSec: number | null;
  topic: string | null;
  language: string | null;
  /** ISO 8601；游标推进与统计口径都以它为准 */
  completedAt: string | null;
  // —— 创意配方维度（null = 未知，做配方统计时必须排除）——
  recipeId: string | null;
  hookType: string | null;
  templateId: string | null;
  aspectRatio: string | null;
  brandPlacement: string | null;
}

export interface AivoraPage {
  videos: AivoraVideo[];
  /** meta.count：本页条数（以服务端口径判断是否满页） */
  count: number;
  /** meta.skipped_unbranded：已完成但未品牌封装、暂不可交付的条数（观测指标） */
  skippedUnbranded: number;
  /** meta.next_since：下一轮 since；本页无数据时为 null（沿用上一次 since） */
  nextSince: string | null;
  /** 服务端口径满页 → 应立即续拉 */
  isFull: boolean;
}

/** 契约 §8：400/401 不重试；503/5xx/超时 指数退避重试（接口只读幂等，重试无副作用） */
export class AivoraApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AivoraApiError";
    this.status = status;
    this.retryable = status >= 500 || status === 0;
  }
}

export function isAivoraConfigured(): boolean {
  return Boolean(process.env.AIVORA_API_URL?.trim() && process.env.AIVORA_API_KEY?.trim());
}

/** 基地址 → /api/videos 完整地址；容忍配置成带 /api 后缀的写法 */
export function getAivoraVideosEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return /\/api$/i.test(base) ? `${base}/videos` : `${base}/api/videos`;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function mapAivoraItem(item: Record<string, unknown>): AivoraVideo | null {
  const externalId = asNullableString(item.id);
  const videoUrl = asNullableString(item.video_url);
  if (!externalId || !videoUrl) return null;
  return {
    externalId,
    title: asNullableString(item.title) ?? `Aivora ${externalId}`,
    videoUrl,
    coverUrl: asNullableString(item.cover_url),
    durationSec:
      typeof item.duration === "number" && Number.isFinite(item.duration)
        ? Math.round(item.duration)
        : null,
    topic: asNullableString(item.topic),
    language: asNullableString(item.language),
    completedAt: asNullableString(item.completed_at),
    recipeId: asNullableString(item.recipe_id),
    hookType: asNullableString(item.hook_type),
    templateId: asNullableString(item.template_id),
    aspectRatio: asNullableString(item.aspect_ratio),
    brandPlacement: asNullableString(item.brand_placement),
  };
}

/** 解析一页响应；meta 缺失时按保守值兜底（不满页、无游标） */
export function parseAivoraPage(payload: unknown, requestedLimit: number): AivoraPage {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const rawVideos = Array.isArray(root.videos) ? root.videos : [];
  const videos = rawVideos
    .map((it) =>
      it && typeof it === "object" ? mapAivoraItem(it as Record<string, unknown>) : null,
    )
    .filter((v): v is AivoraVideo => v !== null);

  const meta =
    root.meta && typeof root.meta === "object" && !Array.isArray(root.meta)
      ? (root.meta as Record<string, unknown>)
      : {};
  const count = typeof meta.count === "number" ? meta.count : rawVideos.length;
  const skippedUnbranded =
    typeof meta.skipped_unbranded === "number" ? meta.skipped_unbranded : 0;
  const nextSince = asNullableString(meta.next_since);

  return {
    videos,
    count,
    skippedUnbranded,
    nextSince,
    isFull: requestedLimit > 0 && count >= requestedLimit,
  };
}

export interface FetchAivoraPageOptions {
  since?: string | null;
  limit?: number;
  /** 测试注入用；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 拉取一页（不重试）；非 2xx 抛 AivoraApiError，网络/超时归为 status 0（可重试） */
export async function fetchAivoraPage(options: FetchAivoraPageOptions = {}): Promise<AivoraPage> {
  const baseUrl = process.env.AIVORA_API_URL?.trim();
  const apiKey = process.env.AIVORA_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error("Aivora 未配置：缺少 AIVORA_API_URL / AIVORA_API_KEY");
  }

  const limit = Math.min(Math.max(options.limit ?? AIVORA_PAGE_LIMIT, 1), AIVORA_PAGE_LIMIT);
  const url = new URL(getAivoraVideosEndpoint(baseUrl));
  url.searchParams.set("status", "completed");
  url.searchParams.set("limit", String(limit));
  if (options.since) url.searchParams.set("since", options.since);

  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new AivoraApiError(0, `Aivora 请求失败（网络/超时）：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 契约 §8：400 修参数不重试；401 检查 token 不重试；503/5xx 指数退避重试
    const hint =
      res.status === 401
        ? "token 缺失/错误（检查 AIVORA_API_KEY，勿自动重试）"
        : res.status === 400
          ? "query 参数非法（修参数，勿重试）"
          : res.status === 503
            ? "Aivora 服务端配置缺失（退避重试并通知 Lucas）"
            : "服务端偶发错误（退避重试，since 不变幂等安全）";
    throw new AivoraApiError(res.status, `Aivora API ${res.status}：${hint} ${body.slice(0, 300)}`.trim());
  }

  const payload = (await res.json().catch(() => {
    throw new AivoraApiError(0, "Aivora 响应不是合法 JSON");
  })) as unknown;
  return parseAivoraPage(payload, limit);
}

const RETRY_DELAYS_MS = [1_000, 3_000];

/** 拉取一页，对可重试错误（5xx/网络/超时）指数退避重试；400/401 直接抛出 */
export async function fetchAivoraPageWithRetry(
  options: FetchAivoraPageOptions = {},
): Promise<AivoraPage> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchAivoraPage(options);
    } catch (e) {
      lastError = e;
      const retryable = e instanceof AivoraApiError && e.retryable;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}
