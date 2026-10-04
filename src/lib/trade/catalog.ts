/**
 * 在售货号的报价字段。只记 FOB / 起订量 / 交期，不记库存。
 * 写入产品档案后，询盘对货号沿用现有匹配。
 */

export const CATALOG_FACT_FOB = "fob_price";
export const CATALOG_FACT_MOQ = "moq";
export const CATALOG_FACT_LEAD = "lead_time";

export function formatFobPrice(amount: number): string {
  const n = Math.round(amount * 100) / 100;
  return `USD ${n}`;
}

export function formatLeadTimeDays(days: number): string {
  return `${Math.round(days)} days`;
}

/** 纯数字补单位，已有文字原样保存 */
export function formatMoq(raw: string): string {
  const t = raw.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return `${t} pcs`;
  return t;
}

export function readFactText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function parseFobPrice(raw?: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseLeadTimeDays(raw?: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)\s*(?:-\s*(\d+))?\s*(day|days|天)/i);
  if (m) return parseInt(m[2] ?? m[1], 10);
  const w = raw.match(/(\d+)\s*(week|weeks|周)/i);
  if (w) return parseInt(w[1], 10) * 7;
  const bare = raw.trim().match(/^(\d+)$/);
  return bare ? parseInt(bare[1], 10) : null;
}

export function commercialFromFacts(
  facts: { fieldKey: string; value: unknown; status: string }[],
): { fobPrice: number | null; moq: string | null; leadTimeDays: number | null } {
  const map: Record<string, string> = {};
  const sorted = [...facts].sort(
    (a, b) => (a.status === "confirmed" ? 1 : 0) - (b.status === "confirmed" ? 1 : 0),
  );
  for (const fact of sorted) {
    const text = readFactText(fact.value);
    if (text) map[fact.fieldKey] = text;
  }
  return {
    fobPrice: parseFobPrice(map[CATALOG_FACT_FOB]),
    moq: map[CATALOG_FACT_MOQ] ?? null,
    leadTimeDays: parseLeadTimeDays(map[CATALOG_FACT_LEAD]),
  };
}

export type CatalogDraft = {
  sku: string;
  name: string;
  nameEn: string | null;
  fobPrice: number | null;
  moq: string | null;
  leadTimeDays: number | null;
  status: "active" | "archived";
};

export function normalizeCatalogDraft(input: {
  sku?: unknown;
  name?: unknown;
  nameEn?: unknown;
  fobPrice?: unknown;
  moq?: unknown;
  leadTimeDays?: unknown;
  status?: unknown;
}): { ok: true; draft: CatalogDraft } | { ok: false; error: string } {
  const sku = String(input.sku ?? "").trim().slice(0, 64);
  const name = String(input.name ?? "").trim().slice(0, 200);
  const nameEnRaw = String(input.nameEn ?? "").trim().slice(0, 200);
  if (!sku) return { ok: false, error: "货号必填" };
  if (!name) return { ok: false, error: "中文名必填" };

  let fobPrice: number | null = null;
  if (input.fobPrice != null && String(input.fobPrice).trim() !== "") {
    const n = Number(input.fobPrice);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
      return { ok: false, error: "FOB 需要是大于 0 的数字" };
    }
    fobPrice = Math.round(n * 100) / 100;
  }

  let moq: string | null = null;
  if (input.moq != null && String(input.moq).trim() !== "") {
    moq = formatMoq(String(input.moq).slice(0, 80));
  }

  let leadTimeDays: number | null = null;
  if (input.leadTimeDays != null && String(input.leadTimeDays).trim() !== "") {
    const n = Number(input.leadTimeDays);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      return { ok: false, error: "交期需要是 1 到 3650 的天数" };
    }
    leadTimeDays = n;
  }

  const status = input.status === "archived" ? "archived" : "active";
  return {
    ok: true,
    draft: { sku, name, nameEn: nameEnRaw || null, fobPrice, moq, leadTimeDays, status },
  };
}
