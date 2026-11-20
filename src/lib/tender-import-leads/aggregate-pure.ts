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

/** 品名与要求共有的词：按去掉词尾 s 的词比，显示品名里的原词（不显示「batterie」这种截出来的样子） */
export function sharedKeywords(goods: ReadonlyArray<string | null>, requirementTexts: readonly string[], max = MAX_SHARED_KEYWORDS): string[] {
  const req = new Set<string>();
  for (const t of requirementTexts) for (const k of keywordsOf(t)) req.add(k);
  const shown = new Map<string, string>();
  for (const g of goods) {
    for (const raw of (g ?? "").toLowerCase().split(/[^a-z]+/)) {
      if (raw.length < 3) continue;
      const k = stem(raw);
      if (!req.has(k) || STOPWORDS.has(k) || STOPWORDS.has(raw) || shown.has(k)) continue;
      shown.set(k, raw);
    }
  }
  return [...shown.values()].sort().slice(0, max);
}

/* ---------------------------------- 汇总 ---------------------------------- */

export type LinkedSupplierRef = { id: string; name: string; hasEmail: boolean; active: boolean };

export type MatchedLeadInput = {
  exporterName: string;
  shipmentDate: string | null;
  goods: string | null;
  winners: readonly string[];
  linkedSupplier: LinkedSupplierRef | null;
  /** 还能关联（状态 NEW / REVIEWED 且没关联供应商）——「加入供应商库」之后新导入或新确认的会是这种 */
  linkable?: boolean;
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
  /** 这家出口商里还没关联到供应商的线索条数（>0 时仍给「加入供应商库」/「关联新导入的」） */
  unlinkedLeads: number;
};

