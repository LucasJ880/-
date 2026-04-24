/**
 * Trade 研究 — 输入采集（Serper + Firecrawl 增强 + fetch 兜底）
 *
 * 供单条 research、batch-research、pipeline 复用；不修改 scoring / bundle 结构语义。
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

export interface TradeResearchGatherResult {
  rawData: string;
  sources: ResearchSource[];
  searchResults: SearchResult[];
  /** 用于写回 prospect.website 的解析结果 */
  website: string | null;
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
 * 1) Serper 搜索
 * 2) Firecrawl map + scrape（优先；失败则仅无增强块）
 * 3) 首页：优先 Firecrawl 根页；否则 fetchPageContent 兜底
 * 4) sources = Serper + 首页 + 其余 Firecrawl 页（去重）
 */
export async function gatherTradeResearchInputs(params: {
  companyName: string;
  country?: string | null;
  website?: string | null;
}): Promise<TradeResearchGatherResult> {
  const { companyName, country, website: prospectWebsite } = params;

  let rawData = "";
  const searchResults = await searchGoogle(
    `"${companyName}" ${country ?? ""} company products`,
    { num: 5 },
  );
  if (searchResults.length > 0) {
    rawData = searchResults
      .map((r) => `[${r.title}](${r.link})\n${r.snippet}`)
      .join("\n\n");
  }

  const website = prospectWebsite ?? searchResults[0]?.link ?? null;
  const siteRoot = website ? normalizeSiteRootUrl(website) : null;

  let fcPages: ResearchFetchedPage[] = [];
  if (siteRoot) {
    try {
      const fc = await collectResearchPages(siteRoot);
      fcPages = fc.pages;
      for (const page of fcPages) {
        rawData += `\n\n--- [${page.kind}] ${page.title} (${page.url}) ---\n${page.markdown.slice(0, 4500)}`;
      }
    } catch (e) {
      console.warn("[trade/research-input] Firecrawl collect failed:", e);
    }
  }

  const rootFc = fcPages.find((p) => p.kind === "homepage");
  let homepagePage: PageContent | null = null;
  let homepageUrl: string | null = null;

  if (rootFc && siteRoot && hostMatch(rootFc.url, siteRoot)) {
    homepagePage = {
      url: rootFc.url,
      title: rootFc.title,
      text: rootFc.markdown,
      ok: true,
    };
    homepageUrl = rootFc.url;
  }

  if (!homepagePage?.ok && website) {
    const page = await fetchPageContent(website);
    if (page.ok) {
      homepagePage = page;
      homepageUrl = website;
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
    website,
  };
}
