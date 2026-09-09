/**
 * Tavily 搜索 client —— 全库唯一实现（Supplier Intelligence M1-S2 统一）。
 *
 * 此前 websearch.ts / market-pricing.ts / referenced-standards.ts 各持一份同构复制体
 *（PART A 审计点名的债 D8 邻项）；本文件收敛三者，供 tender-intel 与 supplier-intel 共用，
 * 禁止再出现第四份复制。行为与原三份逐项等价：POST /search、max_results 5、
 * search_depth basic、25s AbortController、任何失败 catch → []（调用方优雅降级）。
 * 注入缝沿仓库惯例：env / fetchImpl 均可注入（测试零网络）。
 */

const TAVILY_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_SNIPPET_MAX_CHARS = 500;

export type TavilyHit = {
  title: string;
  url: string;
  snippet: string;
};

export type TavilyCallStatus =
  | "SUCCESS"
  | "EMPTY"
  | "TIMEOUT"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR";

export interface TavilyDetailedResult {
  status: TavilyCallStatus;
  hits: TavilyHit[];
  httpStatus: number | null;
}

type TavilyOpts = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
  /** 摘录截断（websearch 沿用 300，其余 500——保持既有行为） */
  snippetMaxChars?: number;
};

/**
 * 带错误分级的调用（supplier-intel 用）：TIMEOUT/AUTH_ERROR/RATE_LIMITED/PROVIDER_ERROR/
 * EMPTY/SUCCESS 显式区分——供应商情报侧禁止 catch{}→[] 的静默失败（S2 §37）。
 */
export async function tavilySearchDetailed(
  query: string,
  opts?: TavilyOpts,
): Promise<TavilyDetailedResult> {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const snippetMax = opts?.snippetMaxChars ?? DEFAULT_SNIPPET_MAX_CHARS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: opts?.maxResults ?? DEFAULT_MAX_RESULTS,
        search_depth: "basic",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const httpStatus = res.status ?? null;
      const status: TavilyCallStatus =
        httpStatus === 401 || httpStatus === 403
          ? "AUTH_ERROR"
          : httpStatus === 429
            ? "RATE_LIMITED"
            : "PROVIDER_ERROR";
      return { status, hits: [], httpStatus };
    }
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const hits = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: (r.title ?? r.url ?? "").slice(0, 160),
        url: r.url!,
        snippet: (r.content ?? "").slice(0, snippetMax),
      }));
    return { status: hits.length > 0 ? "SUCCESS" : "EMPTY", hits, httpStatus: res.status ?? 200 };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { status: isAbort ? "TIMEOUT" : "PROVIDER_ERROR", hits: [], httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

/** 兼容 tender-intel 既有行为：任何失败 → []（调用方自有优雅降级语义，S2 不改动） */
export async function tavilySearch(query: string, opts?: TavilyOpts): Promise<TavilyHit[]> {
  const detailed = await tavilySearchDetailed(query, opts);
  return detailed.hits;
}
