/**
 * 报价折扣率设置 —— 按企业（orgId）读取
 *
 * 禁止：无 orgId 的全局 singleton；禁止跨企业回退。
 * 解锁码：仅存 bcrypt 哈希（lineDiscountUnlockCodeHash / depositOverrideCode），API 永不返回明文或哈希。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { ProductName } from "./pricing-types";
import {
  DEFAULT_DISCOUNTS,
  DEFAULT_SUNNY_MOTOR_PRICE,
  DEFAULT_DELIVERY_FEE,
  INSTALL_RULES,
} from "./pricing-data";
import type { ConfigLoadResult } from "@/lib/org-rules/types";
import { publishOrgRule } from "@/lib/org-rules/service";
import { hashUnlockCode } from "./unlock-code";

export type DiscountsByProduct = Record<ProductName, number>;

const FIELD_TO_PRODUCT: Record<string, ProductName> = {
  zebra: "Zebra",
  shangrila: "SHANGRILA",
  cellular: "Cordless Cellular",
  roller: "Roller",
  drapery: "Drapery",
  sheer: "Sheer",
  shutters: "Shutters",
  honeycomb: "SkylightHoneycomb",
  romanShade: "Roman Shade",
  // 2026-10-28 价表：这两项存企业设置 JSON（pricing.discounts），不是 QuoteDiscountSettings 的列（零 schema）
  fauxwood: "Fauxwood",
  allusion: "Allusion",
};

/** 存于 Organization.settingsJson.pricing.discounts 的折扣键（design D1） */
export const JSON_DISCOUNT_KEYS = ["fauxwood", "allusion"] as const;
export type JsonDiscountKey = (typeof JSON_DISCOUNT_KEYS)[number];
const JSON_DISCOUNT_KEY_SET = new Set<string>(JSON_DISCOUNT_KEYS);

