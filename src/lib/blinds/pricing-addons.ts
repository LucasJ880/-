import type { AddonDef, ProductName, QuoteAddonInput } from './pricing-types';

/**
 * 附加项目目录（2026-10-28 价表，PRICE-3）
 *
 * 每项的单价都来自 config/pricelist/2026-10-28-lucas-quote.json（`source` 指明哪一行），
 * pricelist-2026-10-addons.test.ts 逐项对照；改价只改企业价（settingsJson.pricing.addons），不改这里。
 * 顺序：零售表按 display_order → Excel 独有项按行号 → Downtown。
 * 零售表之外的新键一律含下划线：本地文字解析按键名正则匹配，普通单词（如 downtown）不会误加费用。
 */

const BLINDS_MOTOR_PRODUCTS: ProductName[] = ['Zebra', 'Roller', 'SHANGRILA', 'SkylightHoneycomb'];
const DRAPE_PRODUCTS: ProductName[] = ['Drapery', 'Sheer'];
const SHUTTER_PRODUCTS: ProductName[] = ['Shutters'];

export const ADDON_CATALOG: AddonDef[] = [
  // ── 零售表 retailAddonsCsv（11 项，原样） ──
  { key: 'motor', displayName: 'Motor tube', printLabel: 'Motor tube', unitPrice: 150, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', source: { kind: 'retail', key: 'motor' } },
  { key: 'motor_plugin', displayName: 'Motor Tube(Plug-in)', printLabel: 'Motor Tube(Plug-in)', unitPrice: 350, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', source: { kind: 'retail', key: 'motor_plugin' } },
  { key: 'motor_battery_matter', displayName: 'Motor Tube(Battery-Matter)', printLabel: 'Motor Tube(Battery-Matter)', unitPrice: 190, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', source: { kind: 'retail', key: 'motor_battery_matter' } },
  { key: 'hub', displayName: 'Hub', printLabel: 'Hub', unitPrice: 240, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', source: { kind: 'retail', key: 'hub' } },
  { key: 'remote', displayName: 'SUNNY Remote Control', printLabel: 'SUNNY Remote Control', unitPrice: 40, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', source: { kind: 'retail', key: 'remote' } },
  { key: 'drape_motor_battery', displayName: 'Drape motor(Battery)', printLabel: 'Drape motor(Battery)', unitPrice: 650, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Drapery motor', source: { kind: 'retail', key: 'drape_motor_battery' } },
  { key: 'drape_motor_plugin_matter', displayName: 'Drape motor(Plug-in-Matter)', printLabel: 'Drape motor(Plug-in-Matter)', unitPrice: 700, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Drapery motor', source: { kind: 'retail', key: 'drape_motor_plugin_matter' } },
  { key: 'track6', displayName: 'TRACK 6 ft (72")', printLabel: 'Track 6 ft', unitPrice: 60, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', source: { kind: 'retail', key: 'track6' } },
  { key: 'track8', displayName: 'TRACK 8 ft (96")', printLabel: 'Track 8 ft', unitPrice: 80, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', source: { kind: 'retail', key: 'track8' } },
  { key: 'track10', displayName: 'TRACK 10 ft (120")', printLabel: 'Track 10 ft', unitPrice: 100, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', source: { kind: 'retail', key: 'track10' } },
  { key: 'track12', displayName: 'TRACK 12 ft (144")', printLabel: 'Track 12 ft', unitPrice: 120, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', source: { kind: 'retail', key: 'track12' } },

  // ── Excel ADD ON参考 中零售表没有的项（24 项） ──
  { key: 'motor_charger', displayName: 'Sunny Motor Tube Charging cable', printLabel: 'Sunny Motor Tube Charging cable', unitPrice: 40, eligibleProducts: BLINDS_MOTOR_PRODUCTS, unit: 'each', group: 'Blinds motor', hint: '每单首根免费，第二根起 40', source: { kind: 'excel', id: 'excel-addon-2' } },
  { key: 'drape_remote', displayName: 'Sunny Motorized Drape RMT (6 channel)', printLabel: 'Sunny Motorized Drape Remote (6 channel)', unitPrice: 40, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Drapery motor', source: { kind: 'excel', id: 'excel-addon-10' } },
  { key: 'drape_charger', displayName: 'Sunny Motorized Drape Charger', printLabel: 'Sunny Motorized Drape Charger', unitPrice: 40, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Drapery motor', hint: '每单首根免费，第二根起 40', source: { kind: 'excel', id: 'excel-addon-11' } },
  { key: 'drape_hub', displayName: 'Sunny Motorized Drape Hub', printLabel: 'Sunny Motorized Drape Hub', unitPrice: 300, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Drapery motor', source: { kind: 'excel', id: 'excel-addon-12' } },
  { key: 'drape_track_extra_ft', displayName: 'Motorized Drape Track (over 13 ft)', printLabel: 'Motorized Drape Track (over 13 ft)', unitPrice: 30, eligibleProducts: DRAPE_PRODUCTS, unit: 'ft', group: 'Drapery motor', hint: '电动轨道超过 13 ft 的部分按英尺计', source: { kind: 'excel', id: 'excel-addon-13' } },
  { key: 'channel_uhl_ft', displayName: 'U/H/L Channel', printLabel: 'U/H/L Channel', unitPrice: 18, eligibleProducts: [], unit: 'ft', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-14' } },
  { key: 'channel_rod_6ft', displayName: 'Channel Rod (6 ft)', printLabel: 'Channel Rod 6 ft', unitPrice: 82.5, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-15' } },
  { key: 'channel_rod_8ft', displayName: 'Channel Rod (8 ft)', printLabel: 'Channel Rod 8 ft', unitPrice: 112, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-16' } },
  { key: 'channel_rod_10ft', displayName: 'Channel Rod (10 ft)', printLabel: 'Channel Rod 10 ft', unitPrice: 145, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-17' } },
  { key: 'channel_rod_12ft', displayName: 'Channel Rod (12 ft)', printLabel: 'Channel Rod 12 ft', unitPrice: 178, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-18' } },
  { key: 'shutter_frame_vinyl_ft', displayName: 'Shutter Frame Vinyl', printLabel: 'Shutter Frame (Vinyl)', unitPrice: 4, eligibleProducts: SHUTTER_PRODUCTS, unit: 'ft', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-23' } },
  { key: 'shutter_frame_wood_ft', displayName: 'Shutter Frame Wood', printLabel: 'Shutter Frame (Wood)', unitPrice: 7, eligibleProducts: SHUTTER_PRODUCTS, unit: 'ft', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-24' } },
  { key: 'spacer_6ft', displayName: '加垫板 Spacer Board (6 ft)', printLabel: 'Spacer Board 6 ft', unitPrice: 60, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-25' } },
  { key: 'spacer_8ft', displayName: '加垫板 Spacer Board (8 ft)', printLabel: 'Spacer Board 8 ft', unitPrice: 80, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-26' } },
  { key: 'spacer_10ft', displayName: '加垫板 Spacer Board (10 ft)', printLabel: 'Spacer Board 10 ft', unitPrice: 100, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-27' } },
  { key: 'spacer_12ft', displayName: '加垫板 Spacer Board (12 ft)', printLabel: 'Spacer Board 12 ft', unitPrice: 120, eligibleProducts: [], unit: 'each', group: 'Track & rod', source: { kind: 'excel', id: 'excel-addon-28' } },
  { key: 'curved_track_flexible', displayName: '布帘弯轨·软轨（每窗）Curved Track – Flexible', printLabel: 'Curved Track – Flexible (per window)', unitPrice: 150, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', hint: '轨道本身按 Basic Track 另计，此项为每窗额外费用', source: { kind: 'excel', id: 'excel-addon-29' } },
  { key: 'curved_track_rigid', displayName: '布帘弯轨·硬轨（每弯）Curved Track – Rigid', printLabel: 'Curved Track – Rigid (per bend)', unitPrice: 75, eligibleProducts: DRAPE_PRODUCTS, unit: 'each', group: 'Track & rod', hint: '轨道本身按 Basic Track 另计；数量 = 弯数', source: { kind: 'excel', id: 'excel-addon-30' } },
  { key: 'shutter_valance_5ft', displayName: 'Shutter Valance (5 ft and below)', printLabel: 'Shutter Valance (5 ft and below)', unitPrice: 110, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-31' } },
  { key: 'shutter_valance_8ft', displayName: 'Shutter Valance (5–8 ft)', printLabel: 'Shutter Valance (5–8 ft)', unitPrice: 150, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-32' } },
  { key: 'shutter_valance_12ft', displayName: 'Shutter Valance (8–12 ft)', printLabel: 'Shutter Valance (8–12 ft)', unitPrice: 200, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-33' } },
  { key: 'shutter_track_5ft', displayName: 'Shutters Track (5 ft and below)', printLabel: 'Shutters Track (5 ft and below)', unitPrice: 200, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-38' } },
  { key: 'shutter_track_8ft', displayName: 'Shutters Track (5–8 ft)', printLabel: 'Shutters Track (5–8 ft)', unitPrice: 300, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-39' } },
  { key: 'shutter_track_12ft', displayName: 'Shutters Track (8–12 ft)', printLabel: 'Shutters Track (8–12 ft)', unitPrice: 400, eligibleProducts: SHUTTER_PRODUCTS, unit: 'each', group: 'Shutter', source: { kind: 'excel', id: 'excel-addon-40' } },

  // ── 服务费（fees.downtown，Q6） ──
  { key: 'downtown_fee', displayName: 'Downtown Service Fee', printLabel: 'Downtown Service Fee', unitPrice: 150, eligibleProducts: [], unit: 'each', group: 'Service', source: { kind: 'fee', path: 'downtown' } },
];

export type ExcelAddonDispositionKind = 'catalog' | 'duplicate' | 'engine' | 'superseded' | 'skip';

/**
 * Excel ADD ON参考 40 行逐行归类（design D2）。
 * catalog / duplicate 的 ref 是目录键；未归类的行会让 pricelist-2026-10-addons.test.ts 失败。
 */
export const EXCEL_ADDON_DISPOSITION: Record<string, { kind: ExcelAddonDispositionKind; ref?: string; reason?: string }> = {
  'excel-addon-2': { kind: 'catalog', ref: 'motor_charger' },
  'excel-addon-3': { kind: 'duplicate', ref: 'remote', reason: '6C RMT 即 SUNNY Remote Control（P3-3）' },
  'excel-addon-4': { kind: 'duplicate', ref: 'motor', reason: '电池电机 1.2Nm = Motor tube' },
  'excel-addon-5': { kind: 'duplicate', ref: 'motor_battery_matter' },
  'excel-addon-6': { kind: 'duplicate', ref: 'motor_plugin' },
  'excel-addon-7': { kind: 'superseded', ref: 'hub', reason: 'SUNNY Hub 300 为旧值，零售表 240（Q7）' },
  'excel-addon-8': { kind: 'duplicate', ref: 'drape_motor_plugin_matter' },
  'excel-addon-9': { kind: 'duplicate', ref: 'drape_motor_battery' },
  'excel-addon-10': { kind: 'catalog', ref: 'drape_remote' },
  'excel-addon-11': { kind: 'catalog', ref: 'drape_charger' },
  'excel-addon-12': { kind: 'catalog', ref: 'drape_hub' },
  'excel-addon-13': { kind: 'catalog', ref: 'drape_track_extra_ft' },
  'excel-addon-14': { kind: 'catalog', ref: 'channel_uhl_ft' },
  'excel-addon-15': { kind: 'catalog', ref: 'channel_rod_6ft' },
  'excel-addon-16': { kind: 'catalog', ref: 'channel_rod_8ft' },
  'excel-addon-17': { kind: 'catalog', ref: 'channel_rod_10ft' },
  'excel-addon-18': { kind: 'catalog', ref: 'channel_rod_12ft' },
  'excel-addon-19': { kind: 'duplicate', ref: 'track6' },
  'excel-addon-20': { kind: 'duplicate', ref: 'track8' },
  'excel-addon-21': { kind: 'duplicate', ref: 'track10' },
  'excel-addon-22': { kind: 'duplicate', ref: 'track12' },
  'excel-addon-23': { kind: 'catalog', ref: 'shutter_frame_vinyl_ft' },
  'excel-addon-24': { kind: 'catalog', ref: 'shutter_frame_wood_ft' },
  'excel-addon-25': { kind: 'catalog', ref: 'spacer_6ft' },
  'excel-addon-26': { kind: 'catalog', ref: 'spacer_8ft' },
  'excel-addon-27': { kind: 'catalog', ref: 'spacer_10ft' },
  'excel-addon-28': { kind: 'catalog', ref: 'spacer_12ft' },
  'excel-addon-29': { kind: 'catalog', ref: 'curved_track_flexible' },
  'excel-addon-30': { kind: 'catalog', ref: 'curved_track_rigid' },
  'excel-addon-31': { kind: 'catalog', ref: 'shutter_valance_5ft' },
  'excel-addon-32': { kind: 'catalog', ref: 'shutter_valance_8ft' },
  'excel-addon-33': { kind: 'catalog', ref: 'shutter_valance_12ft' },
  'excel-addon-34': { kind: 'engine', reason: 'Door Screen Sheer W≤25" 已是产品定价（DOOR_SCREEN_SHEER_RULES）' },
  'excel-addon-35': { kind: 'engine', reason: 'Door Screen Sheer 25<W≤40" 已是产品定价（DOOR_SCREEN_SHEER_RULES）' },
  'excel-addon-38': { kind: 'catalog', ref: 'shutter_track_5ft' },
  'excel-addon-39': { kind: 'catalog', ref: 'shutter_track_8ft' },
  'excel-addon-40': { kind: 'catalog', ref: 'shutter_track_12ft' },
  'excel-addon-42': { kind: 'engine', reason: 'Roller 罩盒加价 25（引擎 cassetteBump；边界以原工具为准：宽 ≥ 50 取 50）' },
  'excel-addon-43': { kind: 'engine', reason: 'Roller 罩盒加价 50（引擎 cassetteBump）' },
  'excel-addon-46': { kind: 'skip', reason: '黑色方盒 + 黑底杆 +15% 为行级比例加价，本次不做（Q8）' },
};

/** Part B 自定义行的 addonKey */
export const CUSTOM_ADDON_KEY = 'custom';

/** 单价上限（提交单价超出视为无效，回企业价） */
const MAX_ADDON_UNIT_PRICE = 100000;
const MAX_CUSTOM_NAME_LEN = 120;

const CATALOG_BY_KEY = new Map(ADDON_CATALOG.map((a) => [a.key, a]));

export function getAddonDef(key: string): AddonDef | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function getEligibleAddons(products: ProductName[]): AddonDef[] {
  return ADDON_CATALOG.filter(
    (a) =>
      a.eligibleProducts.length === 0 ||
      a.eligibleProducts.some((p) => products.includes(p))
  );
}

/** 企业价 → 目录价（prices 来自 readJsonAddonPrices，已校验） */
export function effectiveAddonPrice(key: string, prices?: Record<string, number> | null): number | undefined {
  const def = getAddonDef(key);
  if (!def) return undefined;
  const p = prices?.[key];
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : def.unitPrice;
}

/** 对客名称：目录项取 printLabel；自定义 / 未知键取提交名称 */
export function addonCustomerLabel(addonKey: string, customName?: string | null): string {
  const def = getAddonDef(addonKey);
  if (def) return def.printLabel;
  const name = (customName ?? '').trim().slice(0, MAX_CUSTOM_NAME_LEN);
  return name || (addonKey && addonKey !== CUSTOM_ADDON_KEY ? addonKey : 'Custom item');
}

/** 单价显示：按英尺项带 "/ft" */
export function formatAddonUnitPrice(addonKey: string, price: number): string {
  const suffix = getAddonDef(addonKey)?.unit === 'ft' ? '/ft' : '';
  return `$${price.toFixed(2)}${suffix}`;
}

export interface ResolvedAddonLine {
  addonKey: string;
  displayName: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
}

function validUnitPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_ADDON_UNIT_PRICE;
}

/**
 * 附加项目 → 落库行与小计（design D4；calculateQuoteTotal 与落库同源）
 * - 单价：提交值（有效时）> 企业价 > 目录价；未知键且无有效单价 → 0 并给出提示
 * - 数量：取整，< 1 或非法按 1（与旧 calcAddonSubtotal 一致）
 */
export function resolveAddonLines(
  addons: QuoteAddonInput[],
  prices?: Record<string, number> | null,
): { lines: ResolvedAddonLine[]; subtotal: number; warnings: string[] } {
  const lines: ResolvedAddonLine[] = [];
  const warnings: string[] = [];
  let subtotal = 0;
  for (const a of addons) {
    const qtyRaw = Math.round(Number(a.qty));
    const qty = Number.isFinite(qtyRaw) && qtyRaw >= 1 ? qtyRaw : 1;
    let unitPrice: number;
    if (validUnitPrice(a.unitPrice)) {
      unitPrice = a.unitPrice;
    } else {
      const eff = effectiveAddonPrice(a.addonKey, prices);
      if (eff === undefined) {
        warnings.push(`附加项目 ${a.addonKey} 不在目录且未提供单价，按 0 计`);
        unitPrice = 0;
      } else {
        unitPrice = eff;
      }
    }
    const lineSubtotal = Math.round(unitPrice * qty * 100) / 100;
    subtotal += lineSubtotal;
    lines.push({
      addonKey: a.addonKey,
      displayName: addonCustomerLabel(a.addonKey, a.displayName),
      unitPrice,
      qty,
      subtotal: lineSubtotal,
    });
  }
  return { lines, subtotal: Math.round(subtotal * 100) / 100, warnings };
}

export function calcAddonSubtotal(
  addons: QuoteAddonInput[],
  prices?: Record<string, number> | null,
): number {
  return resolveAddonLines(addons, prices).subtotal;
}

/** 请求体里的 addons → 规范输入（丢弃非对象 / 无键的项；单价、名称原样交给 resolveAddonLines 判定） */
export function normalizeAddonInputs(raw: unknown): QuoteAddonInput[] {
  if (!Array.isArray(raw)) return [];
  const out: QuoteAddonInput[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    if (typeof r.addonKey !== 'string' || !r.addonKey.trim()) continue;
    out.push({
      addonKey: r.addonKey.trim(),
      qty: Number(r.qty),
      ...(typeof r.unitPrice === 'number' ? { unitPrice: r.unitPrice } : {}),
      ...(typeof r.displayName === 'string' ? { displayName: r.displayName } : {}),
    });
  }
  return out;
}

/** 报价单 Part B 行里"自定义"的取值 */
export const PART_B_CUSTOM_SKU = '__custom';

/**
 * 报价单 Part B 行 → 提交给服务端的附加项目（design D4）
 * 只取已选择（预设或自定义）且数量 > 0 的行；单价带上销售填写的值（可能改过）。
 */
export function partBRowsToAddonInputs(
  rows: { skuItem: string; customName?: string; qty: number; price: number }[],
): QuoteAddonInput[] {
  const out: QuoteAddonInput[] = [];
  for (const r of rows) {
    const qty = Math.round(Number(r.qty));
    if (!r.skuItem || !Number.isFinite(qty) || qty <= 0) continue;
    const price = Number(r.price);
    const unitPrice = Number.isFinite(price) && price >= 0 ? price : undefined;
    if (r.skuItem === PART_B_CUSTOM_SKU) {
      out.push({
        addonKey: CUSTOM_ADDON_KEY,
        qty,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        displayName: (r.customName ?? '').trim() || 'Custom item',
      });
    } else {
      out.push({ addonKey: r.skuItem, qty, ...(unitPrice !== undefined ? { unitPrice } : {}) });
    }
  }
  return out;
}
