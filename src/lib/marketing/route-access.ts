/**
 * 营销接口（/api/marketing/**）的旧模式判定：中间件对无行业包企业的 JWT 平台角色 sales 返回 403，
 * 岗位模式企业由 requireMarketingReadAccess 按岗位派生角色拦截。
 * 营销工作区页面（/marketing/**、/operations/growth/**）自 VIS-1a 起由路由门按「品牌增长」入口判定
 * （src/lib/navigation/route-gate.ts），不再在这里判定。
 */

export function isMarketingApiPath(pathname: string): boolean {
  return pathname === "/api/marketing" || pathname.startsWith("/api/marketing/");
}

/** 销售只使用销售/报价数字员工，不可经营销接口读增长中心数据（接口层判定）。 */
export function canAccessMarketingWorkspace(role: string | null | undefined): boolean {
  return Boolean(role && role !== "sales");
}
