/**
 * S3-B Slice 2：供应商证据工作台的文案映射与「资料状态」计算（纯函数，无 DB / 无 React）。
 *
 * 纪律：
 *   - **厂家声称 ≠ 已核验**。CLAIMED 永远显示成「厂家声称 / 待核验」，不出现「已认证」。
 *   - **过期是客观事实**。存的状态是 VERIFIED、但日期已过，界面必须明说「按日期已过期」。
 *   - **缺价合法**。没有单价显示「价格待确认」，不是「资料不完整」。
 *   - **资料状态 ≠ 评分**。下面的 completeness 只回答「记了什么、还缺什么」；
 *     不产生 0–100、红黄绿、合格率、Tender Fit——那些是 S4 冻结的 supplier-score-v1 的事。
 *   - 状态一律用文字表达，颜色只是辅助。
 */

import type { LabelWithTone, Tone } from "./workspace-labels";

/* ───────────────── 资质 ───────────────── */

export function certificationStatusDisplay(status: string, expiredByDate: boolean): LabelWithTone {
  switch (status) {
    case "CLAIMED":
      return {
        label: "厂家声称 / 待核验",
        tone: "warning",
        hint: "厂家说有这个证书。还没有用独立证据核对过——不等于已认证。",
      };
    case "VERIFIED":
      return expiredByDate
        ? {
            label: "已独立核验（按日期已过期）",
            tone: "danger",
            hint: "核验过，但证书有效期已经过去。需要重新取得有效证书。",
          }
        : { label: "已独立核验", tone: "success", hint: "有独立证据（档案或官方登记库）且经人工确认。" };
    case "REJECTED":
      return { label: "核验未通过", tone: "danger", hint: "人工核验后认定不成立或证据不足。" };
    case "EXPIRED":
      return { label: "已过期 / 不再有效", tone: "neutral", hint: null };
    default:
      return { label: status, tone: "neutral", hint: null };
  }
}

const CERT_SCOPE: Record<string, string> = {
  SUPPLIER: "整个供应商",
  PRODUCT: "具体产品",
  MODEL_SERIES: "型号系列",
};
export function certificationScopeLabel(scope: string): string {
  return CERT_SCOPE[scope] ?? scope;
}

const CERT_TYPE: Record<string, string> = {
  UL: "UL",
  ETL: "ETL",
  CSA: "CSA",
  BIFMA: "BIFMA",
  GREENGUARD: "GREENGUARD",
  ISO_9001: "ISO 9001 质量体系",
  ISO_14001: "ISO 14001 环境体系",
  CE: "CE",
  FCC: "FCC",
  ROHS: "RoHS",
  REACH: "REACH",
  FSC: "FSC",
  BSCI: "BSCI",
  SMETA: "SMETA",
  SA8000: "SA8000",
  OTHER: "其它",
};
export function certificationTypeLabel(type: string): string {
  return CERT_TYPE[type] ?? type;
}

const CERT_SOURCE: Record<string, string> = {
  SOCIAL: "社媒自述",
  WEBSITE: "厂家官网",
  BROCHURE: "画册 / 资料",
  USER_ENTRY: "人工登记",
  REGISTRY: "官方登记库",
};
export function certificationSourceKindLabel(kind: string): string {
  return CERT_SOURCE[kind] ?? kind;
}

/* ───────────────── 能力声明 ───────────────── */

const CAPABILITY: Record<string, string> = {
  FACTORY_FLOOR: "自有厂房",
  CNC_CAPABILITY: "CNC 加工",
  LASER_CUTTING: "激光切割",
  INJECTION_MOLDING: "注塑",
  POWDER_COATING: "喷粉",
  ASSEMBLY_LINE: "装配线",
  CUSTOM_TOOLING: "定制模具",
  OEM_SUPPORT: "OEM 代工",
  ODM_SUPPORT: "ODM 设计代工",
  EXPORT_PACKAGING: "出口包装",
  TESTING_CAPABILITY: "检测能力",
  WAREHOUSE: "仓储",
  HIGH_VOLUME_PRODUCTION: "大批量生产",
  SMALL_BATCH_PRODUCTION: "小批量生产",
  CUSTOM_PACKAGING: "定制包装",
  OVERSEAS_EXPORT: "海外出口经验",
  CANADA_EXPORT: "对加拿大出口经验",
  CERTIFICATION: "持有认证（声称）",
};
export function capabilityTypeLabel(type: string): string {
  return CAPABILITY[type] ?? type;
}

