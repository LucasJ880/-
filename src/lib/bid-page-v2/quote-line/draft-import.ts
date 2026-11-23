/**
 * BIDPAGE-3 逐行报价 — 把这台电脑上旧的本地成本草稿带进表里（纯函数，浏览器里用；判断点 6 / design D8）
 *
 * 只改表上的值，不保存、不上传；草稿本身不删、不改。按价格表行号对上（第 N 行 ↔ 草稿里 lineNo = N）。
 * 表里已经填了供应商报价的行不覆盖（可能是同事在系统里填好的）；行不是从存下的价格表来的，提示按行号对上、要逐行核对。
 * 带入：供应商报价、口径、币种、证据类别、各币汇率与来源；目标毛利率只在报价还没填时带入
 *（草稿的「按售价毛利」= 报价引擎的按售价毛利）。草稿里逐行的关税、运费、送货费、其它费用、进口 GST 不带入（逐行报价里是共用参数）。
 */
import type { CostDraft } from "@/lib/tender-bid-workspace/cost-draft";
import { QUOTE_CURRENCIES } from "@/lib/quote-engine/contract";
import { LINE_EVIDENCE_KINDS, piecesPerUnit, type LineEvidenceKind, type LineModeState } from "./contract";

/** 提示过一次后在这台电脑上记的标记（不含任何金额） */
export const costDraftPromptedKey = (projectId: string) => `qy.bidPage.costDraftPrompted.${projectId}`;

export type DraftImportResult = {
  state: LineModeState;
  importedRows: number[];
  /** 给人看的说明，每条自己写清楚（带入了什么、没带入什么、要核对什么） */
  notes: string[];
};

const toNum = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * 要不要提示导入：提示过（有标记）就不提示；草稿读不出、没有填了报价的行、或表里没有能按行号对上的行也不提示
 *（表还是空的时提示了，人点「导入」什么也带不进来，提示却用掉了）。
 */
export function draftToPrompt(promptedMarker: string | null, rawDraft: string | null, parse: (raw: string | null) => CostDraft, rowCount: number): CostDraft | null {
  if (promptedMarker) return null;
  if (!rawDraft || rowCount <= 0) return null;
  const d = parse(rawDraft);
  return draftHasLines(d, rowCount) ? d : null;
}

/** 草稿里有没有可带入、且表里有对应行号的行（没有就不提示） */
export function draftHasLines(draft: CostDraft, rowCount = Number.POSITIVE_INFINITY): boolean {
  return Object.entries(draft.lines).some(([no, l]) => toNum(l.unitPrice) != null && Number(no) >= 1 && Number(no) <= rowCount);
}

export function importCostDraft(state: LineModeState, draft: CostDraft): DraftImportResult {
  const importedRows: number[] = [];
  const keptRows: number[] = [];
  const skipped = new Set<string>();
  let fromOtherSource = false;
  const rows = state.rows.map((row, i) => {
    const lineNo = i + 1;
    const d = draft.lines[String(lineNo)];
    if (!d) return row;
    const price = toNum(d.unitPrice);
    if (price == null || price < 0) return row;
    if (row.unitPrice != null) {
      keptRows.push(lineNo);
      return row;
    }
    const basis = d.basis === "PER_PIECE" && piecesPerUnit(row.uom, row.packCount) != null ? "PER_PIECE" : "PER_TENDER_UOM";
    if (d.basis === "PER_PIECE" && basis !== "PER_PIECE") skipped.add(`第 ${lineNo} 行草稿是按件报价，但这一行没有包装数，按招标单位带入了，请核对`);
    const known = (LINE_EVIDENCE_KINDS as readonly string[]).includes(d.evidenceKind);
    const evidenceKind = known ? (d.evidenceKind as LineEvidenceKind) : "ESTIMATE";
    const currency = (d.currency || row.currency).trim().toUpperCase();
    if (!(QUOTE_CURRENCIES as readonly string[]).includes(currency)) {
      skipped.add(`第 ${lineNo} 行草稿的币种「${d.currency}」用不了，这一行没带入`);
      return row;
    }
    if (!known) skipped.add(`第 ${lineNo} 行草稿没写证据类别，按「估计」带入了，请核对`);
    if (row.rowSource !== "schedule") fromOtherSource = true;
    importedRows.push(lineNo);
    if (toNum(d.dutyRatePct) != null) skipped.add("草稿里逐行的关税率没带入（逐行报价里关税率是共用参数）");
    if (toNum(d.freightCad) != null || toNum(d.localDeliveryCad) != null) skipped.add("草稿里逐行的运费、送货费没带入（逐行报价里是共用参数）");
    if (toNum(d.otherCad) != null) skipped.add("草稿里逐行的其它费用没带入（需要的话在专业模式里加）");
    return { ...row, unitPrice: price, basis, currency, evidenceKind, inquiryItemId: null, supplierId: null } as typeof row;
  });
  const fx = { ...state.fx };
  for (const [rawCcy, e] of Object.entries(draft.fx)) {
    const ccy = rawCcy.trim().toUpperCase();
    if (ccy === "CAD" || !(QUOTE_CURRENCIES as readonly string[]).includes(ccy)) continue;
    const rate = toNum(e.rate);
    if (rate == null || rate <= 0) continue;
    fx[ccy] = { rate, source: e.source?.trim() ? e.source.trim().slice(0, 40) : null };
  }
  for (const r of rows) if (r.currency !== "CAD" && !fx[r.currency]) fx[r.currency] = { rate: null, source: null };
  let targetMarginPct = state.targetMarginPct;
  if (targetMarginPct == null && draft.pricingMethod === "MARGIN_ON_PRICE") {
    const m = toNum(draft.pricingRatePct);
    if (m != null && m >= 0 && m < 100) targetMarginPct = m;
  } else if (draft.pricingMethod === "MARKUP_ON_COST") {
    skipped.add("草稿用的是成本加成定价，没带入（逐行报价按目标毛利率定价，请自己填）");
  }
  if (toNum(draft.importGstRatePct) != null) skipped.add("草稿里的进口 GST 没带入（逐行报价不含销售税）");
  if (toNum(draft.reserveOnSalePct) != null && toNum(draft.reserveOnSalePct) !== 0) skipped.add("草稿里的按售价预留没带入（需要的话在专业模式里加）");
  const notes = [
    importedRows.length === 0
      ? "草稿里没有能对上的行（按行号对，可能表里的行和当时不一样），什么都没带入"
      : `已带入 ${importedRows.length} 行（第 ${importedRows.join("、")} 行），请核对后点「保存」`,
    ...(keptRows.length ? [`第 ${keptRows.join("、")} 行已经有供应商报价，草稿里的没带入（要换的话手改）`] : []),
    ...(fromOtherSource ? ["这些行不是从存下的价格表来的，是按行号对上的：请逐行核对品名对不对"] : []),
    ...skipped,
  ];
  return { state: { ...state, rows, fx, targetMarginPct }, importedRows, notes };
}
