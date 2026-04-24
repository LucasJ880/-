/**
 * Trade 研究 — 抓取层 Provider（Firecrawl 云 + 可扩展）
 *
 * 仅用于 research 输入增强：map + scrape，不做整站 crawl / agent。
 * 失败时由调用方回退到 tools.fetchPageContent。
 */

import type { ResearchSourceKind } from "@/lib/trade/research-bundle";

const FIRECRAWL_API_BASE = "https://api.firecrawl.dev";

export interface ResearchFetchedPage {
  url: string;
  title: string;
  markdown: string;
  kind: ResearchSourceKind;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function maxResearchPages(): number {
  const n = parseInt(process.env.FIRECRAWL_MAX_RESEARCH_PAGES ?? "5", 10);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(3, n));
}

function timeoutMs(): number {
  const n = parseInt(process.env.FIRECRAWL_TIMEOUT_MS ?? "25000", 10);
  if (!Number.isFinite(n)) return 25000;
  return Math.min(60000, Math.max(8000, n));
}

export function isFirecrawlConfigured(): boolean {
  return envBool("FIRECRAWL_ENABLED", true) && !!process.env.FIRECRAWL_API_KEY?.trim();
}

/** 规范为可 map/scrape 的站点根 URL（含协议） */
export function normalizeSiteRootUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`);
    if (!u.hostname) return null;
    u.hash = "";
    u.search = "";
    u.pathname = "";
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, "");
}

function sameSite(a: string, b: string): boolean {
  try {
    return stripWww(new URL(a).hostname) === stripWww(new URL(b).hostname);
  } catch {
    return false;
  }
}

function normalizeUrlString(a: string): string {
  try {
    const u = new URL(a);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${path}`;
  } catch {
    return a;
  }
}

function isLikelyHomepage(url: string, root: string): boolean {
  try {
    const u = new URL(url);
    const r = new URL(root);
    if (stripWww(u.hostname) !== stripWww(r.hostname)) return false;
    const p = (u.pathname || "/").replace(/\/+$/, "") || "/";
    return p === "/";
  } catch {
    return false;
  }
}

/** 从 pathname 推断来源类型（用于 sources.kind） */
export function classifyPathKind(pathname: string): ResearchSourceKind {
  const p = pathname.toLowerCase() || "/";
  if (p === "/" || p === "") return "homepage";
  if (/(^|\/)about(-us)?(\/|$)/i.test(p)) return "about";
  if (/(^|\/)products?(\/|$)/i.test(p) || /\/(shop|catalog|store)(\/|$)/i.test(p)) return "products";
  if (/(^|\/)collections?(\/|$)/i.test(p)) return "collections";
  if (/(^|\/)contact(-us)?(\/|$)/i.test(p)) return "contact";
  if (/(^|\/)(certifications?|compliance|gdpr|iso)(\/|$)/i.test(p)) return "compliance";
  if (/(^|\/)(news|press|media)(\/|$)/i.test(p)) return "news";
  if (/(^|\/)blog(\/|$)/i.test(p)) return "blog";
  return "site_page";
}

function scorePathForSelection(pathname: string): number {
  const k = classifyPathKind(pathname);
  const tier: Record<ResearchSourceKind, number> = {
    homepage: 100,
    about: 92,
    products: 90,
    collections: 88,
    contact: 85,
    compliance: 84,
    news: 72,
    blog: 70,
    site_page: 40,
    search: 0,
  };
  return tier[k] ?? 40;
}

export interface MapLink {
  url: string;
  title?: string;
}