export function evidenceStatusDisplay(status: string): LabelWithTone {
  switch (status) {
    case "CLAIMED":
      return { label: "厂家声称", tone: "warning", hint: "来自厂家自述，未经核实。" };
    case "OBSERVED":
      return { label: "有人看到过", tone: "info", hint: "在线索内容中观察到（照片/视频/文字），仍非独立核验。" };
    case "VERIFIED":
      return { label: "已独立核验", tone: "success", hint: null };
    case "UNKNOWN":
      return { label: "不确定", tone: "neutral", hint: null };
    default:
      return { label: status, tone: "neutral", hint: null };
  }
}

export function extractedByLabel(v: string): string {
  return v === "HUMAN" ? "人工录入" : v === "AI_ASSISTED" ? "AI 辅助抽取" : v;
}

/* ───────────────── 可供产品 ───────────────── */

const OFFERING_SOURCE: Record<string, string> = {
  DISCOVERY: "系统发现",
  MANUAL: "人工登记",
  BROCHURE: "画册 / 资料",
  INQUIRY: "询价回复",
};
export function offeringSourceKindLabel(kind: string): string {
  return OFFERING_SOURCE[kind] ?? kind;
}

const PRICE_STATUS: Record<string, string> = {
  KNOWN: "已确认",
  ESTIMATED: "估算",
  UNKNOWN: "待确认",
};
export function priceStatusLabel(s: string): string {
  return PRICE_STATUS[s] ?? s;
}

/** 缺价合法：没有单价就是「价格待确认」，这不是资料不完整的错误 */
export function priceDisplay(o: {
  unitPrice: string | null;
  currency: string | null;
  priceStatus: string;
}): { text: string; pending: boolean } {
  if (o.unitPrice === null || o.priceStatus === "UNKNOWN") {
    return { text: "价格待确认", pending: true };
  }
  const cur = o.currency ? `${o.currency} ` : "";
  const suffix = o.priceStatus === "ESTIMATED" ? "（估算）" : "";
  return { text: `${cur}${o.unitPrice}${suffix}`, pending: false };
}

/* ───────────────── 内部候选来源 ───────────────── */

/** 与 CANDIDATE_ORIGIN_SOURCES 同口径；内部候选 = 历史 / 已存 / 企业记忆，永远不是「系统推荐」 */
const ORIGIN: Record<string, string> = {
  MEMORY: "企业记忆",
  HISTORICAL_SUCCESS: "历史合作",
  SAVED: "已存供应商",
  EXTERNAL_SEARCH: "外部搜索",
  NEW_DISCOVERY: "新发现",
};
export function originSourceLabel(origin: string): string {
  return ORIGIN[origin] ?? origin;
}

/* ───────────────── 资料状态（information completeness） ───────────────── */

/**
 * 只有六种**事实状态**，没有分数：
 *   RECORDED 已记录 / PARTIAL 部分 / PENDING 待确认 / MISSING 未记录 /
 *   CLAIMED 厂家声称 / VERIFIED 已核验
 */
export type CompletenessStatus = "RECORDED" | "PARTIAL" | "PENDING" | "MISSING" | "CLAIMED" | "VERIFIED";

export function completenessStatusDisplay(s: CompletenessStatus): { label: string; tone: Tone } {
  switch (s) {
    case "RECORDED":
      return { label: "已记录", tone: "success" };
    case "PARTIAL":
      return { label: "部分", tone: "info" };
    case "PENDING":
      return { label: "待确认", tone: "warning" };
    case "MISSING":
      return { label: "未记录", tone: "neutral" };
    case "CLAIMED":
      return { label: "厂家声称", tone: "warning" };
    case "VERIFIED":
      return { label: "已核验", tone: "success" };
  }
}

export interface CompletenessRow {
  key: string;
  label: string;
  status: CompletenessStatus;
  /** 一句话说明现状；没有就是 null */
  detail: string | null;
}

/** 计算所需的最小输入形状——刻意不依赖完整 payload，测试里可直接构造 */
export interface CompletenessInput {
  offerings: Array<{
    description: string | null;
    attributes: Record<string, string>;
    unitPrice: string | null;
    priceStatus: string;
    moq: number | null;
    leadTimeDays: number | null;
  }>;
  certifications: Array<{ status: string; expiredByDate: boolean }>;
  capabilities: Array<{ type: string }>;
  linkedSignals: Array<{ id: string }>;
}

