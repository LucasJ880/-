/**
 * 询盘 AI 设计段 — 规则层（纯函数，无 I/O）
 *
 * 1. decideSampleAdvice：寄不寄样、收不收费（按意图/买家类型/红旗）
 * 2. buildQuoteSuggestion：从抽取需求 + 产品库匹配出报价草稿行（价格只给"依据"，不臆造）
 * 3. buildReplyBrief：给 LLM 的回复要点（答什么/问什么/提什么认证）
 */

import type { ExtractedInquiry, RedFlag, ComplianceHint } from "@/lib/trade/inquiry-rules";

// ── 寄样建议 ────────────────────────────────────────────────

export type SampleMode = "free" | "paid_deductible" | "paid" | "decline";
export interface SampleAdvice {
  recommend: boolean;
  mode: SampleMode;
  reasons: string[];
  /** 建议样品费（USD），free/decline 为 null */
  suggestedFeeUsd: number | null;
}

export function decideSampleAdvice(x: ExtractedInquiry, flags: RedFlag[]): SampleAdvice {
  const reasons: string[] = [];
  const critical = flags.filter((f) => f.severity === "critical");
  if (critical.length > 0 || x.intent === "spam") {
    reasons.push(critical.length ? `存在高风险红旗：${critical.map((f) => f.title).join("、")}` : "疑似垃圾询盘");
    return { recommend: false, mode: "decline", reasons, suggestedFeeUsd: null };
  }
  const strongBuyer = ["importer", "brand", "hotel", "retailer"].includes(x.buyerType);
  const wantsSample = x.intent === "sample";
  const hasSpecs = Boolean(x.specs.gsm || x.specs.material || x.specs.size);
  const warnFlags = flags.filter((f) => f.severity === "warn");

  if (wantsSample && strongBuyer && warnFlags.length === 0) {
    reasons.push("买家明确要样且身份清晰");
    reasons.push("样品费可在首单抵扣，既筛真买家又不失礼");
    return { recommend: true, mode: "paid_deductible", reasons, suggestedFeeUsd: 30 };
  }
  if (x.intent === "rfq" && strongBuyer && hasSpecs) {
    reasons.push("询价具体（有规格/克重/尺寸），大概率进入打样环节");
    reasons.push("先报价，报价被接受后再寄样，样品费首单抵扣");
    return { recommend: true, mode: "paid_deductible", reasons, suggestedFeeUsd: 30 };
  }
  if (warnFlags.length > 0) {
    reasons.push(`有待核实信号：${warnFlags.map((f) => f.title).join("、")}`);
    reasons.push("先要买家公司信息/网站，寄样按实收样品费+运费");
    return { recommend: false, mode: "paid", reasons, suggestedFeeUsd: 50 };
  }
  reasons.push("信息还不够判断，先追问再谈寄样");
  return { recommend: false, mode: "paid", reasons, suggestedFeeUsd: 50 };
}

// ── 报价建议 ────────────────────────────────────────────────

export interface ProductCandidate {
  sku: string;
  name: string;
  nameEn: string | null;
  category: string | null;
  /** 产品档案事实：fabric_composition / gsm / size / moq / lead_time / fob_price / packaging_type / carton_qty … */
  facts: Record<string, string>;
}

export interface QuoteSuggestionItem {
  productName: string;
  specification: string;
  unit: string;
  quantity: number;
  /** 产品档案里有 FOB 价才填，否则 null（不臆造价格） */
  unitPriceSuggested: number | null;
  basis: string;
  matchedSku: string | null;
}

export interface QuoteSuggestion {
  items: QuoteSuggestionItem[];
  moq: string | null;
  leadTimeDays: number | null;
  incoterm: string;
  notes: string;
  matchedSkus: string[];
}

const STOP = new Set(["the", "and", "for", "with", "pcs", "piece", "pieces", "of", "a", "an", "to", "in"]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

export function matchProduct(query: string, candidates: ProductCandidate[]): { product: ProductCandidate; score: number } | null {
  const q = new Set(tokenize(query));
  if (q.size === 0) return null;
  let best: { product: ProductCandidate; score: number } | null = null;
  for (const p of candidates) {
    const hay = new Set(tokenize(`${p.name} ${p.nameEn ?? ""} ${p.category ?? ""} ${p.sku} ${p.facts.material ?? ""} ${p.facts.fabric_composition ?? ""}`));
    let hit = 0;
    for (const w of q) if (hay.has(w)) hit++;
    const score = hit / q.size;
    if (score > 0 && (!best || score > best.score)) best = { product: p, score };
  }
  return best && best.score >= 0.34 ? best : null;
}

export function parseQuantity(q: string | null): number {
  if (!q) return 0;
  const m = q.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|thousand|万)?/i);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1000;
  if (unit === "万") n *= 10000;
  return Math.round(n);
}

