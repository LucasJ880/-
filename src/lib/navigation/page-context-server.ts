/**
 * VIS-1b：服务端页面（/help、/operations）取当前用户的判定输入——与路由门同一个 loader（同一企业选择、30 秒缓存）。
 * 未登录或账号停用返回 null（调用方跳登录页；路由门在此之前已拦截，通常走不到）。
 */

import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { ROUTE_GATE_LOADER } from "./context-server";
import type { RouteGateContext } from "./filter-context";

export async function loadPageNavigationContext(): Promise<RouteGateContext | null> {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) return null;
  const user = await ROUTE_GATE_LOADER.loadUser(session.userId);
  if (!user || user.status !== "active") return null;
  return ROUTE_GATE_LOADER.loadContext(user);
}
