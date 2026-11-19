/**
 * China Supplier Sourcing Brief — allowlist 组装（服务端强制）。
 * 默认排除估值、成本、利润、内部备注与 INFERRED 金额。
 *
 * CHAIN-4b：简报是发给工厂的，不再印采购方、截标日期与源文件名（文件名常含招标编号）；
 * 项目只用中性询价编号称呼。自动挑选的事实命中本项目禁出清单或邮箱 / 电话格式的整行不收；
 * 编辑备注命中 → 整份不生成（SupplierIdentityLeakError）。
 */

import {
  scanIdentity,
  SupplierIdentityLeakError,
  type IdentitySegment,
  type ProjectIdentityDenyList,
} from "./project-identity-deny";

export type ChinaBriefFact = {
  content: string;
  confidence: string;
  sourceType: string;
  sourceUrl?: string | null;
  sourcePage?: string | null;
  humanConfirmed?: boolean;
};

export type ChinaBriefInput = {
  /** CHAIN-4b：对供应商的中性询价编号（不传项目名、采购方、截标日期、文件名） */
  reference: string;
  /** CHAIN-4b：本项目的禁出清单 */
  identity: ProjectIdentityDenyList;
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
    `1) RFQ reference / 询价编号: ${input.reference}`,
    "2) Product / qty: [PENDING — from tender specs only]",
    "3) Delivery timing: [PENDING — from tender specs only]",
    "4) Technical requirements: see tender documents (CONFIRMED only)",
    "5) Certificates / tests required: [PENDING from tender]",
    "6) MOQ / sample / lead time questions for factory: [PENDING]",
    "7) Quote format: unit price, currency, Incoterms (FOB/CIF/DDP), validity",
  ];
  // CHAIN-4b：哪几行是自动挑选的事实（招标文本，不查项目名称），其余是模板（我方撰写）
  const factLines = new Set<number>();
  const pushFact = (line: string) => {
    factLines.add(lines.length);
    lines.push(line);
  };
  // 自动挑选的事实：命中身份或格式检查的整行不收（与既有的敏感事实过滤同一做法）
  const identityClean = (f: ChinaBriefFact) => scanIdentity(input.identity, [{ where: "事实", text: f.content, kind: "tender" }]).length === 0;

  const facts = (input.facts ?? []).filter(identityClean);
  const techFacts = facts.filter(
    (f) =>
      !factLooksLikeAmount(f) &&
      !containsSensitiveSupplierBriefText(f.content) &&
      (f.confidence === "CONFIRMED" ||
        f.confidence === "HIGH_CONFIDENCE" ||
        f.sourceType === "tender_document"),
  );
  // 分析师备忘录 v1 P1：北美公共采购常见 Unfair Labour Practices 条款（违约可罚合同额倍数）——
  // 选厂时一并取证，避免中标后被动。固定清单（非敏感、无金额）。
  lines.push(
    "",
    "8) Compliance evidence to collect from factory (labour / origin — required by many Canadian public buyers):",
    "- Business licence copy (营业执照)",
    "- Factory photos: production floor + workshop conditions",
    "- Labour & workplace-safety policy statement (工资/工时/安全制度)",
    "- Raw material source: company + country (原材料来源公司与国别)",
    "- Material certificates (e.g., stainless steel mill certificate 材质证书)",
    "- If available: BSCI / SMETA / SA8000 audit report (非强制，加分)",
  );

  if (techFacts.length) {
    lines.push("", "9) Confirmed / tender facts (non-pricing):");
    for (const f of techFacts.slice(0, 12)) {
      const src = f.sourceUrl ? ` src=${f.sourceUrl}` : "";
      const page = f.sourcePage ? ` p.${f.sourcePage}` : "";
      pushFact(
        `- [${f.confidence}/${f.sourceType}] ${scrubSensitiveSupplierBriefText(f.content).slice(0, 220)}${src}${page}`,
      );
    }
  }

  if (includeHist) {
    const hist = facts.filter(
      (f) => isPublicHistoricalFact(f) && factLooksLikeAmount(f),
    );
    lines.push("", "10) Public historical contract amounts (REFERENCE ONLY — NOT this bid budget):");
    if (hist.length === 0) {
      lines.push("- (none with public historical source)");
    } else {
      for (const f of hist.slice(0, 8)) {
        pushFact(
          `- [PUBLIC HISTORICAL REFERENCE / ${f.sourceType}] ${scrubSensitiveSupplierBriefText(f.content).slice(0, 220)}`,
        );
      }
    }
  } else {
    lines.push(
      "",
      "10) Public historical amounts: omitted (includePublicHistoricalAmounts=false)",
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
    lines.push("", "11) AI_INFERRED (not official — factory must confirm):");
    for (const f of inferred.slice(0, 6)) {
      pushFact(`- [AI_INFERRED] ${f.content.slice(0, 200)}`);
    }
  }

  let notesLine: string | null = null;
  if (input.confirmNotes?.trim()) {
    // CHAIN-4b：编辑备注是人写的——命中招标身份就整份不生成，不替换
    const noteHits = scanIdentity(input.identity, [{ where: "编辑备注", text: input.confirmNotes, kind: "human" }]);
    if (noteHits.length) throw new SupplierIdentityLeakError(noteHits);
    const notes = scrubSensitiveSupplierBriefText(input.confirmNotes.trim());
    notesLine = notes.slice(0, 500);
    lines.push("", "12) Editor notes (scrubbed):", notesLine);
  }

  lines.push(
    "",
    "Confidentiality: do not share customer budget, our margin, competitor notes, or internal risk scores.",
  );

  const body = lines.join("\n");
  // 最终硬过滤
  assertNoForbiddenLeak(body, includeHist);
  // CHAIN-4b：整份再过一次身份检查（模板行查五类，事实行不查项目名称）
  const segs: IdentitySegment[] = [
    { where: "简报", text: lines.filter((_, i) => !factLines.has(i) && lines[i] !== notesLine).join("\n"), kind: "authored" },
    { where: "简报事实", text: lines.filter((_, i) => factLines.has(i)).join("\n"), kind: "tender" },
    ...(notesLine ? [{ where: "编辑备注", text: notesLine, kind: "human" as const }] : []),
  ];
  const hits = scanIdentity(input.identity, segs);
  if (hits.length) throw new SupplierIdentityLeakError(hits);
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
