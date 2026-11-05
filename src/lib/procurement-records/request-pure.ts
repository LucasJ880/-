/**
 * PROC-1 申请卡正文与范围（纯函数，design D7）。
 *
 * 联邦 ATI 正文按任务书第七节模板生成：方括号只由已核实数据替换，缺数据时保留方括号（READY 闸拦截）；
 * 按记录类别取舍条目。省市申请不套联邦模板。text hash 与 scope fingerprint 分开：
 * - text hash：正文规范换行后 sha256（措辞变化即变化）；
 * - scope fingerprint：申请主体 + 辖区 + 机关 + 编号集 + 类别集 + 起止日（与渠道 / 标题 / 措辞无关）。
 */

import { createHash } from "node:crypto";
import { normalizeInstrumentNumber } from "./identity";
import { PATH_TYPE_LABELS, RECORD_CATEGORIES, RECORD_CATEGORY_LABELS, type PathType, type RecordCategory } from "./labels";

export { PATH_TYPES, PATH_TYPE_LABELS, RECORD_CATEGORIES, RECORD_CATEGORY_LABELS, UNKNOWN_CATEGORY } from "./labels";
export type { PathType, RecordCategory } from "./labels";


const CATEGORY_TEMPLATE_ITEMS: Record<RecordCategory, string> = {
  CONTRACT_DOCS: "The final issued contract or Standing Offer, its applicable annexes, amendments and exercised renewal or extension options.",
  CALL_UPS_USAGE:
    "Existing call-up, purchase order or usage records showing, where recorded, item description, quantity, unit of measure, unit price, order date, delivery destination, order value and cumulative value.",
  USAGE_REPORTS: "Existing annual or quarterly usage reports for the specified instrument and period.",
  FINANCIALS:
    "Records showing separately the amounts committed, ordered, invoiced and paid, together with recorded cancellations, returns, credits or refunds relevant to those amounts.",
  PRICE_SCHEDULE: "The applicable final Basis of Payment or price schedule, to the extent releasable.",
};

export function isRecordCategory(v: unknown): v is RecordCategory {
  return typeof v === "string" && (RECORD_CATEGORIES as readonly string[]).includes(v);
}


export const CHANNELS = ["FORMAL", "INFORMAL"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface FederalBodyInput {
  institution: string | null;
  projectTitle: string | null;
  solicitationNumbers: string[];
  contractNumbers: string[];
  startDate: string | null;
  endDate: string | null;
  categories: RecordCategory[];
}

function joinNumbers(list: string[]): string {
  const uniq = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length <= 1) return uniq[0] ?? "";
  return `${uniq.slice(0, -1).join(", ")} and ${uniq[uniq.length - 1]}`;
}

/** 联邦 ATI 正文（任务书第七节模板） */
export function buildFederalAtiBody(input: FederalBodyInput): string {
  const institution = input.institution?.trim() || "[INSTITUTION]";
  const title = input.projectTitle?.trim() || "[PROJECT TITLE]";
  const contracts = joinNumbers(input.contractNumbers) || "[STANDING OFFER / CONTRACT NUMBER]";
  const sol = joinNumbers(input.solicitationNumbers);
  const start = input.startDate || "[START DATE]";
  const end = input.endDate || "[END DATE]";
  const subject = sol ? `${title}, ${sol}, and ${contracts}` : `${title} and ${contracts}`;
  const cats = RECORD_CATEGORIES.filter((c) => input.categories.includes(c));
  const items = (cats.length ? cats : []).map((c, i) => `${i + 1}. ${CATEGORY_TEMPLATE_ITEMS[c]}`);
  return [
    `Pursuant to the Access to Information Act, please provide electronic copies of existing records under the control of ${institution} relating to ${subject}, for the period ${start} to ${end}.`,
    "",
    "Please provide:",
    ...(items.length ? items : ["[RECORD CATEGORIES]"]),
    "",
    "Please provide existing electronic records or ordinary system exports in a reusable format such as CSV or XLSX where available; otherwise, electronic copies in their existing format are acceptable. Please preserve the distinction between contract limits, orders, invoices and payments. I am requesting existing records and not a new forecast or commercial analysis.",
    "",
    "If some requested records are held by another institution, please advise which institution should be contacted or whether a transfer is appropriate. If exemptions apply, please release reasonably severable portions and identify the applicable provisions.",
  ].join("\n");
}

