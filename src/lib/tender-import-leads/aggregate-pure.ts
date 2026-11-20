/**
 * CHAIN-3 按出口商汇总进口线索 + 面板视图的文案（纯函数，判断点 7 A：只计数与比对，不调模型、不打「推荐」）
 */

import { normalizeCompanyName } from "@/lib/tender-competition/company-identity";
import { IMPORT_LEAD_CAVEAT_ZH, IMPORT_LEAD_STATUS_ZH, isOlderThanCurrentWindow } from "@/lib/tender-competition/import-leads";

export const MAX_SHARED_KEYWORDS = 5;

/** 关键词比对时去掉的常见虚词与泛称（英文；品名与招标要求的原文多为英文） */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "shall", "must", "will", "are", "not", "all", "any", "each", "per",
  "only", "into", "upon", "such", "may", "can", "has", "have", "been", "being", "its", "our", "your", "their", "which", "who", "whom", "what",
  "when", "where", "how", "than", "then", "also", "other", "item", "unit", "product", "supply", "supplie", "including", "include", "etc",
  "made", "used", "use", "new", "one", "two", "set", "pcs", "pce", "piece", "carton", "ctn", "package", "pkg", "box", "general", "goods",
  "meet", "minimum", "maximum", "least", "required", "requirement", "provide", "provided", "contractor", "supplier", "vendor", "bidder",
]);

function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

export function keywordsOf(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 3) continue;
    const w = stem(raw);
    if (w.length < 3 || STOPWORDS.has(w) || STOPWORDS.has(raw)) continue;
    out.add(w);
  }
  return out;
}

export function sharedKeywords(goods: ReadonlyArray<string | null>, requirementTexts: readonly string[], max = MAX_SHARED_KEYWORDS): string[] {
  const req = new Set<string>();
  for (const t of requirementTexts) for (const k of keywordsOf(t)) req.add(k);
  const hits = new Set<string>();
  for (const g of goods) for (const k of keywordsOf(g)) if (req.has(k)) hits.add(k);
  return [...hits].sort().slice(0, max);
}

/* ---------------------------------- 汇总 ---------------------------------- */

export type LinkedSupplierRef = { id: string; name: string; hasEmail: boolean; active: boolean };

export type MatchedLeadInput = {
  exporterName: string;
  shipmentDate: string | null;
  goods: string | null;
  winners: readonly string[];
  linkedSupplier: LinkedSupplierRef | null;
};

export type ExporterSummary = {
  exporterKey: string;
  exporterName: string;
  winnerNames: string[];
  shipments: number;
  last12Months: number;
  latestDate: string | null;
  /** 最近一票早于 12 个月前；都没有日期 = null（「日期未知」） */
  historical: boolean | null;
  sharedKeywords: string[];
  supplier: LinkedSupplierRef | null;
};

const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function aggregateByExporter(leads: readonly MatchedLeadInput[], opts: { now: Date; requirementTexts: readonly string[] }): ExporterSummary[] {
  const groups = new Map<string, { name: string; winners: string[]; dates: string[]; goods: Array<string | null>; shipments: number; supplier: LinkedSupplierRef | null }>();
  for (const l of leads) {
    const key = normalizeCompanyName(l.exporterName);
    if (!key) continue;
    const g = groups.get(key) ?? { name: l.exporterName.trim(), winners: [], dates: [], goods: [], shipments: 0, supplier: null };
    g.shipments += 1;
    if (l.shipmentDate) g.dates.push(l.shipmentDate);
    g.goods.push(l.goods);
    for (const w of l.winners) if (!g.winners.some((x) => normalizeCompanyName(x) === normalizeCompanyName(w))) g.winners.push(w);
    if (!g.supplier && l.linkedSupplier) g.supplier = l.linkedSupplier;
    groups.set(key, g);
  }
  const out: ExporterSummary[] = [...groups.entries()].map(([exporterKey, g]) => {
    const latestDate = g.dates.length ? [...g.dates].sort()[g.dates.length - 1] : null;
    return {
      exporterKey,
      exporterName: g.name,
      winnerNames: g.winners,
      shipments: g.shipments,
      last12Months: g.dates.filter((d) => !isOlderThanCurrentWindow(day(d), opts.now) && day(d).getTime() <= opts.now.getTime()).length,
      latestDate,
      historical: latestDate ? isOlderThanCurrentWindow(day(latestDate), opts.now) : null,
      sharedKeywords: sharedKeywords(g.goods, opts.requirementTexts),
      supplier: g.supplier,
    };
  });
  return out.sort(
    (a, b) =>
      b.last12Months - a.last12Months ||
      b.shipments - a.shipments ||
      (b.latestDate ?? "").localeCompare(a.latestDate ?? "") ||
      a.exporterName.localeCompare(b.exporterName),
  );
}

/* ---------------------------------- 视图 ---------------------------------- */

export const IMPORT_LEADS_TEXT = {
  caveat: IMPORT_LEAD_CAVEAT_ZH,
  leadStatus: IMPORT_LEAD_STATUS_ZH.LEAD_UNVERIFIED,
  winnersNotConnected: "授标记录还没有接通（需管理员开启），没法比对历史中标者。",
  winnersNoBuyer: "项目没有采购方名称，没法找历史中标者。",
  winnersNone: "本项目采购方还没有他人中标的记录（不含我方结果），没法比对。",
  winnersUnavailable: "历史中标者暂时读不出来，请稍后刷新。",
  empty: "还没有导入进口记录。",
  unreadable: "进口线索暂时读不出来，请稍后刷新。",
  aliasConflict: "这一对已经有人裁决过了，已刷新。",
  supplierCreated: "已加入供应商库。提单记录通常没有邮箱，请先补上联系邮箱，才能发询价。",
  supplierLinked: (name: string) => `供应商库里已有「${name}」，已关联，没有新建。`,
  supplierInactive: "它已停用，要发询价请先在供应商页启用。",
  supplierMissingEmail: "已在供应商库，缺联系邮箱（去补上）",
  supplierReady: "已在供应商库",
  dateUnknown: "日期未知",
  historical: "已超过 12 个月",
} as const;

export type WinnersState =
  | { status: "ok"; names: string[] }
  | { status: "not_connected" | "no_buyer" | "none" | "unavailable"; messageZh: string };

export function winnersStateMessage(status: "not_connected" | "no_buyer" | "none" | "unavailable"): string {
  return status === "not_connected"
    ? IMPORT_LEADS_TEXT.winnersNotConnected
    : status === "no_buyer"
      ? IMPORT_LEADS_TEXT.winnersNoBuyer
      : status === "none"
        ? IMPORT_LEADS_TEXT.winnersNone
        : IMPORT_LEADS_TEXT.winnersUnavailable;
}

export type PendingSuggestionView = { pairKey: string; importerName: string; winnerName: string; basisZh: string; recordCount: number };

export type ImportLeadsView = {
  caveatZh: string;
  leadStatusZh: string;
  sourceNotesZh: string[];
  winners: WinnersState;
  suggestions: PendingSuggestionView[];
  exporters: ExporterSummary[];
  leadCount: number;
  canEdit: boolean;
};

/** 槽里那一行摘要：有线索时「{N} 家出口商（{M} 条线索）」，没有时「还没有导入进口记录。」 */
export function slotSummaryZh(view: Pick<ImportLeadsView, "exporters" | "leadCount">): string {
  return view.exporters.length ? `${view.exporters.length} 家出口商（${view.leadCount} 条线索）` : IMPORT_LEADS_TEXT.empty;
}
