/**
 * W-2 组织页「询价与落地价设置」的表单规则（纯函数）
 *
 * - 读：GET /api/organizations/[orgId]/tender-rfq-settings 的返回 → 表单（全是字符串，便于输入框）。
 * - 存：只把人改过的项放进 PUT 请求（D1）：GET 给的发件地址是解析后的值（可能来自环境变量），整张发会把它写死。
 *   改成空 = null（清空）；汇率表改过就整张发（PUT 对 fxRates 整体覆盖）。
 * - 校验与接口一致（landed-cost.ts 的 tenderRfqSettingsPutSchema / applyTenderRfqSettingsUpdate），页面先拦一次，接口仍是最终把关。
 */

import { z } from "zod";
import type { CostEstimate, LandedCostSettings, FxRateSource } from "./landed-cost";

export type EstimateMode = CostEstimate["mode"];

/** GET 的返回（发件三项是解析后的值；stored 说明哪几项是组织自己存的，旧接口没有这一项时当作都存了） */
export type TenderRfqSettingsView = {
  fromName: string;
  fromEmail: string;
  mailboxEmail: string;
  stored?: { fromName: boolean; fromEmail: boolean; mailboxEmail: boolean };
  landedCost: LandedCostSettings;
};

export type FxRow = { currency: string; rate: string };
export type EstimateForm = { mode: "" | EstimateMode; value: string };
export type ProjectRow = { projectId: string; dutyRatePct: string; deliveryDeadline: string };

export type TenderRfqSettingsForm = {
  /** 组织自己存的值；没存时为空，输入框里用占位文字显示当前回退到的值（effective） */
  fromName: string;
  fromEmail: string;
  mailboxEmail: string;
  /** 当前实际生效的值（含回退），只读 */
  effective: { fromName: string; fromEmail: string; mailboxEmail: string };
  fxRows: FxRow[];
  fxAsOf: string;
  fxSource: "" | FxRateSource;
  freight: EstimateForm;
  inland: EstimateForm;
  insurancePct: string;
  clearanceFlatCad: string;
  projects: ProjectRow[];
};

export const ESTIMATE_MODE_LABELS: Record<EstimateMode, string> = {
  per_unit: "按件（CAD / 件）",
  per_shipment: "按票（CAD / 票）",
  pct_of_goods: "按货值百分比（%）",
};

export const FX_SOURCE_LABELS: Record<FxRateSource, string> = {
  MANUAL: "手工",
  BANK_SETTLEMENT: "银行结算",
};

export const FX_NEEDS_DATE_AND_SOURCE_ZH = "填写汇率时必须同时给出日期和来源";

const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));
const estForm = (e: CostEstimate | null | undefined): EstimateForm => (e ? { mode: e.mode, value: String(e.value) } : { mode: "", value: "" });

export function formFromView(v: TenderRfqSettingsView): TenderRfqSettingsForm {
  const lc = v.landedCost;
  const stored = v.stored ?? { fromName: true, fromEmail: true, mailboxEmail: true };
  return {
    fromName: stored.fromName ? v.fromName ?? "" : "",
    fromEmail: stored.fromEmail ? v.fromEmail ?? "" : "",
    mailboxEmail: stored.mailboxEmail ? v.mailboxEmail ?? "" : "",
    effective: { fromName: v.fromName ?? "", fromEmail: v.fromEmail ?? "", mailboxEmail: v.mailboxEmail ?? "" },
    fxRows: Object.entries(lc.fxRates ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, rate]) => ({ currency, rate: String(rate) })),
    fxAsOf: lc.fxAsOf ?? "",
    fxSource: lc.fxSource ?? "",
    freight: estForm(lc.freightEstimate),
    inland: estForm(lc.exportInlandEstimate),
    insurancePct: numStr(lc.insurancePct),
    clearanceFlatCad: numStr(lc.clearanceFlatCad),
    projects: Object.entries(lc.projects ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([projectId, o]) => ({ projectId, dutyRatePct: numStr(o.dutyRatePct), deliveryDeadline: o.deliveryDeadline ?? "" })),
  };
}

/* ---------------------------------- 存 ---------------------------------- */

export type TenderRfqSettingsBody = {
  fromName?: string | null;
  fromEmail?: string | null;
  mailboxEmail?: string | null;
  landedCost?: {
    fxRates?: Record<string, number>;
    fxAsOf?: string | null;
    fxSource?: FxRateSource | null;
    freightEstimate?: CostEstimate | null;
    exportInlandEstimate?: CostEstimate | null;
    insurancePct?: number | null;
    clearanceFlatCad?: number | null;
    projects?: Record<string, { dutyRatePct: number | null; deliveryDeadline: string | null } | null>;
  };
};

export type BodyResult = { ok: true; body: TenderRfqSettingsBody; empty: boolean } | { ok: false; errors: string[] };

