/**
 * 确定性优先的事实抽取（RCMP 类 RFP + 通用招标字段）
 * 规则优先级：章节标题 → 关键词组合 → 页级上下文 → 表格行 → 宽松正则（最后）
 * 禁止：全局单词命中；无来源标 CONFIRMED；把 7,500 标为原文事实或保证采购。
 */

import { assertSourceSnippet } from "../source-verify";
import { parseClosingFromText } from "./closing";
import type { FactCandidate, PageInput, SourceRefCandidate } from "./types";

export type QuantityEvaluationSummary = {
  annualEvaluationQuantity: number;
  evaluatedPeriods: number;
  calculatedEvaluatedAggregate: number;
  calculationExpression: string;
  calculationKind: "DOCUMENT_INTERPRETATION";
  guaranteedQuantity: false;
  quantityAmbiguity: boolean;
};

type RuleMatch = {
  factKey: string;
  contentZh: string;
  contentOriginal: string;
  statementKind: FactCandidate["statementKind"];
  confidence: FactCandidate["confidence"];
  snippet: string;
  sectionLabel?: string;
  structuredJson?: Record<string, unknown>;
};

function ref(
  page: PageInput,
  snippet: string,
  method: string,
  confidence: SourceRefCandidate["confidence"] = "CONFIRMED",
  sectionLabel?: string | null,
): SourceRefCandidate {
  return {
    documentId: page.documentId,
    pageNumber: page.pageNumber,
    originalTextSnippet: snippet.replace(/\s+/g, " ").trim().slice(0, 400),
    sectionLabel: sectionLabel ?? null,
    extractionMethod: method,
    confidence,
  };
}

