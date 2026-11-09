/**
 * PROC-1 官方来源抓取（只读；fetch 可注入，测试不打真网络）。design D4。
 *
 * - 总闸：沿用外部情报开关 TENDER_EXTERNAL_INTEL_ENABLED（未开 → 全部来源 UNAVAILABLE，说明原因）；
 * - 只访问官方开放数据 / 公开页面，不碰任何需要登录的页面；
 * - 每个来源独立超时与页数上限；失败只影响该来源。
 */

import { isExternalIntelEnabled } from "@/lib/tender-intel/canadabuys";
import { computeWatchDigest } from "@/lib/tender-intel/watch";
import {
  ckanQueryUrl,
  CONTRACTS_RESOURCE_DEFAULT,
  emptySourceResult,
  mapAtiSummary,
  mapOpenCanadaContract,
  parseCanadaBuysNoticesCsv,
  parseCkanResponse,
  type AtiSummary,
  type NormalizedRecord,
  type SourceResult,
} from "./sources-pure";
import { matchKeywords, passesListFilter, type SourceKey, type WatchConfig } from "./watch-config";
import { normalizeInstrumentNumber } from "./identity";

export const DEFAULT_CANADABUYS_NOTICE_URLS = [
  "https://canadabuys.canada.ca/opendata/pub/newTenderNotice-nouvelAvisAppelOffres.csv",
  "https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv",
];

/** 来源抓取的 User-Agent；live-check 脚本复用同一个（CanadaBuys 会拒绝不带 UA 的请求） */
export const USER_AGENT = "qingyan-procurement-watch/1.0 (+public open data, read-only)";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_CSV_BYTES = 60 * 1024 * 1024;

export interface KnownInstrumentRef {
  id: string;
  officialNumber: string;
  normalizedNumber: string;
  instrumentClass: string;
  /** 合同历史公开页（来自种子 / 证据） */
  contractHistoryUrls: string[];
}

export interface AdapterContext {
  config: WatchConfig;
  known: KnownInstrumentRef[];
  now: Date;
  deadline: Date;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}

export interface PageSnapshot {
  instrumentId: string;
  url: string;
  digest: string | null;
  httpStatus: number | null;
  error: string | null;
}

export interface AdapterOutput {
  result: SourceResult;
  records: NormalizedRecord[];
  atiSummaries: AtiSummary[];
  pageSnapshots: PageSnapshot[];
  /** 记录 → 命中摘要（sourceKey → hits） */
  matches: Map<string, ReturnType<typeof matchKeywords>>;
}

class FetchFailure extends Error {
  constructor(public readonly status: number | null, message: string) {
    super(message);
  }
}

