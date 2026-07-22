/**
 * 企业启用模块（Organization.modulesJson.enabled）
 * 通用枚举，禁止在 UI 写死企业名。
 */

export const ORG_MODULES = [
  "sales",
  "bids",
  "projects",
  "marketing",
  "trade",
  "product_content",
  "supply_chain",
  "operations",
] as const;

export type OrgModule = (typeof ORG_MODULES)[number];

export type OrgModulesConfig = {
  enabled: OrgModule[];
};

export const DEFAULT_SUNNY_MODULES: OrgModule[] = [
  "sales",
  "bids",
  "projects",
  "marketing",
  "product_content",
  "operations",
];

export const DEFAULT_MENGXIN_MODULES: OrgModule[] = [
  "trade",
  "product_content",
  "supply_chain",
  "sales",
  "marketing",
  "operations",
];

/** 导航项 → 所需模块（任一命中即显示；未配置则不限制） */
export const NAV_HREF_MODULES: Record<string, OrgModule[]> = {
  "/sales": ["sales"],
  "/sales/quote-sheet": ["sales"],
  "/sales/quotes": ["sales"],
  "/sales/calendar": ["sales"],
  "/sales/cockpit": ["sales"],
  "/sales/knowledge": ["sales"],
  "/sales/materials": ["product_content", "sales"],
  "/blinds-orders": ["sales", "operations"],
  "/inventory": ["sales", "supply_chain"],
  "/trade": ["trade"],
  "/trade/prospects": ["trade"],
  "/trade/intelligence": ["trade"],
  "/trade/cockpit": ["trade"],
  "/trade/chat": ["trade"],
  "/trade/quotes": ["trade"],
  "/trade/import": ["trade"],
  "/trade/templates": ["trade"],
  "/trade/channels": ["trade"],
  "/trade/fulfillment": ["trade", "supply_chain"],
  "/trade/knowledge": ["trade"],
  "/trade/signals": ["trade"],
  "/product-content": ["product_content", "trade"],
  "/projects": ["bids", "projects"],
  "/projects/intelligence": ["bids", "projects"],
  "/admin/project-intake": ["bids", "projects"],
  "/suppliers": ["bids", "supply_chain", "projects"],
  "/operations": ["operations", "marketing"],
  "/operations/intelligence": ["operations", "marketing"],
  "/operations/center": ["operations"],
  "/service-inbox": ["operations", "sales", "trade"],
  "/marketing": ["marketing"],
  "/operations/growth": ["marketing", "operations"],
};

export function parseOrgModulesJson(raw: unknown): OrgModulesConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (!Array.isArray(enabled)) return null;
  const list = enabled.filter(
    (m): m is OrgModule =>
      typeof m === "string" && (ORG_MODULES as readonly string[]).includes(m),
  );
  return { enabled: list };
}

export function isModuleEnabled(
  modules: OrgModulesConfig | null | undefined,
  module: OrgModule,
): boolean {
  if (!modules?.enabled?.length) return true; // 未配置 = 不限制（兼容存量）
  return modules.enabled.includes(module);
}

export function navHrefAllowedByModules(
  href: string,
  modules: OrgModulesConfig | null | undefined,
): boolean {
  if (!modules?.enabled?.length) return true;
  const required = NAV_HREF_MODULES[href];
  if (!required?.length) return true;
  return required.some((m) => modules.enabled.includes(m));
}
