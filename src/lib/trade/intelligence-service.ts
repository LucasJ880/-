/**
 * Trade Intelligence — 竞品溯源 / 买家发现 MVP
 *
 * - Serper：复用 searchGoogle（trade/tools）
 * - Firecrawl：复用 scrapePage（失败不致命）
 * - AI：createCompletion，禁止编造联系人/邮箱
 */

import { NextResponse } from "next/server";
import type { TradeIntelligenceCase } from "@prisma/client";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai";
import { isAIConfigured } from "@/lib/ai/config";
import { searchGoogle, type SearchResult } from "@/lib/trade/tools";
import { scrapePage } from "@/lib/trade/research-fetch-provider";
import { loadTradeCampaignForOrg } from "@/lib/trade/access";
import { logActivity } from "@/lib/trade/activity-log";
import type {
  IntelligenceCandidate,
  IntelligenceContactCandidate,
  IntelligenceEvidenceItem,
  ConvertIntelligenceBody,
} from "@/lib/trade/intelligence-types";

const MARKETPLACE_HINTS = [
  "amazon.",
  "walmart.",
  "ebay.",
  "aliexpress.",
  "wayfair.",
  "target.com",
  "homedepot.",
  "lowes.",
  "costco.",
  "bestbuy.",
  "homedepot.ca",
  "canadiantire.",
  "etsy.com",
  "newegg.",
];

/** 目录 / 聚合点评等：渠道参考价值低于零售商官网 */
const DIRECTORY_OR_LISTING_HOSTS = [
  "yellowpages.",
  "yelp.",
  "manta.",
  "bbb.org",
  "dnb.com",
  "kompass.",
  "thomasnet.",
  "alibaba.com/showroom",
  "globalsources.",
];

const BLOG_OR_CONTENT_HOSTS = ["medium.com", "blog.", "wordpress.com", "tumblr.", "substack.com"];

function isDirectoryOrBlogUrl(link: string): boolean {
  const l = link.toLowerCase();
  return DIRECTORY_OR_LISTING_HOSTS.some((h) => l.includes(h)) || BLOG_OR_CONTENT_HOSTS.some((h) => l.includes(h));
}

/** 进口 / 分销 B2B 页面 → 只进 importerCandidates，不进 buyer */
const IMPORTER_PAGE_HINTS =
  /\b(importers?\b|importing\s+company|bulk\s+import|customs\s+broker|freight\s+forwarder|wholesale\s+distributor|b2b\s+wholesale(\s+portal)?)\b/i;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function buildInvestigationQueries(caseRow: Pick<
  TradeIntelligenceCase,
  "productName" | "brand" | "upc" | "gtin" | "sku" | "mpn" | "productUrl" | "retailerName" | "notes"
>): string[] {
  const pn = norm(caseRow.productName);
  const br = norm(caseRow.brand);
  const upc = norm(caseRow.upc) || norm(caseRow.gtin);
  const mpn = norm(caseRow.mpn);
  const sku = norm(caseRow.sku);
  const retailer = norm(caseRow.retailerName);
  const url = norm(caseRow.productUrl);
  let host = "";
  try {
    if (url) host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }

  const q: string[] = [];
  if (upc) q.push(upc, `${upc} product`, `${upc} buy wholesale`);
  if (mpn && pn) q.push(`${mpn} ${pn}`, `${mpn} SKU`);
  if (br && pn) q.push(`${br} ${pn}`, `${pn} ${br} official`);
  if (host && mpn) q.push(`site:${host} ${mpn}`);
  if (retailer && pn) q.push(`${retailer} ${pn}`);
  if (retailer && upc) q.push(`${retailer} ${upc}`, `${upc} ${retailer}`);
  if (pn) {
    q.push(`${pn} Made in China`, `${pn} importer`, `${pn} wholesale distributor`, `${pn} supplier`);
  }
  if (sku && pn) q.push(`${sku} ${pn}`);
  return dedupeStrings(q).slice(0, 14);
}

function isMarketplaceUrl(link: string): boolean {
  const l = link.toLowerCase();
  return MARKETPLACE_HINTS.some((h) => l.includes(h));
}

function classifyRoleFromUrl(link: string, title: string): IntelligenceCandidate["role"] {
  const blob = `${link} ${title}`.toLowerCase();
  if (isMarketplaceUrl(link)) return "marketplace";
  if (IMPORTER_PAGE_HINTS.test(blob)) return "importer";
  if (/(distributor|wholesale|b2b\s+seller|bulk\s+wholesale)(\b|[^a-z])/i.test(blob)) return "distributor";
  if (/(supplier|manufacturer|factory|\.cn\b|made\s+in\s+china\s+supplier)/i.test(blob)) return "supplier";
  if (/(retail|shop|store|buy\s|add\s+to\s+cart|cart\b)/i.test(blob)) return "retailer";
  return "unknown";
}

