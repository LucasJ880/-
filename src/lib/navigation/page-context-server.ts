/**
 * VIS-1b：服务端页面（`/`、/help、/operations）取当前用户的判定输入——与路由门同一个 loader（同一企业选择、30 秒缓存）。
 *
 * 只从 session cookie 取用户 id（与中间件同一个 verifySession），不再先跑 resolveWorkspaceContextFromCookies
 * 再丢掉它的结果（审查：重复取数、且后者会走 resolvePreferredOrgId）。
 * 未登录或账号停用返回 null（调用方跳登录页；路由门在此之前已拦截，通常走不到）。
 */

import { cookies } from "next/headers";
import { verifySession } from "@/lib/auth/session";
import { ROUTE_GATE_LOADER } from "./context-server";
import type { RouteGateContext } from "./filter-context";

const SESSION_COOKIE = "qy_session";

/** session cookie 里的用户 id；无 / 失效为 null */
export async function readSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  return payload?.sub ?? null;
}

export async function loadPageNavigationContext(): Promise<RouteGateContext | null> {
  const userId = await readSessionUserId();
  if (!userId) return null;
  return loadGateNavigationContextForUser(userId);
}

/**
 * VIS-1c：已知用户 id 时取与路由门同一份判定输入（同一企业选择、30 秒缓存、不列计数、不写库）。
 * 给高频接口用（全局搜索每次输入都会请求）；账号不存在或停用返回 null。
 */
export async function loadGateNavigationContextForUser(userId: string): Promise<RouteGateContext | null> {
  const user = await ROUTE_GATE_LOADER.loadUser(userId);
  if (!user || user.status !== "active") return null;
  return ROUTE_GATE_LOADER.loadContext(user);
}
