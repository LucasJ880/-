/**
 * PROC-1 前序供应商汇总与进口线索（纯函数，确定性，客户端安全）。
 *
 * 「上一次是谁供货」只来自已入库的采购工具（合同披露 vendor_name 等官方开放数据或人工导入），按合同日期排序；
 * 金额是合同披露值（合同 / 修订后上限或报告值），不等于实际支出，按口径与币种分列、整数分计算，不跨口径相加。
 * 本模块不写 AwardRecord：确认上轮中标由用户在界面上点按钮，走既有的人工确认路由
 * （/api/projects/[id]/external-intel/award-history，HUMAN_CONFIRMED）。
 *
 * 海关：加拿大不公开逐票报关（进口申报）记录。这里只给官方公开来源的检索指引（不抓取、不出站）；
 * 需要登录或付费的商业提单数据库不接入（硬纪律 5，且不是官方来源）。
 */

import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";

export interface SupplierInstrumentInput {
  id: string;
  officialNumber: string;
  title: string | null;
  /** CURRENT | PREDECESSOR | RELATED_HISTORY | CALL_UP（关联合同下的 call-up） */
  relation: string;
  instrumentClass: string;
  vendorName: string | null;
  /** YYYY-MM-DD */
  awardDate: string | null;
  contractValue: string | null;
  contractValueBasis: string | null;
  currency: string | null;
  contractingInstitution: string | null;
  buyingInstitution: string | null;
  /** 最近一条合同披露证据（用于确认中标时带上 reference_number 与来源链接） */
  evidence: { sourceType: string; sourceRecordId: string | null; sourceUrl: string | null; lastSeenAt: string | null } | null;
}

export interface SupplierTotal {
  basis: string;
  currency: string;
  /** 整数分（字符串，避免精度丢失） */
  cents: string;
  count: number;
}

export interface SupplierSummary {
  vendorKey: string;
  vendorName: string;
  instrumentCount: number;
  latestAwardDate: string | null;
  instruments: Array<{ id: string; officialNumber: string; title: string | null; relation: string; awardDate: string | null; valueCents: string | null; basis: string | null; currency: string | null }>;
  totals: SupplierTotal[];
  /** 给「确认为上轮中标」按钮的结构化上下文（取该供应商最近一份合同） */
  confirm: {
    vendorName: string;
    referenceNumber: string | null;
    buyerName: string | null;
    contractValue: number | null;
    contractDate: string | null;
    sourceUrl: string | null;
    evidenceSnippet: string;
  };
}

export interface SupplierRollup {
  suppliers: SupplierSummary[];
  /** 按合同日期最近的一份有供应商的前序 / 相关合同（CURRENT 不算「上一次」） */
  lastSupplier: { vendorName: string; awardDate: string | null; officialNumber: string } | null;
  withoutVendor: number;
  notesZh: string[];
}

const SUFFIX_RE = /(^|\s)(inc|incorporated|ltd|limited|ltee|ltée|corp|corporation|co|company|llc|lp|ulc)(?=\s|$)/gu;

/** 供应商分组键：与 AwardRecord 同一规范化（normalizeBuyerName），再去掉常见公司后缀，只用于分组 */
export function supplierKey(name: string): string {
  return normalizeBuyerName(name).replace(SUFFIX_RE, "$1").replace(/\s+/g, " ").trim();
}

/** "12345.6" → 1234560n；非法或空 → null（不按 0 处理） */
export function decimalToCents(v: string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) return null;
  const cents = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] === "-" ? -cents : cents;
}

function centsToNumber(c: bigint | null): number | null {
  if (c === null) return null;
  return Number(c) / 100;
}

const byDateDesc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