function evidenceFromSerp(
  r: SearchResult,
  ctx: { upc?: string; mpn?: string; brand?: string; productName?: string },
): IntelligenceEvidenceItem {
  const matched: string[] = [];
  const hay = `${r.title} ${r.snippet} ${r.link}`.toLowerCase();
  if (ctx.upc && hay.includes(ctx.upc.toLowerCase())) matched.push("upc");
  if (ctx.mpn && hay.includes(ctx.mpn.toLowerCase())) matched.push("mpn");
  if (ctx.brand && hay.includes(ctx.brand.toLowerCase())) matched.push("brand");
  if (ctx.productName) {
    const words = ctx.productName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => hay.includes(w))) matched.push("productName");
  }
  let type: IntelligenceEvidenceItem["type"] = "search_result";
  if (matched.includes("upc")) type = "upc_match";
  else if (matched.includes("mpn")) type = "mpn_match";
  else if (matched.includes("brand")) type = "brand_match";
  return {
    type,
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    matchedFields: matched.length ? matched : ["search_result"],
  };
}

/** 匹配强度：UPC > MPN > 品名/抓取页 > 品牌 > 泛搜索 */
function evidenceMatchTier(ev: IntelligenceEvidenceItem): number {
  if (ev.type === "upc_match") return 5;
  if (ev.type === "mpn_match") return 4;
  if (ev.type === "product_page") return 3;
  if (ev.matchedFields.includes("productName")) return 3;
  if (ev.type === "brand_match") return 2;
  return 1;
}

/** 渠道形态：独立零售商站优先于平台 / 目录 / 内容站 */
function evidenceChannelScore(ev: IntelligenceEvidenceItem): number {
  const u = ev.url.toLowerCase();
  if (isMarketplaceUrl(u)) return 1;
  if (isDirectoryOrBlogUrl(u)) return 0;
  return 3;
}

function sortEvidenceDescending(evidence: IntelligenceEvidenceItem[]): IntelligenceEvidenceItem[] {
  return [...evidence].sort((a, b) => {
    const sa = evidenceMatchTier(a) * 10 + evidenceChannelScore(a);
    const sb = evidenceMatchTier(b) * 10 + evidenceChannelScore(b);
    if (sb !== sa) return sb - sa;
    return (b.snippet?.length ?? 0) - (a.snippet?.length ?? 0);
  });
}

