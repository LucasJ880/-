/**
 * China Supplier Sourcing Brief — allowlist 组装（服务端强制）。
 * 默认排除估值、成本、利润、内部备注与 INFERRED 金额。
 */

export type ChinaBriefFact = {
  content: string;
  confidence: string;
  sourceType: string;
  sourceUrl?: string | null;
  sourcePage?: string | null;
  humanConfirmed?: boolean;
};

export type ChinaBriefInput = {
  projectName: string;
  clientOrganization?: string | null;
  closeDate?: string | null;
  documentTitles: string[];
  /** 显式开关：仅当为 true 且事实为公开历史时才输出金额类历史行 */
  includePublicHistoricalAmounts?: boolean;
  facts?: ChinaBriefFact[];
  /** 人工确认备注（生成前编辑；仍需再过滤敏感词） */
  confirmNotes?: string | null;
};

const SENSITIVE_PATTERNS: RegExp[] = [
  /estimatedValue/i,
  /ourBidPrice/i,
  /winningBidPrice/i,
  /毛利|利润|成本|预算|底价|底线|售价|报价底/i,
  /margin|profit|cost|budget|internal note|风险评分|中标概率/i,
  /竞争对手|竞品|竞争策略/i,
  /客户电话|客户邮箱|contactEmail|contactPhone/i,
];

const AMOUNT_LIKE =
  /(\$|USD|CAD|CNY|RMB|€|£)\s*[\d,.]+|[\d,.]+\s*(USD|CAD|CNY|RMB|美元|加元)/i;

export function containsSensitiveSupplierBriefText(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

export function scrubSensitiveSupplierBriefText(text: string): string {
  let out = text;
  for (const re of SENSITIVE_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function isPublicHistoricalFact(f: ChinaBriefFact): boolean {
  if (f.confidence === "INFERRED") return false;
  if (f.sourceType !== "historical" && f.sourceType !== "tender_document") {
    return false;
  }
  // 推断金额不得当公开事实
  if (f.confidence === "INFERRED" && AMOUNT_LIKE.test(f.content)) return false;
  return (
    f.confidence === "CONFIRMED" ||
    f.confidence === "HIGH_CONFIDENCE" ||
    !!f.humanConfirmed
  );
}

function factLooksLikeAmount(f: ChinaBriefFact): boolean {
  return AMOUNT_LIKE.test(f.content);
}

/**
 * 从允许字段组装厂家简报正文（不含 estimatedValue / 成本 / 利润）。
 */
export function buildChinaSupplierBriefText(input: ChinaBriefInput): string {
  const includeHist = !!input.includePublicHistoricalAmounts;
  const lines: string[] = [
    "China Supplier Sourcing Brief / 国内供应商询价简报",
    "=== Legend ===",
    "[CONFIRMED from tender] / [PUBLIC HISTORICAL REFERENCE] / [AI_INFERRED] / [PENDING]",
    "NOTE: This brief excludes Sunny internal cost, margin, bid floor, risk scores, and internal valuation fields.",
    "",
    `1) Project: ${input.projectName}`,
    `2) Procuring agency (public): ${input.clientOrganization || "[PENDING]"}`,
    "3) Product / qty: [PENDING — from tender specs only]",
    `4) Delivery timing: ${input.closeDate || "[PENDING]"}`,
    "5) Technical requirements: see tender documents (CONFIRMED only)",
    "6) Certificates / tests required: [PENDING from tender]",
    "7) MOQ / sample / lead time questions for factory: [PENDING]",
    "8) Quote format: unit price, currency, Incoterms (FOB/CIF/DDP), validity",
    `9) Source documents: ${input.documentTitles.join("; ") || "(none)"}`,
  ];

  const facts = input.facts ?? [];
  const techFacts = facts.filter(
    (f) =>
      !factLooksLikeAmount(f) &&
      !containsSensitiveSupplierBriefText(f.content) &&
      (f.confidence === "CONFIRMED" ||
        f.confidence === "HIGH_CONFIDENCE" ||
        f.sourceType === "tender_document"),
  );
  if (techFacts.length) {
    lines.push("", "10) Confirmed / tender facts (non-pricing):");
    for (const f of techFacts.slice(0, 12)) {
      const src = f.sourceUrl ? ` src=${f.sourceUrl}` : "";
      const page = f.sourcePage ? ` p.${f.sourcePage}` : "";
      lines.push(
        `- [${f.confidence}/${f.sourceType}] ${scrubSensitiveSupplierBriefText(f.content).slice(0, 220)}${src}${page}`,
      );
    }
  }

  if (includeHist) {
    const hist = facts.filter(
      (f) => isPublicHistoricalFact(f) && factLooksLikeAmount(f),
    );
    lines.push("", "11) Public historical contract amounts (REFERENCE ONLY — NOT this bid budget):");
    if (hist.length === 0) {
      lines.push("- (none with public historical source)");
    } else {
      for (const f of hist.slice(0, 8)) {
        lines.push(
          `- [PUBLIC HISTORICAL REFERENCE / ${f.sourceType}] ${scrubSensitiveSupplierBriefText(f.content).slice(0, 220)}`,
        );
      }
    }
  } else {
    lines.push(
      "",
      "11) Public historical amounts: omitted (includePublicHistoricalAmounts=false)",
    );
  }

  // INFERRED 仅允许非金额技术提示
  const inferred = facts.filter(
    (f) =>
      f.confidence === "INFERRED" &&
      !factLooksLikeAmount(f) &&
      !containsSensitiveSupplierBriefText(f.content),
  );
  if (inferred.length) {
    lines.push("", "12) AI_INFERRED (not official — factory must confirm):");
    for (const f of inferred.slice(0, 6)) {
      lines.push(`- [AI_INFERRED] ${f.content.slice(0, 200)}`);
    }
  }

  if (input.confirmNotes?.trim()) {
    const notes = scrubSensitiveSupplierBriefText(input.confirmNotes.trim());
    lines.push("", "13) Editor notes (scrubbed):", notes.slice(0, 500));
  }

  lines.push(
    "",
    "Confidentiality: do not share customer budget, our margin, competitor notes, or internal risk scores.",
  );

  const body = lines.join("\n");
  // 最终硬过滤
  assertNoForbiddenLeak(body, includeHist);
  return body;
}

export function assertNoForbiddenLeak(
  body: string,
  includeHistAmounts: boolean,
): void {
  const forbidden = [
    "estimatedValue",
    "ourBidPrice",
    "winningBidPrice",
    "毛利率",
    "内部成本",
    "报价底线",
    "中标概率",
  ];
  for (const token of forbidden) {
    if (body.includes(token)) {
      throw new Error(`china_supplier_brief blocked sensitive token: ${token}`);
    }
  }
  if (!includeHistAmounts) {
    // 粗检：关闭开关时不应出现货币金额行（允许 Incoterms 单词）
    const moneyLines = body
      .split("\n")
      .filter((l) => AMOUNT_LIKE.test(l) && !/Incoterms|FOB|CIF|DDP/i.test(l));
    if (moneyLines.length > 0) {
      throw new Error(
        "china_supplier_brief blocked amount line while historical switch off",
      );
    }
  }
}