export function summarizeSuppliers(rows: SupplierInstrumentInput[]): SupplierRollup {
  const groups = new Map<string, { names: Map<string, number>; rows: SupplierInstrumentInput[] }>();
  let withoutVendor = 0;
  for (const r of rows) {
    const name = r.vendorName?.trim();
    if (!name) {
      withoutVendor++;
      continue;
    }
    const key = supplierKey(name);
    if (!key) {
      withoutVendor++;
      continue;
    }
    const g = groups.get(key) ?? { names: new Map<string, number>(), rows: [] };
    g.names.set(name, (g.names.get(name) ?? 0) + 1);
    g.rows.push(r);
    groups.set(key, g);
  }

  const suppliers: SupplierSummary[] = [];
  for (const [vendorKey, g] of groups) {
    // 显示名：出现最多的写法；并列取字典序最小，保证确定性
    const vendorName = [...g.names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const sorted = [...g.rows].sort((a, b) => byDateDesc(a.awardDate, b.awardDate) || (a.officialNumber < b.officialNumber ? -1 : 1));
    const totals = new Map<string, { basis: string; currency: string; cents: bigint; count: number }>();
    for (const r of sorted) {
      const c = decimalToCents(r.contractValue);
      if (c === null) continue;
      const basis = r.contractValueBasis ?? "UNKNOWN";
      const currency = r.currency ?? "未标注";
      const k = `${basis}|${currency}`;
      const t = totals.get(k) ?? { basis, currency, cents: BigInt(0), count: 0 };
      t.cents += c;
      t.count++;
      totals.set(k, t);
    }
    const latest = sorted[0];
    const latestCents = decimalToCents(latest.contractValue);
    suppliers.push({
      vendorKey,
      vendorName,
      instrumentCount: sorted.length,
      latestAwardDate: latest.awardDate,
      instruments: sorted.map((r) => {
        const c = decimalToCents(r.contractValue);
        return { id: r.id, officialNumber: r.officialNumber, title: r.title, relation: r.relation, awardDate: r.awardDate, valueCents: c === null ? null : c.toString(), basis: r.contractValueBasis, currency: r.currency };
      }),
      totals: [...totals.values()].sort((a, b) => (a.basis + a.currency < b.basis + b.currency ? -1 : 1)).map((t) => ({ basis: t.basis, currency: t.currency, cents: t.cents.toString(), count: t.count })),
      confirm: {
        vendorName,
        referenceNumber: latest.evidence?.sourceType === "OPEN_CANADA_CONTRACTS" ? (latest.evidence.sourceRecordId ?? null) : null,
        buyerName: latest.buyingInstitution ?? latest.contractingInstitution ?? null,
        contractValue: latest.currency === "CAD" || latest.currency === null ? centsToNumber(latestCents) : null,
        contractDate: latest.awardDate,
        sourceUrl: latest.evidence?.sourceUrl ?? null,
        evidenceSnippet: `合同披露：${latest.officialNumber}${latest.title ? ` ${latest.title}` : ""}（${latest.awardDate ?? "日期未知"}）`.slice(0, 500),
      },
    });
  }
  suppliers.sort((a, b) => byDateDesc(a.latestAwardDate, b.latestAwardDate) || (a.vendorName < b.vendorName ? -1 : 1));

  const history = rows
    .filter((r) => r.relation !== "CURRENT" && r.vendorName?.trim())
    .sort((a, b) => byDateDesc(a.awardDate, b.awardDate) || (a.officialNumber < b.officialNumber ? -1 : 1));
  const last = history[0];

  return {
    suppliers,
    lastSupplier: last ? { vendorName: last.vendorName!.trim(), awardDate: last.awardDate, officialNumber: last.officialNumber } : null,
    withoutVendor,
    notesZh: [
      "供应商来自已入库的合同披露（官方开放数据）或人工导入；未入库的合同不在此列，不代表没有其他供应商。",
      "金额是合同披露值（合同 / 修订后上限或报告值），不等于实际支出；按口径与币种分列，不跨口径相加。",
      "确认为上轮中标需要你点按钮；系统不自动把供应商写成上轮中标方。",
    ],
  };
}

export interface ImportLeadSource {
  key: string;
  label: string;
  url: string;
  whatZh: string;
  limitsZh: string;
}

/** 进口 / 海关线索：只列官方公开来源（人工检索），并说明能查到什么、查不到什么 */
export const IMPORT_LEAD_SOURCES: ImportLeadSource[] = [
  {
    key: "CID",
    label: "Canadian Importers Database（ISED）",
    url: "https://ised-isde.canada.ca/site/canadian-importers-database/en",
    whatZh: "按 HS 编码（6 位）列出合计约占该品类进口额 80% 的主要进口商：公司名与所在城市。",
    limitsZh: "没有逐票记录、没有每家公司的金额；数据年份较旧（以页面显示的年份为准）。",
  },
  {
    key: "CID_OPEN_DATA",
    label: "CID 开放数据下载（open.canada.ca）",
    url: "https://open.canada.ca/data/en/dataset/557ccb8d-d035-420d-bfd7-47dfbe0cd18b",
    whatZh: "同一数据库的表格下载（按 HS6 的主要进口商等），便于离线筛选。",
    limitsZh: "这一版是 2018 年数据；以数据集页面列出的版本为准。",
  },
  {
    key: "CIMT",
    label: "Canadian International Merchandise Trade Web Application（Statistics Canada）",
    url: "https://www150.statcan.gc.ca/n1/en/catalogue/71-607-X2021004",
    whatZh: "按 HS 编码（进口最细到 10 位）、来源国、省份、月份查进口总额，用于判断市场规模与主要来源国。",
    limitsZh: "只有汇总数据，没有公司名。",
  },
];

export const IMPORT_LEAD_NOTES_ZH = [
  "加拿大不公开逐票报关（进口申报）记录：CBSA 只向申报人本人提供，无法查到某个竞争对手的具体进口单。",
  "美国提单数据只能通过需要登录或付费的商业数据库取得：青砚不接入；如你自行购买，可作为附件上传，并注明来源。",
  "HS 编码以 CBSA 现行税则为准，例如塑料百叶窗 / 卷帘常见 3925.30，纺织窗帘与室内遮光帘在 6303 下；先确认自己的产品归类再检索。",
];