function retailerNameTokens(retailerName: string | null | undefined): string[] {
  const raw = norm(retailerName).toLowerCase();
  if (!raw) return [];
  return raw
    .split(/[/,&|\s]+/)
    .map((t) => t.replace(/[^a-z0-9\u4e00-\u9fff]/g, ""))
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

function evidenceMatchesRetailerName(
  ev: IntelligenceEvidenceItem,
  retailerName: string | null | undefined,
): boolean {
  const toks = retailerNameTokens(retailerName);
  if (toks.length === 0) return false;
  const hay = `${ev.title} ${ev.snippet} ${ev.url}`.toLowerCase();
  const hits = toks.filter((t) => hay.includes(t));
  if (toks.length >= 3) return hits.length >= 2;
  return hits.length >= Math.min(2, toks.length);
}

function ruleConfidence(
  ev: IntelligenceEvidenceItem,
  ctx: { retailerName?: string | null; upc?: string; mpn?: string },
): number {
  let c = 0.2;
  if (ev.type === "upc_match") c = 0.74;
  else if (ev.type === "mpn_match") c = 0.64;
  else if (ev.type === "product_page") c = 0.52;
  else if (ev.matchedFields.includes("productName")) c = 0.46;
  else if (ev.type === "brand_match") c = 0.36;
  else c = 0.22;

  if (evidenceMatchesRetailerName(ev, ctx.retailerName)) {
    c += 0.14;
    if (!isMarketplaceUrl(ev.url) && !isDirectoryOrBlogUrl(ev.url)) c += 0.08;
  }

  if (isMarketplaceUrl(ev.url)) c = Math.min(c, 0.52);
  if (isDirectoryOrBlogUrl(ev.url)) c = Math.min(c, 0.42);

  const hasStrongId = ev.type === "upc_match" || ev.type === "mpn_match";
  if (!hasStrongId) c = Math.min(c, 0.66);

  const hay = `${ev.title} ${ev.snippet} ${ev.url}`.toLowerCase();
  const u = norm(ctx.upc);
  const m = norm(ctx.mpn);
  if (u && m && hay.includes(u.toLowerCase()) && hay.includes(m.toLowerCase())) {
    c = Math.min(0.92, c + 0.1);
  }

  return Math.round(Math.min(0.92, Math.max(0.08, c)) * 1000) / 1000;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function candidateFromEvidence(
  ev: IntelligenceEvidenceItem,
  ctx: {
    productName?: string;
    retailerName?: string | null;
    upc?: string;
    mpn?: string;
  },
): IntelligenceCandidate {
  const host = hostFromUrl(ev.url);
  let role = classifyRoleFromUrl(ev.url, ev.title);
  const blob = `${ev.url} ${ev.title}`.toLowerCase();
  if (IMPORTER_PAGE_HINTS.test(blob) && role === "unknown") role = "importer";

  const name =
    host ||
    ev.title.slice(0, 80) ||
    (ctx.productName ? `Unknown — ${ctx.productName}` : "Unknown entity");
  let conf = ruleConfidence(ev, {
    retailerName: ctx.retailerName,
    upc: ctx.upc,
    mpn: ctx.mpn,
  });
  const retailerHit = evidenceMatchesRetailerName(ev, ctx.retailerName);
  const flags: string[] = [];
  if (conf < 0.52) flags.push("low_confidence", "needs_human_review");
  if (isMarketplaceUrl(ev.url)) flags.push("marketplace_listing");
  if (isDirectoryOrBlogUrl(ev.url)) flags.push("directory_or_blog");
  if (retailerHit && !isMarketplaceUrl(ev.url)) flags.push("retailer_name_match");

  let reason = `由搜索/抓取证据推导（${ev.type}）。`;
  if (retailerHit && norm(ctx.retailerName)) {
    reason += ` 与用户填写零售商「${norm(ctx.retailerName)}」名称/域名高度相关。`;
  }

  return {
    name,
    role,
    website: host ? `https://${host}` : ev.url,
    country: null,
    confidence: conf,
    evidence: [
      {
        type: ev.type,
        title: ev.title,
        url: ev.url,
        snippet: ev.snippet.slice(0, 500),
        matchedFields: ev.matchedFields,
      },
    ],
    reason,
    riskFlags: flags,
    nextVerificationStep:
      role === "marketplace"
        ? "此为平台商品页，仅作渠道证据；最终买家需结合卖家/品牌与发票流向人工确认。"
        : role === "importer" || role === "distributor"
          ? "核对该公司是否为本产品在目标市场的进口商/分销商，而非终端消费者。"
          : "打开站点核对产品页 UPC/MPN 与包装是否一致。",
  };
}

function pickScrapeUrls(productUrl: string | null, evidence: IntelligenceEvidenceItem[], max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const t = u.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (productUrl) {
    try {
      push(new URL(productUrl.startsWith("http") ? productUrl : `https://${productUrl}`).toString());
    } catch {
      /* skip */
    }
  }
  for (const ev of evidence) {
    if (out.length >= max) break;
    if (ev.url && (ev.type === "upc_match" || ev.type === "mpn_match" || ev.type === "product_page")) push(ev.url);
  }
  for (const ev of evidence) {
    if (out.length >= max) break;
    push(ev.url);
  }
  return out.slice(0, max);
}

function buildContactCandidates(candidates: IntelligenceCandidate[]): IntelligenceContactCandidate[] {
  const out: IntelligenceContactCandidate[] = [];
  for (const c of candidates.slice(0, 12)) {
    const site = c.website;
    if (!site) continue;
    let host = "";
    try {
      host = new URL(site).hostname;
    } catch {
      continue;
    }
    const q = encodeURIComponent(c.name);
    out.push({
      companyName: c.name,
      contactType: "contact_page",
      url: `${site.replace(/\/$/, "")}/contact`,
      label: "尝试官网联系页（可能 404，需人工验证）",
      confidence: 0.35,
      reason: "由候选站点拼接 /contact，常见站点结构不同。",
    });
    out.push({
      companyName: c.name,
      contactType: "linkedin_search",
      url: `https://www.linkedin.com/search/results/companies/?keywords=${q}`,
      label: "LinkedIn 公司搜索（仅策略链接，非抓取结果）",
      confidence: 0.25,
      reason: "MVP 不提供联系人抓取；使用公开搜索入口。",
    });
  }
  return out.slice(0, 20);
}

const AI_SYSTEM = `你是 B2B 贸易调查分析助手。只能使用用户提供的「证据 JSON」与 case 字段；不得臆测未出现的网页、联系人或内部数据。

硬性规则（违反则整段回答视为无效）：
1) 禁止编造：联系人姓名、邮箱、电话、传真、微信、采购经理姓名与职位；证据未出现则不得输出上述任何一项。
2) 禁止编造「已邮件确认」「已电话核实」等未发生的动作。
3) 若无直接联系证据：contact 相关建议只能写「访问官网 /contact」「supplier portal」「LinkedIn 公司搜索 URL 模板」等策略，不得写具体地址为真。
4) 证据不足时：相关候选 confidence 必须 <=0.45，riskFlags 必须包含 "insufficient_evidence"，并在 analysisReport 的 Needs verification 段说明缺什么。
5) Amazon / Walmart / eBay 等平台商品页：只能作为 marketplace 渠道证据，不得标为最终买家（buyerCandidates 中不得收录）。
6) 进口商 / 分销商 / 批发商页面：只能进入 importerCandidates（role=importer|distributor），不得进入 buyerCandidates。
7) 输出必须是单一 JSON 对象，不要 markdown 代码围栏，不要 JSON 以外的解释文字。

analysisReport 字符串内须用标题区分（中文或英文均可）：
## Confirmed evidence
## Likely inference  
## Needs verification
## Final buyer view
在 Final buyer view 中，每个结论必须写清：依据的 URL、证据类型、confidence；区分事实与推断。

JSON 顶层字段：
{
  "buyerCandidates": IntelligenceCandidate[],
  "retailerCandidates": IntelligenceCandidate[],
  "importerCandidates": IntelligenceCandidate[],
  "supplierCandidates": IntelligenceCandidate[],
  "analysisReport": string,
  "nextSteps": string,
  "overallConfidence": number
}
IntelligenceCandidate：name, role, website|null, country|null, confidence 0-1, evidence[], reason, riskFlags[], nextVerificationStep。
evidence[]：type, title, url, snippet, matchedFields；type 只能是 search_result|product_page|upc_match|mpn_match|brand_match|address_match|customs_hint|manual。`;

function safeParseAiJson(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asCandidateArray(v: unknown): IntelligenceCandidate[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object") as IntelligenceCandidate[];
}

function firstEvidenceTier(c: IntelligenceCandidate): number {
  const e = c.evidence?.[0];
  if (!e) return 0;
  return evidenceMatchTier(e) * 10 + evidenceChannelScore(e);
}

function mergeCandidates(rule: IntelligenceCandidate[], ai: IntelligenceCandidate[]): IntelligenceCandidate[] {
  const key = (c: IntelligenceCandidate) =>
    `${c.name.toLowerCase()}|${(c.website ?? "").toLowerCase()}`;
  const map = new Map<string, IntelligenceCandidate>();
  for (const c of [...rule, ...ai]) {
    const k = key(c);
    const prev = map.get(k);
    if (!prev || c.confidence > prev.confidence) map.set(k, c);
  }
  const merged = [...map.values()];
  merged.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 0.02) return b.confidence - a.confidence;
    return firstEvidenceTier(b) - firstEvidenceTier(a);
  });
  return merged;
}

