/**
 * 用户在前端确认/编辑后的吊牌字段合并（create-from-extracted）
 */

import type { LabelExtractedFields, LabelFieldSlot, LabelVisionFieldKey } from "./intelligence-label-types";

/** 与新建页「可编辑」列一致（不含 language：由 Vision 保留即可） */
export const LABEL_USER_EDITABLE_KEYS = [
  "productName",
  "brand",
  "upc",
  "gtin",
  "sku",
  "mpn",
  "itemNumber",
  "styleNumber",
  "material",
  "size",
  "color",
  "countryOfOrigin",
  "manufacturer",
  "importer",
  "distributor",
  "retailer",
  "address",
  "barcodeDigits",
  "marketRegion",
] as const satisfies readonly LabelVisionFieldKey[];

export type LabelUserEditableKey = (typeof LABEL_USER_EDITABLE_KEYS)[number];

function readEditedValue(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    const v = (raw as { value?: unknown }).value;
    if (v === null) return null;
    if (typeof v === "string") return v.trim() || null;
  }
  return undefined;
}

/**
 * 将 editedFields 覆盖到 base（仅处理 EDIT 白名单中的键；未出现的键沿用 base）
 */
export function mergeUserEditedLabelFields(
  base: LabelExtractedFields,
  edited: unknown,
): LabelExtractedFields {
  if (!edited || typeof edited !== "object") return { ...base };
  const e = edited as Record<string, unknown>;
  const out: LabelExtractedFields = { ...base };

  for (const key of LABEL_USER_EDITABLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(e, key)) continue;
    const nextVal = readEditedValue(e[key]);
    if (nextVal === undefined) continue;

    const prev: LabelFieldSlot = out[key] ?? {
      value: null,
      confidence: 0,
      evidence: "",
      source: "unknown",
    };

    out[key] = {
      value: nextVal,
      confidence: 0.95,
      evidence: `[用户确认/编辑] ${prev.evidence ? prev.evidence.slice(0, 400) : "—"}`.slice(0, 2000),
      source: "user_confirmed",
    };
  }

  return out;
}
