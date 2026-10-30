/**
 * PERM-3：品类判定（纯函数）
 *
 * 品类 = 出单岗位的责任边界：vinyl / drapery / shades。
 * 零 schema：品类由单据行的产品类型推导，不落列；权限键按品类拆分（orders.fulfillment.update.<category>）。
 * 新增品类只改这一张表 + 权限键 + 岗位模板。
 */

export const CATEGORIES = ["vinyl", "drapery", "shades"] as const;
export type FulfillmentCategory = (typeof CATEGORIES)[number];

/** 工艺单行 productType（src/lib/blinds/deduction-rules.ts PRODUCT_TYPES）→ 品类 */
const PRODUCT_TYPE_CATEGORY: Record<string, FulfillmentCategory> = {
  卷帘: "shades",
  斑马帘: "shades",
  香格里拉: "shades",
};

/** 报价行 product（src/lib/blinds/pricing-types.ts ProductName）→ 品类（Shutters → vinyl 为任务书判断点 2 的默认值） */
const QUOTE_PRODUCT_CATEGORY: Record<string, FulfillmentCategory> = {
  Zebra: "shades",
  Roller: "shades",
  SHANGRILA: "shades",
  "Cordless Cellular": "shades",
  SkylightHoneycomb: "shades",
  "Roman Shade": "shades",
  Roman: "shades",
  Allusion: "shades",
  /** 2026-10-28 价表新产品（仿木百叶）：出单归 Roller/Zebra/Roman 岗（任务书 Q2） */
  Fauxwood: "shades",
  Drapery: "drapery",
  Sheer: "drapery",
  Shutters: "vinyl",
};

export const CATEGORY_LABEL: Record<FulfillmentCategory, string> = {
  vinyl: "Vinyl",
  drapery: "布帘",
  shades: "Roller/Zebra/Roman",
};

/** 负责该品类的岗位模板 key 与名称（与 role-defaults 的 fulfillment_* 对应） */
export const CATEGORY_POSITION: Record<FulfillmentCategory, { key: string; name: string }> = {
  vinyl: { key: "fulfillment_vinyl", name: "出单·Vinyl" },
  drapery: { key: "fulfillment_drapery", name: "出单·布帘" },
  shades: { key: "fulfillment_shades", name: "出单·Roller/Zebra/Roman" },
};

export function updateKeyFor(category: FulfillmentCategory): string {
  return `orders.fulfillment.update.${category}`;
}

/** 全品类伞键（仅 owner / 平台管理员） */
export const FULFILLMENT_UMBRELLA_KEY = "orders.fulfillment.update";

export function categoryOfProductType(productType: string | null | undefined): FulfillmentCategory | null {
  if (!productType) return null;
  return PRODUCT_TYPE_CATEGORY[productType.trim()] ?? null;
}

export function categoryOfQuoteProduct(product: string | null | undefined): FulfillmentCategory | null {
  if (!product) return null;
  return QUOTE_PRODUCT_CATEGORY[product.trim()] ?? null;
}

/** 一张单的品类集合 = 各行品类去重（未知类型不计入），按 CATEGORIES 顺序 */
export function orderCategories(items: ReadonlyArray<{ productType: string }>): FulfillmentCategory[] {
  const set = new Set<FulfillmentCategory>();
  for (const it of items) {
    const c = categoryOfProductType(it.productType);
    if (c) set.add(c);
  }
  return CATEGORIES.filter((c) => set.has(c));
}

/**
 * 自动生成工艺单的参数行（sunny-process ProcessSpec）也是"单据行"：国内下单表 → shades、窗帘 → drapery、
 * Vinyl → vinyl；外采购按段（shutter → vinyl，与 Shutters → vinyl 同一默认值；drape → drapery；shade → shades）。
 * 结构类型，不依赖 sunny-process。
 */
export type SpecLinesForCategory = {
  domestic: ReadonlyArray<unknown>;
  drapes: ReadonlyArray<unknown>;
  vinyl: ReadonlyArray<unknown>;
  purchase: ReadonlyArray<{ section: string }>;
};

/** INSTALL-2c：收口单元品类（质保年限查表）也用这张表 */
export const PURCHASE_SECTION_CATEGORY: Record<string, FulfillmentCategory> = {
  shutter: "vinyl",
  drape: "drapery",
  shade: "shades",
};

export function specCategories(spec: SpecLinesForCategory | null | undefined): FulfillmentCategory[] {
  if (!spec) return [];
  const set = new Set<FulfillmentCategory>();
  if (spec.domestic.length > 0) set.add("shades");
  if (spec.drapes.length > 0) set.add("drapery");
  if (spec.vinyl.length > 0) set.add("vinyl");
  for (const p of spec.purchase) {
    const c = PURCHASE_SECTION_CATEGORY[p.section];
    if (c) set.add(c);
  }
  return CATEGORIES.filter((c) => set.has(c));
}

/** 工艺单行 + 参数行 的品类并集，按 CATEGORIES 顺序 */
export function orderCategoriesWithSpec(
  items: ReadonlyArray<{ productType: string }>,
  spec: SpecLinesForCategory | null | undefined,
): FulfillmentCategory[] {
  const set = new Set<FulfillmentCategory>([...orderCategories(items), ...specCategories(spec)]);
  return CATEGORIES.filter((c) => set.has(c));
}