function isMarketplaceCandidate(c: IntelligenceCandidate): boolean {
  if (c.role === "marketplace") return true;
  const u = (c.website ?? c.evidence?.[0]?.url ?? "").toLowerCase();
  return isMarketplaceUrl(u);
}

/** 平台列表不得作为最终买家；无强证据时压低置信度 */
function sanitizeBuyerCandidates(buyers: IntelligenceCandidate[]): IntelligenceCandidate[] {
  return buyers
    .filter((c) => !isMarketplaceCandidate(c))
    .map((c) => {
      const evs = c.evidence ?? [];
      if (evs.length === 0) {
        return {
          ...c,
          confidence: Math.min(c.confidence, 0.42),
          riskFlags: [...new Set([...(c.riskFlags ?? []), "insufficient_evidence"])],
        };
      }
      const hasStrong = evs.some((e) =>
        ["upc_match", "mpn_match", "product_page"].includes(e.type),
      );
      const onlyWeakSerp =
        !hasStrong && evs.every((e) => e.type === "search_result" || e.type === "brand_match");
      if (onlyWeakSerp) {
        return {
          ...c,
          confidence: Math.min(c.confidence, 0.52),
          riskFlags: [...new Set([...(c.riskFlags ?? []), "weak_search_only"])],
        };
      }
      if (c.confidence > 0.72 && !hasStrong) {
        return { ...c, confidence: Math.min(c.confidence, 0.64) };
      }
      return c;
    });
}