const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function aggregateByExporter(leads: readonly MatchedLeadInput[], opts: { now: Date; requirementTexts: readonly string[] }): ExporterSummary[] {
  const groups = new Map<string, { name: string; winners: string[]; dates: string[]; goods: Array<string | null>; shipments: number; supplier: LinkedSupplierRef | null; unlinked: number }>();
  for (const l of leads) {
    const key = normalizeCompanyName(l.exporterName);
    if (!key) continue;
    const g = groups.get(key) ?? { name: l.exporterName.trim(), winners: [], dates: [], goods: [], shipments: 0, supplier: null, unlinked: 0 };
    g.shipments += 1;
    if (l.linkable) g.unlinked += 1;
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
      // 上界与解析时「在未来」的界线一致：UTC 今天再加一天（时差）
      last12Months: g.dates.filter((d) => !isOlderThanCurrentWindow(day(d), opts.now) && day(d).getTime() <= opts.now.getTime() + 24 * 60 * 60 * 1000).length,
      latestDate,
      historical: latestDate ? isOlderThanCurrentWindow(day(latestDate), opts.now) : null,
      sharedKeywords: sharedKeywords(g.goods, opts.requirementTexts),
      supplier: g.supplier,
      unlinkedLeads: g.unlinked,
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
  winnersNotConnected: "授标记录还没有接通，没法比对历史中标者（请联系管理员开启）。",
  winnersNoBuyer: "项目没有采购方名称，没法找历史中标者。",
  winnersNone: "本项目采购方还没有他人中标的记录（不含我方结果），没法比对。",
  winnersUnavailable: "历史中标者暂时读不出来，请稍后刷新。",
  empty: "还没有导入进口记录。",
  unreadable: "进口线索暂时读不出来，请稍后刷新。",
  aliasConflict: "同事已经处理过这一对，页面已更新。",
  /** CHAIN-3c：裁决与撤回只限组织管理员 */
  notOrgAdmin: "只有组织管理员能确认、否决或撤回「是不是同一家」（对本组织所有项目生效）。",
  revokeConflict: "这一对现在没有可撤回的裁决，页面已更新。",
  pairNotInProject: "这一对不在本项目里。",
  revoked: "已撤回，这一对回到待确认。",
  revokedRejection: "之前因否决没有导入的记录需要重新导入。",
  formerMember: "不是本组织现有成员",
  aliasNotPending: "这一对已不需要确认。",
  exporterNotInSummary: "这家出口商不在本项目的进口线索汇总里。",
  aliasConfirmed: "已确认是同一家，相关记录已加入出口商汇总。",
  aliasRejected: "已标为不是同一家，这些记录不再显示。",
  leadCap: (n: number, cap: number) => `这个项目已有 ${n} 条进口记录（含在供应链页标为不采用的），最多 ${cap} 条，这一批放不下了。`,
  storedButHidden: (n: number) => `已导入 ${n} 条进口记录；历史中标者现在读不出来，先不显示。`,
  storedPending: (n: number) => `已导入 ${n} 条进口记录，都在等确认是不是同一家（打开进口线索查看）。`,
  storedUnmatched: (n: number) => `已导入 ${n} 条进口记录，但都对不上本采购方现在的历史中标者（或已标为不是同一家），不显示。`,
  cannotImport: (reason: string) => `暂时不能导入：${reason}`,
  supplierCreated: "已加入供应商库。进口记录通常没有邮箱，请先补上联系邮箱才能发询价；补上后在项目里点「问供应商要价」就能勾选它。",
  supplierLinkedNoEmail: "它还没有联系邮箱，补上后才能发询价。",
  supplierLinked: (name: string) => `供应商库里已有「${name}」，已关联，没有新建。`,
  supplierInactive: "它已停用，要发询价请先在供应商页启用。",
  supplierMissingEmail: "缺联系邮箱，去补邮箱",
  supplierNotAdded: "未加入供应商库",
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

/** CHAIN-3c：本项目现有记录涉及、当前有裁决的一对（名称用本项目的写法；裁决人只显示本组织现有成员的名字） */
export type DecidedPairView = {
  pairKey: string;
  /** 那条裁决审计行的 id；撤回请求带上它，裁决已被同事换掉时 409 */
  decisionId: string;
  importerName: string;
  winnerName: string;
  decision: "CONFIRMED" | "REJECTED";
  deciderName: string;
  /** YYYY-MM-DD（UTC） */
  decidedOn: string;
  recordCount: number;
};

export type ImportLeadsView = {
  caveatZh: string;
  leadStatusZh: string;
  sourceNotesZh: string[];
  winners: WinnersState;
  suggestions: PendingSuggestionView[];
  exporters: ExporterSummary[];
  /** 挂上的线索条数 */
  leadCount: number;
  /** 本项目存着的线索条数（不含在供应链页标为不采用的） */
  storedLeadCount: number;
  canEdit: boolean;
  /** CHAIN-3c：调用人能不能确认、否决、撤回「是不是同一家」（组织管理员） */
  canDecideAliases: boolean;
  /** CHAIN-3c：已裁决的一节 */
  decidedPairs: DecidedPairView[];
};

/**
 * 槽里那一行摘要：有挂上的线索时「{N} 家出口商（{M} 条线索）」；存着线索但中标者读不出来 / 都在等确认时照实说；
 * 一条都没有时「还没有导入进口记录。」
 */
export function slotSummaryZh(view: Pick<ImportLeadsView, "exporters" | "leadCount" | "storedLeadCount" | "winners" | "suggestions">): string {
  if (view.exporters.length) return `${view.exporters.length} 家出口商（${view.leadCount} 条线索）`;
  if (view.storedLeadCount > 0) {
    if (view.winners.status !== "ok") return IMPORT_LEADS_TEXT.storedButHidden(view.storedLeadCount);
    return view.suggestions.length ? IMPORT_LEADS_TEXT.storedPending(view.storedLeadCount) : IMPORT_LEADS_TEXT.storedUnmatched(view.storedLeadCount);
  }
  if (view.winners.status !== "ok") return IMPORT_LEADS_TEXT.cannotImport(view.winners.messageZh);
  return IMPORT_LEADS_TEXT.empty;
}

export type ImportResultCounts = {
  totalRecords: number;
  imported: number;
  matched: number;
  suggested: number;
  duplicates: number;
  unrelated: number;
  unrelatedImporters: string[];
  problemRecords: number;
};

/**
 * 导入结果那一句：「共 N 条：导入 a 条（b 条已对应中标者，c 条要你确认是不是同一家）；重复跳过 d 条；
 * e 条的进口商不是这个采购方的中标者，没有保存（甲、乙）；f 条有问题没有导入，见下。」——为 0 的那半句不写。
 */
export function importResultZh(r: ImportResultCounts): string {
  const detail = [r.matched ? `${r.matched} 条已对应中标者` : "", r.suggested ? `${r.suggested} 条要确认是不是同一家` : ""].filter(Boolean).join("，");
  const parts = [r.imported ? `导入 ${r.imported} 条${detail ? `（${detail}）` : ""}` : "没有新导入"];
  if (r.duplicates) parts.push(`重复跳过 ${r.duplicates} 条`);
  if (r.unrelated) parts.push(`${r.unrelated} 条的进口商不是这个采购方的中标者，没有保存${r.unrelatedImporters.length ? `（${r.unrelatedImporters.join("、")}）` : ""}`);
  if (r.problemRecords) parts.push(`${r.problemRecords} 条有问题没有导入，见下`);
  return `共 ${r.totalRecords} 条：${parts.join("；")}。`;
}
