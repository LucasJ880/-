/**
 * Muse Bridge — 个人偏好记忆（P1-8，纯函数，零 DB）
 *
 * 存储（零 schema，与绑定表同一个父键）：
 *   Organization.settingsJson.museBridge.userPrefs[userId] =
 *     { defaultSupplierIds: string[], defaultIncoterm: string|null, chaseAfterDays: number|null, lastUpdatedAt }
 *
 * 纪律：
 *   - 偏好里不存任何价格 / 成本 / 估值：写回时只序列化上面四个字段，其它键一律丢弃；
 *   - 学习只改"操作者本人"的那一条（调用方传 userId，本文件不跨用户写）。
 */

import { MUSE_PREF_KEYS, type MusePrefKey } from "./contract";

export const DEFAULT_SUPPLIERS_MAX = 5;
export const PREF_INCOTERMS = ["EXW", "FOB", "CIF", "DDP", "DAP"] as const;
export type PrefIncoterm = (typeof PREF_INCOTERMS)[number];
export const CHASE_AFTER_DAYS_RANGE = { min: 1, max: 60 } as const;

export type MuseUserPrefs = {
  defaultSupplierIds: string[];
  defaultIncoterm: PrefIncoterm | null;
  chaseAfterDays: number | null;
  lastUpdatedAt: string | null;
};

export const EMPTY_PREFS: MuseUserPrefs = { defaultSupplierIds: [], defaultIncoterm: null, chaseAfterDays: null, lastUpdatedAt: null };

const isIncoterm = (v: unknown): v is PrefIncoterm => typeof v === "string" && (PREF_INCOTERMS as readonly string[]).includes(v);
const isChaseDays = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= CHASE_AFTER_DAYS_RANGE.min && v <= CHASE_AFTER_DAYS_RANGE.max;

/** 只认这四个字段；坏数据当作没填 */
export function normalizePrefs(raw: unknown): MuseUserPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.defaultSupplierIds)
    ? [...new Set(o.defaultSupplierIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, DEFAULT_SUPPLIERS_MAX)
    : [];
  return {
    defaultSupplierIds: ids,
    defaultIncoterm: isIncoterm(o.defaultIncoterm) ? o.defaultIncoterm : null,
    chaseAfterDays: isChaseDays(o.chaseAfterDays) ? o.chaseAfterDays : null,
    lastUpdatedAt: typeof o.lastUpdatedAt === "string" ? o.lastUpdatedAt : null,
  };
}

export function readUserPrefs(settingsJson: unknown, userId: string): MuseUserPrefs {
  const mb = (settingsJson as { museBridge?: { userPrefs?: Record<string, unknown> } } | null)?.museBridge;
  return normalizePrefs(mb?.userPrefs?.[userId]);
}

/** 写回（纯函数：只动 museBridge.userPrefs[userId]，绑定表等其它键原样保留） */
export function withUserPrefs(settingsJson: unknown, userId: string, prefs: MuseUserPrefs): Record<string, unknown> {
  const base = settingsJson && typeof settingsJson === "object" ? { ...(settingsJson as Record<string, unknown>) } : {};
  const mb = base.museBridge && typeof base.museBridge === "object" ? { ...(base.museBridge as Record<string, unknown>) } : {};
  const all = mb.userPrefs && typeof mb.userPrefs === "object" ? { ...(mb.userPrefs as Record<string, unknown>) } : {};
  const p = normalizePrefs(prefs);
  // 显式只序列化四个字段（不展开调用方对象）：偏好 JSON 里不可能出现别的键
  all[userId] = {
    defaultSupplierIds: p.defaultSupplierIds,
    defaultIncoterm: p.defaultIncoterm,
    chaseAfterDays: p.chaseAfterDays,
    lastUpdatedAt: p.lastUpdatedAt,
  };
  mb.userPrefs = all;
  base.museBridge = mb;
  return base;
}

/* ---------------------------------- 学习 ---------------------------------- */

/** 选定供应商后：挪到最前、去重、上限 5 */
export function learnSupplier(prefs: MuseUserPrefs, supplierId: string, now: Date): MuseUserPrefs {
  const ids = [supplierId, ...prefs.defaultSupplierIds.filter((x) => x !== supplierId)].slice(0, DEFAULT_SUPPLIERS_MAX);
  return { ...prefs, defaultSupplierIds: ids, lastUpdatedAt: now.toISOString() };
}