async function firecrawlPost(path: string, body: unknown): Promise<unknown> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("no_api_key");
  const ms = timeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${FIRECRAWL_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`firecrawl_non_json:${res.status}`);
    }
    if (!res.ok) {
      const err = (json as { error?: string })?.error ?? `http_${res.status}`;
      throw new Error(err);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** Firecrawl /v2/map — 返回站点链接列表（失败抛错，由上层捕获） */
export async function mapSite(siteRootUrl: string): Promise<MapLink[]> {
  const json = (await firecrawlPost("/v2/map", { url: siteRootUrl })) as Record<string, unknown>;
  if (json.success === false) return [];
  const links = json.links;
  if (!Array.isArray(links)) return [];
  const out: MapLink[] = [];
  for (const row of links) {
    if (typeof row === "string") {
      out.push({ url: row });
    } else if (row && typeof row === "object" && "url" in row) {
      const u = String((row as { url?: unknown }).url ?? "");
      if (u) out.push({ url: u, title: String((row as { title?: unknown }).title ?? "") });
    }
  }
  return out;
}

/** Firecrawl /v2/scrape — 单页 markdown */
export async function scrapePage(url: string): Promise<{ markdown: string; title: string; ok: boolean }> {
  try {
    const json = (await firecrawlPost("/v2/scrape", {
      url,
      formats: ["markdown"],
    })) as Record<string, unknown>;
    if (json.success === false) return { markdown: "", title: "", ok: false };
    const data = json.data;
    let markdown = "";
    let title = "";
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      markdown = String(d.markdown ?? d.content ?? "");
      const meta = d.metadata;
      if (meta && typeof meta === "object") {
        title = String((meta as { title?: unknown }).title ?? "");
      }
    }
    if (!markdown && typeof json.markdown === "string") {
      markdown = json.markdown as string;
    }
    const ok = markdown.trim().length > 0;
    return { markdown, title: title || url, ok };
  } catch {
    return { markdown: "", title: "", ok: false };
  }
}

/**
 * 从 map 结果中选 3–5 个待 scrape URL（含首页根路径优先）。
 * 不整站深爬；仅同域链接。
 */
export function selectResearchUrlsFromMap(
  siteRoot: string,
  mapLinks: MapLink[],
  maxPages: number,
): string[] {
  const root = normalizeSiteRootUrl(siteRoot);
  if (!root) return [];

  const candidates: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  const push = (url: string, score: number) => {
    const n = normalizeUrlString(url);
    if (seen.has(n)) return;
    if (!sameSite(n, root)) return;
    seen.add(n);
    candidates.push({ url: n, score });
  };

  try {
    const rootPath = (new URL(root).pathname || "/").replace(/\/+$/, "") || "/";
    push(root, scorePathForSelection(rootPath));
  } catch {
    push(root, 100);
  }

  for (const L of mapLinks) {
    try {
      const u = new URL(L.url);
      if (!sameSite(L.url, root)) continue;
      const path = u.pathname || "/";
      push(L.url, scorePathForSelection(path) + (L.title ? 1 : 0));
    } catch {
      continue;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const urls = candidates.map((c) => c.url);
  return urls.slice(0, maxPages);
}

/**
 * 对 canonical 站点执行 map → 选 URL → scrape，失败返回空数组（不抛到 research 外层）。
 */
export async function collectResearchPages(siteRootUrl: string | null): Promise<{
  pages: ResearchFetchedPage[];
  usedFirecrawl: boolean;
}> {
  if (!isFirecrawlConfigured() || !siteRootUrl) {
    return { pages: [], usedFirecrawl: false };
  }
  const root = normalizeSiteRootUrl(siteRootUrl);
  if (!root) return { pages: [], usedFirecrawl: false };

  const max = maxResearchPages();
  let urls: string[] = [];
  try {
    const links = await mapSite(root);
    urls = selectResearchUrlsFromMap(root, links, max);
  } catch (e) {
    console.warn("[trade/research-fetch-provider] map failed:", e);
    urls = [root];
  }
  if (urls.length === 0) urls = [root];

  const pages: ResearchFetchedPage[] = [];
  for (const url of urls) {
    try {
      const scraped = await scrapePage(url);
      if (!scraped.ok) continue;
      let kind: ResearchSourceKind = "site_page";
      try {
        kind = classifyPathKind(new URL(url).pathname || "/");
      } catch {
        kind = "site_page";
      }
      if (isLikelyHomepage(url, root)) {
        kind = "homepage";
      }
      pages.push({
        url,
        title: scraped.title || url,
        markdown: scraped.markdown,
        kind,
      });
    } catch (e) {
      console.warn("[trade/research-fetch-provider] scrape failed:", url, e);
    }
  }

  return { pages, usedFirecrawl: pages.length > 0 };
}