export async function createIntelligenceCase(params: {
  orgId: string;
  userId: string;
  input: {
    productName?: string | null;
    brand?: string | null;
    upc?: string | null;
    gtin?: string | null;
    sku?: string | null;
    mpn?: string | null;
    productUrl?: string | null;
    retailerName?: string | null;
    notes?: string | null;
    title?: string | null;
    sourceType?: string | null;
  };
}): Promise<TradeIntelligenceCase> {
  const title =
    norm(params.input.title) ||
    [norm(params.input.brand), norm(params.input.productName)].filter(Boolean).join(" · ") ||
    `竞品溯源 ${norm(params.input.upc) || norm(params.input.mpn) || "未命名"}`;

  return db.tradeIntelligenceCase.create({
    data: {
      orgId: params.orgId,
      title,
      status: "new",
      sourceType: norm(params.input.sourceType) || "manual",
      productName: norm(params.input.productName) || null,
      brand: norm(params.input.brand) || null,
      upc: norm(params.input.upc) || null,
      gtin: norm(params.input.gtin) || null,
      sku: norm(params.input.sku) || null,
      mpn: norm(params.input.mpn) || null,
      productUrl: norm(params.input.productUrl) || null,
      retailerName: norm(params.input.retailerName) || null,
      notes: norm(params.input.notes) || null,
      createdById: params.userId,
    },
  });
}