/** 纯函数：从企业设置 JSON 读 pricing.discounts 里的折扣；坏值（非 0~1 有限数）丢弃，由调用方回落默认 */
export function readJsonDiscounts(settingsJson: unknown): Partial<Record<JsonDiscountKey, number>> {
  const out: Partial<Record<JsonDiscountKey, number>> = {};
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) return out;
  const pricing = (settingsJson as Record<string, unknown>).pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return out;
  const discounts = (pricing as Record<string, unknown>).discounts;
  if (!discounts || typeof discounts !== "object" || Array.isArray(discounts)) return out;
  for (const k of JSON_DISCOUNT_KEYS) {
    const v = (discounts as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

/** 纯函数：把 JSON 折扣写回企业设置 JSON，只替换 pricing.discounts 的对应键，其它键原样保留 */
export function mergeJsonDiscounts(
  settingsJson: unknown,
  patch: Partial<Record<JsonDiscountKey, number>>,
): Record<string, unknown> {
  const base =
    settingsJson && typeof settingsJson === "object" && !Array.isArray(settingsJson)
      ? { ...(settingsJson as Record<string, unknown>) }
      : {};
  const pricingRaw = base.pricing;
  const pricing =
    pricingRaw && typeof pricingRaw === "object" && !Array.isArray(pricingRaw)
      ? { ...(pricingRaw as Record<string, unknown>) }
      : {};
  const discountsRaw = pricing.discounts;
  const discounts =
    discountsRaw && typeof discountsRaw === "object" && !Array.isArray(discountsRaw)
      ? { ...(discountsRaw as Record<string, unknown>) }
      : {};
  for (const k of JSON_DISCOUNT_KEYS) {
    if (patch[k] !== undefined) discounts[k] = patch[k];
  }
  pricing.discounts = discounts;
  base.pricing = pricing;
  return base;
}

/**
 * 服务端计价前把企业折扣套到没有行级覆盖的行上（design D1：定价、预览与报价创建同一来源）。
 * 行上已有有限数的 discountOverridePct（销售手动改过）时保持不变；手填价产品（Roman）不受影响（引擎忽略）。
 */
export function applyOrgDiscountDefaults<T extends { product: ProductName; discountOverridePct?: number | null }>(
  items: T[],
  discounts: DiscountsByProduct,
): T[] {
  return items.map((item) => {
    if (typeof item.discountOverridePct === "number" && Number.isFinite(item.discountOverridePct)) return item;
    const d = discounts[item.product];
    if (typeof d !== "number" || !Number.isFinite(d)) return item;
    return { ...item, discountOverridePct: d };
  });
}

/** DTO → 按产品折扣表（给已拿到 DTO 的调用方用，省一次查询） */
export function dtoToProductDiscounts(dto: DiscountsDto): DiscountsByProduct {
  const out = { ...DEFAULT_DISCOUNTS };
  for (const [field, product] of Object.entries(FIELD_TO_PRODUCT)) {
    const v = (dto as unknown as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) out[product] = v;
  }
  return out;
}

export const PRODUCT_TO_FIELD: Record<ProductName, string> = Object.fromEntries(
  Object.entries(FIELD_TO_PRODUCT).map(([f, p]) => [p, f]),
) as Record<ProductName, string>;

export interface DiscountsDto {
  orgId: string;
  version: number;
  effectiveAt: string;
  configStatus: "ok" | "missing";
  zebra: number;
  shangrila: number;
  cellular: number;
  roller: number;
  drapery: number;
  sheer: number;
  shutters: number;
  honeycomb: number;
  romanShade: number;
  /** 2026-10-28 价表新产品折扣（企业设置 JSON 存储；缺省 0.30 / 0.35） */
  fauxwood: number;
  allusion: number;
  sunnyMotorPrice: number;
  /** 最低安装费（CAD）：installation 模式下行内安装费不足时补足到此金额 */
  minInstallFee: number;
  /** 运费（CAD）：installation 模式下每单加收；pickup 免收 */
  deliveryFee: number;
  /** 提成估算：毛利率估算系数（0-1；0=未配置，业绩页隐藏提成卡） */
  commissionMarginRate: number;
  /** 提成估算：提成比例（0-1，默认 0.3=毛利的 30%） */
  commissionRate: number;
  /** 品类成本率（{zebra:0.45,...}；成本 ≈ 成交行价 × 率）；空对象=未配置 */
  costRates: Record<string, number>;
  promoWarnPct: number;
  promoDangerPct: number;
  promoMaxPct: number;
  depositWarnPct: number;
  depositMinPct: number;
  /** 仅布尔：是否已配置定金解锁码（永不返回明文/哈希） */
  hasDepositOverrideCode: boolean;
  /** 仅布尔：是否已配置行折扣解锁码（永不返回明文/哈希） */
  hasLineDiscountUnlockCode: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

const PRODUCT_KEYS = [
  "zebra",
  "shangrila",
  "cellular",
  "roller",
  "drapery",
  "sheer",
  "shutters",
  "honeycomb",
  "romanShade",
  "fauxwood",
  "allusion",
] as const;
const THRESHOLD_KEYS = ["promoWarnPct", "promoDangerPct", "promoMaxPct"] as const;
const DEPOSIT_KEYS = ["depositWarnPct", "depositMinPct"] as const;
const PRICE_KEYS = ["sunnyMotorPrice", "minInstallFee", "deliveryFee"] as const;
const COMMISSION_KEYS = ["commissionMarginRate", "commissionRate"] as const;
export const DTO_NUMERIC_KEYS = [
  ...PRODUCT_KEYS,
  ...THRESHOLD_KEYS,
  ...DEPOSIT_KEYS,
  ...PRICE_KEYS,
  ...COMMISSION_KEYS,
] as const;

const COST_RATE_FIELDS = new Set(PRODUCT_KEYS as readonly string[]);

/** 解析 costRatesJson：仅接受已知品类字段、0-1 有限数，其余静默丢弃 */
export function parseCostRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!COST_RATE_FIELDS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) {
      out[k] = Math.round(v * 10000) / 10000;
    }
  }
  return out;
}

/** 校验入参形态的品类成本率（API PUT 用）；非法字段/数值报错而非丢弃 */
export function validateCostRatesInput(
  raw: unknown,
): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "costRates 必须是对象（{zebra:0.45,...}）" };
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!COST_RATE_FIELDS.has(k)) {
      return { ok: false, error: `costRates 含未知品类字段 ${k}` };
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { ok: false, error: `品类成本率 ${k} 必须为 0~1 之间的数字` };
    }
    out[k] = Math.round(n * 10000) / 10000;
  }
  return { ok: true, value: out };
}