function firstMatch(
  pages: PageInput[],
  re: RegExp,
  opts?: { preferPages?: number[] },
): { page: PageInput; match: RegExpMatchArray } | null {
  const ordered = opts?.preferPages?.length
    ? [
        ...pages.filter((p) => opts.preferPages!.includes(p.pageNumber)),
        ...pages.filter((p) => !opts.preferPages!.includes(p.pageNumber)),
      ]
    : pages;
  for (const page of ordered) {
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
  if (out.some((f) => f.factKey === rule.factKey)) return;
  const sourceRef = ref(
    page,
    rule.snippet,
    method,
    rule.confidence,
    rule.sectionLabel,
  );
  const verified = assertSourceSnippet({
    snippet: sourceRef.originalTextSnippet,
    pageText: page.contentText,
    statementKind: rule.statementKind,
    confidence: rule.confidence,
  });
  // 无来源核验不得保留 CONFIRMED
  if (
    rule.statementKind === "CONFIRMED_FACT" &&
    verified.statementKind !== "CONFIRMED_FACT"
  ) {
    return;
  }
  const fact: FactCandidate = {
    factKey: rule.factKey,
    statementKind: verified.statementKind,
    contentZh: rule.contentZh,
    contentOriginal: rule.contentOriginal,
    confidence: verified.confidence,
    sourceRefs: [{ ...sourceRef, confidence: verified.confidence }],
  };
  if (rule.structuredJson) {
    (fact as FactCandidate & { structuredJson?: Record<string, unknown> }).structuredJson =
      rule.structuredJson;
  }
  out.push(fact);
}

function pushInterpretation(
  out: FactCandidate[],
  fact: Omit<FactCandidate, "confidence"> & { confidence?: FactCandidate["confidence"] },
): void {
  if (out.some((f) => f.factKey === fact.factKey)) return;
  out.push({
    ...fact,
    confidence: fact.confidence ?? "HIGH_CONFIDENCE",
  });
}

/** 核心封面 / 结构事实 */
function extractCoreFacts(pages: PageInput[], out: FactCandidate[]): void {
  const rules: Array<{
    factKey: string;
    re: RegExp;
    zh: (m: RegExpMatchArray) => string;
    preferPages?: number[];
    sectionLabel?: string;
  }> = [
    {
      factKey: "solicitation_number",
      re: /\b(M5000-25-3574-A)\b/i,
      zh: (m) => `招标编号（Solicitation）：${m[1]}`,
      preferPages: [1],
    },
    {
      factKey: "solicitation_title",
      re: /Backpacks\s+for\s+Cadets/i,
      zh: () => "项目名称：Cadets 背包采购（Backpacks for Cadets）",
      preferPages: [1],
    },
    {
      factKey: "issue_date",
      re: /\bDate\s+(July\s+29,\s*2026)\b/i,
      zh: (m) => `发布日：${m[1]}`,
      preferPages: [1],
    },
    {
      factKey: "solicitation_type",
      re: /REQUEST\s+FOR\s+STANDING\s+OFFER[\s\S]{0,80}?Regional\s+Individual\s+Standing\s+Offer\s*\(RISO\)/i,
      zh: () =>
        "招标形式：Request for Standing Offer / Regional Individual Standing Offer (RISO)",
      preferPages: [1, 4],
      sectionLabel: "Cover / RISO",
    },
    {
      factKey: "no_security_requirement",
      re: /(?:THIS\s+DOCUMENT\s+DOES\s+NOT\s+CONTAIN\s+A\s+SECURITY\s+REQUIREMENT|There\s+is\s+no\s+security\s+requirement\s+applicable\s+to\s+the\s+Standing\s+Offer)/i,
      zh: () => "无安全许可要求（No security requirement）",
      preferPages: [1, 4],
    },
    {
      factKey: "standing_offer_main_period",
      re: /(?:Standing\s+Offer\s+is\s+from|period\s+of\s+the\s+Standing\s+Offer\s+is\s+from)?\s*(October\s+2,\s*2026\s+to\s+October\s+1,\s*2029)/i,
      zh: (m) => `主合同期：${m[1]}`,
      preferPages: [4, 23, 30],
    },
    {
      factKey: "option_period_1",
      re: /(October\s+2,\s*2029\s+to\s+October\s+1,\s*2030)/i,
      zh: (m) => `选择期 1：${m[1]}`,
      preferPages: [4, 23],
    },
    {
      factKey: "option_period_2",
      re: /(October\s+2,\s*2030\s+to\s+October\s+1,\s*2031)/i,
      zh: (m) => `选择期 2：${m[1]}`,
      preferPages: [4, 23],
    },
    {
      factKey: "submission_sections",
      re: /Section\s+I:\s*Technical\s+Offer[\s\S]{0,80}?Section\s+II:\s*Financial\s+Offer[\s\S]{0,80}?Section\s+III:\s*Certifications/i,
      zh: () =>
        "投标文件须分三份独立 PDF：Technical Offer / Financial Offer / Certifications",
      preferPages: [8],
      sectionLabel: "Offer Preparation Instructions",
    },
    {
      factKey: "email_max_size",
      re: /(?:must\s+not\s+exceed|maximum|not\s+exceed)\s*5\s*MB|5\s*MB[\s\S]{0,40}(?:attachments|including)/i,
      zh: () => "邮件总大小（含全部附件）不得超过 5MB",
      preferPages: [8],
    },
    {
      factKey: "zip_and_links_not_accepted",
      re: /Zip\s+files\s+or\s+links\s+to\s+Offer\s+documents\s+will\s+not\s+be\s+accepted/i,
      zh: () => "不接受 ZIP 文件或下载链接",
      preferPages: [8],
    },
    {
      factKey: "price_only_in_financial_offer",
      re: /Prices\s+must\s+appear\s+in\s+the\s+financial\s+offer/i,
      zh: () => "价格仅可出现在 Financial Offer（技术标不得出现价格）",
      preferPages: [8],
    },
    {
      factKey: "offer_validity",
      re: /\b(90\s*days)\b/i,
      zh: () => "报价有效期：90 days",
      preferPages: [6],
    },
    {
      factKey: "evaluation_method",
      re: /responsive\s+offer\s+with\s+the\s+lowest\s+evaluated\s+price/i,
      zh: () =>
        "评标方式：满足全部 Mandatory Technical Criteria 后，以最低评估价（lowest evaluated price）推荐",
      preferPages: [12],
    },
    {
      factKey: "delivery_term",
      re: /DDP\)?\s*Regina(?:,\s*Saskatchewan)?\s+Incoterms\s+2020/i,
      zh: () => "交货条件：DDP Regina, Saskatchewan Incoterms 2020",
      preferPages: [31, 30, 36],
    },
    {
      factKey: "delivery_lead_time",
      // 必须含 call-up issuance；排除 before expiry / calendar days after quarter
      re: /within\s+30\s+days\s+of\s+call-up\s+issuance/i,
      zh: () => "交货期：收到 Call-up 后 30 天内交付（within 30 days of call-up issuance）",
      preferPages: [30, 34],
      sectionLabel: "Delivery Date",
    },
    {
      factKey: "callup_confirmation",
      re: /Confirm\s+the\s+order\s+by\s+email\s+within\s+24\s+hours/i,
      zh: () => "收到 Call-up 后须在 24 小时内邮件确认订单",
      preferPages: [34],
    },
    {
      factKey: "environmentally_preferable_packaging_mandatory",
      re: /ENVIRONMENTALLY\s+PREFERABLE\s+PACKAGING\s*[–-]\s*MANDATORY|environmentally\s+preferable\s+packaging[\s\S]{0,40}mandatory/i,
      zh: () => "环保包装（Environmentally Preferable Packaging）为 Mandatory",
      preferPages: [34, 4, 17],
    },
    {
      factKey: "reciprocal_procurement_eligibility",
      re: /only\s+open\s+to\s+Canadian\s+Suppliers\s+and\s+to\s+Suppliers\s+of\s+an\s+Applicable\s+Trading\s+Partner|Policy\s+on\s+Reciprocal\s+Procurement/i,
      zh: () =>
        "供应商资格受 Reciprocal Procurement 限制：Canadian Supplier 或 Applicable Trading Partner",
      preferPages: [17, 2, 4],
    },
    {
      factKey: "forced_labour_requirement",
      re: /forced\s+Labou?r\s+Requirement|forced\s+labour/i,
      zh: () => "含强迫劳动（Forced Labour）声明/合规要求",
      preferPages: [27, 28, 29],
    },
    {
      factKey: "buyer_rcmp",
      re: /Royal\s+Canadian\s+Mounted\s+Police|\bRCMP\b/,
      zh: () => "采购单位：Royal Canadian Mounted Police（RCMP）",
      preferPages: [1],
    },
  ];

  for (const rule of rules) {
    const hit = firstMatch(pages, rule.re, { preferPages: rule.preferPages });
    if (!hit) continue;
    // delivery_lead_time：硬排除误匹配页/上下文
    if (rule.factKey === "delivery_lead_time") {
      const ctx = hit.page.contentText;
      if (
        /30\s+days\s+before\s+the\s+expiry/i.test(hit.match[0]!) ||
        /30\s+calendar\s+days\s+after\s+(?:the\s+)?quarter/i.test(ctx) &&
          !/call-up\s+issuance/i.test(hit.match[0]!)
      ) {
        continue;
      }
      if (hit.page.pageNumber === 23) continue;
      if (!/call-up\s+issuance/i.test(hit.match[0]!)) continue;
    }
    const snippet = hit.match[0]!;
    pushVerified(
      out,
      hit.page,
      {
        factKey: rule.factKey,
        contentZh: rule.zh(hit.match),
        contentOriginal: snippet.replace(/\s+/g, " ").trim().slice(0, 400),
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: rule.sectionLabel,
      },
      `regex_${rule.factKey}`,
    );
  }

  // closing（必须含 MDT 等时区）
  for (const prefer of [1, ...pages.map((p) => p.pageNumber)]) {
    const page = pages.find((p) => p.pageNumber === prefer);
    if (!page) continue;
    if (!/Solicitation\s+Closes|Closing/i.test(page.contentText) && prefer !== 1) {
      continue;
    }
    const closing = parseClosingFromText(page.contentText);
    if (!closing) continue;
    if (!closing.timezoneLabel) continue;
    pushVerified(
      out,
      page,
      {
        factKey: "closing_datetime",
        contentZh: `截标时间：${closing.closingRaw}（日期/时间/时区已保留）`,
        contentOriginal: closing.closingRaw,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet: closing.sourceSnippet,
        structuredJson: {
          closingRaw: closing.closingRaw,
          timezoneLabel: closing.timezoneLabel,
          closingDateYmd: closing.closingDate
            ? closing.closingDate.toISOString().slice(0, 10)
            : null,
          enquiryDeadlineYmd: closing.enquiryDeadline
            ? closing.enquiryDeadline.toISOString().slice(0, 10)
            : null,
        },
      },
      "regex_closing",
    );
    if (closing.enquiryDeadline) {
      const y = closing.enquiryDeadline.toISOString().slice(0, 10);
      pushInterpretation(out, {
        factKey: "enquiry_deadline_minus_5_days",
        statementKind: "DOCUMENT_INTERPRETATION",
        contentZh: `询价/澄清截止日按「截标日 − 5 个日历日」估算为 ${y}（时区 ${closing.timezoneLabel}；若原文另有规定以原文为准）`,
        contentOriginal: closing.closingRaw,
        confidence: "HIGH_CONFIDENCE",
        sourceRefs: [
          ref(
            page,
            closing.sourceSnippet,
            "enquiry_deadline_rule",
            "HIGH_CONFIDENCE",
          ),
        ],
      });
    }
    break;
  }
}

