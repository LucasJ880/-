/**
 * PROC-1 披露分析（纯函数，design D10；spec「按口径分析」「分析结果与覆盖说明」）。
 *
 * - 只合计 CONFIRMED 明细；NEEDS_REVIEW 只计数；
 * - ceiling / evaluated / committed / ordered / invoiced / paid 分列，绝不相加成「总采购」；
 * - 不同币种不相加；币种未标注单列；不同单位不换算；
 * - 修订「修订后总额」取最新一条不叠加；修订口径未识别不计入并列缺口；
 * - 同口径同单号同金额只计一次；贷项 / 取消以负数保留；
 * - 金额以整数分（BigInt）计算；
 * - 标题固定「已取得记录的合计」；公开合同值 ≠ 实际支出；框架值 0 ≠ 未采购；无记录 ≠ 0。
 */

import { foldText } from "./identity";
import type { AmountBasis } from "./extract-pure";

export interface AnalysisLine {
  id: string;
  instrumentNumber: string | null;
  documentType: string;
  amountBasis: AmountBasis | string;
  amendmentMode: string | null;
  docRef: string | null;
  docDate: string | null;
  productDescription: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  amount: string | null;
  currency: string | null;
  deliveryLocation: string | null;
  isCancellationOrCredit: boolean;
  reviewStatus: string;
  sourceLabel: string;
}

export interface AnalysisAttachment {
  id: string;
  filename: string;
  kind: string;
  parseStatus: string;
  pageCount: number | null;
}

export interface AnalysisInput {
  lines: AnalysisLine[];
  attachments: AnalysisAttachment[];
  request: {
    institution: string | null;
    requestedStart: string | null;
    requestedEnd: string | null;
    governmentOutcome: string | null;
    filesStatus: string;
    expectedReleasePages: number | null;
  };
  instruments: Array<{ number: string; contractValue: string | null; contractValueBasis: string | null; callUpCount: number }>;
}

// ─────────────────────────── 十进制（无浮点） ───────────────────────────

/** 十进制字符串 → 按 scale 位小数的 BigInt（四舍五入到 scale；无法解析 → null） */
export function toScaled(v: string | null | undefined, scale: number): bigint | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const neg = m[1] === "-";
  const frac = (m[3] ?? "").padEnd(scale + 1, "0");
  let n = BigInt(m[2]) * 10n ** BigInt(scale) + BigInt(frac.slice(0, scale) || "0");
  if (Number(frac[scale] ?? "0") >= 5) n += 1n;
  return neg ? -n : n;
}

export function formatScaled(n: bigint, scale: number): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const base = 10n ** BigInt(scale);
  const int = (a / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (a % base).toString().padStart(scale, "0");
  return `${neg ? "-" : ""}${int}${scale ? `.${frac}` : ""}`;
}

export const toCents = (v: string | null | undefined) => toScaled(v, 2);
export const formatCents = (n: bigint) => formatScaled(n, 2);

// ─────────────────────────── 结果类型 ───────────────────────────

export interface BasisTotal {
  basis: string;
  currency: string;
  /** 已取得记录的合计（含贷项） */
  total: string;
  credits: string;
  lineCount: number;
  duplicatesExcluded: number;
}

export interface QuantityTotal {
  basis: string;
  product: string;
  unit: string;
  quantity: string;
  lineCount: number;
}

export interface UnitPriceObs {
  product: string;
  unit: string;
  currency: string;
  min: string;
  max: string;
  latest: string;
  latestDate: string | null;
  count: number;
}

export interface AnalysisResult {
  headlineZh: string;
  status: "COMPLETED" | "NEEDS_REVIEW";
  coverage: {
    institution: string | null;
    instruments: string[];
    requestedRange: { start: string | null; end: string | null };
    documentedRange: { start: string | null; end: string | null };
    files: Array<AnalysisAttachment & { analyzed: boolean }>;
    analyzedPages: number;
    expectedReleasePages: number | null;
  };
  totals: BasisTotal[];
  quantities: QuantityTotal[];
  unitPrices: UnitPriceObs[];
  orderFrequency: { byMonth: Array<{ month: string; orders: number }>; byDestination: Array<{ destination: string; orders: number }> };
  publicValueNotes: string[];
  gaps: string[];
  assumptions: string[];
  counts: { total: number; confirmed: number; needsReview: number; rejected: number; excludedUnknownBasis: number; excludedAmendmentUnknown: number };
}

