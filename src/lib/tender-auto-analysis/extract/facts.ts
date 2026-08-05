/**
 * 确定性优先的事实抽取（RCMP 类 RFP + 通用招标字段）
 * 禁止编造历史中标/供应商/工厂名；数量歧义必须保留。
 */

import { assertSourceSnippet } from "../source-verify";
import { parseClosingFromText } from "./closing";
import type { FactCandidate, PageInput, SourceRefCandidate } from "./types";

type RuleMatch = {
  factKey: string;
  contentZh: string;
  contentOriginal: string;
  statementKind: FactCandidate["statementKind"];
  confidence: FactCandidate["confidence"];
  snippet: string;
  sectionLabel?: string;
};

function ref(
  page: PageInput,
  snippet: string,
  method: string,
  confidence: SourceRefCandidate["confidence"] = "CONFIRMED",
): SourceRefCandidate {
  return {
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    originalTextSnippet: snippet.replace(/\s+/g, " ").trim().slice(0, 400),
    sectionLabel: null,
    extractionMethod: method,
    confidence,
  };
}

function firstMatch(
  pages: PageInput[],
  re: RegExp,
): { page: PageInput; match: RegExpMatchArray } | null {
  for (const page of pages) {
    const match = page.contentText.match(re);
    if (match) return { page, match };
  }
  return null;
}

function pushVerified(
  out: FactCandidate[],
  page: PageInput,
  rule: RuleMatch,
  method: string,
): void {
  const sourceRef = ref(page, rule.snippet, method, rule.confidence);
  const verified = assertSourceSnippet({
    snippet: sourceRef.originalTextSnippet,
    pageText: page.contentText,
    statementKind: rule.statementKind,
    confidence: rule.confidence,
  });
  out.push({
    factKey: rule.factKey,
    statementKind: verified.statementKind,
    contentZh: rule.contentZh,
    contentOriginal: rule.contentOriginal,
    confidence: verified.confidence,
    sourceRefs: [
      {
        ...sourceRef,
        confidence: verified.confidence,
      },
    ],
  });
}

/** 数量歧义：Annex A / Annex B / 7500 评估汇总数 */
function extractQuantityFacts(pages: PageInput[], out: FactCandidate[]): void {
  const annexA = firstMatch(
    pages,
    /up\s+to\s+1[,.]?500\s+per\s+contract\s+period/i,
  );
  if (annexA) {
    const snippet = annexA.match[0]!;
    pushVerified(
      out,
      annexA.page,
      {
        factKey: "qty_annex_a_up_to_1500_per_period",
        contentZh:
          "Annex A 载明「每个合同期最多 1,500」（Up to 1500 per contract period）。此为上限表述，不等于保证采购量，存在口径歧义，需澄清。",
        contentOriginal: snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: "Annex A",
      },
      "regex_quantity_annex_a",
    );
  }

  const annexB = firstMatch(
    pages,
    /1[,.]500\s*(?:units?\s*)?(?:per\s*year|annual|\/\s*year|each\s*year)/i,
  );
  const annexBAlt = annexB
    ? null
    : firstMatch(
        pages,
        /(?:evaluation\s+quantit(?:y|ies)|annual\s+quantit(?:y|ies))[^\n]{0,40}1[,.]500/i,
      );
  const bHit = annexB ?? annexBAlt;
  if (bHit) {
    const snippet = bHit.match[0]!;
    pushVerified(
      out,
      bHit.page,
      {
        factKey: "qty_annex_b_1500_annual_evaluation",
        contentZh:
          "Annex B / 评标数量载明年度评估量 1,500。该数字用于评标测算，不应直接等同于承诺采购量。",
        contentOriginal: snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: "Annex B",
      },
      "regex_quantity_annex_b",
    );
  }

  const agg = firstMatch(pages, /7[,.]500/);
  if (agg) {
    const snippet = agg.match[0]!;
    // 7,500 仅作为评估合计解释，绝不当作保证采购
    const page = agg.page;
    const verified = assertSourceSnippet({
      snippet,
      pageText: page.contentText,
      statementKind: "DOCUMENT_INTERPRETATION",
      confidence: "HIGH_CONFIDENCE",
    });
    out.push({
      factKey: "qty_7500_evaluation_aggregate_not_guarantee",
      statementKind: verified.statementKind,
      contentZh:
        "文中出现 7,500：按「年度评估量 × 合同年数」可解释为评标用合计数量（evaluation aggregate），不是保证采购量（NOT a guaranteed purchase）。投标报价与产能规划必须区分评估量与实际 call-up。",
      contentOriginal: snippet,
      confidence: verified.confidence,
      sourceRefs: [ref(page, snippet, "regex_quantity_7500", verified.confidence)],
    });

    out.push({
      factKey: "qty_ambiguity_interpretation",
      statementKind: "DOCUMENT_INTERPRETATION",
      contentZh:
        "数量口径存在歧义：Annex A「Up to 1500 per contract period」与 Annex B 年度 1,500 评标量并存；7,500 仅宜视为评估合计。须通过澄清确认 call-up 最小/最大/典型量及是否存在保底。",
      contentOriginal:
        "Up to 1500 per contract period / 1,500 annual / 7,500 evaluation aggregate",
      confidence: "HIGH_CONFIDENCE",
      sourceRefs: annexA
        ? [ref(annexA.page, annexA.match[0]!, "quantity_ambiguity", "HIGH_CONFIDENCE")]
        : agg
          ? [ref(agg.page, snippet, "quantity_ambiguity", "HIGH_CONFIDENCE")]
          : [],
    });
  } else if (annexA || bHit) {
    out.push({
      factKey: "qty_ambiguity_interpretation",
      statementKind: "DOCUMENT_INTERPRETATION",
      contentZh:
        "数量口径存在歧义：同时出现合同期上限与年度评标量表述，不能视为保证采购；需澄清实际 call-up 机制。",
      contentOriginal: "quantity ambiguity between contract-period cap and annual evaluation qty",
      confidence: "HIGH_CONFIDENCE",
      sourceRefs: annexA
        ? [ref(annexA.page, annexA.match[0]!, "quantity_ambiguity", "HIGH_CONFIDENCE")]
        : bHit
          ? [ref(bHit.page, bHit.match[0]!, "quantity_ambiguity", "HIGH_CONFIDENCE")]
          : [],
    });
  }
}