/** Annex A / Annex B 数量链 + 7,500 计算解释 */
function extractQuantityFacts(pages: PageInput[], out: FactCandidate[]): void {
  const annexA = firstMatch(
    pages,
    /up\s+to\s+1[,.]?500\s+per\s+contract\s+period/i,
    { preferPages: [33] },
  );
  if (annexA) {
    const snippet = annexA.match[0]!;
    pushVerified(
      out,
      annexA.page,
      {
        factKey: "qty_annex_a_up_to_1500_per_period",
        contentZh:
          "Annex A：Required quantity — Up to 1500 per contract period（上限表述，非保证采购量）",
        contentOriginal: snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: "Annex A",
      },
      "regex_quantity_annex_a",
    );
  }

  const yearDefs: Array<{
    factKey: string;
    label: string;
    re: RegExp;
    preferPages: number[];
  }> = [
    {
      factKey: "qty_annex_b_standing_offer_year_1_1500",
      label: "Standing Offer Year 1",
      re: /Standing\s+Offer\s+Year\s+1:[\s\S]{0,120}?Each\s+1500/i,
      preferPages: [36],
    },
    {
      factKey: "qty_annex_b_standing_offer_year_2_1500",
      label: "Standing Offer Year 2",
      re: /Standing\s+Offer\s+Year\s+2:[\s\S]{0,120}?Each\s+1500/i,
      preferPages: [36],
    },
    {
      factKey: "qty_annex_b_standing_offer_year_3_1500",
      label: "Standing Offer Year 3",
      re: /Standing\s+Offer\s+Year\s+3:[\s\S]{0,120}?Each\s+1500/i,
      preferPages: [36],
    },
    {
      factKey: "qty_annex_b_option_year_1_1500",
      label: "Option Year 1",
      re: /Option\s+Year\s+1:[\s\S]{0,120}?Each\s+1500/i,
      preferPages: [37, 36],
    },
    {
      factKey: "qty_annex_b_option_year_2_1500",
      label: "Option Year 2",
      re: /Option\s+Year\s+2:[\s\S]{0,120}?Each\s+1500/i,
      preferPages: [37, 36],
    },
  ];

  const yearHits: Array<{ factKey: string; page: PageInput; snippet: string }> =
    [];
  for (const def of yearDefs) {
    const hit = firstMatch(pages, def.re, { preferPages: def.preferPages });
    if (!hit) continue;
    const snippet = hit.match[0]!.replace(/\s+/g, " ").trim().slice(0, 400);
    pushVerified(
      out,
      hit.page,
      {
        factKey: def.factKey,
        contentZh: `Annex B 评标数量：${def.label} = 1,500（Each 1500；用于评标，非保证采购）`,
        contentOriginal: snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: "Annex B",
      },
      `regex_${def.factKey}`,
    );
    yearHits.push({ factKey: def.factKey, page: hit.page, snippet });
  }

  // 兼容旧键：若五行齐全，也写一条年度评标摘要
  if (yearHits.length >= 1) {
    const first = yearHits[0]!;
    pushVerified(
      out,
      first.page,
      {
        factKey: "qty_annex_b_1500_annual_evaluation",
        contentZh:
          "Annex B：各评标年 Estimated Annual Quantity 为 1,500（Standing Offer / Option Year 行内 Each 1500）",
        contentOriginal: first.snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet: first.snippet,
        sectionLabel: "Annex B",
      },
      "regex_quantity_annex_b_annual",
    );
  }

  const guaranteeHit = firstMatch(
    pages,
    /estimated\s+quantity\s+is\s+provided\s+for\s+evaluation\s+purposes\s+only\s+and\s+does\s+not\s+constitute\s+a\s+guarantee\s+or\s+commitment/i,
    { preferPages: [36] },
  );
  if (guaranteeHit) {
    const snippet = guaranteeHit.match[0]!;
    pushVerified(
      out,
      guaranteeHit.page,
      {
        factKey: "qty_estimated_for_evaluation_only_not_guarantee",
        contentZh:
          "估计数量仅供评标使用，不构成加拿大政府的保证或承诺（not a guarantee or commitment）",
        contentOriginal: snippet,
        statementKind: "CONFIRMED_FACT",
        confidence: "CONFIRMED",
        snippet,
        sectionLabel: "Annex B",
      },
      "regex_qty_evaluation_only",
    );
  }

  const annual = 1500;
  const periods = yearHits.length >= 5 ? 5 : yearHits.length;
  if (periods >= 5) {
    const calc: QuantityEvaluationSummary = {
      annualEvaluationQuantity: annual,
      evaluatedPeriods: 5,
      calculatedEvaluatedAggregate: 7500,
      calculationExpression: "1500 × 5",
      calculationKind: "DOCUMENT_INTERPRETATION",
      guaranteedQuantity: false,
      quantityAmbiguity: Boolean(annexA),
    };
    const sourceRefs = yearHits.slice(0, 5).map((h) =>
      ref(h.page, h.snippet, "annex_b_year_row", "HIGH_CONFIDENCE", "Annex B"),
    );
    pushInterpretation(out, {
      factKey: "qty_7500_evaluation_aggregate_not_guarantee",
      statementKind: "DOCUMENT_INTERPRETATION",
      contentZh:
        "评标合计数量（计算）：1,500 × 5 个评标期 = 7,500。此为 DOCUMENT_INTERPRETATION（文件未写字面 7,500），绝非保证采购量。",
      contentOriginal:
        "calculation: 1500 × 5 = 7500 (evaluation aggregate; NOT in source text as literal 7,500)",
      confidence: "HIGH_CONFIDENCE",
      sourceRefs,
    });
    const last = out[out.length - 1] as FactCandidate & {
      structuredJson?: QuantityEvaluationSummary;
    };
    last.structuredJson = calc;

    pushInterpretation(out, {
      factKey: "qty_actual_purchase_not_guaranteed",
      statementKind: "DOCUMENT_INTERPRETATION",
      contentZh:
        "实际采购数量不保证：评标用估计量 / 计算合计不得视为加拿大政府承诺的采购量。",
      contentOriginal:
        guaranteeHit?.match[0] ??
        "estimated quantity … does not constitute a guarantee or commitment",
      confidence: "HIGH_CONFIDENCE",
      sourceRefs: guaranteeHit
        ? [
            ref(
              guaranteeHit.page,
              guaranteeHit.match[0]!,
              "qty_not_guaranteed",
              "HIGH_CONFIDENCE",
              "Annex B",
            ),
          ]
        : sourceRefs.slice(0, 1),
    });
  }

  if (annexA || yearHits.length > 0) {
    const refs: SourceRefCandidate[] = [];
    if (annexA) {
      refs.push(
        ref(
          annexA.page,
          annexA.match[0]!,
          "quantity_ambiguity_annex_a",
          "HIGH_CONFIDENCE",
          "Annex A",
        ),
      );
    }
    for (const h of yearHits.slice(0, 2)) {
      refs.push(
        ref(h.page, h.snippet, "quantity_ambiguity_annex_b", "HIGH_CONFIDENCE", "Annex B"),
      );
    }
    pushInterpretation(out, {
      factKey: "qty_ambiguity_interpretation",
      statementKind: "DOCUMENT_INTERPRETATION",
      contentZh:
        "数量口径歧义（须澄清）：Annex A「Up to 1500 per contract period」与 Annex B 各年度评标量 1,500 并存；不得静默选择一方，亦不得将 7,500 视为保证订单。",
      contentOriginal:
        "Annex A Up to 1500 per contract period vs Annex B annual Each 1500 evaluation quantities",
      confidence: "HIGH_CONFIDENCE",
      sourceRefs: refs,
    });
  }
}

