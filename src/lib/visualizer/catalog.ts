/**
 * Visualizer 产品库（DB 表 VisualizerCatalogProduct） + mock fallback
 *
 * 设计要点：
 * - 单一权威：所有线上读写都走 DB（GET/POST/PATCH/DELETE 与 product-options.create）
 * - mock-products 仅作为：
 *   1) seed 来源（scripts/seed-visualizer-catalog.ts）
 *   2) DB 失联兜底（异常环境下 ProductPanel 仍可用最少 10 款工作）
 *   3) 旧记录回查兜底：极端情况下 productCatalogId = mock_xxx 但 DB 行被删，回到静态库找
 *
 * 权限边界：
 * - 平台预置 (orgId IS NULL)：所有登录用户可见，不可改/不可删
 * - 组织私有 (orgId 非空)：仅本组织成员可见、可改、可软删
 */

import { db } from "@/lib/db";
import {
  VISUALIZER_MOCK_PRODUCTS,
  type VisualizerMockProduct,
  type VisualizerProductColor,
} from "@/lib/visualizer/mock-products";
import type {
  VisualizerCatalogColor,
  VisualizerCatalogMounting,
  VisualizerCatalogProductDetail,
} from "@/lib/visualizer/types";

const VALID_MOUNTINGS = new Set<VisualizerCatalogMounting>(["inside", "outside"]);

export const VISUALIZER_CATALOG_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "roller", label: "卷帘" },
  { value: "solar", label: "阳光帘" },
  { value: "blackout_roller", label: "遮光卷帘" },
  { value: "zebra", label: "斑马帘" },
  { value: "sheer", label: "纱帘" },
  { value: "drapery", label: "布艺窗帘" },
  { value: "dual", label: "双层帘" },
  { value: "honeycomb", label: "蜂巢帘" },
  { value: "vertical", label: "垂直帘" },
  { value: "motorized", label: "电动窗帘" },
  { value: "custom", label: "自定义" },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeColors(raw: unknown): VisualizerCatalogColor[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualizerCatalogColor[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
    const hex = typeof o.hex === "string" ? o.hex.trim() : "";
    if (!name || !HEX_RE.test(hex)) continue;
    out.push({ name, hex });
  }
  return out;
}

export function sanitizeMountings(raw: unknown): VisualizerCatalogMounting[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualizerCatalogMounting[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim() as VisualizerCatalogMounting;
    if (VALID_MOUNTINGS.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function sanitizeOpacity(raw: unknown, fallback = 0.85): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0.1, Math.min(1, raw));
}

export function isValidCategory(category: string): boolean {
  return VISUALIZER_CATALOG_CATEGORIES.some((c) => c.value === category);
}

export function categoryLabelFor(category: string): string {
  const found = VISUALIZER_CATALOG_CATEGORIES.find((c) => c.value === category);
  return found?.label ?? category;
}

/** Prisma row → API/前端共用 detail */
export function toCatalogDetail(
  row: {
    id: string;
    orgId: string | null;
    name: string;
    category: string;
    categoryLabel: string;
    previewImageUrl: string | null;
    textureUrl: string | null;
    defaultOpacity: number;
    colorsJson: unknown;
    mountingsJson: unknown;
    pricingProductName: string | null;
    notes: string | null;
    archived: boolean;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  ctx: { currentOrgId: string | null },
): VisualizerCatalogProductDetail {
  return {
    id: row.id,
    orgId: row.orgId,
    isPlatform: row.orgId === null,
    isOwn: row.orgId !== null && row.orgId === ctx.currentOrgId,
    name: row.name,
    category: row.category,
    categoryLabel: row.categoryLabel,
    previewImageUrl: row.previewImageUrl,
    textureUrl: row.textureUrl,
    defaultOpacity: row.defaultOpacity,
    colors: sanitizeColors(row.colorsJson),
    mountings: sanitizeMountings(row.mountingsJson),
    pricingProductName: row.pricingProductName,
    notes: row.notes,
    archived: row.archived,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 把 mock 静态行包成 detail（兜底） */
function fromMock(p: VisualizerMockProduct): VisualizerCatalogProductDetail {
  return {
    id: p.id,
    orgId: null,
    isPlatform: true,
    isOwn: false,
    name: p.name,
    category: p.category,
    categoryLabel: p.categoryLabel,
    previewImageUrl: p.previewImageUrl,
    textureUrl: p.textureUrl,
    defaultOpacity: p.defaultOpacity,
    colors: p.supportedColors.map((c: VisualizerProductColor) => ({
      name: c.name,
      hex: c.hex,
    })),
    mountings: [...p.mountingTypes],
    pricingProductName: null,
    notes: p.notes,
    archived: false,
    createdById: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * 选产品时调用：先 DB（限定 orgId 范围），找不到回退 mock。
 *
 * @param id productCatalogId（mock_xxx 或 cuid）
 * @param scope.orgId 用于校验组织私有产品的可见性；null/undefined 表示只允许平台预置
 */
export async function findCatalogProductForUse(
  id: string,
  scope: { orgId: string | null },
): Promise<VisualizerCatalogProductDetail | null> {
  const row = await db.visualizerCatalogProduct.findUnique({
    where: { id },
  });
  if (row && !row.archived) {
    if (row.orgId !== null && row.orgId !== scope.orgId) {
      // 组织私有但不属于当前组织 → 视为不存在
      return null;
    }
    return toCatalogDetail(row, { currentOrgId: scope.orgId });
  }

  const mock = VISUALIZER_MOCK_PRODUCTS.find((p) => p.id === id);
  return mock ? fromMock(mock) : null;
}

/** 列出可见目录：平台预置 + 当前组织私有；archived 默认排除 */
export async function listCatalogForOrg(scope: {
  orgId: string | null;
}): Promise<{
  platform: VisualizerCatalogProductDetail[];
  org: VisualizerCatalogProductDetail[];
}> {
  const [platformRows, orgRows] = await Promise.all([
    db.visualizerCatalogProduct.findMany({
      where: { orgId: null, archived: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    scope.orgId
      ? db.visualizerCatalogProduct.findMany({
          where: { orgId: scope.orgId, archived: false },
          orderBy: [{ updatedAt: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  return {
    platform: platformRows.map((r) => toCatalogDetail(r, { currentOrgId: scope.orgId })),
    org: orgRows.map((r) => toCatalogDetail(r, { currentOrgId: scope.orgId })),
  };
}
