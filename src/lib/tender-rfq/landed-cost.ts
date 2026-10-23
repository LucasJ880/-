/**
 * Tender RFQ（P1-5）— 报价归一化：币种 → CAD、贸易条款 → 落地价（货到目的地、含关税、不含我方利润）
 *
 * 纪律（任务书 P1-5/6 §2、§5）：
 *   - 纯函数、零 IO、零 AI；
 *   - 每个换算步骤写一条 assumption（用了什么汇率、什么运费估算）；
 *   - 缺任何参数 → 该项 null + blocker（列出缺什么），绝不用"默认汇率"或"经验运费"顶上；
 *   - 汇率是组织维护的表 + 日期 + 来源（与 project-finance fxRateSource 同纪律：来源必须显式）。
 *
 * 组织设置（零 schema）：Organization.settingsJson.tenderRfq.landedCost
 */

import { z } from "zod";

/* ---------------------------------- 设置 ---------------------------------- */

export type CostEstimate = { mode: "per_unit" | "per_shipment" | "pct_of_goods"; value: number };
export type FxRateSource = "MANUAL" | "BANK_SETTLEMENT";

export type ProjectLandedCostOverrides = {
  /** 关税率 %（人工填；缺 = 需要关税的条款无法换算） */
  dutyRatePct: number | null;
  /** 交付截止 YYYY-MM-DD（缺 → 按截标日 +30 天，并写 assumption） */
  deliveryDeadline: string | null;
};

export type LandedCostSettings = {
  /** 1 单位外币 = x CAD */
  fxRates: Record<string, number>;
  fxAsOf: string | null;
  fxSource: FxRateSource | null;
  /** 国际运费估算（FOB/FCA/EXW 需要） */
  freightEstimate: CostEstimate | null;
  /** 出口国内陆运费估算（仅 EXW 需要） */
  exportInlandEstimate: CostEstimate | null;
  /** 保险费率 %，按（货值 + 内陆 + 运费）计 */
  insurancePct: number | null;
  /** 进口清关杂费（每票，CAD） */
  clearanceFlatCad: number | null;
  /** 项目级覆盖，key = projectId */
  projects: Record<string, ProjectLandedCostOverrides>;
};

export const FX_STALE_DAYS = 30;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const ymd = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function readEstimate(v: unknown): CostEstimate | null {
  const o = v as { mode?: unknown; value?: unknown } | null;
  if (!o || typeof o !== "object") return null;
  const mode = o.mode === "per_unit" || o.mode === "per_shipment" || o.mode === "pct_of_goods" ? o.mode : null;
  const value = num(o.value);
  return mode && value != null ? { mode, value } : null;
}

/** 读组织设置；任何字段不合法都当作"没填"（null），由 normalizeQuote 产生 blocker，而不是猜一个值 */
export function readLandedCostSettings(settingsJson: unknown): LandedCostSettings {
  const tr = (settingsJson as { tenderRfq?: { landedCost?: unknown } } | null)?.tenderRfq;
  const lc = (tr?.landedCost ?? {}) as Record<string, unknown>;
  const fxRates: Record<string, number> = {};
  if (lc.fxRates && typeof lc.fxRates === "object") {
    for (const [k, v] of Object.entries(lc.fxRates as Record<string, unknown>)) {
      const n = num(v);
      if (/^[A-Z]{3}$/.test(k) && n != null && n > 0) fxRates[k] = n;
    }
  }
  const projects: Record<string, ProjectLandedCostOverrides> = {};
  if (lc.projects && typeof lc.projects === "object") {
    for (const [pid, v] of Object.entries(lc.projects as Record<string, unknown>)) {
      const o = (v ?? {}) as Record<string, unknown>;
      projects[pid] = { dutyRatePct: num(o.dutyRatePct), deliveryDeadline: ymd(o.deliveryDeadline) };
    }
  }
  return {
    fxRates,
    fxAsOf: ymd(lc.fxAsOf),
    fxSource: lc.fxSource === "MANUAL" || lc.fxSource === "BANK_SETTLEMENT" ? lc.fxSource : null,
    freightEstimate: readEstimate(lc.freightEstimate),
    exportInlandEstimate: readEstimate(lc.exportInlandEstimate),
    insurancePct: num(lc.insurancePct),
    clearanceFlatCad: num(lc.clearanceFlatCad),
    projects,
  };
}