function fraction(hit: number, total: number): CompletenessStatus {
  if (total === 0) return "MISSING";
  if (hit === total) return "RECORDED";
  if (hit === 0) return "PENDING";
  return "PARTIAL";
}

/**
 * 确定性的「还缺什么资料」。基于当前记录的事实，不做推断，不打分。
 * 这不是 S4 的 eligibility gate：没有任何一行会说「合格」或「不合格」。
 */
export function computeInformationCompleteness(v: CompletenessInput): CompletenessRow[] {
  const n = v.offerings.length;
  const rows: CompletenessRow[] = [];

  rows.push({
    key: "offering",
    label: "产品型号",
    status: n > 0 ? "RECORDED" : "MISSING",
    detail: n > 0 ? `已登记 ${n} 个可供产品` : "还没有登记任何具体产品；供应商 ≠ 产品",
  });

  const withSpec = v.offerings.filter(
    (o) => Object.keys(o.attributes).length > 0 || Boolean(o.description?.trim()),
  ).length;
  rows.push({
    key: "spec",
    label: "产品规格",
    status: n === 0 ? "MISSING" : fraction(withSpec, n),
    detail: n === 0 ? null : `${withSpec} / ${n} 个产品有规格或说明`,
  });

  const priced = v.offerings.filter((o) => o.unitPrice !== null && o.priceStatus !== "UNKNOWN").length;
  rows.push({
    key: "price",
    label: "价格",
    status: n === 0 ? "MISSING" : fraction(priced, n),
    detail:
      n === 0
        ? null
        : priced === n
          ? "全部产品有价格"
          : `${n - priced} 个产品价格待确认（缺价不是不合格，通常需要询价）`,
  });

  const withMoq = v.offerings.filter((o) => o.moq !== null).length;
  rows.push({
    key: "moq",
    label: "最小起订量（MOQ）",
    status: n === 0 ? "MISSING" : fraction(withMoq, n),
    detail: n === 0 ? null : `${withMoq} / ${n} 个产品已记录`,
  });

  const withLead = v.offerings.filter((o) => o.leadTimeDays !== null).length;
  rows.push({
    key: "leadTime",
    label: "交期",
    status: n === 0 ? "MISSING" : fraction(withLead, n),
    detail: n === 0 ? null : `${withLead} / ${n} 个产品已记录`,
  });

  const certs = v.certifications;
  const verifiedLive = certs.filter((c) => c.status === "VERIFIED" && !c.expiredByDate).length;
  const verifiedExpired = certs.filter((c) => c.status === "VERIFIED" && c.expiredByDate).length;
  const claimed = certs.filter((c) => c.status === "CLAIMED").length;
  rows.push({
    key: "cert",
    label: "认证",
    status: certs.length === 0 ? "MISSING" : verifiedLive > 0 ? "VERIFIED" : claimed > 0 ? "CLAIMED" : "PENDING",
    detail:
      certs.length === 0
        ? "未登记任何认证"
        : `厂家声称 ${claimed} 项，已核验 ${verifiedLive} 项${verifiedExpired ? `，另有 ${verifiedExpired} 项核验过但按日期已过期` : ""}`,
  });
  rows.push({
    key: "certVerify",
    label: "认证核验",
    status: certs.length === 0 ? "MISSING" : claimed === 0 ? "RECORDED" : "PENDING",
    detail:
      certs.length === 0
        ? null
        : claimed === 0
          ? "没有待核验的认证"
          : `${claimed} 项认证还没有独立核验依据`,
  });

  rows.push({
    key: "source",
    label: "来源线索",
    status: v.linkedSignals.length > 0 ? "RECORDED" : "MISSING",
    detail:
      v.linkedSignals.length > 0
        ? `已关联 ${v.linkedSignals.length} 条线索`
        : "没有任何已关联的线索——能力声明需要出处",
  });

  rows.push({
    key: "capability",
    label: "能力声明（如安装、定制、出口经验）",
    status: v.capabilities.length > 0 ? "RECORDED" : "MISSING",
    detail:
      v.capabilities.length > 0
        ? `已记录 ${v.capabilities.length} 条，均可回溯到线索原文`
        : "未记录；请从已关联的线索原文中录入",
  });

  return rows;
}