const BASIS_ORDER = ["CEILING", "EVALUATED", "COMMITTED", "ORDERED", "INVOICED", "PAID", "UNKNOWN"];
const productKey = (p: string | null) => foldText(p).slice(0, 80) || "（未写品名）";

export function analyzeDisclosure(input: AnalysisInput): AnalysisResult {
  const confirmed = input.lines.filter((l) => l.reviewStatus === "CONFIRMED");
  const needsReview = input.lines.filter((l) => l.reviewStatus === "NEEDS_REVIEW").length;
  const rejected = input.lines.filter((l) => l.reviewStatus === "REJECTED").length;
  const gaps: string[] = [];
  const assumptions: string[] = [
    "只合计已复核确认（CONFIRMED）的明细；各金额口径分列，不相加成总采购",
    "金额以整数分计算；不同币种、不同单位不合并、不换算",
    "同口径、同单号、同金额的重复行只计一次；贷项 / 取消以负数计入同口径",
  ];

  // —— 修订：修订后总额取最新；口径未识别不计入 ——
  let excludedAmendmentUnknown = 0;
  const revisedLatest = new Map<string, AnalysisLine>();
  const working: AnalysisLine[] = [];
  for (const l of confirmed) {
    if (l.documentType === "AMENDMENT") {
      if (l.amendmentMode === "REVISED_TOTAL") {
        const k = `${l.instrumentNumber ?? "?"}|${l.amountBasis}|${l.currency ?? "?"}`;
        const prev = revisedLatest.get(k);
        if (!prev || (l.docDate ?? "") > (prev.docDate ?? "")) revisedLatest.set(k, l);
        continue;
      }
      if (l.amendmentMode !== "INCREMENT") {
        excludedAmendmentUnknown++;
        continue;
      }
    }
    working.push(l);
  }
  const revisedGroups = new Map<string, number>();
  for (const l of confirmed.filter((x) => x.documentType === "AMENDMENT" && x.amendmentMode === "REVISED_TOTAL")) {
    const k = `${l.instrumentNumber ?? "?"}|${l.amountBasis}|${l.currency ?? "?"}`;
    revisedGroups.set(k, (revisedGroups.get(k) ?? 0) + 1);
  }
  for (const [k, l] of revisedLatest) {
    const sameDateCount = confirmed.filter((x) => x.documentType === "AMENDMENT" && x.amendmentMode === "REVISED_TOTAL" && `${x.instrumentNumber ?? "?"}|${x.amountBasis}|${x.currency ?? "?"}` === k && (x.docDate ?? "") === (l.docDate ?? "")).length;
    if (sameDateCount > 1) gaps.push(`合同 ${l.instrumentNumber ?? "?"} 的多条「修订后总额」日期相同或缺失，无法判定最新一条，已取其一，需人工核对`);
    working.push(l);
  }
  if (revisedLatest.size) assumptions.push("合同修订写明「修订后总额」时取最新一条作为该口径的值，不与原值或其他修订叠加");
  if (excludedAmendmentUnknown) gaps.push(`${excludedAmendmentUnknown} 条修订未识别是增量还是修订后总额，未计入合计`);

  // —— 按口径 + 币种合计（去重） ——
  const totals = new Map<string, { basis: string; currency: string; total: bigint; credits: bigint; lineCount: number; dup: number; seen: Set<string> }>();
  let excludedUnknownBasis = 0;
  let unknownCurrency = 0;
  for (const l of working) {
    const cents = toCents(l.amount);
    if (cents === null) continue;
    if (l.amountBasis === "UNKNOWN") {
      excludedUnknownBasis++;
      continue;
    }
    const currency = l.currency?.trim().toUpperCase() || "币种未标注";
    if (currency === "币种未标注") unknownCurrency++;
    const key = `${l.amountBasis}|${currency}`;
    const g = totals.get(key) ?? { basis: l.amountBasis, currency, total: 0n, credits: 0n, lineCount: 0, dup: 0, seen: new Set<string>() };
    const signed = l.isCancellationOrCredit && cents > 0n ? -cents : cents;
    const dupKey = l.docRef ? `${foldText(l.docRef)}|${signed}` : null;
    if (dupKey && g.seen.has(dupKey)) {
      g.dup++;
      totals.set(key, g);
      continue;
    }
    if (dupKey) g.seen.add(dupKey);
    g.total += signed;
    if (signed < 0n) g.credits += signed;
    g.lineCount++;
    totals.set(key, g);
  }
  if (excludedUnknownBasis) gaps.push(`${excludedUnknownBasis} 条明细金额口径未识别（UNKNOWN），未计入任何合计`);
  if (unknownCurrency) gaps.push(`${unknownCurrency} 条明细未标注币种，单列为「币种未标注」，未与其他币种合并`);

  // —— 数量（按口径 + 品名 + 单位） ——
  const qty = new Map<string, QuantityTotal & { n: bigint }>();
  for (const l of working) {
    const q = toScaled(l.quantity, 4);
    if (q === null) continue;
    const unit = l.unit?.trim() || "单位未标注";
    const k = `${l.amountBasis}|${productKey(l.productDescription)}|${foldText(unit)}`;
    const g = qty.get(k) ?? { basis: l.amountBasis, product: l.productDescription?.trim() || "（未写品名）", unit, quantity: "0", lineCount: 0, n: 0n };
    g.n += l.isCancellationOrCredit && q > 0n ? -q : q;
    g.lineCount++;
    qty.set(k, g);
  }

  // —— 单价 ——
  const prices = new Map<string, { product: string; unit: string; currency: string; vals: Array<{ v: bigint; d: string | null }> }>();
  for (const l of working) {
    const p = toScaled(l.unitPrice, 4);
    if (p === null) continue;
    const unit = l.unit?.trim() || "单位未标注";
    const currency = l.currency?.trim().toUpperCase() || "币种未标注";
    const k = `${productKey(l.productDescription)}|${foldText(unit)}|${currency}`;
    const g = prices.get(k) ?? { product: l.productDescription?.trim() || "（未写品名）", unit, currency, vals: [] };
    g.vals.push({ v: p, d: l.docDate });
    prices.set(k, g);
  }
  const unitPrices: UnitPriceObs[] = [...prices.values()].map((g) => {
    const sorted = [...g.vals].sort((a, b) => (a.d ?? "").localeCompare(b.d ?? ""));
    const vals = g.vals.map((x) => x.v);
    const min = vals.reduce((a, b) => (b < a ? b : a));
    const max = vals.reduce((a, b) => (b > a ? b : a));
    const latest = sorted[sorted.length - 1];
    return { product: g.product, unit: g.unit, currency: g.currency, min: formatScaled(min, 4), max: formatScaled(max, 4), latest: formatScaled(latest.v, 4), latestDate: latest.d, count: g.vals.length };
  });

  // —— 订单频率与目的地 ——
  const orders = working.filter((l) => l.amountBasis === "ORDERED");
  const orderKeys = new Map<string, AnalysisLine>();
  for (const o of orders) orderKeys.set(o.docRef ? foldText(o.docRef) : o.id, o);
  const byMonth = new Map<string, number>();
  const byDest = new Map<string, number>();
  for (const o of orderKeys.values()) {
    const m = o.docDate ? o.docDate.slice(0, 7) : "日期未知";
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    const d = o.deliveryLocation?.trim() || "交付地未知";
    byDest.set(d, (byDest.get(d) ?? 0) + 1);
  }

  // —— 覆盖 ——
  const dates = working.map((l) => l.docDate).filter((d): d is string => !!d).sort();
  const files = input.attachments.map((a) => ({ ...a, analyzed: a.kind === "DISCLOSURE_FILE" && a.parseStatus === "PARSED" }));
  const analyzedPages = files.filter((f) => f.analyzed).reduce((s, f) => s + (f.pageCount ?? 0), 0);
  const disclosureFiles = files.filter((f) => f.kind === "DISCLOSURE_FILE");
  for (const f of disclosureFiles) {
    if (f.parseStatus === "NEEDS_OCR") gaps.push(`「${f.filename}」是扫描件 / 无文字层（无 OCR 能力），未自动抽取，需人工录入`);
    if (f.parseStatus === "ENCRYPTED") gaps.push(`「${f.filename}」已加密，无法读取`);
    if (f.parseStatus === "CORRUPT") gaps.push(`「${f.filename}」文件损坏，无法读取`);
    if (f.parseStatus === "UNSUPPORTED") gaps.push(`「${f.filename}」格式不支持自动解析`);
    if (f.parseStatus === "PENDING" || f.parseStatus === "PARSING") gaps.push(`「${f.filename}」尚在解析`);
  }
  if (disclosureFiles.length === 0) gaps.push("尚未上传任何披露文件（只有来信或回执时不能视为已取得记录）");
  if (input.request.expectedReleasePages !== null && input.request.expectedReleasePages > analyzedPages) {
    gaps.push(`来信称附件 ${input.request.expectedReleasePages} 页，已分析 ${analyzedPages} 页`);
  }
  if (input.request.filesStatus === "NOTICE_RECEIVED") gaps.push("只收到披露通知 / 回复信，实际附件尚未取得");
  if (input.request.filesStatus === "PARTIAL_FILES_RECEIVED") gaps.push("披露文件只取得一部分（用户尚未确认已取得全部）");
  switch (input.request.governmentOutcome) {
    case "PARTIAL_DISCLOSURE":
      gaps.push("部分披露：删节 / 豁免部分未覆盖");
      break;
    case "ALL_WITHHELD":
      gaps.push("全部不予披露：没有可分析的明细");
      break;
    case "NO_RECORDS":
      gaps.push("机关答复无记录：不代表采购金额为 0，可能由其他机关持有或未以所请形式保存");
      break;
    case "TRANSFERRED":
      gaps.push("已转交其他机关：接收机关的记录尚未覆盖");
      break;
    default:
      break;
  }
  if (input.request.requestedStart && input.request.requestedEnd) {
    if (!dates.length) gaps.push(`申请期间 ${input.request.requestedStart} 至 ${input.request.requestedEnd} 尚无已确认的有日期明细`);
    else {
      if (dates[0] > input.request.requestedStart) gaps.push(`${input.request.requestedStart} 至 ${dates[0]} 之前没有已确认明细`);
      if (dates[dates.length - 1] < input.request.requestedEnd) gaps.push(`${dates[dates.length - 1]} 之后至 ${input.request.requestedEnd} 没有已确认明细`);
    }
  }
  if (needsReview) gaps.push(`${needsReview} 条明细待复核，未计入合计`);

  // —— 公开合同值说明 ——
  const publicValueNotes: string[] = [];
  for (const i of input.instruments) {
    if (i.contractValue === null) continue;
    const c = toCents(i.contractValue);
    if (c === 0n) publicValueNotes.push(`合同 ${i.number} 公开合同值为 0：这是框架 / SO 的披露口径，不代表未采购`);
    else if (c !== null) publicValueNotes.push(`合同 ${i.number} 公开合同值 ${formatCents(c)}：披露口径（可能为上限 / 框架值），不等于实际支出`);
  }
  const ordered = [...totals.values()].filter((t) => t.basis === "ORDERED");
  if (ordered.length && input.instruments.length) {
    for (const t of ordered) {
      publicValueNotes.push(`已取得记录的 ordered 合计 ${formatCents(t.total)} ${t.currency}（${t.lineCount} 笔）：只代表已取得的记录，不代表全周期实付`);
    }
  }

  return {
    headlineZh: "已取得记录的合计（不代表全项目实际总采购）",
    status: needsReview > 0 ? "NEEDS_REVIEW" : "COMPLETED",
    coverage: {
      institution: input.request.institution,
      instruments: input.instruments.map((i) => i.number),
      requestedRange: { start: input.request.requestedStart, end: input.request.requestedEnd },
      documentedRange: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
      files,
      analyzedPages,
      expectedReleasePages: input.request.expectedReleasePages,
    },
    totals: [...totals.values()]
      .sort((a, b) => BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis) || a.currency.localeCompare(b.currency))
      .map((t) => ({ basis: t.basis, currency: t.currency, total: formatCents(t.total), credits: formatCents(t.credits), lineCount: t.lineCount, duplicatesExcluded: t.dup })),
    quantities: [...qty.values()].map((q) => ({ basis: q.basis, product: q.product, unit: q.unit, quantity: formatScaled(q.n, 4), lineCount: q.lineCount })),
    unitPrices,
    orderFrequency: {
      byMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, orders: n })),
      byDestination: [...byDest.entries()].sort((a, b) => b[1] - a[1]).map(([destination, n]) => ({ destination, orders: n })),
    },
    publicValueNotes,
    gaps,
    assumptions,
    counts: { total: input.lines.length, confirmed: confirmed.length, needsReview, rejected, excludedUnknownBasis, excludedAmendmentUnknown },
  };
}