/** 列存折扣 + 企业设置 JSON 折扣 → 按产品的折扣表（缺省回 DEFAULT_DISCOUNTS） */
function rowToProductMap(
  row: Record<string, unknown> | null,
  settingsJson: unknown = null,
): DiscountsByProduct {
  const out = { ...DEFAULT_DISCOUNTS };
  const json = readJsonDiscounts(settingsJson);
  for (const [field, product] of Object.entries(FIELD_TO_PRODUCT)) {
    const v = JSON_DISCOUNT_KEY_SET.has(field) ? json[field as JsonDiscountKey] : row?.[field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) {
      out[product] = v;
    }
  }
  return out;
}

async function loadSettingsJson(orgId: string): Promise<unknown> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  return org?.settingsJson ?? null;
}

export async function loadDiscounts(orgId: string): Promise<DiscountsByProduct> {
  if (!orgId) {
    throw new Error("loadDiscounts 必须提供 orgId");
  }
  const [row, settingsJson] = await Promise.all([
    db.quoteDiscountSettings.findUnique({ where: { orgId } }),
    loadSettingsJson(orgId),
  ]);
  return rowToProductMap(row as unknown as Record<string, unknown> | null, settingsJson);
}

export async function loadDiscountsResult(
  orgId: string,
): Promise<ConfigLoadResult<DiscountsByProduct>> {
  const [row, settingsJson] = await Promise.all([
    db.quoteDiscountSettings.findUnique({ where: { orgId } }),
    loadSettingsJson(orgId),
  ]);
  if (!row) {
    return {
      status: "missing",
      value: rowToProductMap(null, settingsJson),
      orgId,
      ruleKey: "quote_discounts",
      version: null,
      effectiveAt: null,
      updatedById: null,
      message: "未配置企业折扣，使用平台通用默认（非其他企业配置）",
    };
  }
  return {
    status: "ok",
    value: rowToProductMap(row as unknown as Record<string, unknown>, settingsJson),
    orgId,
    ruleKey: "quote_discounts",
    version: row.version,
    effectiveAt: row.effectiveAt,
    updatedById: row.updatedBy,
  };
}

