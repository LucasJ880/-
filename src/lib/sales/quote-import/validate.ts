/**
 * 报价文件校验（QUOTE-1b，design D1 / D2 / D11）
 *
 * 纯函数：文本 + 字节数 → 净化后的报价（只含认识的键）或一条中文拒绝原因。
 * - 不信任文件：先判大小，再解析；`__proto__` / `constructor` / `prototype` 键在解析时丢弃；
 *   字符串截断、数字必须有限；窗户照片、试装图、面料资料一律不拷贝（照片只数张数）。
 * - 没见过的字段（界面才会产生的、旧版本的）一律容忍：认识的键照读，其余不留存（design D2「没有覆盖到的字段」）。
 */
import {
  FILE_PRODUCTS,
  MAX_FILE_ADDONS,
  MAX_FILE_BYTES,
  MAX_FILE_ITEMS,
  MAX_FILE_PLANS,
  QUOTE_FILE_FORMAT,
  QUOTE_FILE_VERSION,
  isFileProduct,
  type FileAddon,
  type FileItem,
  type FilePlan,
  type FilePricing,
  type FileProduct,
  type FileProductPricing,
  type ParseQuoteFileResult,
} from "./types";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_MAX = 200;
const NOTE_MAX = 2000;
/** 价表矩阵的边长上限（与工具相同） */
const MATRIX_MAX = 100;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown, max = TEXT_MAX): string {
  if (typeof v === "string") return v.trim().slice(0, max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 填了（非 null / undefined / 空串）但不是有限数 */
function presentButNotNumber(v: unknown): boolean {
  return v !== null && v !== undefined && v !== "" && finite(v) === null;
}

function fail(code: string, reasonZh: string): ParseQuoteFileResult {
  return { ok: false, code, reasonZh };
}

function planLabel(planId: string, multi: boolean): string {
  return multi ? `方案 ${planId || "（未命名）"}：` : "";
}

function readItem(raw: unknown): { item: FileItem | null; unknownProduct: string | null } {
  if (!isObj(raw)) return { item: null, unknownProduct: "（不是有效的行）" };
  if (!isFileProduct(raw.product)) return { item: null, unknownProduct: text(raw.product) || "（空）" };
  const invalid: string[] = [];
  for (const key of ["w", "h", "qty", "offer", "discountOverridePct", "fullness"] as const) {
    if (presentButNotNumber(raw[key])) invalid.push(key);
  }
  return {
    item: {
      product: raw.product,
      fabric: text(raw.fabric),
      w: finite(raw.w),
      h: finite(raw.h),
      qty: finite(raw.qty),
      room: text(raw.room),
      sku: text(raw.sku),
      cordless: raw.cordless === true,
      offer: finite(raw.offer),
      discountOverridePct: finite(raw.discountOverridePct),
      fullness: finite(raw.fullness),
      note: text(raw.note, NOTE_MAX),
      invalid,
    },
    unknownProduct: null,
  };
}

function readAddon(raw: unknown): FileAddon {
  const a = isObj(raw) ? raw : {};
  return {
    name: text(a.name),
    qty: finite(a.qty),
    price: finite(a.price),
    unit: text(a.unit, 20),
    note: text(a.note, NOTE_MAX),
  };
}

function readPlan(
  src: Obj,
  isActive: boolean,
  multi: boolean,
): { plan: FilePlan } | { error: ParseQuoteFileResult } {
  const planId = text(src.planId, 20);
  const label = planLabel(planId, multi);
  if (!Array.isArray(src.items)) {
    return { error: fail("no_items", `${label}文件里没有产品行，不是完整的报价文件`) };
  }
  if (src.items.length > MAX_FILE_ITEMS) {
    return { error: fail("too_many_items", `${label}产品行有 ${src.items.length} 行，超过 ${MAX_FILE_ITEMS} 行上限`) };
  }
  const rawAddons = src.addons === undefined || src.addons === null ? [] : src.addons;
  if (!Array.isArray(rawAddons)) {
    return { error: fail("bad_addons", `${label}附加项目的格式不对，无法导入`) };
  }
  if (rawAddons.length > MAX_FILE_ADDONS) {
    return { error: fail("too_many_addons", `${label}附加项目有 ${rawAddons.length} 项，超过 ${MAX_FILE_ADDONS} 项上限`) };
  }
  const items: FileItem[] = [];
  for (let i = 0; i < src.items.length; i++) {
    const { item, unknownProduct } = readItem(src.items[i]);
    if (!item) {
      return {
        error: fail(
          "unknown_product",
          `${label}第 ${i + 1} 行的产品「${unknownProduct}」不在青砚的 ${FILE_PRODUCTS.length} 个品类里，无法导入`,
        ),
      };
    }
    items.push(item);
  }
  return {
    plan: {
      planId,
      planName: text(src.planName),
      isActive,
      items,
      addons: rawAddons.map(readAddon),
      note: text(src.note, NOTE_MAX),
      install: src.install === true,
      delivery: src.delivery === true,
      downtown: src.downtown === true,
      deliveryAmount: finite(src.deliveryAmount),
      downtownAmount: finite(src.downtownAmount),
    },
  };
}

function numberList(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MATRIX_MAX) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = finite(x);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function matrix(v: unknown, rows: number, cols: number): number[][] | null {
  if (!Array.isArray(v) || v.length !== rows) return null;
  const out: number[][] = [];
  for (const r of v) {
    const row = numberList(r);
    if (!row || row.length !== cols) return null;
    out.push(row);
  }
  return out;
}

function readProductPricing(raw: unknown): FileProductPricing | null {
  if (!isObj(raw) || !isObj(raw.brackets) || !isObj(raw.fabrics)) return null;
  const widths = numberList(raw.brackets.widths);
  const heights = numberList(raw.brackets.heights);
  if (!widths || !heights) return null;
  const fabrics: FileProductPricing["fabrics"] = {};
  for (const [name, f] of Object.entries(raw.fabrics)) {
    if (UNSAFE_KEYS.has(name) || name.length > TEXT_MAX || !isObj(f)) continue;
    const msrp = f.msrp === undefined ? null : matrix(f.msrp, heights.length, widths.length);
    // 带了矩阵但形状不对 → 这个品类的价表不可用
    if (f.msrp !== undefined && !msrp) return null;
    fabrics[name] = {
      msrp,
      msrpRef: typeof f.msrpRef === "string" ? f.msrpRef.slice(0, 20) : null,
      cassette: f.cassette === true,
      special: typeof f.special === "string" ? f.special.slice(0, 40) : null,
    };
  }
  const rollerTables: Record<string, number[][]> = {};
  if (isObj(raw.msrpTables)) {
    for (const [name, t] of Object.entries(raw.msrpTables)) {
      if (UNSAFE_KEYS.has(name) || name.length > 20) continue;
      const m = matrix(t, heights.length, widths.length);
      if (!m) return null;
      rollerTables[name] = m;
    }
  }
  return { widths, heights, fabrics, rollerTables };
}

function readPricing(raw: unknown): FilePricing | null {
  if (!isObj(raw) || !isObj(raw.data) || !isObj(raw.data.products)) return null;
  const products: FilePricing["products"] = {};
  const discounts: FilePricing["discounts"] = {};
  const floors: FilePricing["floors"] = {};
  const rawDiscounts = isObj(raw.discounts) ? raw.discounts : {};
  const rawFloors = isObj(raw.floors) ? raw.floors : {};
  for (const product of FILE_PRODUCTS as readonly FileProduct[]) {
    const p = readProductPricing(raw.data.products[product]);
    if (p) products[product] = p;
    const d = finite(rawDiscounts[product]);
    if (d !== null) discounts[product] = d;
    const fl = finite(rawFloors[product]);
    if (fl !== null) floors[product] = fl;
  }
  const install: Record<string, number> = {};
  if (isObj(raw.data.install)) {
    for (const [k, v] of Object.entries(raw.data.install)) {
      const n = finite(v);
      if (!UNSAFE_KEYS.has(k) && k.length <= 40 && n !== null) install[k] = n;
    }
  }
  const cf = isObj(raw.cordlessFloors) ? raw.cordlessFloors : {};
  const fu = isObj(raw.fullness) ? raw.fullness : {};
  return {
    version: text(raw.version),
    tax: finite(raw.tax),
    discounts,
    floors,
    cordlessDiscount: finite(raw.cordlessDiscount),
    cordlessMultiplier: finite(raw.cordlessMultiplier),
    cordlessFloors: { Zebra: finite(cf.Zebra), Roller: finite(cf.Roller) },
    fullness: { Drapery: finite(fu.Drapery), Sheer: finite(fu.Sheer) },
    install,
    products,
  };
}

function photosIn(v: unknown): number {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").length : 0;
}

/**
 * 窗户照片张数，按窗位去重：照片同时出现在当前方案的行上与 `planWindows` 里（同一批）。
 * 有 planWindowId 且 planWindows 里有该窗位的行不重复数。
 */
function countPhotos(quote: Obj, planSources: Obj[]): number {
  const windows = isObj(quote.planWindows) ? quote.planWindows : {};
  let n = 0;
  for (const [id, w] of Object.entries(windows)) {
    if (!UNSAFE_KEYS.has(id) && isObj(w)) n += photosIn(w.windowPhotos);
  }
  for (const src of planSources) {
    if (!Array.isArray(src.items)) continue;
    for (const it of src.items) {
      if (!isObj(it)) continue;
      const wid = typeof it.planWindowId === "string" ? it.planWindowId : "";
      if (wid && !UNSAFE_KEYS.has(wid) && isObj(windows[wid])) continue;
      n += photosIn(it.windowPhotos);
    }
  }
  return n;
}

/**
 * 校验一份报价文件。
 * @param fileText 文件全文
 * @param byteLength 文件字节数（浏览器里取 `File.size`，在读取之前就能判断上限）
 */
export function parseQuoteFile(fileText: string, byteLength: number): ParseQuoteFileResult {
  if (!Number.isFinite(byteLength) || byteLength > MAX_FILE_BYTES) {
    return fail("too_large", "文件超过 35 MB，无法导入");
  }
  if (typeof fileText !== "string" || !fileText.trim()) {
    return fail("not_json", "文件是空的，或不是 JSON 文件");
  }
  let root: unknown;
  try {
    // 解析时就丢掉会改原型的键
    root = JSON.parse(fileText, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value));
  } catch {
    return fail("not_json", "文件不是合法的 JSON，无法读取");
  }
  if (!isObj(root)) return fail("bad_format", "文件不是报价工具导出的报价文件");
  if (root.format !== QUOTE_FILE_FORMAT) {
    const got = text(root.format, 60);
    return fail(
      "bad_format",
      got
        ? `文件的格式标识是「${got}」，只支持报价工具导出的报价文件（${QUOTE_FILE_FORMAT}）`
        : `文件没有格式标识，只支持报价工具导出的报价文件（${QUOTE_FILE_FORMAT}）`,
    );
  }
  if (root.version !== QUOTE_FILE_VERSION) {
    const got = typeof root.version === "number" || typeof root.version === "string" ? String(root.version).slice(0, 20) : "（缺失）";
    return fail("bad_version", `文件版本 ${got} 暂不支持（只支持版本 ${QUOTE_FILE_VERSION}）`);
  }
  const quote = root.quote;
  if (!isObj(quote)) return fail("no_quote", "文件里没有报价内容，不是完整的报价文件");

  const otherPlans = Array.isArray(quote.plans) ? quote.plans.filter(isObj).slice(0, MAX_FILE_PLANS) : [];
  const multi = otherPlans.length > 0;
  const plans: FilePlan[] = [];
  const sources: Obj[] = [quote, ...otherPlans];
  for (let i = 0; i < sources.length; i++) {
    const r = readPlan(sources[i], i === 0, multi);
    if ("error" in r) return r.error;
    plans.push(r.plan);
  }
  plans.sort((a, b) => a.planId.localeCompare(b.planId));

  return {
    ok: true,
    file: {
      fileVersion: QUOTE_FILE_VERSION,
      exportedAt: text(root.exportedAt, 40),
      quoteId: text(quote.id),
      quoteNumber: text(quote.number),
      customer: {
        name: text(quote.customer),
        phone: text(quote.phone, 60),
        email: text(quote.email),
        address: text(quote.address, 300),
      },
      pricing: readPricing(quote.pricing),
      plans,
      photoCount: countPhotos(quote, sources),
    },
  };
}

/** 方案在界面上的名字：「方案 B · Blackout upgrade（导出时的当前方案）」 */
export function planDisplayName(plan: Pick<FilePlan, "planId" | "planName" | "isActive">, multi: boolean): string {
  const base = plan.planId ? `方案 ${plan.planId}` : "方案";
  const named = plan.planName ? `${base} · ${plan.planName}` : base;
  return multi && plan.isActive ? `${named}（导出时的当前方案）` : named;
}
