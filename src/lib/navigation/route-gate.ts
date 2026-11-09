/**
 * VIS-1a 路由门（spec navigation/route-gate；design openspec/changes/vis-1a-route-gate/design.md）
 *
 * 纯模块，不连库：门表、请求分类、判定（与侧栏同一个 isNavItemVisible）、302 目标、TTL 缓存、
 * 中间件用的请求处理函数（用户与判定输入的加载器由调用方注入，见 context-server.ts）。
 *
 * 门表口径：
 * - 侧栏入口：路由对应的导航项连同全部父项在侧栏可见 ⇔ 放行；
 * - 无侧栏入口：指向 registry.ts 的 ROUTE_ONLY_NAV_ITEMS（只做门、不渲染）；
 * - 登录即可：login_only；
 * - 门表之外：不放行（fail-closed）。
 *
 * VIS-1b：纯判定（门表、匹配、isRouteAllowed、路径变体）拆到 route-gate-core.ts，落地页与 302 目标在 landing.ts，
 * 判定输入拼装在 filter-context.ts；本文件只留请求分类、TTL 缓存与中间件请求处理，并重新导出前三者。
 */

import { NextResponse, type NextRequest } from "next/server";
import type { NavigationFilterContext } from "./types";
import {
  GATED_TOP_SEGMENTS,
  gatePathVariants,
  isRouteAllowed,
  matchRouteGateEntry,
  splitPath,
} from "./route-gate-core";
import { gateRedirectTarget } from "./landing";
import type { RouteGateContext } from "./filter-context";

export * from "./route-gate-core";
export { gateRedirectTarget, isPostVisible, resolveLandingPage, visiblePosts } from "./landing";
export type { RouteGateContext } from "./filter-context";


export type RouteGateDecision = { allowed: true } | { allowed: false; redirect: string };

export function resolveRouteGate(pathname: string, ctx: NavigationFilterContext): RouteGateDecision {
  if (isRouteAllowed(pathname, ctx)) return { allowed: true };
  return { allowed: false, redirect: gateRedirectTarget(pathname, ctx) };
}

// ─────────────────────────────── 请求分类 ───────────────────────────────

/** 门外（已登录区以外、需要登录但不经路由门）：(auth) 组页面与 Sentry 隧道 */
export const ROUTE_GATE_OUTSIDE_PATHS = ["/login", "/register", "/select-org", "/monitoring"] as const;

const IMAGE_EXTENSION = /\.(?:svg|png|jpg|jpeg|gif|webp)$/i;
const FILE_EXTENSION = /\.[A-Za-z0-9]+$/;


/** public/ 静态文件：末段带扩展名，且第一段不是已登录区一级路径 */
export function isStaticFilePath(pathname: string): boolean {
  const segs = splitPath(pathname);
  if (!segs.length) return false;
  if (!FILE_EXTENSION.test(segs[segs.length - 1])) return false;
  return !GATED_TOP_SEGMENTS.has(segs[0]);
}

/** public/ 图片：在登录检查之前放行（与改动前 matcher 排除图片一致）；原样与解码后都须是 public 图片 */
export function isStaticImagePath(pathname: string): boolean {
  const variants = gatePathVariants(pathname);
  if (!variants || variants[0] !== pathname) return false;
  return variants.every((p) => isStaticFilePath(p) && IMAGE_EXTENSION.test(p));
}

export type RouteRequestKind = "api" | "static_file" | "outside" | "login_only" | "gated";

function underAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 已登录请求的分类（中间件免登录路径在此之前已放行）；RSC 变体还原、原样与解码后分类一致才算非「需判定」 */
export function classifyPageRequest(pathname: string): RouteRequestKind {
  const variants = gatePathVariants(pathname);
  if (!variants) return "gated";
  const kinds = variants.map(classifyOne);
  return kinds.every((k) => k === kinds[0]) ? kinds[0] : "gated";
}

function classifyOne(pathname: string): RouteRequestKind {
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  if (isStaticFilePath(pathname)) return "static_file";
  if (pathname.startsWith("/_next/") || underAny(pathname, ROUTE_GATE_OUTSIDE_PATHS)) return "outside";
  const entry = matchRouteGateEntry(pathname);
  if (entry?.rule.kind === "login_only") return "login_only";
  return "gated";
}

// ─────────────────────────────── TTL 缓存 ───────────────────────────────

/** 进程内 TTL 缓存：超过上限淘汰最旧；时钟可注入（测试用） */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly opts: { ttlMs: number; max: number; now?: () => number },
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.opts.ttlMs });
    while (this.map.size > this.opts.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** 判定输入缓存的时效与上限（spec「判定时效」：30 秒） */
export const ROUTE_GATE_CACHE_TTL_MS = 30_000;
export const ROUTE_GATE_CACHE_MAX = 500;

// ─────────────────────────────── 请求处理 ───────────────────────────────

export type RouteGateUser = {
  id: string;
  role: string | null;
  status: string;
  activeOrgId: string | null;
};

export type RouteGateLoader = {
  loadUser(userId: string): Promise<RouteGateUser | null>;
  loadContext(user: RouteGateUser): Promise<RouteGateContext>;
};

function redirectTo(request: NextRequest, target: string): NextResponse {
  // new URL(target, base) 不带原查询串；不加任何说明判定原因的响应头
  return NextResponse.redirect(new URL(target, request.url), 302);
}

/**
 * 中间件在登录校验之后调用：返回 null = 放行；否则为 302 响应。
 * 顺序（design D3）：非「需判定」的请求直接放行、不调加载器 → 查用户（失效 → /login；super_admin → 放行）
 * → 取判定输入（失败 → /tasks，fail-closed）→ 判定。
 */
export async function applyRouteGate(
  request: NextRequest,
  sessionUserId: string,
  loader: RouteGateLoader,
): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (classifyPageRequest(pathname) !== "gated") return null;

  let user: RouteGateUser | null;
  try {
    user = await loader.loadUser(sessionUserId);
  } catch (err) {
    console.error("[route-gate] 取用户失败，fail-closed", err);
    return redirectTo(request, "/tasks");
  }
  if (!user || user.status !== "active") return redirectTo(request, "/login");
  if (user.role === "super_admin") return null;

  let ctx: RouteGateContext;
  try {
    ctx = await loader.loadContext(user);
  } catch (err) {
    console.error("[route-gate] 取判定输入失败，fail-closed", err);
    return redirectTo(request, "/tasks");
  }

  // 原样与解码后的路径都须放行；解码失败按不放行
  const variants = gatePathVariants(pathname);
  const page = variants?.[0] ?? pathname;
  const judged: NavigationFilterContext = { ...ctx, pathname: page };
  if (variants && variants.every((p) => isRouteAllowed(p, { ...ctx, pathname: p }))) return null;
  return redirectTo(request, gateRedirectTarget(page, judged));
}