/** 索取已完成 ATI 的既有披露副本（非正式请求；不套用正式申请时限） */
export function buildCompletedAtiCopyBody(input: { institution: string | null; requestNumbers: string[] }): string {
  const institution = input.institution?.trim() || "[INSTITUTION]";
  const nums = joinNumbers(input.requestNumbers) || "[COMPLETED REQUEST NUMBER]";
  return [
    `I would like to request a copy of the records already released by ${institution} under completed access to information request ${nums}, as listed in the Government of Canada's Completed Access to Information Requests summaries.`,
    "",
    "Electronic copies in their existing released format are acceptable. I understand this is an informal request for previously released records.",
  ].join("\n");
}

export interface ExplanationInput {
  pathType: PathType;
  jurisdiction: string;
  institutionDisplay: string | null;
  recordsHolderBasis: string | null;
  instrumentLabels: string[];
  startDate: string | null;
  endDate: string | null;
  categories: string[];
  lawLabel: string | null;
  feeCents: number | null;
  currency: string | null;
  deadlineValue: number | null;
  deadlineUnit: string | null;
  purposeZh: string | null;
  gapsZh: string | null;
}

/** 中文说明（与英文正文同源；不承诺取得时间） */
export function buildExplanationZh(e: ExplanationInput): string {
  const fee =
    e.feeCents === null ? "费用未知（待核实，不按 0 处理）" : `${(e.feeCents / 100).toFixed(2)} ${e.currency ?? ""}`.trim();
  const deadline =
    e.pathType === "COMPLETED_ATI_COPY"
      ? "非正式副本请求不适用正式申请的法定答复时限。"
      : e.deadlineValue
        ? `正常法定答复期 ${e.deadlineValue} 个${e.deadlineUnit === "BUSINESS_DAYS" ? "工作日" : "日历日"}，机关可依法延期；不承诺何时取得。`
        : "答复时限未核实。";
  const cats = e.categories.map((c) => RECORD_CATEGORY_LABELS[c as RecordCategory] ?? c).join("；");
  return [
    `【用途】${e.purposeZh?.trim() || "为下一次投标准备，查清前序合同的实际订单、数量、单价与支出口径。"}`,
    `【还缺什么】${e.gapsZh?.trim() || "（待填写）"}`,
    `【取得路径】${PATH_TYPE_LABELS[e.pathType]}`,
    `【接收机关】${e.institutionDisplay ?? "（未填写）"}；持有依据：${e.recordsHolderBasis?.trim() || "（未填写——须按所需记录核实，不默认 PSPC）"}`,
    `【法律 / 辖区】${e.lawLabel ?? "（未核实）"}（${e.jurisdiction}）`,
    `【范围】${e.instrumentLabels.join("、") || "（未关联合同）"}；${e.startDate ?? "[起]"} 至 ${e.endDate ?? "[止]"}（含首尾日）`,
    `【记录类别】${cats || "（未选择）"}`,
    `【费用】${fee}`,
    `【时限】${deadline}`,
  ].join("\n");
}

const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 /_-]*\]/g;

export function findPlaceholders(body: string): string[] {
  return [...new Set(body.match(PLACEHOLDER_RE) ?? [])];
}

export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

export function textHash(body: string): string {
  return createHash("sha256").update(normalizeBody(body), "utf8").digest("hex");
}

export interface ScopeInput {
  applicantKey: string | null;
  jurisdiction: string;
  institutionKey: string | null;
  numbers: string[];
  categories: string[];
  startDate: string | null;
  endDate: string | null;
}

export function normalizeNumbers(numbers: string[]): string[] {
  return [...new Set(numbers.map((n) => normalizeInstrumentNumber(n).normalized).filter(Boolean))].sort();
}

/** 语义范围指纹：与渠道、标题、英文措辞无关 */
export function scopeFingerprint(s: ScopeInput): string {
  const canon = {
    a: s.applicantKey ?? null,
    j: s.jurisdiction,
    i: s.institutionKey ?? null,
    n: normalizeNumbers(s.numbers),
    c: [...new Set(s.categories)].sort(),
    s: s.startDate,
    e: s.endDate,
  };
  return createHash("sha256").update(JSON.stringify(canon), "utf8").digest("hex");
}

/** 日期字符串校验（YYYY-MM-DD 且是真实日期） */
export function isValidIsoDate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