/** 加载折扣 DTO；永不包含解锁码明文或哈希 */
export async function loadDiscountsDto(orgId: string): Promise<DiscountsDto> {
  if (!orgId) throw new Error("loadDiscountsDto 必须提供 orgId");

  const [row, settingsJson] = await Promise.all([
    db.quoteDiscountSettings.findUnique({ where: { orgId } }),
    loadSettingsJson(orgId),
  ]);
  const json = readJsonDiscounts(settingsJson);
  const fauxwood = json.fauxwood ?? DEFAULT_DISCOUNTS.Fauxwood;
  const allusion = json.allusion ?? DEFAULT_DISCOUNTS.Allusion;
  if (!row) {
    return {
      orgId,
      version: 0,
      effectiveAt: new Date(0).toISOString(),
      configStatus: "missing",
      zebra: DEFAULT_DISCOUNTS.Zebra,
      shangrila: DEFAULT_DISCOUNTS.SHANGRILA,
      cellular: DEFAULT_DISCOUNTS["Cordless Cellular"],
      roller: DEFAULT_DISCOUNTS.Roller,
      drapery: DEFAULT_DISCOUNTS.Drapery,
      sheer: DEFAULT_DISCOUNTS.Sheer,
      shutters: DEFAULT_DISCOUNTS.Shutters,
      honeycomb: DEFAULT_DISCOUNTS.SkylightHoneycomb,
      romanShade: DEFAULT_DISCOUNTS["Roman Shade"],
      fauxwood,
      allusion,
      sunnyMotorPrice: DEFAULT_SUNNY_MOTOR_PRICE,
      minInstallFee: INSTALL_RULES.minimumTotal,
      deliveryFee: DEFAULT_DELIVERY_FEE,
      commissionMarginRate: 0,
      commissionRate: 0.3,
      costRates: {},
      promoWarnPct: 0.06,
      promoDangerPct: 0.15,
      promoMaxPct: 0.25,
      depositWarnPct: 0.4,
      depositMinPct: 0.3,
      hasDepositOverrideCode: false,
      hasLineDiscountUnlockCode: false,
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
    };
  }

  return {
    orgId,
    version: row.version,
    effectiveAt: row.effectiveAt.toISOString(),
    configStatus: "ok",
    zebra: row.zebra,
    shangrila: row.shangrila,
    cellular: row.cellular,
    roller: row.roller,
    drapery: row.drapery,
    sheer: row.sheer,
    shutters: row.shutters,
    honeycomb: row.honeycomb,
    romanShade: row.romanShade,
    fauxwood,
    allusion,
    sunnyMotorPrice: row.sunnyMotorPrice,
    minInstallFee: row.minInstallFee,
    deliveryFee: row.deliveryFee,
    commissionMarginRate: row.commissionMarginRate,
    commissionRate: row.commissionRate,
    costRates: parseCostRates(row.costRatesJson),
    promoWarnPct: row.promoWarnPct,
    promoDangerPct: row.promoDangerPct,
    promoMaxPct: row.promoMaxPct,
    depositWarnPct: row.depositWarnPct,
    depositMinPct: row.depositMinPct,
    hasDepositOverrideCode: !!(row.depositOverrideCode && row.depositOverrideCode.length > 0),
    hasLineDiscountUnlockCode: !!(
      row.lineDiscountUnlockCodeHash && row.lineDiscountUnlockCodeHash.length > 0
    ),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export type DiscountSavePatch = Partial<
  Pick<DiscountsDto, (typeof DTO_NUMERIC_KEYS)[number]>
> & {
  /** 品类成本率整表替换（已经 validateCostRatesInput 校验） */
  costRates?: Record<string, number>;
  /** 明文入参；落库前哈希到 depositOverrideCode */
  depositOverrideCodePlain?: string | null;
  /** 明文入参；落库前哈希到 lineDiscountUnlockCodeHash */
  lineDiscountUnlockCodePlain?: string | null;
  /** PERM-2：已哈希入参（审批执行器用；与明文字段互斥，明文优先）；null=清空 */
  depositOverrideCodeHashed?: string | null;
  lineDiscountUnlockCodeHashed?: string | null;
};

export async function saveDiscountsForOrg(params: {
  orgId: string;
  userId: string;
  patch: DiscountSavePatch;
}): Promise<DiscountsDto> {
  const existing = await db.quoteDiscountSettings.findUnique({
    where: { orgId: params.orgId },
  });
  const nextVersion = (existing?.version ?? 0) + 1;
  const now = new Date();

  const {
    depositOverrideCodePlain,
    lineDiscountUnlockCodePlain,
    depositOverrideCodeHashed,
    lineDiscountUnlockCodeHashed,
    costRates,
    ...numericPatchAll
  } = params.patch;

  // 2026-10-28：fauxwood / allusion 不是列，拆出来写企业设置 JSON 的 pricing.discounts 子键
  const jsonPatch: Partial<Record<JsonDiscountKey, number>> = {};
  const numericPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(numericPatchAll)) {
    if (JSON_DISCOUNT_KEY_SET.has(k)) {
      if (typeof v === "number") jsonPatch[k as JsonDiscountKey] = v;
    } else {
      numericPatch[k] = v;
    }
  }

  const data: Record<string, unknown> = { ...numericPatch };
  if (costRates !== undefined) {
    data.costRatesJson = costRates;
  }

  if (depositOverrideCodePlain === undefined && depositOverrideCodeHashed !== undefined) {
    data.depositOverrideCode = depositOverrideCodeHashed;
  }
  if (lineDiscountUnlockCodePlain === undefined && lineDiscountUnlockCodeHashed !== undefined) {
    data.lineDiscountUnlockCodeHash = lineDiscountUnlockCodeHashed;
  }

  if (depositOverrideCodePlain !== undefined) {
    if (depositOverrideCodePlain === null || depositOverrideCodePlain.trim() === "") {
      data.depositOverrideCode = null;
    } else {
      data.depositOverrideCode = await hashUnlockCode(depositOverrideCodePlain);
    }
  }

  if (lineDiscountUnlockCodePlain !== undefined) {
    if (
      lineDiscountUnlockCodePlain === null ||
      lineDiscountUnlockCodePlain.trim() === ""
    ) {
      data.lineDiscountUnlockCodeHash = null;
    } else {
      data.lineDiscountUnlockCodeHash = await hashUnlockCode(
        lineDiscountUnlockCodePlain,
      );
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.quoteDiscountSettings.upsert({
      where: { orgId: params.orgId },
      create: {
        orgId: params.orgId,
        version: 1,
        effectiveAt: now,
        ...data,
        updatedBy: params.userId,
      },
      update: {
        ...data,
        version: nextVersion,
        effectiveAt: now,
        updatedBy: params.userId,
      },
    });
    if (Object.keys(jsonPatch).length > 0) {
      // 只替换 pricing.discounts 子键；sunnyWarranty / tenderRfq / calendarWatch 等其它键原样保留
      const org = await tx.organization.findUnique({ where: { id: params.orgId }, select: { settingsJson: true } });
      const merged = mergeJsonDiscounts(org?.settingsJson ?? null, jsonPatch);
      await tx.organization.update({
        where: { id: params.orgId },
        data: { settingsJson: merged as Prisma.InputJsonValue },
      });
    }
    return row;
  });
  const jsonAfter = readJsonDiscounts(await loadSettingsJson(params.orgId));

  await publishOrgRule({
    orgId: params.orgId,
    ruleKey: "quote_discounts",
    userId: params.userId,
    effectiveAt: now,
    config: {
      zebra: updated.zebra,
      shangrila: updated.shangrila,
      cellular: updated.cellular,
      roller: updated.roller,
      drapery: updated.drapery,
      sheer: updated.sheer,
      shutters: updated.shutters,
      honeycomb: updated.honeycomb,
      romanShade: updated.romanShade,
      fauxwood: jsonAfter.fauxwood ?? DEFAULT_DISCOUNTS.Fauxwood,
      allusion: jsonAfter.allusion ?? DEFAULT_DISCOUNTS.Allusion,
      sunnyMotorPrice: updated.sunnyMotorPrice,
      minInstallFee: updated.minInstallFee,
      deliveryFee: updated.deliveryFee,
      commissionMarginRate: updated.commissionMarginRate,
      commissionRate: updated.commissionRate,
      costRates: parseCostRates(updated.costRatesJson),
      promoWarnPct: updated.promoWarnPct,
      promoDangerPct: updated.promoDangerPct,
      promoMaxPct: updated.promoMaxPct,
      depositWarnPct: updated.depositWarnPct,
      depositMinPct: updated.depositMinPct,
      hasDepositOverrideCode: !!updated.depositOverrideCode,
      hasLineDiscountUnlockCode: !!updated.lineDiscountUnlockCodeHash,
    },
  }).catch((e) => {
    console.warn("[discount-settings] snapshot OrgBusinessRule failed", e);
  });

  return loadDiscountsDto(params.orgId);
}

export function validateDiscountsInput(
  input: Record<string, unknown>,
):
  | {
      ok: true;
      value: Partial<Pick<DiscountsDto, (typeof DTO_NUMERIC_KEYS)[number]>>;
    }
  | { ok: false; error: string } {
  const out: Record<string, number> = {};
  for (const k of [...PRODUCT_KEYS, ...THRESHOLD_KEYS, ...DEPOSIT_KEYS, ...COMMISSION_KEYS]) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return {
        ok: false,
        error: `字段 ${k} 必须为 0~1 之间的数字（0.06 表示 6%）`,
      };
    }
    out[k] = Math.round(n * 10000) / 10000;
  }
  for (const k of PRICE_KEYS) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 10000) {
      return {
        ok: false,
        error: `字段 ${k} 必须为 0~10000 之间的 CAD 金额`,
      };
    }
    out[k] = Math.round(n * 100) / 100;
  }
  const w = out.promoWarnPct;
  const d = out.promoDangerPct;
  const m = out.promoMaxPct;
  if (w !== undefined && d !== undefined && w > d) {
    return { ok: false, error: "黄色预警阈值不能大于红色强警告阈值" };
  }
  if (d !== undefined && m !== undefined && d > m) {
    return { ok: false, error: "红色强警告阈值不能大于最高让利上限" };
  }
  if (w !== undefined && m !== undefined && w > m) {
    return { ok: false, error: "黄色预警阈值不能大于最高让利上限" };
  }
  const dw = out.depositWarnPct;
  const dm = out.depositMinPct;
  if (dw !== undefined && dm !== undefined && dw < dm) {
    return { ok: false, error: "定金黄色提醒阈值不能低于定金最低阈值" };
  }
  return { ok: true, value: out };
}