export async function runIntelligenceCase(params: {
  caseId: string;
  orgId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.tradeIntelligenceCase.findFirst({
    where: { id: params.caseId, orgId: params.orgId },
  });
  if (!row) return { ok: false, error: "案例不存在" };

  await db.tradeIntelligenceCase.updateMany({
    where: { id: row.id, orgId: params.orgId },
    data: { status: "searching", lastError: null },
  });

  try {
    const queries = buildInvestigationQueries(row);
    const ctx = {
      upc: row.upc ?? row.gtin ?? undefined,
      mpn: row.mpn ?? undefined,
      brand: row.brand ?? undefined,
      productName: row.productName ?? undefined,
    };

    const seenLinks = new Set<string>();
    const evidence: IntelligenceEvidenceItem[] = [];

    for (const q of queries) {
      const hits = await searchGoogle(q, { num: 8 });
      for (const h of hits) {
        if (!h.link || seenLinks.has(h.link)) continue;
        seenLinks.add(h.link);
        evidence.push(evidenceFromSerp(h, ctx));
        if (evidence.length >= 48) break;
      }
      if (evidence.length >= 48) break;
    }

    await db.tradeIntelligenceCase.updateMany({
      where: { id: row.id, orgId: params.orgId },
      data: { status: "analyzing", searchQueries: queries as unknown as object, evidence: evidence as unknown as object },
    });

    const scrapeUrls = pickScrapeUrls(row.productUrl, evidence, 5);
    for (const u of scrapeUrls) {
      const sc = await scrapePage(u);
      if (sc.ok && sc.markdown) {
        const sn = sc.markdown.replace(/\s+/g, " ").slice(0, 600);
        evidence.push({
          type: "product_page",
          title: sc.title || u,
          url: u,
          snippet: sn,
          matchedFields: ["firecrawl_scrape"],
        });
      }
    }

    evidence.splice(0, evidence.length, ...sortEvidenceDescending(evidence));

    if (evidence.length === 0) {
      await db.tradeIntelligenceCase.updateMany({
        where: { id: row.id, orgId: params.orgId },
        data: {
          status: "needs_review",
          searchQueries: queries as unknown as object,
          evidence: [] as unknown as object,
          buyerCandidates: [] as unknown as object,
          retailerCandidates: [] as unknown as object,
          importerCandidates: [] as unknown as object,
          supplierCandidates: [] as unknown as object,
          contactCandidates: [] as unknown as object,
          recommendedProspects: [] as unknown as object,
          analysisReport:
            "## Confirmed evidence\n（空）无 Serper 结果。\n\n## Likely inference\n不适用。\n\n## Needs verification\n检查 SERPER 配置与网络后重新运行。",
          confidenceScore: 0.12,
          lastRunAt: new Date(),
          lastError: !process.env.SERPER_API_KEY?.trim()
            ? "未检测到 SERPER_API_KEY，无法发起检索。"
            : "Serper 未返回任何链接，请稍后重试或检查查询词。",
        },
      });
      return { ok: true };
    }

    const ruleCtx = {
      productName: row.productName ?? undefined,
      retailerName: row.retailerName,
      upc: row.upc ?? row.gtin ?? undefined,
      mpn: row.mpn ?? undefined,
    };

    const ruleBuyers: IntelligenceCandidate[] = [];
    const ruleRetailers: IntelligenceCandidate[] = [];
    const ruleImporters: IntelligenceCandidate[] = [];
    for (const ev of evidence) {
      const c = candidateFromEvidence(ev, ruleCtx);
      const blob = `${ev.url} ${ev.title}`;

      if (c.role === "marketplace") {
        ruleRetailers.push(c);
        continue;
      }

      if (c.role === "importer" || c.role === "distributor" || IMPORTER_PAGE_HINTS.test(blob)) {
        const rle: IntelligenceCandidate["role"] =
          c.role === "importer" ? "importer" : c.role === "distributor" ? "distributor" : "importer";
        ruleImporters.push({
          ...c,
          role: rle,
          reason:
            c.reason +
            (IMPORTER_PAGE_HINTS.test(blob) ? "（标题/URL 含进口或批发语义，归入进口商/分销候选，不当作终端买家。）" : ""),
        });
        continue;
      }

      if (c.role === "supplier") {
        continue;
      }

      if (c.role === "retailer") {
        ruleRetailers.push(c);
        continue;
      }

      if (ev.type === "upc_match" || ev.type === "mpn_match") {
        if (isMarketplaceUrl(ev.url)) {
          ruleRetailers.push({ ...c, role: "marketplace" });
        } else {
          ruleRetailers.push({
            ...c,
            role: "retailer",
            reason: `${c.reason} 强标识（UPC/MPN）命中该 URL，视为零售/销售渠道页面。`,
          });
        }
        continue;
      }

      if (c.confidence >= 0.52 && !isDirectoryOrBlogUrl(ev.url) && !isMarketplaceUrl(ev.url)) {
        ruleRetailers.push({
          ...c,
          role: "retailer",
          confidence: Math.min(c.confidence, 0.58),
          reason: `${c.reason}（无强 UPC/MPN 证据，仅作弱零售/渠道线索。）`,
        });
      }
    }

    let aiBuyers: IntelligenceCandidate[] = [];
    let aiRetailers: IntelligenceCandidate[] = [];
    let aiImporters: IntelligenceCandidate[] = [];
    let aiSuppliers: IntelligenceCandidate[] = [];
    let analysisReport = "";
    let nextSteps = "人工打开高置信证据链接，核对 UPC/MPN 与包装信息。";
    let overall = 0.4;

    if (isAIConfigured()) {
      const payload = JSON.stringify({
        case: {
          title: row.title,
          productName: row.productName,
          brand: row.brand,
          upc: row.upc,
          mpn: row.mpn,
          retailerName: row.retailerName,
          notes: row.notes,
        },
        evidence: evidence.slice(0, 35),
      });
      const raw = await createCompletion({
        systemPrompt: AI_SYSTEM,
        userPrompt: `请阅读以下 JSON（case + evidence），只输出一条 JSON 对象，不要其它文字。

analysisReport 必须按以下四段书写（可用中文，每段有标题行）：
## Confirmed evidence
只列证据 JSON 中已出现的事实（URL、命中字段、页面类型）。
## Likely inference
基于证据的合理推断，逐条标注「推断」并引用对应 URL。
## Needs verification
列出需人工打开页面核对的事项。
## Final buyer view
若讨论「最终买家/零售商」，必须说明：证据来源 URL、证据类型（upc/mpn/product_page 等）、confidence 数值；不得出现具体联系人姓名/邮箱/电话。

buyerCandidates：仅含可能成为采购终端或签约对方的实体；Amazon/Walmart 等平台商品页只能进 retailerCandidates 且 role=marketplace，不得进 buyerCandidates。
importerCandidates：进口商、批发商、分销商页面。
若无联系证据，nextSteps 中只可建议访问官网 /contact 或使用 LinkedIn 公司搜索链接，不得写 invented 邮箱。

输入：\n${payload}`,
        mode: "structured",
        maxTokens: 4096,
        timeoutMs: 120000,
      });
      const parsed = safeParseAiJson(raw);
      if (parsed) {
        aiBuyers = sanitizeBuyerCandidates(asCandidateArray(parsed.buyerCandidates));
        aiRetailers = asCandidateArray(parsed.retailerCandidates);
        aiImporters = asCandidateArray(parsed.importerCandidates);
        aiSuppliers = asCandidateArray(parsed.supplierCandidates);
        analysisReport = typeof parsed.analysisReport === "string" ? parsed.analysisReport : "";
        nextSteps = typeof parsed.nextSteps === "string" ? parsed.nextSteps : nextSteps;
        const oc = parsed.overallConfidence;
        overall = typeof oc === "number" && Number.isFinite(oc) ? Math.max(0, Math.min(1, oc)) : overall;
      }
    } else {
      analysisReport =
        "## Confirmed evidence\n见下方 evidence JSON。\n\n## Likely inference\n未配置 AI，不做机器推断。\n\n## Needs verification\n请人工审阅证据链接。\n\n## Final buyer view\n未生成；请开启 AI 后重试。";
      overall = 0.35;
    }

    const buyerCandidates = sanitizeBuyerCandidates(mergeCandidates(ruleBuyers, aiBuyers)).slice(0, 20);
    const retailerCandidates = mergeCandidates(ruleRetailers, aiRetailers).slice(0, 20);
    const importerCandidates = mergeCandidates(ruleImporters, aiImporters).slice(0, 20);
    const supplierCandidates = mergeCandidates([], aiSuppliers).slice(0, 15);
    if (buyerCandidates.length === 0 && overall > 0.48) {
      overall = Math.min(overall, 0.45);
    }
    const contactCandidates = buildContactCandidates([
      ...buyerCandidates,
      ...retailerCandidates,
      ...importerCandidates,
    ]);
    const recommendedProspects = buyerCandidates.slice(0, 3).map((c) => ({
      name: c.name,
      website: c.website,
      confidence: c.confidence,
      reason: c.reason,
    }));

    const topBuyer = buyerCandidates[0];
    const topConf = topBuyer?.confidence ?? Math.min(overall, 0.52);
    const strongProof =
      !!topBuyer?.evidence?.some((e) =>
        ["upc_match", "mpn_match", "product_page"].includes(e.type),
      );
    const status =
      !!topBuyer &&
      topConf >= 0.72 &&
      buyerCandidates.length > 0 &&
      strongProof &&
      !(topBuyer.riskFlags ?? []).includes("insufficient_evidence") &&
      !isMarketplaceCandidate(topBuyer)
        ? "buyer_identified"
        : "needs_review";

    const structuredProduct = {
      productName: row.productName,
      brand: row.brand,
      upc: row.upc,
      gtin: row.gtin,
      mpn: row.mpn,
      sku: row.sku,
      retailerName: row.retailerName,
      productUrl: row.productUrl,
    };

    await db.tradeIntelligenceCase.updateMany({
      where: { id: row.id, orgId: params.orgId },
      data: {
        status,
        structuredProduct: structuredProduct as object,
        buyerCandidates: buyerCandidates as unknown as object,
        retailerCandidates: retailerCandidates as unknown as object,
        importerCandidates: importerCandidates as unknown as object,
        supplierCandidates: supplierCandidates as unknown as object,
        contactCandidates: contactCandidates as unknown as object,
        recommendedProspects: recommendedProspects as unknown as object,
        analysisReport: [analysisReport, "", "## 下一步建议", nextSteps].filter(Boolean).join("\n"),
        confidenceScore: Math.max(topConf, retailerCandidates[0]?.confidence ?? 0),
        lastRunAt: new Date(),
        lastError: null,
      },
    });

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.tradeIntelligenceCase.updateMany({
      where: { id: params.caseId, orgId: params.orgId },
      data: { status: "failed", lastError: msg.slice(0, 1900), lastRunAt: new Date() },
    });
    return { ok: false, error: msg };
  }
}

function pickCandidateList(
  row: TradeIntelligenceCase,
  role: ConvertIntelligenceBody["candidateRole"],
): IntelligenceCandidate[] {
  const parse = (j: unknown): IntelligenceCandidate[] => {
    if (!Array.isArray(j)) return [];
    return j as IntelligenceCandidate[];
  };
  if (role === "buyer") return parse(row.buyerCandidates);
  if (role === "retailer") return parse(row.retailerCandidates);
  if (role === "importer" || role === "distributor") {
    const im = parse(row.importerCandidates);
    if (role === "distributor") {
      return im.filter(
        (c) => c.role === "distributor" || /distribut/i.test(`${c.name} ${c.reason}`),
      );
    }
    return im;
  }
  return [];
}

export async function convertCaseToTradeProspect(params: {
  caseRow: TradeIntelligenceCase;
  orgId: string;
  userId: string;
  body: ConvertIntelligenceBody;
}): Promise<{ prospectId: string } | { error: string; status?: number }> {
  const { caseRow, orgId, userId, body } = params;
  if (caseRow.convertedProspectId) {
    return { error: "该案例已转为线索", status: 409 };
  }

  let campaignId = norm(body.createCampaignId);
  if (!campaignId) {
    const first = await db.tradeCampaign.findFirst({
      where: { orgId, status: { not: "completed" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!first) {
      return { error: "当前组织下没有可用活动，请先创建活动或在请求中指定 createCampaignId", status: 400 };
    }
    campaignId = first.id;
  } else {
    const camp = await loadTradeCampaignForOrg(campaignId, orgId);
    if (camp instanceof NextResponse) {
      return { error: "活动不存在或不属于当前组织", status: 403 };
    }
  }

  const list = pickCandidateList(caseRow, body.candidateRole);
  const idx = body.candidateIndex;
  if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) {
    return { error: "candidateIndex 无效", status: 400 };
  }
  const cand = list[idx];

  let website = cand.website;
  if (website) {
    try {
      website = new URL(website.startsWith("http") ? website : `https://${website}`).origin;
    } catch {
      website = null;
    }
  }

  const evidenceUrls = (cand.evidence ?? []).map((e) => e.url).filter(Boolean).slice(0, 12);
  const reportJson = {
    intelligenceCaseId: caseRow.id,
    productName: caseRow.productName,
    brand: caseRow.brand,
    upc: caseRow.upc,
    mpn: caseRow.mpn,
    evidenceUrls,
    confidence: cand.confidence,
    candidateRole: body.candidateRole,
    candidateName: cand.name,
    candidateIndex: idx,
    candidateWebsite: website,
    reason: cand.reason,
    riskFlags: cand.riskFlags ?? [],
  };

  const notesLines = [
    `[trade_intelligence] intelligenceCaseId=${caseRow.id}`,
    `candidateRole=${body.candidateRole} candidateIndex=${idx} candidateName=${cand.name}`,
    `productName=${caseRow.productName ?? "—"} brand=${caseRow.brand ?? "—"} upc=${caseRow.upc ?? "—"} mpn=${caseRow.mpn ?? "—"}`,
    `confidence=${cand.confidence.toFixed(3)}`,
    `evidence_urls: ${evidenceUrls.join(" | ")}`,
    caseRow.notes ? `operator_notes: ${caseRow.notes}` : "",
  ].filter(Boolean);

  const scoreReason = [
    `[Trade Intelligence] intelligenceCaseId=${caseRow.id}`,
    `productName=${caseRow.productName ?? "—"}`,
    `brand=${caseRow.brand ?? "—"}`,
    `upc=${caseRow.upc ?? "—"} mpn=${caseRow.mpn ?? "—"}`,
    `candidateRole=${body.candidateRole} candidateIndex=${idx} name=${cand.name}`,
    `confidence=${cand.confidence.toFixed(3)}`,
    `reason: ${cand.reason}`,
    "",
    "evidenceURLs:",
    ...evidenceUrls.map((u) => `- ${u}`),
    "",
    "来源：竞品溯源（人工确认后转换）。",
    `风险标记：${(cand.riskFlags ?? []).join(", ") || "—"}`,
    "",
    "--- Intelligence notes ---",
    ...notesLines,
  ].join("\n");

  try {
    const result = await db.$transaction(async (tx) => {
      const prospect = await tx.tradeProspect.create({
        data: {
          campaignId,
          orgId,
          companyName: cand.name.slice(0, 240),
          website,
          country: cand.country,
          source: "trade_intelligence",
          stage: "discovered",
          researchStatus: website ? "research_pending" : "website_needed",
          researchReport: reportJson as object,
          scoreReason: scoreReason.slice(0, 12000),
        },
      });

      await tx.tradeCampaign.update({
        where: { id: campaignId },
        data: { totalProspects: { increment: 1 } },
      });

      const convN = await tx.tradeIntelligenceCase.updateMany({
        where: { id: caseRow.id, orgId, convertedProspectId: null },
        data: {
          convertedProspectId: prospect.id,
          convertedAt: new Date(),
          convertedById: userId,
          status: "converted_to_prospect",
        },
      });
      if (convN.count !== 1) {
        throw new Error("CASE_ALREADY_CONVERTED_OR_MISSING");
      }
      return prospect;
    });

    await logActivity({
      orgId,
      campaignId,
      prospectId: result.id,
      action: "trade_intelligence_convert",
      detail: `IntelligenceCase=${caseRow.id} → Prospect=${result.id}`,
      meta: { intelligenceCaseId: caseRow.id, prospectId: result.id },
    });

    return { prospectId: result.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CASE_ALREADY_CONVERTED_OR_MISSING") {
      return { error: "该案例已转为线索或状态已变更，请刷新后重试", status: 409 };
    }
    return { error: msg.slice(0, 500), status: 500 };
  }
}