export function projectOverrides(settings: LandedCostSettings, projectId: string): ProjectLandedCostOverrides {
  return settings.projects[projectId] ?? { dutyRatePct: null, deliveryDeadline: null };
}

/* ---------------------------------- 贸易条款 ---------------------------------- */

type Step = "inland" | "freight" | "insurance" | "duty" | "clearance";

/**
 * 报价条款 → 到目的地（DDP 等价）还需加哪些项。
 * 关税基数：EXW/FCA/FOB 按货值（+EXW 内陆）——与加拿大 value for duty 口径一致（不含国际运保）；
 * CIF/CIP/DAP 价已含运保、无法拆出，按报价本身计，偏保守，assumption 里注明。
 */
export const INCOTERM_STEPS: Record<string, readonly Step[]> = {
  EXW: ["inland", "freight", "insurance", "duty", "clearance"],
  FCA: ["freight", "insurance", "duty", "clearance"],
  FOB: ["freight", "insurance", "duty", "clearance"],
  CIF: ["duty", "clearance"],
  CIP: ["duty", "clearance"],
  DAP: ["duty", "clearance"],
  DDP: [],
};

/* ---------------------------------- 归一化 ---------------------------------- */

export type QuoteForNormalize = {
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
  incoterm: string | null;
};

export type NormalizeContext = {
  settings: LandedCostSettings;
  dutyRatePct: number | null;
  /** 询价第一档数量 */
  quantity: number | null;
  now: Date;
};

export type NormalizedQuote = {
  /** 报价折成 CAD（未加任何费用） */
  goodsCad: { unit: number | null; total: number | null };
  landedCad: { unit: number | null; total: number | null };
  assumptions: string[];
  warnings: string[];
  blockers: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const DAY = 86_400_000;

function fxLabel(s: FxRateSource): string {
  return s === "MANUAL" ? "手工" : "银行结算";
}

export function daysBetween(fromYmd: string, to: Date): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((t - from) / DAY);
}

function estimateAmount(
  label: string,
  est: CostEstimate,
  goodsTotal: number,
  qty: number | null,
): { amount: number; assumption: string } | { missing: string } {
  if (est.mode === "per_unit") {
    if (qty == null) return { missing: `${label}按件估算需要询价数量` };
    const amount = est.value * qty;
    return { amount, assumption: `${label} ${fmt(est.value)} CAD/件 × ${qty} = ${fmt(amount)} CAD（组织估算参数）` };
  }
  if (est.mode === "per_shipment") {
    return { amount: est.value, assumption: `${label} ${fmt(est.value)} CAD/票（组织估算参数）` };
  }
  const amount = (goodsTotal * est.value) / 100;
  return { amount, assumption: `${label} 货值 × ${est.value}% = ${fmt(amount)} CAD（组织估算参数）` };
}