/** 与接口同一条规则（tenderRfqSettingsPutSchema 用的是 zod 的 email） */
const emailSchema = z.string().trim().email().max(200);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseNum(s: string): number | null | "bad" {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "bad";
}

const blankRow = (r: FxRow) => r.currency.trim() === "" && r.rate.trim() === "";

/** 汇率表规范化成可比较的形式（去掉整行空白；币种去空格）；不校验 */
function fxCanon(rows: FxRow[]): string {
  return JSON.stringify(
    rows
      .filter((r) => !blankRow(r))
      .map((r) => [r.currency.trim(), r.rate.trim() === "" ? "" : String(Number(r.rate.trim()))])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

function estimateOf(e: EstimateForm, label: string, errors: string[]): CostEstimate | null | undefined {
  if (e.mode === "") return null;
  const n = parseNum(e.value);
  if (n === null || n === "bad" || n < 0) {
    errors.push(`${label}：请填一个不小于 0 的数字（或把方式选为「不填」）`);
    return undefined;
  }
  return { mode: e.mode, value: n };
}

const sameEstimate = (a: EstimateForm, b: EstimateForm) =>
  a.mode === b.mode && (a.mode === "" || parseNum(a.value) === parseNum(b.value));

export function bodyFromForm(form: TenderRfqSettingsForm, initial: TenderRfqSettingsForm): BodyResult {
  const errors: string[] = [];
  const body: TenderRfqSettingsBody = {};

  // 发件设置
  const strField = (key: "fromName" | "fromEmail" | "mailboxEmail", label: string, isEmail: boolean, max: number) => {
    const v = form[key].trim();
    if (v === initial[key].trim()) return;
    if (v === "") {
      body[key] = null;
      return;
    }
    if (v.length > max) errors.push(`${label}：太长（最多 ${max} 个字符）`);
    else if (isEmail && !emailSchema.safeParse(v).success) errors.push(`${label}：不是有效的邮箱地址`);
    else body[key] = isEmail ? v.toLowerCase() : v;
  };
  strField("fromName", "发件显示名", false, 120);
  strField("fromEmail", "显示地址", true, 200);
  strField("mailboxEmail", "授权邮箱", true, 200);
  // 授权邮箱没单独存时，它跟着显示地址回退；只改显示地址会把发信账号也带着改掉（独立审查 M1）。
  // 这时把授权邮箱固定为改之前实际生效的那个，发信账号保持不变。
  if (
    body.fromEmail !== undefined &&
    form.mailboxEmail.trim() === initial.mailboxEmail.trim() &&
    initial.mailboxEmail.trim() === "" &&
    initial.effective.mailboxEmail.trim() !== ""
  ) {
    body.mailboxEmail = initial.effective.mailboxEmail.trim().toLowerCase();
  }

  const lc: NonNullable<TenderRfqSettingsBody["landedCost"]> = {};

  // 汇率表（改过就整张发）
  const fxChanged = fxCanon(form.fxRows) !== fxCanon(initial.fxRows);
  const finalRates: Record<string, number> = {};
  const seen = new Set<string>();
  form.fxRows.forEach((r, i) => {
    if (blankRow(r)) return;
    const cur = r.currency.trim();
    const n = parseNum(r.rate);
    const where = `汇率第 ${i + 1} 行`;
    if (!/^[A-Z]{3}$/.test(cur)) errors.push(`${where}：币种用三位大写代码（如 USD、CNY）`);
    else if (cur === "CAD") errors.push(`${where}：CAD 不用填（本身就是 CAD）`);
    else if (seen.has(cur)) errors.push(`${where}：${cur} 重复了`);
    else if (n === null || n === "bad" || n <= 0) errors.push(`${where}：汇率要大于 0`);
    else {
      seen.add(cur);
      finalRates[cur] = n;
    }
  });
  const asOf = form.fxAsOf.trim();
  if (asOf !== "" && !YMD_RE.test(asOf)) errors.push("汇率日期：格式 YYYY-MM-DD");
  const asOfValue = asOf === "" ? null : asOf;
  const sourceValue = form.fxSource === "" ? null : form.fxSource;
  if (fxChanged) {
    // 汇率、日期、来源是一个整体：改了汇率就三项一起发，免得两个人同时改时，一个人的汇率挂上另一个人的日期与来源（独立审查 M3）
    lc.fxRates = finalRates;
    lc.fxAsOf = asOfValue;
    lc.fxSource = sourceValue;
  } else {
    if (asOf !== initial.fxAsOf.trim()) lc.fxAsOf = asOfValue;
    if (form.fxSource !== initial.fxSource) lc.fxSource = sourceValue;
  }
  const ratesAfter = fxChanged ? Object.keys(finalRates).length : initial.fxRows.filter((r) => !blankRow(r)).length;

  // 估算参数
  if (!sameEstimate(form.freight, initial.freight)) {
    const e = estimateOf(form.freight, "国际运费", errors);
    if (e !== undefined) lc.freightEstimate = e;
  }
  if (!sameEstimate(form.inland, initial.inland)) {
    const e = estimateOf(form.inland, "出口内陆运费", errors);
    if (e !== undefined) lc.exportInlandEstimate = e;
  }
  const numField = (key: "insurancePct" | "clearanceFlatCad", label: string, max: number | null) => {
    const a = parseNum(form[key]);
    const b = parseNum(initial[key]);
    if (a === b) return;
    if (a === "bad" || (a != null && (a < 0 || (max != null && a > max)))) {
      errors.push(`${label}：请填 0${max != null ? `–${max}` : " 以上"} 的数字（或留空）`);
      return;
    }
    lc[key] = a;
  };
  numField("insurancePct", "保险费率", 100);
  numField("clearanceFlatCad", "进口清关杂费", null);

  // 项目关税率与交付截止
  const initialById = new Map(initial.projects.map((p) => [p.projectId, p]));
  const projects: NonNullable<NonNullable<TenderRfqSettingsBody["landedCost"]>["projects"]> = {};
  const formIds = new Set<string>();
  form.projects.forEach((p, i) => {
    const id = p.projectId.trim();
    const where = `项目设置第 ${i + 1} 行`;
    if (!id) {
      errors.push(`${where}：请选择项目`);
      return;
    }
    if (formIds.has(id)) {
      errors.push(`${where}：这个项目重复了`);
      return;
    }
    formIds.add(id);
    const duty = parseNum(p.dutyRatePct);
    const dl = p.deliveryDeadline.trim();
    if (duty === "bad" || (duty != null && (duty < 0 || duty > 100))) {
      errors.push(`${where}：关税率请填 0–100 的数字（或留空）`);
      return;
    }
    if (dl !== "" && !YMD_RE.test(dl)) {
      errors.push(`${where}：交付截止格式 YYYY-MM-DD`);
      return;
    }
    const before = initialById.get(id);
    if (!before && duty === null && dl === "") {
      errors.push(`${where}：请填关税率或交付截止（或删掉这一行）`);
      return;
    }
    const same = before && parseNum(before.dutyRatePct) === duty && before.deliveryDeadline.trim() === dl;
    if (!same) projects[id] = { dutyRatePct: duty, deliveryDeadline: dl === "" ? null : dl };
  });
  for (const id of initialById.keys()) if (!formIds.has(id)) projects[id] = null;
  if (Object.keys(projects).length > 0) lc.projects = projects;

  // 与接口相同：只有这次要写落地价参数时才查——最终有汇率就必须有日期与来源
  if (Object.keys(lc).length > 0 && ratesAfter > 0 && (asOf === "" || form.fxSource === "")) errors.push(FX_NEEDS_DATE_AND_SOURCE_ZH);
  if (Object.keys(lc).length > 0) body.landedCost = lc;
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, body, empty: Object.keys(body).length === 0 };
}

export const SETTINGS_PURPOSE_ZH =
  "这些是组织的估算参数，用于比价矩阵里的落地价（CAD）和报价表助手的成本建议；落地价会逐项标明用了哪一条参数。只有组织管理员能看、能改，每次保存都记审计。";
export const MAILBOX_NOTE_ZH =
  "显示地址是供应商看到的发件人；授权邮箱是实际授权发信、读回信的那个邮箱账号（可以不同，例如在授权账号里把显示地址设为「以此地址发送」）。发信只按这里的授权邮箱找授权。";

export const PIN_MAILBOX_NOTE_ZH = "授权邮箱没有单独设置时会跟着显示地址走；只改显示地址时，页面会把授权邮箱固定为现在实际用的那个，发信账号不变。";

/* ---------------------------------- 行操作（组件只调这些） ---------------------------------- */

export const emptyFxRow = (): FxRow => ({ currency: "", rate: "" });
export const emptyProjectRow = (): ProjectRow => ({ projectId: "", dutyRatePct: "", deliveryDeadline: "" });

export function updateFxRow(form: TenderRfqSettingsForm, index: number, patch: Partial<FxRow>): TenderRfqSettingsForm {
  const p = patch.currency !== undefined ? { ...patch, currency: patch.currency.toUpperCase() } : patch;
  return { ...form, fxRows: form.fxRows.map((r, i) => (i === index ? { ...r, ...p } : r)) };
}
export function removeFxRow(form: TenderRfqSettingsForm, index: number): TenderRfqSettingsForm {
  return { ...form, fxRows: form.fxRows.filter((_, i) => i !== index) };
}
export function updateProjectRow(form: TenderRfqSettingsForm, index: number, patch: Partial<ProjectRow>): TenderRfqSettingsForm {
  return { ...form, projects: form.projects.map((r, i) => (i === index ? { ...r, ...patch } : r)) };
}
export function removeProjectRow(form: TenderRfqSettingsForm, index: number): TenderRfqSettingsForm {
  return { ...form, projects: form.projects.filter((_, i) => i !== index) };
}
