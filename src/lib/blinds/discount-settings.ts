/**
 * 报价折扣率设置 —— 按企业（orgId）读取
 *
 * 禁止：无 orgId 的全局 singleton；禁止跨企业回退。
 * 解锁码：仅存 bcrypt 哈希（lineDiscountUnlockCodeHash / depositOverrideCode），API 永不返回明文或哈希。
 */

import { db } from "@/lib/db";
import type { ProductName } from "./pricing-types";
import { DEFAULT_DISCOUNTS } from "./pricing-data";
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
};

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
] as const;
const THRESHOLD_KEYS = ["promoWarnPct", "promoDangerPct", "promoMaxPct"] as const;
const DEPOSIT_KEYS = ["depositWarnPct", "depositMinPct"] as const;
export const DTO_NUMERIC_KEYS = [
  ...PRODUCT_KEYS,
  ...THRESHOLD_KEYS,
  ...DEPOSIT_KEYS,
] as const;

function rowToProductMap(row: Record<string, unknown> | null): DiscountsByProduct {
  const out = { ...DEFAULT_DISCOUNTS };
  if (!row) return out;
  for (const [field, product] of Object.entries(FIELD_TO_PRODUCT)) {
    const v = row[field];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) {
      out[product] = v;
    }
  }
  return out;
}

export async function loadDiscounts(orgId: string): Promise<DiscountsByProduct> {
  if (!orgId) {
    throw new Error("loadDiscounts 必须提供 orgId");
  }
  const row = await db.quoteDiscountSettings.findUnique({
    where: { orgId },
  });
  return rowToProductMap(row as unknown as Record<string, unknown> | null);
}

export async function loadDiscountsResult(
  orgId: string,
): Promise<ConfigLoadResult<DiscountsByProduct>> {
  const row = await db.quoteDiscountSettings.findUnique({ where: { orgId } });
  if (!row) {
    return {
      status: "missing",
      value: { ...DEFAULT_DISCOUNTS },
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
    value: rowToProductMap(row as unknown as Record<string, unknown>),
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

  const row = await db.quoteDiscountSettings.findUnique({ where: { orgId } });
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
  /** 明文入参；落库前哈希到 depositOverrideCode */
  depositOverrideCodePlain?: string | null;
  /** 明文入参；落库前哈希到 lineDiscountUnlockCodeHash */
  lineDiscountUnlockCodePlain?: string | null;
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
    ...numericPatch
  } = params.patch;

  const data: Record<string, unknown> = { ...numericPatch };

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

  const updated = await db.quoteDiscountSettings.upsert({
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
  for (const k of DTO_NUMERIC_KEYS) {
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