export function normalizeQuote(item: QuoteForNormalize, ctx: NormalizeContext): NormalizedQuote {
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const out = (goods: NormalizedQuote["goodsCad"], landed: NormalizedQuote["landedCad"]): NormalizedQuote => ({
    goodsCad: { unit: goods.unit == null ? null : round2(goods.unit), total: goods.total == null ? null : round2(goods.total) },
    landedCad: { unit: landed.unit == null ? null : round2(landed.unit), total: landed.total == null ? null : round2(landed.total) },
    assumptions,
    warnings,
    blockers,
  });
  const none = { unit: null, total: null };
  const qty = ctx.quantity != null && ctx.quantity > 0 ? ctx.quantity : null;

  if (item.unitPrice == null && item.totalPrice == null) {
    blockers.push("没有报价金额");
    return out(none, none);
  }

  // ── 币种 → CAD ──
  const cur = (item.currency ?? "").trim().toUpperCase();
  let rate: number | null = null;
  if (!cur) {
    blockers.push("币种未注明");
  } else if (cur === "CAD") {
    rate = 1;
  } else {
    const r = ctx.settings.fxRates[cur];
    if (r == null) {
      blockers.push(`缺 ${cur}→CAD 汇率，请在组织设置填写`);
    } else if (!ctx.settings.fxAsOf || !ctx.settings.fxSource) {
      blockers.push(`${cur}→CAD 汇率未注明${!ctx.settings.fxAsOf ? "日期" : ""}${!ctx.settings.fxAsOf && !ctx.settings.fxSource ? "和" : ""}${!ctx.settings.fxSource ? "来源" : ""}，请在组织设置补全`);
    } else {
      rate = r;
      assumptions.push(`汇率 ${cur}→CAD ${r}（${ctx.settings.fxAsOf}，${fxLabel(ctx.settings.fxSource)}）`);
      const age = daysBetween(ctx.settings.fxAsOf, ctx.now);
      if (age > FX_STALE_DAYS) warnings.push(`汇率已 ${age} 天未更新（${ctx.settings.fxAsOf}）`);
    }
  }
  if (rate == null) return out(none, none);

  const goodsUnit = item.unitPrice != null ? item.unitPrice * rate : item.totalPrice != null && qty ? (item.totalPrice / qty) * rate : null;
  const goodsTotal = item.totalPrice != null ? item.totalPrice * rate : item.unitPrice != null && qty ? item.unitPrice * qty * rate : null;
  const goods = { unit: goodsUnit, total: goodsTotal };

  // ── 贸易条款 → 落地价 ──
  const term = (item.incoterm ?? "").trim().toUpperCase();
  if (!term) {
    blockers.push("贸易条款未注明");
    return out(goods, none);
  }
  const steps = INCOTERM_STEPS[term];
  if (!steps) {
    blockers.push(`贸易条款 ${term} 暂不支持换算`);
    return out(goods, none);
  }
  if (steps.length === 0) return out(goods, goods); // DDP：不加任何项

  if (goodsTotal == null) {
    blockers.push("缺询价数量，无法由单价算出货值总额");
    return out(goods, none);
  }

  const s = ctx.settings;
  const missing: string[] = [];
  let inland = 0;
  let freight = 0;
  const adds: number[] = [];

  if (steps.includes("inland")) {
    if (!s.exportInlandEstimate) missing.push("出口国内陆运费估算参数");
    else {
      const r = estimateAmount("出口内陆运费", s.exportInlandEstimate, goodsTotal, qty);
      if ("missing" in r) missing.push(r.missing);
      else {
        inland = r.amount;
        adds.push(r.amount);
        assumptions.push(r.assumption);
      }
    }
  }
  if (steps.includes("freight")) {
    if (!s.freightEstimate) missing.push("国际运费估算参数");
    else {
      const r = estimateAmount("国际运费", s.freightEstimate, goodsTotal, qty);
      if ("missing" in r) missing.push(r.missing);
      else {
        freight = r.amount;
        adds.push(r.amount);
        assumptions.push(r.assumption);
      }
    }
  }
  if (steps.includes("insurance")) {
    if (s.insurancePct == null) missing.push("保险费率");
    else {
      const base = goodsTotal + inland + freight;
      const amount = (base * s.insurancePct) / 100;
      adds.push(amount);
      assumptions.push(`保险 ${s.insurancePct}% ×（货值${inland ? " + 内陆" : ""} + 运费 ${fmt(base)}）= ${fmt(amount)} CAD`);
    }
  }
  if (steps.includes("duty")) {
    if (ctx.dutyRatePct == null) missing.push("关税率（项目级 dutyRatePct）");
    else {
      const base = goodsTotal + inland;
      const amount = (base * ctx.dutyRatePct) / 100;
      adds.push(amount);
      const basis = term === "CIF" || term === "CIP" || term === "DAP" ? `${term} 价（含运保，偏保守）` : inland ? "货值 + 内陆" : "货值";
      assumptions.push(`关税 ${ctx.dutyRatePct}% × ${basis} ${fmt(base)} = ${fmt(amount)} CAD`);
    }
  }
  if (steps.includes("clearance")) {
    if (s.clearanceFlatCad == null) missing.push("清关杂费");
    else {
      adds.push(s.clearanceFlatCad);
      assumptions.push(`进口清关 ${fmt(s.clearanceFlatCad)} CAD/票（组织估算参数）`);
    }
  }

  if (missing.length) {
    blockers.push(`${term} 换算缺：${missing.join("、")}`);
    return out(goods, none);
  }
  const landedTotal = goodsTotal + adds.reduce((a, b) => a + b, 0);
  return out(goods, { unit: qty ? landedTotal / qty : null, total: landedTotal });
}