function extractSimpleFacts(pages: PageInput[], out: FactCandidate[]): void {
  const rules: Array<{
    factKey: string;
    re: RegExp;
    zh: (m: RegExpMatchArray) => string;
    kind?: FactCandidate["statementKind"];
  }> = [
    {
      factKey: "project_name",
      re: /Backpacks\s+for\s+Cadets/i,
      zh: () => "项目名称：Cadets 背包采购（Backpacks for Cadets）",
    },
    {
      factKey: "solicitation_number",
      re: /\b(M5000-[0-9A-Z-]+)\b/i,
      zh: (m) => `招标编号（Solicitation）：${m[1]}`,
    },
    {
      factKey: "buyer_rcmp",
      re: /\bRCMP\b|Royal Canadian Mounted Police/i,
      zh: (m) => `采购方：${/Royal Canadian Mounted Police/i.test(m[0]) ? "加拿大皇家骑警（RCMP）" : "RCMP"}`,
    },
    {
      factKey: "delivery_ddp_regina",
      re: /DDP\s+Regina/i,
      zh: () => "交货条件：DDP Regina（完税交货至 Regina）",
    },
    {
      factKey: "delivery_lead_time_30_days",
      re: /\b30\s*days\b/i,
      zh: () => "供货周期相关表述含 30 days（需对照条款确认起算点）",
    },
    {
      factKey: "email_size_5mb",
      re: /\b5\s*MB\b/i,
      zh: () => "投标邮件附件限制：不超过 5MB",
    },
    {
      factKey: "three_pdfs",
      re: /three\s+PDFs?|3\s+PDFs?/i,
      zh: () => "投标提交需准备三份 PDF（three PDFs）",
    },
    {
      factKey: "reciprocal_procurement",
      re: /Reciprocal\s+Procurement/i,
      zh: () => "涉及 Reciprocal Procurement（对等采购）声明要求",
    },
    {
      factKey: "contract_period",
      re: /(?:contract\s+period|period\s+of\s+the\s+contract)[^\n]{0,60}/i,
      zh: (m) => `合同期相关原文：${m[0]!.replace(/\s+/g, " ").trim().slice(0, 160)}`,
    },
  ];

  for (const rule of rules) {
    if (out.some((f) => f.factKey === rule.factKey)) continue;
    const hit = firstMatch(pages, rule.re);
    if (!hit) continue;
    const snippet = hit.match[0]!;
    pushVerified(
      out,
      hit.page,
      {
        factKey: rule.factKey,
        contentZh: rule.zh(hit.match),
        contentOriginal: snippet,
        statementKind: rule.kind ?? "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
      },
      `regex_${rule.factKey}`,
    );
  }

  // closing
  for (const page of pages) {
    const closing = parseClosingFromText(page.contentText);
    if (!closing) continue;
    pushVerified(
      out,
      page,
      {
        factKey: "closing_datetime",
        contentZh: `截标时间：${closing.closingRaw}${
          closing.timezoneLabel ? `（时区标签 ${closing.timezoneLabel}）` : ""
        }`,
        contentOriginal: closing.closingRaw,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet: closing.closingRaw,
      },
      "regex_closing",
    );
    if (closing.enquiryDeadline) {
      const y = closing.enquiryDeadline.toISOString().slice(0, 10);
      out.push({
        factKey: "enquiry_deadline_minus_5_days",
        statementKind: "DOCUMENT_INTERPRETATION",
        contentZh: `询价/澄清截止日按「截标日 − 5 个日历日」估算为 ${y}（时区标签 ${
          closing.timezoneLabel ?? "未知"
        }；若原文另有规定以原文为准）`,
        contentOriginal: closing.closingRaw,
        confidence: "HIGH_CONFIDENCE",
        sourceRefs: [
          ref(page, closing.closingRaw, "enquiry_deadline_rule", "HIGH_CONFIDENCE"),
        ],
      });
    }
    break;
  }
}

