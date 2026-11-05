/**
 * PROC-1 采购工具身份（纯函数）：编号 / 机构规范化与去重键（design D5）。
 *
 * 去重键 = jurisdiction | procuringEntityKey | instrumentClass | normalizedNumber（组织内唯一）。
 * - 标题从不参与去重；
 * - 合同 / SO / SA 同属 AWARD_INSTRUMENT，避免来源间"SO / contract"说法不一致拆成两条；
 * - 机构走固定别名表；未命中的保持规范化原文并标 mapped=false（同号不同机构 → 人工复核，不自动合并）。
 */

export const JURISDICTIONS = ["CA-FED", "CA-ON", "CA-BC", "CA-MB", "CA-QC", "CA-AB", "CA-SK", "OTHER"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  "CA-FED": "加拿大联邦",
  "CA-ON": "安大略省",
  "CA-BC": "不列颠哥伦比亚省",
  "CA-MB": "曼尼托巴省",
  "CA-QC": "魁北克省",
  "CA-AB": "阿尔伯塔省",
  "CA-SK": "萨斯喀彻温省",
  OTHER: "其他",
};

export const INSTRUMENT_CLASSES = ["SOLICITATION", "AWARD_INSTRUMENT", "CALL_UP", "OTHER"] as const;
export type InstrumentClass = (typeof INSTRUMENT_CLASSES)[number];

export const INSTRUMENT_SUBTYPES = [
  "CONTRACT",
  "STANDING_OFFER",
  "SUPPLY_ARRANGEMENT",
  "PURCHASE_ORDER",
  "UNKNOWN",
] as const;
export type InstrumentSubtype = (typeof INSTRUMENT_SUBTYPES)[number];

export const INSTRUMENT_CLASS_LABELS: Record<InstrumentClass, string> = {
  SOLICITATION: "招标 / 征集",
  AWARD_INSTRUMENT: "合同 / SO / SA",
  CALL_UP: "Call-up / PO",
  OTHER: "其他",
};

export function isJurisdiction(v: unknown): v is Jurisdiction {
  return typeof v === "string" && (JURISDICTIONS as readonly string[]).includes(v);
}

export function isInstrumentClass(v: unknown): v is InstrumentClass {
  return typeof v === "string" && (INSTRUMENT_CLASSES as readonly string[]).includes(v);
}

/** 去重音、转小写、标点改空格、空白坍缩（检索 / 别名表共用） */
export function foldText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface NormalizedNumber {
  /** 规范编号（大写、去空白与 - _ . / #） */
  normalized: string;
  /** 被剥掉的修订 / 记录后缀（如 CanadaBuys 合同历史的 -001） */
  amendmentSuffix: string | null;
  raw: string;
}

/**
 * 规范化正式编号。只在「余下部分 ≥ 6 个字符且含数字、后缀恰为 3 位数字」时剥后缀，
 * 因此 `CW2379109-001` → `CW2379109`（后缀 001），而 `W3380-23FD05`、`21C51-249059` 不受影响。
 */
