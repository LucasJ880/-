/**
 * 角色 → 模块 / API 路由访问配置
 *
 * - admin 拥有全部权限
 * - 其他角色只能访问列出的路由前缀
 * - 用于中间件或 API 守卫做快速路由级鉴权
 */

export const ROLE_ROUTE_ACCESS: Record<string, string[]> = {
  admin: ["*"],
  sales: [
    "/api/sales/",
    "/api/blinds-orders/",
    "/api/ai/",
    "/api/auth/",
    "/api/users/me",
    "/api/tasks/",
    "/api/notifications/",
    "/api/messaging/",
    "/api/secretary/",
  ],
  trade: [
    "/api/trade/",
    "/api/ai/",
    "/api/auth/",
    "/api/users/me",
    "/api/tasks/",
    "/api/notifications/",
    "/api/messaging/",
    "/api/secretary/",
  ],
  user: [
    "/api/ai/",
    "/api/auth/",
    "/api/users/me",
    "/api/tasks/",
    "/api/projects/",
    "/api/organizations/",
    "/api/suppliers/",
    "/api/notifications/",
    "/api/reports/",
    "/api/messaging/",
  ],
};

/**
 * 侧边栏模块可见性矩阵
 * 值为允许的角色列表，undefined 表示所有角色可见
 */
export interface ModuleVisibility {
  roles?: string[];
}

export const MODULE_VISIBILITY: Record<string, ModuleVisibility> = {
  "/":                { roles: undefined },
  "/notifications":   { roles: undefined },
  "/tasks":           { roles: undefined },

  "/sales":             { roles: ["admin", "sales"] },
  "/sales/quotes":      { roles: ["admin", "sales"] },
  "/sales/calendar":    { roles: ["admin", "sales"] },
  "/sales/measure":     { roles: ["admin", "sales"] },
  "/settings/email":    { roles: ["admin", "sales"] },
  "/inventory":         { roles: ["admin"] },
  "/sales/cockpit":     { roles: ["admin", "sales"] },
  "/sales/knowledge":   { roles: ["admin", "sales"] },
  "/blinds-orders":     { roles: ["admin", "sales"] },

  "/trade":             { roles: ["admin", "trade"] },
  "/trade/knowledge":   { roles: ["admin", "trade"] },

  "/organizations":   { roles: ["admin", "user"] },
  "/projects":        { roles: ["admin", "user"] },
  "/suppliers":       { roles: ["admin", "user"] },

  "/assistant":       { roles: undefined },
  "/wechat":          { roles: undefined },
  "/ai-activity":     { roles: undefined },
  "/reports":         { roles: ["admin", "user"] },
  "/settings/wechat": { roles: undefined },

  "/admin":           { roles: ["admin"] },
};

/**
 * 检查角色是否有权访问某模块路径
 */
export function canAccessModule(role: string, modulePath: string): boolean {
  const normalizedRole = role === "super_admin" ? "admin" : role;

  const vis = MODULE_VISIBILITY[modulePath];
  if (!vis || !vis.roles) return true;
  return vis.roles.includes(normalizedRole);
}

/**
 * 检查角色是否有权访问某 API 路由
 */
export function canAccessRoute(role: string, routePath: string): boolean {
  const normalizedRole = role === "super_admin" ? "admin" : role;

  const allowedPrefixes = ROLE_ROUTE_ACCESS[normalizedRole];
  if (!allowedPrefixes) return false;
  if (allowedPrefixes.includes("*")) return true;
  return allowedPrefixes.some((prefix) => routePath.startsWith(prefix));
}