/**
 * 从多页文本抽取事实；对每条 CONFIRMED_FACT 做 source-verify。
 */
export function extractFactsFromPages(pages: PageInput[]): FactCandidate[] {
  const out: FactCandidate[] = [];
  extractSimpleFacts(pages, out);
  extractQuantityFacts(pages, out);

  // 去重 factKey（保留首个）
  const seen = new Set<string>();
  return out.filter((f) => {
    if (seen.has(f.factKey)) return false;
    seen.add(f.factKey);
    return true;
  });
}

/** 汇总给报告 / 调查室使用的结构化摘要字段（无虚构） */
export function summarizeExtractedFacts(facts: FactCandidate[]): {
  projectName: string | null;
  solicitationNumber: string | null;
  procurementType: string | null;
  closing: string | null;
  contractPeriod: string | null;
  evaluationMethod: string | null;
  evaluationQuantity: string | null;
  purchaseGuarantee: string;
  topRisks: string[];
} {
  const byKey = new Map(facts.map((f) => [f.factKey, f]));
  const getOriginal = (k: string) => byKey.get(k)?.contentOriginal ?? null;
  const getZh = (k: string) => byKey.get(k)?.contentZh ?? null;

  const topRisks: string[] = [];
  if (byKey.has("qty_ambiguity_interpretation")) {
    topRisks.push("数量口径歧义：合同期上限 vs 评标年量；7,500 非保证采购");
  }
  if (byKey.has("email_size_5mb")) {
    topRisks.push("投标邮件附件须控制在 5MB 以内");
  }
  if (byKey.has("reciprocal_procurement")) {
    topRisks.push("需 Reciprocal Procurement 声明，资格合规风险");
  }
  if (byKey.has("delivery_ddp_regina")) {
    topRisks.push("DDP Regina 跨境物流与关税成本风险");
  }

  return {
    projectName: getOriginal("project_name") ?? getZh("project_name"),
    solicitationNumber: getOriginal("solicitation_number"),
    procurementType: byKey.has("reciprocal_procurement")
      ? "Government RFP / Reciprocal Procurement"
      : null,
    closing: getOriginal("closing_datetime"),
    contractPeriod: getOriginal("contract_period"),
    evaluationMethod: byKey.has("qty_annex_b_1500_annual_evaluation")
      ? "价格评标（含年度评估量）"
      : null,
    evaluationQuantity: byKey.has("qty_annex_b_1500_annual_evaluation")
      ? "1,500 / year（评标）；7,500 可为评估合计"
      : byKey.has("qty_annex_a_up_to_1500_per_period")
        ? "Up to 1500 per contract period（上限，非保证）"
        : null,
    purchaseGuarantee: "无保证采购；7,500 不得视为 guaranteed purchase",
    topRisks,
  };
}