/* ---------------------------------- 合规判断（§2.4） ---------------------------------- */

export type CheckValue = true | false | "unknown" | "partial";

export type QuoteChecks = {
  deliveryOk: CheckValue;
  validityOk: CheckValue;
  moqOk: CheckValue;
  mandatoryOk: CheckValue;
};

export type ChecksInput = {
  /** 回信日期（InquiryItem.repliedAt） */
  emailDate: Date | null;
  deliveryDays: number | null;
  validUntil: Date | string | null;
  moq: number | null;
  mandatoryAnswers: Array<{ requirementCode: string; answer: string }>;
};

export type TenderTimeline = {
  closeDate: Date | string | null;
  deliveryDeadline: string | null;
  /** 询价第一档数量 */
  firstTierQty: number | null;
  /** RFQ 里的强制要求编号；供应商没答的按"未答"计 */
  mandatoryCodes: string[];
};

export type ChecksResult = {
  checks: QuoteChecks;
  /** 交期超出截止的天数（> 0 才有） */
  deliveryLateDays: number | null;
  /** 有效期比截标日早的天数（> 0 才有） */
  validityShortDays: number | null;
  assumptions: string[];
};

function toUtcDay(v: Date | string): number {
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : v;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function evaluateQuoteChecks(q: ChecksInput, t: TenderTimeline): ChecksResult {
  const assumptions: string[] = [];
  let deliveryLateDays: number | null = null;
  let validityShortDays: number | null = null;

  // 交期：回信日 + 交期天数 ≤ 交付截止（无截止 → 截标日 + 30 天）
  let deliveryOk: CheckValue = "unknown";
  const deadline = t.deliveryDeadline
    ? toUtcDay(t.deliveryDeadline)
    : t.closeDate
      ? toUtcDay(t.closeDate) + 30 * DAY
      : null;
  if (!t.deliveryDeadline && t.closeDate) assumptions.push(`未设交付截止，按截标日 +30 天（${ymdOf(deadline!)}）判断交期`);
  if (q.deliveryDays != null && q.emailDate && deadline != null) {
    const arrive = toUtcDay(q.emailDate) + q.deliveryDays * DAY;
    deliveryOk = arrive <= deadline;
    if (!deliveryOk) deliveryLateDays = Math.round((arrive - deadline) / DAY);
  }

  // 有效期：validUntil ≥ 截标日
  let validityOk: CheckValue = "unknown";
  if (t.closeDate && q.validUntil) {
    const close = toUtcDay(t.closeDate);
    const valid = toUtcDay(q.validUntil);
    validityOk = valid >= close;
    if (!validityOk) validityShortDays = Math.round((close - valid) / DAY);
  }

  // 起订量：moq ≤ 询价第一档数量；没 MOQ → unknown（不算不合规）
  const moqOk: CheckValue = q.moq == null || t.firstTierQty == null ? "unknown" : q.moq <= t.firstTierQty;

  // 强制项：有"不满足" → false；有"未答"（含 RFQ 里有但回信没提的编号）→ partial；否则 true
  const byCode = new Map(q.mandatoryAnswers.map((a) => [a.requirementCode, a.answer]));
  const codes = new Set([...t.mandatoryCodes, ...byCode.keys()]);
  let mandatoryOk: CheckValue = true;
  for (const code of codes) {
    const a = byCode.get(code) ?? "未答";
    if (a === "不满足") {
      mandatoryOk = false;
      break;
    }
    if (a === "未答" || a === "部分满足") mandatoryOk = "partial";
  }

  return { checks: { deliveryOk, validityOk, moqOk, mandatoryOk }, deliveryLateDays, validityShortDays, assumptions };
}

/* ---------------------------------- 设置写入（PUT /tender-rfq-settings） ---------------------------------- */

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式 YYYY-MM-DD");
const estimateSchema = z.object({ mode: z.enum(["per_unit", "per_shipment", "pct_of_goods"]), value: z.number().min(0) }).strict();

export const tenderRfqSettingsPutSchema = z
  .object({
    fromName: z.string().trim().min(1).max(120).nullable().optional(),
    fromEmail: z.string().trim().email().max(200).nullable().optional(),
    landedCost: z
      .object({
        fxRates: z.record(z.string().regex(/^[A-Z]{3}$/, "币种用三位大写代码"), z.number().positive()).optional(),
        fxAsOf: ymdSchema.nullable().optional(),
        fxSource: z.enum(["MANUAL", "BANK_SETTLEMENT"]).nullable().optional(),
        freightEstimate: estimateSchema.nullable().optional(),
        exportInlandEstimate: estimateSchema.nullable().optional(),
        insurancePct: z.number().min(0).max(100).nullable().optional(),
        clearanceFlatCad: z.number().min(0).nullable().optional(),
        projects: z
          .record(
            z.string().min(1).max(64),
            z
              .object({
                dutyRatePct: z.number().min(0).max(100).nullable().optional(),
                deliveryDeadline: ymdSchema.nullable().optional(),
              })
              .strict()
              .nullable(),
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TenderRfqSettingsPut = z.infer<typeof tenderRfqSettingsPutSchema>;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * 把 PUT 体合进 settingsJson（纯函数）：传了的键覆盖、没传的保留、null 清空；projects 按项目合并、null 删除该项目。
 * 只动 settingsJson.tenderRfq，其它键（museBridge 绑定等）原样保留。
 * 汇率来源必须显式：合并后只要有汇率，就必须有 fxAsOf 与 fxSource，否则拒绝。
 */
export function applyTenderRfqSettingsUpdate(
  settingsJson: unknown,
  body: TenderRfqSettingsPut,
): { ok: true; next: Record<string, unknown>; tenderRfq: Record<string, unknown> } | { ok: false; error: string } {
  const settings = asObject(settingsJson);
  const tenderRfq = { ...asObject(settings.tenderRfq) };
  if (body.fromName !== undefined) tenderRfq.fromName = body.fromName;
  if (body.fromEmail !== undefined) tenderRfq.fromEmail = body.fromEmail?.toLowerCase() ?? null;

  if (body.landedCost) {
    const lc = { ...asObject(tenderRfq.landedCost) };
    const { projects, ...rest } = body.landedCost;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) lc[k] = v;
    if (projects) {
      const merged = { ...asObject(lc.projects) };
      for (const [pid, v] of Object.entries(projects)) {
        if (v === null) delete merged[pid];
        else merged[pid] = { ...asObject(merged[pid]), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
      }
      lc.projects = merged;
    }
    if (Object.keys(asObject(lc.fxRates)).length > 0 && (!lc.fxAsOf || !lc.fxSource)) {
      return { ok: false, error: "填写汇率时必须同时给出 fxAsOf（日期）和 fxSource（MANUAL / BANK_SETTLEMENT）" };
    }
    tenderRfq.landedCost = lc;
  }
  return { ok: true, next: { ...settings, tenderRfq }, tenderRfq };
}