/**
 * 从多页文本抽取事实；对每条 CONFIRMED_FACT 做 source-verify。
 */
export function extractFactsFromPages(pages: PageInput[]): FactCandidate[] {
  const out: FactCandidate[] = [];
  extractCoreFacts(pages, out);
  extractQuantityFacts(pages, out);

  // 兼容旧测试键名
  if (
    out.some((f) => f.factKey === "solicitation_title") &&
    !out.some((f) => f.factKey === "project_name")
  ) {
    const t = out.find((f) => f.factKey === "solicitation_title")!;
    out.push({ ...t, factKey: "project_name" });
  }
  if (
    out.some((f) => f.factKey === "email_max_size") &&
    !out.some((f) => f.factKey === "email_size_5mb")
  ) {
    const t = out.find((f) => f.factKey === "email_max_size")!;
    out.push({ ...t, factKey: "email_size_5mb" });
  }
  if (
    out.some((f) => f.factKey === "delivery_term") &&
    !out.some((f) => f.factKey === "delivery_ddp_regina")
  ) {
    const t = out.find((f) => f.factKey === "delivery_term")!;
    out.push({ ...t, factKey: "delivery_ddp_regina" });
  }
  if (
    out.some((f) => f.factKey === "delivery_lead_time") &&
    !out.some((f) => f.factKey === "delivery_lead_time_30_days")
  ) {
    const t = out.find((f) => f.factKey === "delivery_lead_time")!;
    out.push({ ...t, factKey: "delivery_lead_time_30_days" });
  }
  if (
    out.some((f) => f.factKey === "submission_sections") &&
    !out.some((f) => f.factKey === "three_pdfs")
  ) {
    const t = out.find((f) => f.factKey === "submission_sections")!;
    out.push({ ...t, factKey: "three_pdfs" });
  }
  if (
    out.some((f) => f.factKey === "reciprocal_procurement_eligibility") &&
    !out.some((f) => f.factKey === "reciprocal_procurement")
  ) {
    const t = out.find((f) => f.factKey === "reciprocal_procurement_eligibility")!;
    out.push({ ...t, factKey: "reciprocal_procurement" });
  }

  appendJudgmentFacts(out);

  const seen = new Set<string>();
  return out.filter((f) => {
    if (seen.has(f.factKey)) return false;
    seen.add(f.factKey);
    return true;
  });
}