async function fetchText(ctx: AdapterContext, url: string, maxBytes: number): Promise<string> {
  const remaining = ctx.deadline.getTime() - Date.now();
  if (remaining <= 1000) throw new FetchFailure(null, "本轮时间预算已用尽");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT_MS, remaining));
  try {
    const res = await ctx.fetchImpl(url, { signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "*/*" } });
    if (!res.ok) throw new FetchFailure(res.status, `HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > maxBytes) throw new FetchFailure(res.status, `响应超过 ${Math.round(maxBytes / 1048576)} MB 上限`);
    return text;
  } catch (e) {
    if (e instanceof FetchFailure) throw e;
    const msg = e instanceof Error ? (e.name === "AbortError" ? "请求超时" : e.message) : "请求失败";
    throw new FetchFailure(null, msg.slice(0, 160));
  } finally {
    clearTimeout(timer);
  }
}

function emptyOutput(source: SourceKey, now: Date): AdapterOutput {
  return { result: emptySourceResult(source, now), records: [], atiSummaries: [], pageSnapshots: [], matches: new Map() };
}

function finish(out: AdapterOutput): AdapterOutput {
  out.result.finishedAt = new Date().toISOString();
  return out;
}

/** 总闸未开时的统一结果 */
export function gateClosedOutput(source: SourceKey, now: Date): AdapterOutput {
  const out = emptyOutput(source, now);
  out.result.status = "UNAVAILABLE";
  out.result.note = "外部情报总闸 TENDER_EXTERNAL_INTEL_ENABLED 未开启，未发起任何外部请求";
  return finish(out);
}

function recordPassesFilters(r: NormalizedRecord, config: WatchConfig, now: Date, kind: "notice" | "contract") {
  const m = matchKeywords(
    {
      texts: [r.title, r.description, r.categoryText, r.raw["title-titre-fra"], r.raw.description_fr],
      categoryCodes: r.categoryCodes,
    },
    config.filters,
  );
  if (!m.matched) return { ok: false as const, m };
  if (!passesListFilter([r.contractingInstitution, r.buyingInstitution], config.filters.institutions)) return { ok: false as const, m };
  if (kind === "notice" && !passesListFilter(r.regions, config.filters.regions)) return { ok: false as const, m };
  if (kind === "notice" && r.publishedAt) {
    const cutoff = now.getTime() - config.filters.lookbackDays * 86400_000;
    if (new Date(r.publishedAt).getTime() < cutoff) return { ok: false as const, m };
  }
  if (kind === "contract" && r.awardDate) {
    const cutoff = now.getTime() - config.filters.contractLookbackYears * 365.25 * 86400_000;
    if (new Date(r.awardDate).getTime() < cutoff) return { ok: false as const, m };
  }
  return { ok: true as const, m };
}

// ───────────────────── CanadaBuys 招标公告 ─────────────────────

export async function fetchCanadaBuysNotices(ctx: AdapterContext): Promise<AdapterOutput> {
  const out = emptyOutput("CANADABUYS_TENDER_NOTICES", ctx.now);
  const urls = (ctx.env.PROCUREMENT_CANADABUYS_NOTICE_URLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_CANADABUYS_NOTICE_URLS).slice(
    0,
    ctx.config.limits.maxPagesPerSource,
  );
  const failures: string[] = [];
  let parseFailures = 0;
  let successes = 0;
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const text = await fetchText(ctx, url, MAX_CSV_BYTES);
      out.result.pagesFetched++;
      const parsed = parseCanadaBuysNoticesCsv(text);
      if (!parsed.ok) {
        parseFailures++;
        failures.push(`${url.split("/").pop()}：${parsed.reason}（${parsed.missingColumns.join("、")}）`);
        continue;
      }
      successes++;
      out.result.fetched += parsed.rowCount;
      for (const r of parsed.records) {
        if (seen.has(r.sourceKey)) continue;
        seen.add(r.sourceKey);
        const f = recordPassesFilters(r, ctx.config, ctx.now, "notice");
        if (!f.ok) continue;
        out.records.push(r);
        out.matches.set(r.sourceKey, f.m);
      }
    } catch (e) {
      failures.push(`${url.split("/").pop()}：${e instanceof Error ? e.message : "失败"}`);
    }
  }
  out.result.matched = out.records.length;
  if (successes === urls.length) out.result.status = "SUCCESS";
  else if (successes > 0) out.result.status = "PARTIAL";
  else out.result.status = parseFailures > 0 ? "PARSE_FAILED" : "UNAVAILABLE";
  out.result.note = failures.length ? failures.join("；").slice(0, 500) : null;
  return finish(out);
}

// ───────────────────── Open Government 合同披露 ─────────────────────

async function ckanPage(ctx: AdapterContext, url: string): Promise<{ ok: true; records: Array<Record<string, unknown>>; total: number | null } | { ok: false; parse: boolean; reason: string }> {
  try {
    const text = await fetchText(ctx, url, 20 * 1024 * 1024);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, parse: true, reason: "响应不是 JSON" };
    }
    const p = parseCkanResponse(json);
    return p.ok ? p : { ok: false, parse: true, reason: p.reason };
  } catch (e) {
    return { ok: false, parse: false, reason: e instanceof Error ? e.message : "失败" };
  }
}

export async function fetchOpenCanadaContracts(ctx: AdapterContext): Promise<AdapterOutput> {
  const out = emptyOutput("OPEN_CANADA_CONTRACTS", ctx.now);
  const resource = ctx.env.EXTERNAL_INTEL_CONTRACTS_RESOURCE_ID?.trim() || CONTRACTS_RESOURCE_DEFAULT;
  const limit = ctx.config.limits.maxRowsPerPage;
  const budget = ctx.config.limits.maxPagesPerSource;
  const failures: string[] = [];
  let okQueries = 0;
  let parseFail = 0;
  let queries = 0;
  const seen = new Set<string>();
  const add = (row: Record<string, unknown>, viaRefresh: boolean) => {
    const r = mapOpenCanadaContract(row, resource);
    if (!r || seen.has(r.sourceKey)) return;
    seen.add(r.sourceKey);
    if (viaRefresh) {
      out.records.push(r);
      out.matches.set(r.sourceKey, matchKeywords({ texts: [r.title, r.description] }, ctx.config.filters));
      return;
    }
    const f = recordPassesFilters(r, ctx.config, ctx.now, "contract");
    if (!f.ok) return;
    out.records.push(r);
    out.matches.set(r.sourceKey, f.m);
  };
  const run = async (url: string, viaRefresh: boolean) => {
    queries++;
    const page = await ckanPage(ctx, url);
    out.result.pagesFetched++;
    if (!page.ok) {
      if (page.parse) parseFail++;
      failures.push(page.reason);
      return;
    }
    okQueries++;
    out.result.fetched += page.records.length;
    for (const row of page.records) add(row, viaRefresh);
    if (page.total !== null && page.total > page.records.length) out.result.truncated = true;
  };

  // 1) 已知合同 / SO 刷新：按编号精确过滤；并取挂在该 SO 下的 call-up
  const refreshTargets = ctx.known.filter((k) => k.instrumentClass === "AWARD_INSTRUMENT");
  for (const k of refreshTargets) {
    if (queries >= budget * 2) {
      out.result.truncated = true;
      break;
    }
    const base = normalizeInstrumentNumber(k.officialNumber).raw.replace(/[-/]\d{3}$/, "");
    await run(ckanQueryUrl(resource, { filters: { procurement_id: base }, limit }), true);
    await run(ckanQueryUrl(resource, { filters: { standing_offer_number: base }, limit, sort: "contract_date desc" }), true);
  }

  // 2) 关键词发现（字段限定 q；全文 q 在此资源失灵——仓库实测）
  const productTerms = ctx.config.filters.keywords.filter((k) => /^[a-z ]+$/i.test(k));
  const discovery = productTerms.slice(0, budget);
  if (productTerms.length > discovery.length) out.result.truncated = true;
  for (const term of discovery) {
    await run(ckanQueryUrl(resource, { q: { description_en: term }, limit, sort: "contract_date desc" }), false);
  }

  out.result.matched = out.records.length;
  if (queries === 0) out.result.status = "SUCCESS";
  else if (okQueries === queries) out.result.status = "SUCCESS";
  else if (okQueries > 0) out.result.status = "PARTIAL";
  else out.result.status = parseFail > 0 ? "PARSE_FAILED" : "UNAVAILABLE";
  const notes: string[] = [];
  if (failures.length) notes.push(`${failures.length} 次查询失败：${[...new Set(failures)].join("；")}`.slice(0, 300));
  if (productTerms.length > discovery.length) notes.push(`关键词 ${productTerms.length} 个，本轮按页数上限只查询前 ${discovery.length} 个（截断待续）`);
  out.result.note = notes.join("；") || null;
  return finish(out);
}

// ───────────────────── Completed ATI 摘要 ─────────────────────

export async function fetchAtiSummaries(ctx: AdapterContext): Promise<AdapterOutput> {
  const out = emptyOutput("OPEN_CANADA_ATI_SUMMARIES", ctx.now);
  const resource = ctx.env.PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID?.trim();
  if (!resource) {
    out.result.status = "SKIPPED";
    out.result.note = "未配置 PROCUREMENT_ATI_SUMMARIES_RESOURCE_ID（Completed ATI 摘要的 CKAN 资源 ID 未在本环境核实）；请在 https://search.open.canada.ca/ati/ 人工检索";
    return finish(out);
  }
  const limit = Math.min(ctx.config.limits.maxRowsPerPage, 100);
  const budget = ctx.config.limits.maxPagesPerSource;
  const seen = new Set<string>();
  let queries = 0;
  let okQueries = 0;
  let parseFail = 0;
  const failures: string[] = [];
  const terms = [
    ...ctx.known.map((k) => normalizeInstrumentNumber(k.officialNumber).raw.replace(/[-/]\d{3}$/, "")),
    ...ctx.config.filters.keywords.filter((k) => /^[a-z ]+$/i.test(k)).slice(0, 3),
  ].slice(0, budget);
  for (const term of terms) {
    queries++;
    const page = await ckanPage(ctx, ckanQueryUrl(resource, { q: { summary_en: term }, limit }));
    out.result.pagesFetched++;
    if (!page.ok) {
      if (page.parse) parseFail++;
      failures.push(page.reason);
      continue;
    }
    okQueries++;
    out.result.fetched += page.records.length;
    for (const row of page.records) {
      const s = mapAtiSummary(row, resource);
      if (!s || seen.has(s.sourceKey)) continue;
      seen.add(s.sourceKey);
      out.atiSummaries.push(s);
    }
  }
  out.result.matched = out.atiSummaries.length;
  if (okQueries === queries) out.result.status = "SUCCESS";
  else if (okQueries > 0) out.result.status = "PARTIAL";
  else out.result.status = parseFail > 0 ? "PARSE_FAILED" : "UNAVAILABLE";
  out.result.note = failures.length ? [...new Set(failures)].join("；").slice(0, 300) : null;
  return finish(out);
}

// ───────────────────── CanadaBuys 合同历史公开页 ─────────────────────

export async function fetchContractHistoryPages(ctx: AdapterContext): Promise<AdapterOutput> {
  const out = emptyOutput("CANADABUYS_CONTRACT_HISTORY_PAGE", ctx.now);
  const targets = ctx.known.flatMap((k) =>
    k.contractHistoryUrls
      .filter((u) => /^https:\/\/canadabuys\.canada\.ca\//i.test(u))
      .map((url) => ({ instrumentId: k.id, url })),
  );
  const budget = ctx.config.limits.maxPagesPerSource * 2;
  if (targets.length > budget) out.result.truncated = true;
  let okCount = 0;
  for (const t of targets.slice(0, budget)) {
    try {
      const html = await fetchText(ctx, t.url, 10 * 1024 * 1024);
      out.result.pagesFetched++;
      okCount++;
      out.pageSnapshots.push({ ...t, digest: computeWatchDigest(html), httpStatus: 200, error: null });
    } catch (e) {
      out.result.pagesFetched++;
      out.pageSnapshots.push({
        ...t,
        digest: null,
        httpStatus: e instanceof FetchFailure ? e.status : null,
        error: e instanceof Error ? e.message : "失败",
      });
    }
  }
  out.result.fetched = okCount;
  out.result.matched = okCount;
  const tried = Math.min(targets.length, budget);
  out.result.status = tried === 0 ? "SUCCESS" : okCount === tried ? "SUCCESS" : okCount > 0 ? "PARTIAL" : "UNAVAILABLE";
  const errs = out.pageSnapshots.filter((s) => s.error).map((s) => s.error);
  out.result.note = tried === 0 ? "没有需要刷新的合同历史页" : errs.length ? `${errs.length} 个页面失败：${[...new Set(errs)].join("；")}`.slice(0, 300) : "仅做页面哈希变更检测，不解析字段";
  return finish(out);
}

export const ADAPTERS: Record<SourceKey, (ctx: AdapterContext) => Promise<AdapterOutput>> = {
  CANADABUYS_TENDER_NOTICES: fetchCanadaBuysNotices,
  OPEN_CANADA_CONTRACTS: fetchOpenCanadaContracts,
  OPEN_CANADA_ATI_SUMMARIES: fetchAtiSummaries,
  CANADABUYS_CONTRACT_HISTORY_PAGE: fetchContractHistoryPages,
};

export function externalFetchAllowed(env: NodeJS.ProcessEnv): boolean {
  return isExternalIntelEnabled(env);
}
