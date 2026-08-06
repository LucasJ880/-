/**
 * M1–M15 强制技术要求抽取（确定性优先）
 */

import type { PageInput, RequirementCandidate, SourceRefCandidate } from "./types";

const M_CODE_RE = /\bM\s*([1-9]|1[0-5])\b/gi;

/** 已知背包类准则的启发式中文（命中英文关键词时使用） */
const ZH_HINTS: Array<{ pattern: RegExp; zh: string }> = [
  { pattern: /capacity|volume|litre|liter|\bl\b/i, zh: "容量/容积要求" },
  { pattern: /1000d|1000\s*d|cordura|nylon/i, zh: "面料（含 1000D 尼龙等）要求" },
  { pattern: /water\s*resist|waterproof|ipx/i, zh: "防水/抗水性能要求" },
  { pattern: /zipper|slide\s*fastener/i, zh: "拉链性能要求" },
  { pattern: /webbing|strap/i, zh: "织带/背带要求" },
  { pattern: /thread|stitch/i, zh: "缝线/缝制要求" },
  { pattern: /dimension|size|measurement|cm\b|mm\b/i, zh: "尺寸/测量方法要求" },
  { pattern: /colour|color|olive|black/i, zh: "颜色要求" },
  { pattern: /logo|insignia|marking|label/i, zh: "标识/徽标要求" },
  { pattern: /pad|cushion|back\s*panel/i, zh: "背垫/填充要求" },
  { pattern: /pocket|compartment/i, zh: "口袋/隔舱要求" },
  { pattern: /buckle|fastener|clip/i, zh: "扣具要求" },
  { pattern: /sample/i, zh: "样品要求" },
  { pattern: /weight/i, zh: "重量要求" },
  { pattern: /durability|abrasion/i, zh: "耐久/耐磨要求" },
];

export function looksLikeRcmpBackpackRfp(allText: string): boolean {
  const t = allText.toLowerCase();
  const hasSolicitation =
    /m5000/i.test(allText) || /solicitation/i.test(allText);
  const hasBackpack =
    /backpacks?\s+for\s+cadets/i.test(allText) || /backpack/i.test(t);
  const hasRcmp = /\brcmp\b/i.test(allText) || /royal canadian mounted police/i.test(t);
  return hasSolicitation && hasBackpack && hasRcmp;
}

function snippetAround(text: string, index: number, len = 180): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + len);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function translateRequirement(en: string): string {
  for (const hint of ZH_HINTS) {
    if (hint.pattern.test(en)) {
      return `${hint.zh}（原文见英文；AI_EXTRACTED 启发式翻译）`;
    }
  }
  const short = en.replace(/\s+/g, " ").trim().slice(0, 120);
  return `【待译】${short}${en.length > 120 ? "…" : ""}（AI_EXTRACTED）`;
}

function makeSourceRef(
  page: PageInput,
  snippet: string,
): SourceRefCandidate {
  return {
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    originalTextSnippet: snippet.slice(0, 400),
    sectionLabel: "Mandatory Technical",
    extractionMethod: "regex_m_code",
    confidence: "HIGH_CONFIDENCE",
  };
}

/**
 * 从页文本抽取 M1–M15。
 * 对疑似 RCMP 背包 RFP：若不足 15 项，补齐缺失码为 NEEDS_CLARIFICATION。
 */
export function extractRequirementsFromPages(
  pages: PageInput[],
): RequirementCandidate[] {
  const byCode = new Map<string, RequirementCandidate>();

  for (const page of pages) {
    const text = page.contentText ?? "";
    if (!text.trim()) continue;

    // 行级优先： "M1 …" / "M1." / "M 1 -"
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const lm = line.match(/^\s*M\s*([1-9]|1[0-5])\s*[\.\:\-\)]\s*(.+)$/i);
      if (!lm) continue;
      const code = `M${lm[1]}`;
      const body = lm[2]!.trim();
      if (!body || byCode.has(code)) continue;
      const snippet = line.trim().slice(0, 400);
      byCode.set(code, {
        requirementCode: code,
        category: "mandatory_technical",
        originalRequirement: body,
        chineseTranslation: translateRequirement(body),
        mandatory: true,
        evidenceRequired: /certificate|test|sample|evidence|proof/i.test(body),
        complianceStatus: "NOT_ASSESSED",
        reviewStatus: "AI_EXTRACTED",
        sourcePage: page.pageNumber,
        sourceRefs: [makeSourceRef(page, snippet)],
      });
    }

    // 回退：段落内 M-code
    M_CODE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = M_CODE_RE.exec(text)) !== null) {
      const code = `M${m[1]}`;
      if (byCode.has(code)) continue;
      const from = m.index;
      const rest = text.slice(from, from + 240);
      const bodyMatch = rest.match(
        /^M\s*(?:[1-9]|1[0-5])\s*[\.\:\-\)]?\s*([^\n]{8,200})/i,
      );
      const body = bodyMatch?.[1]?.trim() ?? snippetAround(text, from);
      const snippet = snippetAround(text, from);
      byCode.set(code, {
        requirementCode: code,
        category: "mandatory_technical",
        originalRequirement: body,
        chineseTranslation: translateRequirement(body),
        mandatory: true,
        evidenceRequired: /certificate|test|sample|evidence|proof/i.test(body),
        complianceStatus: "NOT_ASSESSED",
        reviewStatus: "AI_EXTRACTED",
        sourcePage: page.pageNumber,
        sourceRefs: [makeSourceRef(page, snippet)],
      });
    }
  }

  const allText = pages.map((p) => p.contentText).join("\n");
  if (looksLikeRcmpBackpackRfp(allText)) {
    for (let i = 1; i <= 15; i++) {
      const code = `M${i}`;
      if (byCode.has(code)) continue;
      byCode.set(code, {
        requirementCode: code,
        category: "mandatory_technical",
        originalRequirement: `(Missing in extracted text) Mandatory technical criterion ${code}`,
        chineseTranslation: `未在正文中定位到 ${code} 原文，需人工核对招标附件（NEEDS_CLARIFICATION）`,
        mandatory: true,
        evidenceRequired: false,
        complianceStatus: "NEEDS_CLARIFICATION",
        reviewStatus: "AI_EXTRACTED",
        sourcePage: null,
        sourceRefs: [],
      });
    }
  }

  return Array.from(byCode.values()).sort((a, b) => {
    const na = Number(a.requirementCode.replace(/\D/g, ""));
    const nb = Number(b.requirementCode.replace(/\D/g, ""));
    return na - nb;
  });
}