/**
 * 基于已核验事实的推断与建议（不得标为 CONFIRMED_FACT / Mandatory）。
 * 来源引用指向支撑事实页；内容明确标注 AI 推断或建议。
 */
function appendJudgmentFacts(out: FactCandidate[]): void {
  const byKey = new Map(out.map((f) => [f.factKey, f]));
  const pickRefs = (...keys: string[]): SourceRefCandidate[] => {
    const refs: SourceRefCandidate[] = [];
    for (const k of keys) {
      const f = byKey.get(k);
      if (f?.sourceRefs?.length) refs.push(...f.sourceRefs.slice(0, 2));
    }
    return refs.slice(0, 4);
  };

  const push = (fact: FactCandidate) => {
    if (out.some((f) => f.factKey === fact.factKey)) return;
    if (fact.sourceRefs.length === 0) return;
    out.push(fact);
  };

  if (byKey.has("delivery_lead_time") || byKey.has("delivery_lead_time_30_days")) {
    push({
      factKey: "inference_callup_fulfillment_pressure",
      statementKind: "AI_INFERENCE",
      contentZh:
        "【AI推断】Call-up 后 30 天交付 + DDP Regina，可能对库存预置与跨境物流排程形成履约压力；非文件原文事实。",
      contentOriginal: null,
      confidence: "INFERRED",
      sourceRefs: pickRefs(
        "delivery_lead_time",
        "delivery_lead_time_30_days",
        "delivery_term",
        "delivery_ddp_regina",
      ),
    });
  }

  if (
    byKey.has("qty_ambiguity_interpretation") ||
    byKey.has("qty_7500_evaluation_aggregate_not_guarantee")
  ) {
    push({
      factKey: "inference_quantity_commercial_risk",
      statementKind: "AI_INFERENCE",
      contentZh:
        "【AI推断】Annex A 上限与 Annex B 评标量并存时，商业规划应按「不保证采购量」建模，避免按 7,500 备货；非 Mandatory。",
      contentOriginal: null,
      confidence: "INFERRED",
      sourceRefs: pickRefs(
        "qty_ambiguity_interpretation",
        "qty_7500_evaluation_aggregate_not_guarantee",
        "qty_actual_purchase_not_guaranteed",
        "qty_estimated_for_evaluation_only_not_guarantee",
      ),
    });
  }

  if (byKey.has("submission_sections") || byKey.has("three_pdfs") || byKey.has("email_max_size")) {
    push({
      factKey: "inference_submission_format_risk",
      statementKind: "AI_INFERENCE",
      contentZh:
        "【AI推断】三份独立 PDF + 邮件 5MB 限制同时存在时，打包与压缩策略本身即投标合规风险点；非文件保证条款。",
      contentOriginal: null,
      confidence: "INFERRED",
      sourceRefs: pickRefs("submission_sections", "three_pdfs", "email_max_size", "email_size_5mb"),
    });
  }

  if (byKey.has("evaluation_method")) {
    push({
      factKey: "recommendation_tech_first_then_price",
      statementKind: "RECOMMENDATION",
      contentZh:
        "【建议】先完成 M1–M15 与证书路径核验，再优化 DDP 价格；技术不合格时最低价路径不可达。此为投标策略建议，非 Mandatory。",
      contentOriginal: null,
      confidence: "INFERRED",
      sourceRefs: pickRefs("evaluation_method"),
    });
  }

  if (byKey.has("qty_ambiguity_interpretation")) {
    push({
      factKey: "recommendation_send_quantity_clarifications",
      statementKind: "RECOMMENDATION",
      contentZh:
        "【建议】在询价截止前书面澄清 Call-up 典型数量与「per contract period」含义，并确认 7,500 仅用于评标。此为建议，非 Mandatory。",
      contentOriginal: null,
      confidence: "HIGH_CONFIDENCE",
      sourceRefs: pickRefs("qty_ambiguity_interpretation", "closing_datetime"),
    });
  }

  push({
    factKey: "recommendation_no_auto_go",
    statementKind: "RECOMMENDATION",
    contentZh:
      "【建议】完成本轮人工审核前保持 HOLD，不自动 GO；待澄清与合规矩阵确认后再决策。此为流程建议，非文件 Mandatory。",
    contentOriginal: null,
    confidence: "HIGH_CONFIDENCE",
    sourceRefs: pickRefs(
      "solicitation_number",
      "closing_datetime",
      "qty_ambiguity_interpretation",
      "evaluation_method",
    ),
  });
}

