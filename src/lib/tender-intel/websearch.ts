/**
 * M2 — 外部情报：Web 搜索（竞争对手/案例/授标信息）
 *
 * 标准管线契约（与 M1 相同）：自动提取 → 多线检索 → 交叉验证 → 人工确认。
 * 搜索源：Tavily（TAVILY_API_KEY；未配置或总闸 OFF → 零出站，优雅降级）。
 * 证据纪律：finding = {标题, URL, 摘录}，只作研究线索；确认后才写入调查结论
 *（competitors 列表），绝不自动当事实。
 */

import { isExternalIntelEnabled } from "./canadabuys";
import { tavilySearch as sharedTavilySearch } from "./tavily-client";

const TIMEOUT_MS = 25_000;
const MAX_PER_LINE = 5;

export type WebFinding = {
  title: string;
  url: string;
  snippet: string;
  /** 命中的检索线 */
  sourceQuery: string;
};

export type RankedWebCandidate = {
  /** 归并键：域名 */
  domain: string;
  hitQueries: string[];
  score: number;
  findings: WebFinding[];
};

export type WebIntelResult = {
  ok: boolean;
  queries: string[];
  candidates: RankedWebCandidate[];
  note: string | null;
  fetchedAt: string;
};

export function hasWebSearchKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.TAVILY_API_KEY ?? "").trim());
}

/** 纯函数：多线 Web 检索词（中标方线 / 产品+机构线 / 招标编号线） */
export function deriveWebQueries(input: {
  confirmedWinner: string | null;
  productPhrase: string | null;
  buyerPhrase: string | null;
  solicitationNumber: string | null;
}): string[] {
  const out: string[] = [];
  if (input.confirmedWinner) {
    out.push(`"${input.confirmedWinner}" ${input.productPhrase ?? "tender award"}`.trim());
    out.push(`"${input.confirmedWinner}" supplier case study`);
  }
  if (input.productPhrase && input.buyerPhrase) {
    out.push(`${input.productPhrase} ${input.buyerPhrase} awarded contract`);
  } else if (input.productPhrase) {
    out.push(`${input.productPhrase} tender awarded Canada`);
  }
  if (input.solicitationNumber) {
    out.push(`"${input.solicitationNumber}" award`);
  }
  const seen = new Set<string>();
  return out
    .map((q) => q.replace(/\s+/g, " ").trim())
    .filter((q) => {
      const k = q.toLowerCase();
      if (!q || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/** 纯函数：按域名跨线交叉验证排序 */
export function rankWebFindings(
  lines: Array<{ query: string; findings: WebFinding[] }>,
): RankedWebCandidate[] {
  const byDomain = new Map<string, RankedWebCandidate>();
  for (const line of lines) {
    for (const f of line.findings) {
      const d = domainOf(f.url);
      const cur = byDomain.get(d);
      if (cur) {
        if (!cur.hitQueries.includes(line.query)) cur.hitQueries.push(line.query);
        if (cur.findings.length < 3) cur.findings.push(f);
      } else {
        byDomain.set(d, { domain: d, hitQueries: [line.query], score: 0, findings: [f] });
      }
    }
  }
  const ranked = [...byDomain.values()].map((c) => ({
    ...c,
    score: c.hitQueries.length * 10 + Math.min(c.findings.length, 3),
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

async function tavilySearch(
  query: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<WebFinding[]> {
  // M1-S2 起统一走共享 client（行为等价：max 5 / basic / 25s / catch→[]，snippet 300）
  const hits = await sharedTavilySearch(query, {
    env,
    fetchImpl,
    maxResults: MAX_PER_LINE,
    timeoutMs: TIMEOUT_MS,
    snippetMaxChars: 300,
  });
  return hits.map((h) => ({ ...h, sourceQuery: query }));
}

/** 多线 Web 检索 + 交叉验证（总闸 OFF 或无 key → 零出站） */
export async function autoWebIntel(input: {
  queries: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<WebIntelResult> {
  const env = input.env ?? process.env;
  const fetchedAt = new Date().toISOString();
  if (!isExternalIntelEnabled(env)) {
    return { ok: false, queries: [], candidates: [], note: "外部情报开关未启用", fetchedAt };
  }
  if (!hasWebSearchKey(env)) {
    return { ok: false, queries: [], candidates: [], note: "未配置搜索 API Key（TAVILY_API_KEY）", fetchedAt };
  }
  const queries = input.queries.filter((q) => q.trim()).slice(0, 4);
  if (queries.length === 0) {
    return { ok: false, queries: [], candidates: [], note: "未提取到可用检索词", fetchedAt };
  }
  const f = input.fetchImpl ?? fetch;
  const lines: Array<{ query: string; findings: WebFinding[] }> = [];
  for (const q of queries) {
    lines.push({ query: q, findings: await tavilySearch(q, env, f) });
  }
  const candidates = rankWebFindings(lines).slice(0, 8);
  return {
    ok: true,
    queries,
    candidates,
    note: candidates.length === 0 ? "各检索线均未命中" : null,
    fetchedAt,
  };
}
