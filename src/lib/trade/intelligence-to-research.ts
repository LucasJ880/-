import type { IntelligenceCandidate, IntelligenceContactCandidate } from "@/lib/trade/intelligence-types";
import type { ResearchBundleV1, ResearchReport, ResearchSource } from "@/lib/trade/research-bundle";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** 只采用原文里已经出现的邮箱，不编造。 */
export function extractObservedEmail(
  contacts: IntelligenceContactCandidate[] | unknown,
  companyName?: string | null,
): string | null {
  if (!Array.isArray(contacts)) return null;
  const list = contacts as IntelligenceContactCandidate[];
  const preferred = companyName
    ? [
        ...list.filter((c) => c.companyName.trim().toLowerCase() === companyName.trim().toLowerCase()),
        ...list,
      ]
    : list;

  for (const c of preferred) {
    const mailto = c.url?.startsWith("mailto:") ? c.url.slice(7).split("?")[0] : "";
    const fromLabel = c.label?.match(EMAIL_RE)?.[0] ?? "";
    const candidate = (mailto || fromLabel).trim();
    if (candidate && EMAIL_RE.test(candidate) && !candidate.includes("example.com")) {
      return candidate;
    }
  }
  return null;
}

export function buildIntelligenceResearchBundle(input: {
  caseTitle?: string | null;
  productName?: string | null;
  brand?: string | null;
  candidate: IntelligenceCandidate;
  evidenceUrls: string[];
}): ResearchBundleV1 {
  const sources: ResearchSource[] = input.evidenceUrls.slice(0, 12).map((url, i) => ({
    id: `s${i + 1}`,
    url,
    title: url,
    kind: "search" as const,
    snippet: input.candidate.reason,
  }));

  const report: ResearchReport = {
    companyOverview: [input.candidate.name, input.candidate.country, input.candidate.reason]
      .filter(Boolean)
      .join(" · "),
    products: [input.productName, input.brand].filter(Boolean).join(" / "),
    marketPosition: `${input.candidate.role} · 置信 ${input.candidate.confidence.toFixed(2)}`,
    importHistory: "",
    contactInfo: input.candidate.website ? `网站：${input.candidate.website}` : "",
    matchAnalysis: input.candidate.reason,
    recommendations: "来源：企业情报人工确认。可基于以上证据起草开发信，禁止编造联系人。",
  };

  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    sources,
    report,
  };
}
