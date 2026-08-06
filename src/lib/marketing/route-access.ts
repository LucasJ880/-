const MARKETING_PAGE_PREFIXES = [
  "/operations/growth",
  "/marketing",
] as const;

export function isMarketingPagePath(pathname: string): boolean {
  return MARKETING_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isMarketingApiPath(pathname: string): boolean {
  return pathname === "/api/marketing" || pathname.startsWith("/api/marketing/");
}

export function isMarketingWorkspacePath(pathname: string): boolean {
  return isMarketingPagePath(pathname) || isMarketingApiPath(pathname);
}

/** 销售只使用销售/报价数字员工，不可通过深链绕过品牌增长导航。 */
export function canAccessMarketingWorkspace(role: string | null | undefined): boolean {
  return Boolean(role && role !== "sales");
}