/** 询价被批准后：记下这轮的贸易条款，仅当之前没有 */
export function learnIncoterm(prefs: MuseUserPrefs, incoterm: string | null | undefined, now: Date): MuseUserPrefs {
  if (prefs.defaultIncoterm || !isIncoterm(incoterm)) return prefs;
  return { ...prefs, defaultIncoterm: incoterm, lastUpdatedAt: now.toISOString() };
}

/* ---------------------------------- 手动设置（set_preference） ---------------------------------- */

export type ApplyPreferenceResult = { ok: true; prefs: MuseUserPrefs; summaryZh: string } | { ok: false; error: string };

export function isPrefKey(k: unknown): k is MusePrefKey {
  return typeof k === "string" && (MUSE_PREF_KEYS as readonly string[]).includes(k);
}

/** 按 key 校验 value；null = 清空。supplierIds 是否属于本组织由调用方（DB）再校验。 */
export function applyPreference(prefs: MuseUserPrefs, key: string, value: unknown, now: Date): ApplyPreferenceResult {
  if (!isPrefKey(key)) return { ok: false, error: `不认识的偏好项「${key}」，可设：${MUSE_PREF_KEYS.join(" / ")}。` };
  const at = now.toISOString();
  if (key === "defaultSupplierIds") {
    if (value === null) return { ok: true, prefs: { ...prefs, defaultSupplierIds: [], lastUpdatedAt: at }, summaryZh: "常用供应商已清空" };
    if (!Array.isArray(value) || value.length === 0 || !value.every((x) => typeof x === "string" && x.length > 0)) {
      return { ok: false, error: "常用供应商要给一组供应商 id。" };
    }
    const ids = [...new Set(value as string[])];
    if (ids.length > DEFAULT_SUPPLIERS_MAX) return { ok: false, error: `常用供应商最多 ${DEFAULT_SUPPLIERS_MAX} 家。` };
    return { ok: true, prefs: { ...prefs, defaultSupplierIds: ids, lastUpdatedAt: at }, summaryZh: `常用供应商 ${ids.length} 家` };
  }
  if (key === "defaultIncoterm") {
    if (value === null) return { ok: true, prefs: { ...prefs, defaultIncoterm: null, lastUpdatedAt: at }, summaryZh: "默认贸易条款已清空" };
    const v = typeof value === "string" ? value.trim().toUpperCase() : value;
    if (!isIncoterm(v)) return { ok: false, error: `贸易条款只能是 ${PREF_INCOTERMS.join(" / ")}。` };
    return { ok: true, prefs: { ...prefs, defaultIncoterm: v, lastUpdatedAt: at }, summaryZh: `默认贸易条款 ${v}` };
  }
  if (value === null) return { ok: true, prefs: { ...prefs, chaseAfterDays: null, lastUpdatedAt: at }, summaryZh: "催单天数已清空" };
  if (!isChaseDays(value)) return { ok: false, error: `催单天数要是 ${CHASE_AFTER_DAYS_RANGE.min}–${CHASE_AFTER_DAYS_RANGE.max} 的整数。` };
  return { ok: true, prefs: { ...prefs, chaseAfterDays: value, lastUpdatedAt: at }, summaryZh: `${value} 天没回就提醒催单` };
}

/* ---------------------------------- 使用：RFQ 选供应商 ---------------------------------- */

export type RfqSupplierPick =
  | { source: "explicit"; supplierIds: string[] }
  | { source: "hint"; hint: string }
  | { source: "prefs"; supplierIds: string[] }
  | { source: "candidates" };

/** 顺序：显式 > 名称提示 > 个人偏好 > 候选列表 */
export function pickRfqSuppliers(input: { supplierIds?: string[] | null; supplierHint?: string | null; prefs: MuseUserPrefs }): RfqSupplierPick {
  if (input.supplierIds?.length) return { source: "explicit", supplierIds: input.supplierIds };
  const hint = input.supplierHint?.trim();
  if (hint) return { source: "hint", hint };
  if (input.prefs.defaultSupplierIds.length) return { source: "prefs", supplierIds: input.prefs.defaultSupplierIds };
  return { source: "candidates" };
}

/** 贸易条款：显式 > 偏好 > 无 */
export function pickRfqIncoterm(explicit: string | null | undefined, prefs: MuseUserPrefs): { incoterm: PrefIncoterm | null; fromPrefs: boolean } {
  if (isIncoterm(explicit)) return { incoterm: explicit, fromPrefs: false };
  return prefs.defaultIncoterm ? { incoterm: prefs.defaultIncoterm, fromPrefs: true } : { incoterm: null, fromPrefs: false };
}
