/**
 * Trade 外贸获客 — 外部工具层
 *
 * 借鉴 sales-outreach-automation-langgraph 的 search_tools + markdown_scraper
 * 实现 Serper Google 搜索 + 网页内容抓取
 */

// ── Google Search via Serper ────────────────────────────────

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export async function searchGoogle(
  query: string,
  opts?: { num?: number; gl?: string },
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[trade/tools] SERPER_API_KEY not set, returning empty results");
    return [];
  }

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: opts?.num ?? 10,
      gl: opts?.gl,
    }),
  });

  if (!res.ok) {
    console.error(`[trade/tools] Serper error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const organic = data.organic ?? [];
  return organic.map((item: Record<string, unknown>, i: number) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    snippet: String(item.snippet ?? ""),
    position: i + 1,
  }));
}

// ── Web Page Content Fetch ──────────────────────────────────

export interface PageContent {
  url: string;
  title: string;
  text: string;
  ok: boolean;
}

export async function fetchPageContent(url: string): Promise<PageContent> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; QingyanBot/1.0; +https://qingyan.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { url, title: "", text: "", ok: false };
    }

    const html = await res.text();
    const title = extractTitle(html);
    const text = htmlToText(html).slice(0, 8000);

    return { url, title, text, ok: true };
  } catch {
    return { url, title: "", text: "", ok: false };
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Discover Prospects from Search ──────────────────────────

export interface DiscoveredCompany {
  companyName: string;
  website: string;
  snippet: string;
  country?: string;
}

export async function discoverProspects(
  keywords: string[],
  maxPerKeyword: number = 5,
): Promise<DiscoveredCompany[]> {
  const seen = new Set<string>();
  const results: DiscoveredCompany[] = [];

  for (const kw of keywords.slice(0, 5)) {
    const searchResults = await searchGoogle(kw, { num: maxPerKeyword });

    for (const r of searchResults) {
      try {
        const domain = new URL(r.link).hostname.replace(/^www\./, "");
        if (seen.has(domain)) continue;
        seen.add(domain);

        const companyName = extractCompanyName(r.title, domain);
        results.push({
          companyName,
          website: r.link,
          snippet: r.snippet,
        });
      } catch {
        continue;
      }
    }
  }

  return results;
}

function extractCompanyName(title: string, domain: string): string {
  const cleaned = title
    .replace(/\s*[-–—|·]\s*.*/g, "")
    .replace(/\s*(Home|About|Products|Welcome).*$/i, "")
    .trim();

  if (cleaned.length >= 3 && cleaned.length <= 80) return cleaned;

  return domain
    .replace(/\.(com|net|org|io|co|biz|info).*$/i, "")
    .replace(/[.-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
