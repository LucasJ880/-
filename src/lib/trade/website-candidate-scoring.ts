/**
 * Serper 候选官网 — 规则评分（不依赖 LLM）
 */

import type { SearchResult } from "@/lib/trade/tools";

export const AUTO_WEBSITE_CONFIDENCE_THRESHOLD = 0.75;

export interface WebsiteCandidateJson {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  source: string;
  rank: number;
  type: string;
  confidence: number;
  reasons: string[];
  rejectedReason?: string | null;
}

const BAD_HOST_SUBSTRINGS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "alibaba.com",
  "made-in-china.com",
  "globalsources.com",
  "yellowpages",
  "yelp.com",
  "crunchbase.com",
  "indeed.com",
  "glassdoor.com",
  "wikipedia.org",
  "amazon.",
  "ebay.",
  "etsy.com",
  "dhgate.com",
  "1688.com",
  "jd.com",
  "tmall.com",
];

const BAD_PATH_HINTS = ["/news/", "/blog/", "/press/", "/article/", "/jobs/", "/careers/", "/job/", ".pdf"];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function extractDomain(link: string): string | null {
  try {
    const u = new URL(link.startsWith("http") ? link : `https://${link}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathDepth(link: string): number {
  try {
    const u = new URL(link.startsWith("http") ? link : `https://${link}`);
    const segs = u.pathname.split("/").filter(Boolean);
    return segs.length;
  } catch {
    return 99;
  }
}

function hostLooksBad(domain: string): string | null {
  const d = domain.toLowerCase();
  for (const b of BAD_HOST_SUBSTRINGS) {
    if (d.includes(b)) return `blocked_host:${b}`;
  }
  return null;
}

function pathLooksBad(link: string): string | null {
  const low = link.toLowerCase();
  for (const h of BAD_PATH_HINTS) {
    if (low.includes(h)) return `blocked_path:${h}`;
  }
  if (pathDepth(link) > 4) return "path_too_deep";
  return null;
}

function tokenizeCompany(name: string): string[] {
  return norm(name)
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function containsAny(hay: string, needles: string[]): boolean {
  const h = norm(hay);
  return needles.some((n) => n.length >= 2 && h.includes(n));
}

/**
 * 将 Serper organic 结果转为候选并打分。
 */
export function scoreWebsiteCandidates(
  companyName: string,
  country: string | null,
  productKeywords: string[],
  results: SearchResult[],
): WebsiteCandidateJson[] {
  const companyTokens = tokenizeCompany(companyName);
  const primary = companyTokens[0] ?? norm(companyName);

  const out: WebsiteCandidateJson[] = [];

  for (const r of results) {
    if (!r.link?.trim()) continue;
    let url = r.link.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const domain = extractDomain(url);
    if (!domain) continue;

    const reasons: string[] = [];
    let score = 0.35;
    let rejected: string | null = null;

    const badHost = hostLooksBad(domain);
    if (badHost) {
      rejected = badHost;
      score -= 0.55;
      reasons.push(`减分: ${badHost}`);
    }

    const badPath = pathLooksBad(url);
    if (badPath) {
      if (!rejected) rejected = badPath;
      score -= 0.25;
      reasons.push(`减分: ${badPath}`);
    }

    const titleLow = norm(r.title);
    const snippetLow = norm(r.snippet);
    const domainLow = domain;

    if (primary && domainLow.includes(primary)) {
      score += 0.22;
      reasons.push("加分: 域名含公司主要词");
    }
    if (companyTokens.length > 1 && companyTokens.slice(1).some((t) => domainLow.includes(t) || titleLow.includes(t))) {
      score += 0.08;
      reasons.push("加分: 域名或标题含公司词片段");
    }
    if (containsAny(titleLow + " " + snippetLow, companyTokens)) {
      score += 0.12;
      reasons.push("加分: 标题或摘要提及公司");
    }
    if (productKeywords.length && containsAny(titleLow + " " + snippetLow, productKeywords)) {
      score += 0.1;
      reasons.push("加分: 标题或摘要含产品/行业词");
    }

    if (country?.trim()) {
      const c = norm(country);
      if (c.length >= 2 && (domain.endsWith(`.${c}`) || snippetLow.includes(c) || titleLow.includes(c))) {
        score += 0.06;
        reasons.push("加分: 国家与域名/文案相关");
      }
    }

    if (pathDepth(url) <= 2 && !/\/(tag|category|search|list)/i.test(url)) {
      score += 0.06;
      reasons.push("加分: 较浅路径或根域");
    }

    if (/directory|listing|b2b|marketplace|wholesale platform/i.test(titleLow + snippetLow)) {
      score -= 0.2;
      reasons.push("减分: 疑似目录/B2B 平台文案");
    }

    if (/news|press release|announces|ipo/i.test(titleLow) && !containsAny(titleLow, companyTokens)) {
      score -= 0.15;
      reasons.push("减分: 标题像新闻且未突出公司");
    }

    score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

    let type = "website";
    if (rejected) type = "rejected";

    out.push({
      url,
      domain,
      title: r.title,
      snippet: r.snippet,
      source: "serper",
      rank: r.position,
      type,
      confidence: score,
      reasons,
      rejectedReason: rejected,
    });
  }

  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 5);
}

export function shouldAutoPickCandidate(top: WebsiteCandidateJson | undefined): boolean {
  if (!top) return false;
  if (top.rejectedReason) return false;
  if (top.confidence < AUTO_WEBSITE_CONFIDENCE_THRESHOLD) return false;
  return true;
}

export function buildSerpWebsiteQuery(companyName: string, country: string | null, targetMarket: string | null): string {
  const parts = [`"${companyName.trim()}"`];
  if (country?.trim()) parts.push(country.trim());
  if (targetMarket?.trim()) {
    const t = targetMarket.trim().slice(0, 80);
    parts.push(t);
  }
  parts.push("official website");
  return parts.join(" ");
}

export function extractProductKeywords(productDesc: string, targetMarket: string): string[] {
  const raw = `${productDesc} ${targetMarket}`;
  return norm(raw)
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 12);
}
