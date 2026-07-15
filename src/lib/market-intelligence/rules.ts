import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { MapLink } from "@/lib/trade/research-fetch-provider";

const HIGH_SIGNAL_TERMS = [
  "price",
  "pricing",
  "discount",
  "promotion",
  "offer",
  "financing",
  "quote",
  "book",
  "appointment",
  "cta",
  "servicearea",
  "installation",
  "delivery",
  "leadtime",
  "warranty",
  "价格",
  "折扣",
  "优惠",
  "预约",
  "安装",
  "交付",
  "质保",
];

const MEDIUM_SIGNAL_TERMS = [
  "product",
  "collection",
  "category",
  "headline",
  "valueproposition",
  "trustsignal",
  "review",
  "testimonial",
  "case",
  "gallery",
  "产品",
  "品类",
  "案例",
  "评价",
  "卖点",
];

const PAGE_BUCKETS = [
  { id: "offer", pattern: /\/(sale|promo|offer|special|deal|pricing|quote|financ)/i, score: 98 },
  { id: "product", pattern: /\/(product|products|collection|collections|shop|store|catalog)/i, score: 94 },
  { id: "proof", pattern: /\/(case|project|gallery|review|testimonial|portfolio)/i, score: 90 },
  { id: "convert", pattern: /\/(book|appointment|consult|estimate|contact|measure)/i, score: 88 },
  { id: "content", pattern: /\/(blog|news|resource|guide|inspiration)/i, score: 72 },
] as const;

export function normalizeCompetitorUrl(raw: string): {
  websiteUrl: string;
  normalizedDomain: string;
} {
  const value = raw.trim();
  const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("竞品网址必须使用 http 或 https");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const normalizedDomain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!normalizedDomain.includes(".")) throw new Error("请输入有效的竞品网站域名");
  return { websiteUrl: parsed.toString(), normalizedDomain };
}

function sameDomain(url: string, domain: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") === domain;
  } catch {
    return false;
  }
}

function normalizedUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

/** Select a small, diverse set of decision-relevant pages to control Firecrawl spend. */
export function selectCompetitorUrls(
  websiteUrl: string,
  links: MapLink[],
  maxPages = 5,
): string[] {
  const root = normalizeCompetitorUrl(websiteUrl);
  const candidates = new Map<string, { url: string; score: number; bucket: string }>();

  const add = (raw: string, title = "") => {
    if (!sameDomain(raw, root.normalizedDomain)) return;
    let url: string;
    try {
      url = normalizedUrl(raw);
    } catch {
      return;
    }
    const parsed = new URL(url);
    const searchText = `${parsed.pathname} ${title}`.toLowerCase();
    const matched = PAGE_BUCKETS.find((item) => item.pattern.test(searchText));
    const isHome = parsed.pathname === "/";
    const bucket = isHome ? "home" : matched?.id ?? "other";
    const score = isHome ? 100 : matched?.score ?? 35;
    const current = candidates.get(url);
    if (!current || score > current.score) candidates.set(url, { url, score, bucket });
  };

  add(root.websiteUrl, "homepage");
  for (const link of links) add(link.url, link.title ?? "");

  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
  const selected: string[] = [];
  const usedBuckets = new Set<string>();
  for (const candidate of sorted) {
    if (selected.length >= maxPages) break;
    if (candidate.bucket === "other" || usedBuckets.has(candidate.bucket)) continue;
    selected.push(candidate.url);
    usedBuckets.add(candidate.bucket);
  }
  for (const candidate of sorted) {
    if (selected.length >= maxPages) break;
    if (!selected.includes(candidate.url)) selected.push(candidate.url);
  }
  return selected;
}

function searchableChangeText(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  } catch {
    return "";
  }
}

export type MarketSignalSeverity = "low" | "medium" | "high";

export function classifyMarketChange(input: {
  pageStatus: string;
  diff?: unknown;
  judgment?: unknown;
}): { severity: MarketSignalSeverity; signalType: string } {
  const text = searchableChangeText({ diff: input.diff, judgment: input.judgment });
  if (input.pageStatus === "removed") return { severity: "high", signalType: "page_removed" };
  if (HIGH_SIGNAL_TERMS.some((term) => text.includes(term))) {
    return { severity: "high", signalType: "commercial_change" };
  }
  if (input.pageStatus === "new") return { severity: "medium", signalType: "page_added" };
  if (MEDIUM_SIGNAL_TERMS.some((term) => text.includes(term))) {
    return { severity: "medium", signalType: "product_or_positioning_change" };
  }
  return { severity: "low", signalType: "content_change" };
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

export function verifyFirecrawlSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) return false;
  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function verifySharedWebhookToken(
  received: string | null,
  expected: string,
): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