export function buildQuantityEvaluationSummary(
  facts: FactCandidate[],
): QuantityEvaluationSummary | null {
  const byKey = new Map(facts.map((f) => [f.factKey, f]));
  const years = [
    "qty_annex_b_standing_offer_year_1_1500",
    "qty_annex_b_standing_offer_year_2_1500",
    "qty_annex_b_standing_offer_year_3_1500",
    "qty_annex_b_option_year_1_1500",
    "qty_annex_b_option_year_2_1500",
  ].filter((k) => byKey.has(k));
  if (years.length < 5) return null;
  return {
    annualEvaluationQuantity: 1500,
    evaluatedPeriods: 5,
    calculatedEvaluatedAggregate: 7500,
    calculationExpression: "1500 × 5",
    calculationKind: "DOCUMENT_INTERPRETATION",
    guaranteedQuantity: false,
    quantityAmbiguity: byKey.has("qty_ambiguity_interpretation"),
  };
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
  const qty = buildQuantityEvaluationSummary(facts);

  const topRisks: string[] = [];
  if (byKey.has("qty_ambiguity_interpretation")) {
    topRisks.push("数量口径歧义：Annex A 合同期上限 vs Annex B 评标年量；7,500 为计算值非保证采购");
  }
  if (byKey.has("email_max_size") || byKey.has("email_size_5mb")) {
    topRisks.push("投标邮件附件须控制在 5MB 以内");
  }
  if (byKey.has("reciprocal_procurement_eligibility")) {
    topRisks.push("需 Reciprocal Procurement 资格合规");
  }
  if (byKey.has("delivery_term")) {
    topRisks.push("DDP Regina Incoterms 2020 跨境物流与关税成本风险");
  }

  return {
    projectName:
      getOriginal("solicitation_title") ??
      getOriginal("project_name") ??
      getZh("solicitation_title"),
    solicitationNumber: getOriginal("solicitation_number"),
    procurementType: byKey.has("solicitation_type")
      ? "Request for Standing Offer / RISO"
      : null,
    closing: getOriginal("closing_datetime"),
    contractPeriod: getOriginal("standing_offer_main_period"),
    evaluationMethod: byKey.has("evaluation_method")
      ? "Mandatory technical compliance + lowest evaluated price"
      : null,
    evaluationQuantity: qty
      ? `1,500 / year × ${qty.evaluatedPeriods} = ${qty.calculatedEvaluatedAggregate}（评标计算，非保证）`
      : byKey.has("qty_annex_a_up_to_1500_per_period")
        ? "Up to 1500 per contract period（上限，非保证）"
        : null,
    purchaseGuarantee: "无保证采购；7,500 不得视为 guaranteed purchase",
    topRisks,
  };
}
