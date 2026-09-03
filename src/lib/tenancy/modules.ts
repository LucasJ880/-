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
  /** 窗饰专属工具面（报价单/工艺单/面料库存/可视化等）；梦馨等非窗饰企业不启用 */
  "window_covering",
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
  "window_covering",
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
  "/sales/quote-sheet": ["window_covering"],
  "/sales/quotes": ["window_covering"],
  "/sales/calendar": ["sales"],
  "/sales/cockpit": ["window_covering"],
  "/sales/knowledge": ["sales"],
  "/blinds-orders": ["window_covering"],
  "/inventory": ["window_covering"],
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
  "/bids": ["bids", "projects"],
  "/admin/project-intake": ["bids", "projects"],
  "/suppliers": ["bids", "supply_chain", "projects"],
  "/operations": ["operations", "marketing"],
  "/operations/intelligence": ["operations", "marketing"],
  "/operations/center": ["operations"],
  "/service-inbox": ["operations", "sales", "trade"],
  "/marketing": ["marketing"],
  "/operations/growth": ["marketing", "operations"],
};

/**
 * 行业包 → 隐含模块（过渡兜底）：
 * 窗饰服务包的企业即使 modulesJson 尚未显式加 window_covering，也视同启用，
 * 保证代码先于数据脚本上线时 Sunny 工具面不闪断；非窗饰包（如梦馨家纺）不受影响。
 */
export function withIndustryPackModules(
  modules: OrgModulesConfig | null,
  industryPackId: string | null | undefined,
): OrgModulesConfig | null {
  if (industryPackId !== "window_covering_services_v1") return modules;
  if (!modules?.enabled?.length) return modules;
  if (modules.enabled.includes("window_covering")) return modules;
  return { enabled: [...modules.enabled, "window_covering"] };
}

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
