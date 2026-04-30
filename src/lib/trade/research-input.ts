/**
 * Trade 研究 — 输入采集（Serper + Firecrawl 增强 + fetch 兜底）
 *
 * 供单条 research、batch-research、pipeline 复用；不修改 scoring / bundle 结构语义。
 *
 * 注意：不得在无已解析官网时把 Serper 第一条当作 prospect.website；官网解析由 research-service 完成。
 */

import type { SearchResult } from "@/lib/trade/tools";
import { searchGoogle, fetchPageContent, type PageContent } from "@/lib/trade/tools";
import {
  buildSourcesFromSerpAndPage,
  mergeSourcesWithFirecrawlPages,
  type ResearchSource,
} from "@/lib/trade/research-bundle";
import {
  collectResearchPages,
  normalizeSiteRootUrl,
  type ResearchFetchedPage,
} from "@/lib/trade/research-fetch-provider";

export interface TradeResearchGatherMeta {
  serpOrganicCount: number;
  mapFailed: boolean;
  homepageFromFetchFallback: boolean;
  homepageFallbackOnly: boolean;
  firecrawlPageCount: number;
}

export interface TradeResearchGatherResult {
  rawData: string;
  sources: ResearchSource[];
  searchResults: SearchResult[];
  /** 与入参 website 一致（已解析的官网根或页） */
  website: string | null;
  meta: TradeResearchGatherMeta;
}

function hostMatch(a: string, b: string): boolean {
  try {
    return (
      new URL(a).hostname.replace(/^www\./i, "") === new URL(b).hostname.replace(/^www\./i, "")
    );
  } catch {
    return false;
  }
}

/**
 * 1) Serper 搜索（补充上下文，不用于自动认定官网）
 * 2) Firecrawl map + scrape（优先；map 失败则仅根 URL）
 * 3) 首页：优先 Firecrawl 根页；否则 fetchPageContent 兜底
 * 4) sources = Serper + 首页 + 其余 Firecrawl 页（去重）
 *
 * @param website 必须已解析：无官网时不要调用本函数做「整站研究」。
 */
export async function gatherTradeResearchInputs(params: {
  companyName: string;
  country?: string | null;
  /** 已确认的官网 URL；为 null 时仅拉 Serper、不跑 Firecrawl */
  website: string | null;
  /** 覆盖默认 Serper 查询 */
  serpQuery?: string | null;
}): Promise<TradeResearchGatherResult> {
  const { companyName, country, website, serpQuery } = params;

  let rawData = "";
  const q =
    (serpQuery?.trim() || `"${companyName}" ${country ?? ""} company products`).trim();
  const searchResults = await searchGoogle(q, { num: 8 });
  const serpOrganicCount = searchResults.length;
  if (searchResults.length > 0) {
    rawData = searchResults
      .map((r) => `[${r.title}](${r.link})\n${r.snippet}`)
      .join("\n\n");
  }

  const siteRoot = website ? normalizeSiteRootUrl(website) : null;

  let fcPages: ResearchFetchedPage[] = [];
  let mapFailed = false;
  let homepageFallbackOnly = false;
  if (siteRoot) {
    try {
      const fc = await collectResearchPages(siteRoot);
      fcPages = fc.pages;
      mapFailed = fc.mapFailed;
      homepageFallbackOnly = fc.homepageFallbackOnly;
      for (const page of fcPages) {
        rawData += `\n\n--- [${page.kind}] ${page.title} (${page.url}) ---\n${page.markdown.slice(0, 4500)}`;
      }
    } catch (e) {
      console.warn("[trade/research-input] Firecrawl collect failed:", e);
      mapFailed = true;
      homepageFallbackOnly = true;
    }
  }

  const rootFc = fcPages.find((p) => p.kind === "homepage");
  let homepagePage: PageContent | null = null;
  let homepageUrl: string | null = null;
  let homepageFromFetchFallback = false;

  if (website && rootFc && siteRoot && hostMatch(rootFc.url, siteRoot)) {
    homepagePage = {
      url: rootFc.url,
      title: rootFc.title,
      text: rootFc.markdown,
      ok: true,
    };
    homepageUrl = rootFc.url;
  }

  if (website && (!homepagePage?.ok || !homepageUrl)) {
    const page = await fetchPageContent(website);
    if (page.ok) {
      homepagePage = page;
      homepageUrl = website;
      homepageFromFetchFallback = true;
      rawData += `\n\n--- 官网内容 ---\n${page.title}\n${page.text.slice(0, 3000)}`;
    }
  }

  const baseSources = buildSourcesFromSerpAndPage(
    searchResults,
    homepagePage,
    homepageUrl && homepagePage?.ok ? homepageUrl : null,
  );

  const extraFc = fcPages.filter(
    (p) => !homepageUrl || p.url.replace(/\/$/, "") !== homepageUrl.replace(/\/$/, ""),
  );

  const sources = mergeSourcesWithFirecrawlPages(baseSources, extraFc);

  return {
    rawData: rawData.trim(),
    sources,
    searchResults,
    website: website ?? null,
    meta: {
      serpOrganicCount,
      mapFailed,
      homepageFromFetchFallback,
      homepageFallbackOnly: !!website && homepageFallbackOnly,
      firecrawlPageCount: fcPages.length,
    },
  };
}
