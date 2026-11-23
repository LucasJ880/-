/**
 * BIDPAGE-3 逐行报价 — 把这台电脑上旧的本地成本草稿带进表里（纯函数，浏览器里用；判断点 6 / design D8）
 *
 * 只改表上的值，不保存、不上传；草稿本身不删、不改。按价格表行号对上（第 N 行 ↔ 草稿里 lineNo = N）。
 * 带入：供应商报价、口径、币种、证据类别、各币汇率与来源；目标毛利率只在报价还没填时带入
 *（草稿的「按售价毛利」= 报价引擎的按售价毛利）。草稿里逐行的关税、运费、送货费、其它费用、进口 GST 不带入（逐行报价里是共用参数）。
 */
import type { CostDraft } from "@/lib/tender-bid-workspace/cost-draft";
import { LINE_EVIDENCE_KINDS, piecesPerUnit, type LineEvidenceKind, type LineModeState } from "./contract";

/** 提示过一次后在这台电脑上记的标记（不含任何金额） */
export const costDraftPromptedKey = (projectId: string) => `qy.bidPage.costDraftPrompted.${projectId}`;

export type DraftImportResult = {
  state: LineModeState;
  importedRows: number[];
  skipped: string[];
};

const toNum = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = String(s).replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 草稿里有没有可带入的行（没有就不提示） */
export function draftHasLines(draft: CostDraft): boolean {
  return Object.values(draft.lines).some((l) => toNum(l.unitPrice) != null);
}

export function importCostDraft(state: LineModeState, draft: CostDraft): DraftImportResult {
  const importedRows: number[] = [];
  const skipped = new Set<string>();
  const rows = state.rows.map((row, i) => {
    const lineNo = i + 1;
    const d = draft.lines[String(lineNo)];
    if (!d) return row;
    const price = toNum(d.unitPrice);
    if (price == null || price < 0) return row;
    const basis = d.basis === "PER_PIECE" && piecesPerUnit(row.uom, row.packCount) != null ? "PER_PIECE" : "PER_TENDER_UOM";
    if (d.basis === "PER_PIECE" && basis !== "PER_PIECE") skipped.add(`第 ${lineNo} 行草稿是按件报价，但这一行没有包装数，按招标单位带入了，请核对`);
    const evidenceKind = (LINE_EVIDENCE_KINDS as readonly string[]).includes(d.evidenceKind) ? (d.evidenceKind as LineEvidenceKind) : "ESTIMATE";
    importedRows.push(lineNo);
    if (toNum(d.dutyRatePct) != null) skipped.add("草稿里逐行的关税率（逐行报价里关税率是共用参数）");
    if (toNum(d.freightCad) != null || toNum(d.localDeliveryCad) != null) skipped.add("草稿里逐行的运费、送货费（逐行报价里是共用参数）");
    if (toNum(d.otherCad) != null) skipped.add("草稿里逐行的其它费用（需要的话在专业模式里加）");
    return { ...row, unitPrice: price, basis, currency: d.currency || row.currency, evidenceKind, inquiryItemId: null } as typeof row;
  });
  const fx = { ...state.fx };
  for (const [ccy, e] of Object.entries(draft.fx)) {
    if (ccy === "CAD") continue;
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
    skipped.add("草稿用的是成本加成定价（逐行报价按售价毛利定价，目标毛利率请自己填）");
  }
  if (toNum(draft.importGstRatePct) != null) skipped.add("草稿里的进口 GST（逐行报价不含销售税）");
  if (toNum(draft.reserveOnSalePct) != null && toNum(draft.reserveOnSalePct) !== 0) skipped.add("草稿里的按售价预留（需要的话在专业模式里加）");
  return { state: { ...state, rows, fx, targetMarginPct }, importedRows, skipped: [...skipped] };
}