export function normalizeInstrumentNumber(raw: string): NormalizedNumber {
  const trimmed = raw.trim();
  let base = trimmed;
  let suffix: string | null = null;
  const m = /^(.*?)[-/](\d{3})$/.exec(trimmed);
  if (m && m[1].replace(/[\s\-_./#]/g, "").length >= 6 && /\d/.test(m[1])) {
    base = m[1];
    suffix = m[2];
  }
  return {
    normalized: base.toUpperCase().replace(/[\s\-_./#]+/g, ""),
    amendmentSuffix: suffix,
    raw: trimmed,
  };
}

/** 两个编号是否规范相等 */
export function sameInstrumentNumber(a: string, b: string): boolean {
  const na = normalizeInstrumentNumber(a).normalized;
  return na.length > 0 && na === normalizeInstrumentNumber(b).normalized;
}

/** 机构别名表：联邦机构 + 已有单独申请规则的市级机关（固定；扩充走 PR，不在运行期猜测） */
const INSTITUTION_ALIASES: Record<string, string[]> = {
  PSPC: [
    "pspc",
    "pwgsc",
    "spac",
    "tpsgc",
    "public services and procurement canada",
    "public works and government services canada",
    "services publics et approvisionnement canada",
    "travaux publics et services gouvernementaux canada",
    "public services and procurement",
    "pspc spac",
  ],
  CSC: [
    "csc",
    "scc",
    "correctional service canada",
    "correctional service of canada",
    "correctional services canada",
    "service correctionnel canada",
    "service correctionnel du canada",
    "csc scc",
  ],
  CORCAN: ["corcan", "csc corcan", "corcan csc"],
  DND: [
    "dnd",
    "mdn",
    "national defence",
    "department of national defence",
    "defence construction canada dnd",
    "defense nationale",
    "ministere de la defense nationale",
    "dnd caf",
    "dnd mdn",
  ],
  TBS: ["tbs", "sct", "treasury board of canada secretariat", "secretariat du conseil du tresor du canada"],
  // 多伦多市政府本身（MFIPPA 机关）；TTC、多伦多警察服务、TCHC 等市属机构各自独立受理，不并入
  TORONTO: ["city of toronto", "ville de toronto", "toronto city hall", "city of toronto purchasing and materials management division", "city of toronto pmmd"],
};

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [key, aliases] of Object.entries(INSTITUTION_ALIASES)) {
    map.set(key.toLowerCase(), key);
    for (const a of aliases) map.set(foldText(a), key);
  }
  return map;
})();

export const INSTITUTION_DISPLAY: Record<string, string> = {
  PSPC: "Public Services and Procurement Canada (PSPC)",
  CSC: "Correctional Service Canada (CSC)",
  CORCAN: "CORCAN (CSC)",
  DND: "National Defence (DND)",
  TBS: "Treasury Board of Canada Secretariat (TBS)",
  TORONTO: "City of Toronto",
};

export interface InstitutionKey {
  key: string;
  /** 是否命中别名表（false = 规范化原文，跨来源合并须人工复核） */
  mapped: boolean;
}

/** 规范机构键：命中别名表 → 固定键；否则 `RAW:` + 规范化原文；空 → `UNKNOWN` */
export function normalizeInstitutionKey(raw: string | null | undefined): InstitutionKey {
  const folded = foldText(raw);
  if (!folded) return { key: "UNKNOWN", mapped: false };
  const direct = ALIAS_LOOKUP.get(folded);
  if (direct) return { key: direct, mapped: true };
  // 形如 "Public Services and Procurement Canada (PSPC)" / "CSC - Ontario Region"：逐段尝试
  const parts = (raw ?? "")
    .split(/[()\/,;|–—-]+/)
    .map((p) => foldText(p))
    .filter(Boolean);
  for (const p of parts) {
    const hit = ALIAS_LOOKUP.get(p);
    if (hit) return { key: hit, mapped: true };
  }
  return { key: `RAW:${folded.replace(/\s+/g, "-").slice(0, 80)}`, mapped: false };
}

export function institutionDisplayName(key: string | null | undefined, fallback?: string | null): string {
  if (!key) return fallback ?? "未知机构";
  return INSTITUTION_DISPLAY[key] ?? fallback ?? key.replace(/^RAW:/, "");
}

export function buildInstrumentDedupeKey(input: {
  jurisdiction: Jurisdiction;
  procuringEntityKey: string;
  instrumentClass: InstrumentClass;
  normalizedNumber: string;
}): string {
  return [input.jurisdiction, input.procuringEntityKey, input.instrumentClass, input.normalizedNumber].join("|");
}

/**
 * 同号同类但机构键不同：是否需要人工复核（任一方未命中别名表时不能确定是同一机构）。
 * 两边都命中别名表且键不同 → 确定是不同机构的不同记录（如 PSPC 的 SO 与 CSC 的 call-up 同号极少见，仍各自独立）。
 */
export function needsInstitutionReview(a: InstitutionKey, b: InstitutionKey): boolean {
  if (a.key === b.key) return false;
  return !a.mapped || !b.mapped;
}

/** 申请主体规范键（法定名称规范化；空 → null，重复检查按本组织保守匹配） */
export function applicantCanonicalKey(legalName: string | null | undefined): string | null {
  const folded = foldText(legalName)
    .replace(/\b(inc|incorporated|ltd|limited|corp|corporation|co|company|ltee|llc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return folded ? folded : null;
}

/** 规范机构键的全部已知别名（含键本身；RAW / UNKNOWN 返回规范化原文） */
export function institutionAliases(key: string): string[] {
  const list = INSTITUTION_ALIASES[key];
  if (list) return [key.toLowerCase(), ...list];
  if (key.startsWith("RAW:")) return [key.slice(4).replace(/-/g, " ")];
  return [];
}
