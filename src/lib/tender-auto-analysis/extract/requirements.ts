/**
 * 强制技术要求抽取（确定性优先）
 * - 保留 M1–M15（RCMP 类）
 * - Phase 1.1.1：通用 shall/must/required + 跨文档 dedupe
 */

import { normalizeRequirementFingerprint } from "../hash";
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
  { pattern: /submit|submission|proposal/i, zh: "提交/投标文件要求" },
  { pattern: /insurance|liability|indemnif/i, zh: "保险/责任要求" },
  { pattern: /warranty|guarantee/i, zh: "质保要求" },
  { pattern: /deliver|schedule|completion/i, zh: "交付/工期要求" },
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
  method = "regex_m_code",
): SourceRefCandidate {
  return {
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    originalTextSnippet: snippet.slice(0, 400),
    sectionLabel: "Mandatory Technical",
    extractionMethod: method,
    confidence: "HIGH_CONFIDENCE",
  };
}

function normalizeBody(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 合并同 code / 同正文指纹的 Requirement；冲突不覆盖，追加 conflict 标记。
 */
export function dedupeRequirementCandidates(
  items: RequirementCandidate[],
): RequirementCandidate[] {
  const byKey = new Map<string, RequirementCandidate>();

  for (const item of items) {
    const codeKey = item.requirementCode.trim().toUpperCase();
    const textFp = normalizeRequirementFingerprint(item.originalRequirement);
    const key =
      codeKey && !codeKey.startsWith("GEN-")
        ? `code:${codeKey}`
        : `text:${textFp}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...item,
        sourceRefs: [...item.sourceRefs],
      });
      continue;
    }

    // 合并 SourceRefs（跨文档）
    const seen = new Set(
      existing.sourceRefs.map(
        (r) => `${r.documentId}:${r.pageNumber}:${r.originalTextSnippet.slice(0, 40)}`,
      ),
    );
    for (const ref of item.sourceRefs) {
      const sk = `${ref.documentId}:${ref.pageNumber}:${ref.originalTextSnippet.slice(0, 40)}`;
      if (!seen.has(sk)) {
        existing.sourceRefs.push(ref);
        seen.add(sk);
      }
    }

    const a = normalizeBody(existing.originalRequirement).toLowerCase();
    const b = normalizeBody(item.originalRequirement).toLowerCase();
    if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
      // 冲突：不覆盖正文，标记需澄清
      existing.complianceStatus = "NEEDS_CLARIFICATION";
      existing.chineseTranslation = `${existing.chineseTranslation}\n【DOCUMENT_CONFLICT】多文档对同一要求表述冲突，需人工确认。`;
      if (!existing.originalRequirement.includes("[DOCUMENT_CONFLICT]")) {
        existing.originalRequirement = `${existing.originalRequirement}\n[DOCUMENT_CONFLICT] ${item.originalRequirement}`;
      }
    }
  }

  return Array.from(byKey.values());
}

/** 通用强制语气行：bidder/contractor/offeror shall|must|is required */
const GENERIC_MANDATORY_LINE =
  /^\s*((?:the\s+)?(?:bidder|contractor|offeror|proponent|supplier|vendor)s?\s+)?(?:shall|must|is\s+required\s+to)\b(.+)$/i;

const GENERIC_REQUIRED_LINE =
  /^\s*(?:it\s+is\s+)?(?:mandatory|required)\s+(?:that|to)\b(.+)$/i;

function extractGenericMandatory(
  pages: PageInput[],
): RequirementCandidate[] {
  const out: RequirementCandidate[] = [];
  let seq = 0;
  const seenFp = new Set<string>();

  for (const page of pages) {
    const text = page.contentText ?? "";
    if (!text.trim()) continue;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 24 || trimmed.length > 500) continue;
      // 跳过已由 M-code 覆盖的行
      if (/^\s*M\s*(?:[1-9]|1[0-5])\b/i.test(trimmed)) continue;

      let body: string | null = null;
      let m = trimmed.match(GENERIC_MANDATORY_LINE);
      if (m) {
        body = normalizeBody((m[1] ? m[0] : `Shall${m[2]}`).replace(/^\s*/, ""));
        // 使用完整行更稳
        body = normalizeBody(trimmed);
      } else {
        m = trimmed.match(GENERIC_REQUIRED_LINE);
        if (m) body = normalizeBody(trimmed);
      }
      if (!body) continue;

      const fp = normalizeRequirementFingerprint(body);
      if (seenFp.has(fp)) {
        // 同正文：追加 source（由后续 dedupe 合并）
      } else {
        seenFp.add(fp);
      }

      seq += 1;
      const code = `GEN-${String(seq).padStart(3, "0")}`;
      out.push({
        requirementCode: code,
        category: "mandatory_general",
        originalRequirement: body,
        chineseTranslation: translateRequirement(body),
        mandatory: true,
        evidenceRequired: /certificate|test|sample|evidence|proof|submit/i.test(
          body,
        ),
        complianceStatus: "NOT_ASSESSED",
        reviewStatus: "AI_EXTRACTED",
        sourcePage: page.pageNumber,
        sourceRefs: [makeSourceRef(page, trimmed.slice(0, 400), "regex_shall_must")],
      });
    }
  }

  // GEN 码按正文指纹去重（跨页重复 shall 句）
  return dedupeRequirementCandidates(out).map((r, i) => ({
    ...r,
    requirementCode: r.requirementCode.startsWith("GEN-")
      ? `GEN-${String(i + 1).padStart(3, "0")}`
      : r.requirementCode,
  }));
}

/**
 * 从页文本抽取要求（M1–M15 + 通用 mandatory language）。
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
      if (!body) continue;
      if (byCode.has(code)) {
        const existing = byCode.get(code)!;
        existing.sourceRefs.push(makeSourceRef(page, line.trim().slice(0, 400)));
        const a = normalizeBody(existing.originalRequirement).toLowerCase();
        const b = normalizeBody(body).toLowerCase();
        if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
          existing.complianceStatus = "NEEDS_CLARIFICATION";
          existing.chineseTranslation = `${existing.chineseTranslation}\n【DOCUMENT_CONFLICT】多文档对 ${code} 表述冲突。`;
          if (!existing.originalRequirement.includes("[DOCUMENT_CONFLICT]")) {
            existing.originalRequirement = `${existing.originalRequirement}\n[DOCUMENT_CONFLICT] ${body}`;
          }
        }
        continue;
      }
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
      if (byCode.has(code)) {
        const existing = byCode.get(code)!;
        existing.sourceRefs.push(
          makeSourceRef(page, snippetAround(text, m.index)),
        );
        continue;
      }
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

  const coded = Array.from(byCode.values());
  const generic = extractGenericMandatory(pages);

  // 通用句与 M-code 正文去重：若 generic 正文已被 M 覆盖则丢弃
  const codedBodies = new Set(
    coded.map((c) => normalizeRequirementFingerprint(c.originalRequirement)),
  );
  const genericFiltered = generic.filter(
    (g) => !codedBodies.has(normalizeRequirementFingerprint(g.originalRequirement)),
  );

  const merged = dedupeRequirementCandidates([...coded, ...genericFiltered]);

  return merged.sort((a, b) => {
    const aM = /^M\d/i.test(a.requirementCode);
    const bM = /^M\d/i.test(b.requirementCode);
    if (aM && bM) {
      return (
        Number(a.requirementCode.replace(/\D/g, "")) -
        Number(b.requirementCode.replace(/\D/g, ""))
      );
    }
    if (aM !== bM) return aM ? -1 : 1;
    return a.requirementCode.localeCompare(b.requirementCode);
  });
}