function parsePrice(v?: string): number | null {
  if (!v) return null;
  const m = v.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function parseDays(v?: string): number | null {
  if (!v) return null;
  const m = v.match(/(\d+)\s*(?:-\s*(\d+))?\s*(day|days|天)/i);
  if (m) return parseInt(m[2] ?? m[1], 10);
  const w = v.match(/(\d+)\s*(week|weeks|周)/i);
  if (w) return parseInt(w[1], 10) * 7;
  return null;
}

export function buildQuoteSuggestion(x: ExtractedInquiry, candidates: ProductCandidate[]): QuoteSuggestion {
  const qty = parseQuantity(x.quantity);
  const products = x.products.length ? x.products : ["(买家未写明产品)"];
  const items: QuoteSuggestionItem[] = [];
  const matchedSkus: string[] = [];
  let moq: string | null = null;
  let leadTimeDays: number | null = null;

  for (const name of products.slice(0, 5)) {
    const m = matchProduct(`${name} ${x.specs.material ?? ""}`, candidates);
    const specBits = [
      x.specs.material ?? m?.product.facts.fabric_composition,
      x.specs.gsm ? `${x.specs.gsm} GSM`.replace(/GSM GSM/i, "GSM") : m?.product.facts.gsm ? `${m.product.facts.gsm} GSM` : null,
      x.specs.size ?? m?.product.facts.size,
      x.specs.color,
      x.specs.packaging ?? m?.product.facts.packaging_type,
    ].filter(Boolean);
    const price = m ? parsePrice(m.product.facts.fob_price) : null;
    if (m) {
      matchedSkus.push(m.product.sku);
      moq = moq ?? m.product.facts.moq ?? null;
      leadTimeDays = leadTimeDays ?? parseDays(m.product.facts.lead_time);
    }
    items.push({
      productName: m ? (m.product.nameEn || m.product.name) : name,
      specification: specBits.join(" · "),
      unit: "pcs",
      quantity: qty,
      unitPriceSuggested: price,
      basis: m
        ? price !== null
          ? `按产品库 ${m.product.sku} 档案 FOB 价（匹配度 ${Math.round(m.score * 100)}%）`
          : `匹配产品库 ${m.product.sku}（档案无 FOB 价，需人工填价）`
        : "产品库无匹配货号，按买家描述占位，需人工选品与填价",
      matchedSku: m?.product.sku ?? null,
    });
  }

  const notes = [
    x.targetPrice ? `买家目标价：${x.targetPrice}` : "",
    x.leadTimeAsk ? `买家要求交期：${x.leadTimeAsk}` : "",
    x.certificationsAsked.length ? `买家要求认证：${x.certificationsAsked.join("、")}` : "",
    qty === 0 ? "买家未给数量：先按 MOQ 报阶梯价" : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    items,
    moq,
    leadTimeDays,
    incoterm: (x.incotermHint ?? "FOB").toUpperCase(),
    notes,
    matchedSkus,
  };
}

// ── 回复要点 ────────────────────────────────────────────────

export interface ReplyBrief {
  language: string;
  answer: string[];
  ask: string[];
  mention: string[];
  nextStep: string;
}

export function buildReplyBrief(
  x: ExtractedInquiry,
  hints: ComplianceHint[],
  sample: SampleAdvice,
  quote: QuoteSuggestion,
): ReplyBrief {
  const answer: string[] = [];
  if (x.products.length) answer.push(`确认能做：${x.products.join("、")}${quote.matchedSkus.length ? "（有现成货号）" : ""}`);
  if (quote.moq) answer.push(`MOQ：${quote.moq}`);
  if (quote.leadTimeDays) answer.push(`交期约 ${quote.leadTimeDays} 天`);
  const ask = [...x.missingInfo];
  if (!x.quantity) ask.push("目标数量（按数量给阶梯价）");
  if (!x.destinationCountry) ask.push("目的国/港口（决定运费与合规要求）");
  if (!x.specs.gsm && !x.specs.material) ask.push("面料成分与克重偏好");
  const mention = hints
    .filter((h) => h.severity !== "info")
    .slice(0, 3)
    .map((h) => h.title);
  if (x.certificationsAsked.length) mention.push(`认证：${x.certificationsAsked.join("、")}（说明持证情况）`);
  const nextStep =
    sample.recommend
      ? sample.mode === "paid_deductible"
        ? "提出寄样，样品费首单抵扣"
        : "提出寄样"
      : x.intent === "rfq"
        ? "补齐信息后 24 小时内出正式报价"
        : "回答问题并邀请进一步沟通";
  return { language: x.language ?? "en", answer, ask: [...new Set(ask)].slice(0, 5), mention, nextStep };
}
