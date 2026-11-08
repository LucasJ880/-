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
 */

import { NextResponse, type NextRequest } from "next/server";
import { isNavItemVisible } from "./filter";
import { NAVIGATION_REGISTRY, ROUTE_ONLY_NAV_ITEMS, SYSTEM_NAV_ITEMS } from "./registry";
import type { NavigationFilterContext, NavigationItem } from "./types";
import { resolveHomeRedirect, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";

// ─────────────────────────────── 门表 ───────────────────────────────

export type RouteGateRule =
  | { kind: "login_only" }
  | {
      kind: "nav";
      /** 任一导航项（连父链）可见即放行 */
      navKeys: readonly string[];
      /** 当前企业内有 active 项目成员关系也放行（仅 /projects/*；项目内可见性由接口按项目判定） */
      allowProjectMember?: true;
      /** 当前企业无 active 成员身份也放行（仅 /organizations 列表：「前往组织」） */
      allowWithoutMembership?: true;
    };

export type RouteGateEntry = {
  /** 按段匹配：`*` 匹配一段；结尾 `=` 只匹配本路径；否则匹配本路径及其子路径 */
  pattern: string;
  rule: RouteGateRule;
};

const LOGIN_ONLY: RouteGateRule = { kind: "login_only" };
const nav = (...navKeys: string[]): RouteGateRule => ({ kind: "nav", navKeys });

/** 项目的平台管理员子页（与既有 PlatformAdminGate 同口径；单独登记，避免被 /projects/* 放宽） */
const PROJECT_PLATFORM_ADMIN_SUBPAGES = [
  "agents",
  "prompts",
  "tools",
  "knowledge-bases",
  "feedbacks",
  "feedback-tags",
  "quality",
] as const;

export const ROUTE_GATE_TABLE: readonly RouteGateEntry[] = [
  // ── 登录即可（spec「登录即可的路由」）──
  { pattern: "/=", rule: LOGIN_ONLY },
  { pattern: "/tasks", rule: LOGIN_ONLY },
  { pattern: "/notifications", rule: LOGIN_ONLY },
  { pattern: "/help", rule: LOGIN_ONLY },
  { pattern: "/settings=", rule: LOGIN_ONLY },
  { pattern: "/settings/account", rule: LOGIN_ONLY },
  { pattern: "/settings/appearance", rule: LOGIN_ONLY },
  { pattern: "/settings/notifications", rule: LOGIN_ONLY },
  // 微信两页：开关关闭时由 COLLAB-1 整页替换为「暂未开放」（spec identity/wechat-entry）
  { pattern: "/settings/wechat", rule: LOGIN_ONLY },
  { pattern: "/wechat", rule: LOGIN_ONLY },

  // ── 设置 ──
  { pattern: "/settings/email", rule: nav("route-email-settings") },
  { pattern: "/settings/digital-employees", rule: nav("route-platform-admin") },
  { pattern: "/settings/agent-skills", rule: nav("route-platform-admin") },

  // ── 工作台 ──
  { pattern: "/assistant", rule: nav("work-assistant") },
  { pattern: "/inbox", rule: nav("work-assistant") },
  { pattern: "/workforce", rule: nav("work-ai-jobs") },
  { pattern: "/service-inbox", rule: nav("work-inbox") },
  { pattern: "/ops=", rule: nav("ws-ops") },
  { pattern: "/ops/projects", rule: nav("ws-ops-projects") },
  { pattern: "/install", rule: nav("ws-install") },
  { pattern: "/bids", rule: nav("ws-bids") },
  { pattern: "/accounting", rule: nav("biz-accounting") },

  // ── AI 工作中心 ──
  { pattern: "/capabilities=", rule: nav("cap-overview") },
  { pattern: "/capabilities/catalog", rule: nav("cap-catalog") },
  { pattern: "/capabilities/runs", rule: nav("cap-runs") },
  { pattern: "/capabilities/approvals", rule: nav("route-approvals") },
  { pattern: "/capabilities/governance", rule: nav("cap-governance") },
  { pattern: "/capabilities/config-health", rule: nav("cap-health") },
  { pattern: "/capabilities/health", rule: nav("cap-health") },
  { pattern: "/ai/autopilot", rule: nav("autopilot") },

  // ── 销售 ──
  { pattern: "/sales=", rule: nav("sales-crm") },
  { pattern: "/sales/home", rule: nav("sales-home") },
  { pattern: "/sales/customers", rule: nav("route-sales-customer-detail") },
  { pattern: "/sales/inquiries", rule: nav("sales-crm") },
  { pattern: "/sales/visualizer", rule: nav("sales-crm") },
  { pattern: "/sales/knowledge", rule: nav("sales-crm") },
  { pattern: "/sales/website-bookings", rule: nav("route-website-bookings") },
  { pattern: "/sales/measure", rule: nav("biz-quotes") },
  { pattern: "/sales/quote-sheet", rule: nav("biz-quotes") },
  { pattern: "/sales/quotes", rule: nav("biz-all-quotes") },
  { pattern: "/sales/performance", rule: nav("sales-performance") },
  { pattern: "/sales/calendar", rule: nav("work-calendar", "route-install-calendar") },
  { pattern: "/sales/cockpit", rule: nav("biz-cockpit") },
  { pattern: "/sales/analytics", rule: nav("route-sales-analytics") },

  // ── 工艺单 / 库存 ──
  { pattern: "/blinds-orders=", rule: nav("biz-work-orders") },
  { pattern: "/blinds-orders/new", rule: nav("biz-work-orders") },
  { pattern: "/blinds-orders/zebra-ratios", rule: nav("biz-work-orders") },
  { pattern: "/blinds-orders/*", rule: nav("route-blinds-order-detail") },
  { pattern: "/inventory", rule: nav("biz-inventory") },

  // ── 外贸 / 营收（模块 trade）──
  { pattern: "/trade", rule: nav("biz-trade") },
  { pattern: "/trade/inbox", rule: nav("biz-inbox") },
  { pattern: "/trade/prospects", rule: nav("biz-prospects") },
  { pattern: "/trade/quotes", rule: nav("biz-trade-quotes") },
  { pattern: "/trade/samples", rule: nav("biz-trade-samples") },
  { pattern: "/trade/products", rule: nav("biz-trade-products") },
  { pattern: "/trade/chat", rule: nav("biz-trade-chat") },
  { pattern: "/trade/intelligence", rule: nav("biz-trade-intel") },
  { pattern: "/trade/fulfillment", rule: nav("biz-fulfillment") },
  { pattern: "/trade/import", rule: nav("biz-trade-import") },
  { pattern: "/trade/signals", rule: nav("biz-signals") },
  { pattern: "/trade/channels", rule: nav("biz-channels") },
  { pattern: "/revenue", rule: nav("biz-revenue") },
  { pattern: "/revenue/today", rule: nav("biz-revenue-today") },

  // ── 项目 / 项目情报 / 供应商 ──
  { pattern: "/projects=", rule: nav("nav-projects") },
  { pattern: "/projects/*", rule: { kind: "nav", navKeys: ["route-project-detail"], allowProjectMember: true } },
  ...PROJECT_PLATFORM_ADMIN_SUBPAGES.map(
    (sub): RouteGateEntry => ({ pattern: `/projects/*/${sub}`, rule: nav("route-platform-admin") }),
  ),
  { pattern: "/projects/intelligence", rule: nav("nav-project-intel") },
  { pattern: "/projects/intelligence/awards", rule: nav("nav-intel-awards") },
  { pattern: "/projects/intelligence/competitors", rule: nav("nav-intel-competitors") },
  { pattern: "/projects/intelligence/agencies", rule: nav("nav-intel-agencies") },
  { pattern: "/projects/intelligence/supply-chain", rule: nav("nav-intel-supply") },
  { pattern: "/projects/intelligence/monitor", rule: nav("nav-intel-monitor") },
  { pattern: "/suppliers", rule: nav("nav-suppliers") },

  // ── 品牌增长 / 内容运营 ──
  { pattern: "/marketing", rule: nav("growth-hub") },
  { pattern: "/operations=", rule: nav("growth-content") },
  { pattern: "/operations/growth", rule: nav("growth-hub") },
  { pattern: "/operations/assets", rule: nav("growth-content") },
  { pattern: "/operations/brand", rule: nav("growth-content") },
  { pattern: "/operations/calendar", rule: nav("growth-content") },
  { pattern: "/operations/dashboard", rule: nav("growth-content") },
  { pattern: "/operations/matrix", rule: nav("growth-content") },
  { pattern: "/operations/review", rule: nav("growth-content") },
  { pattern: "/operations/intelligence", rule: nav("growth-intel") },
  { pattern: "/operations/center", rule: nav("ops-center") },
  { pattern: "/operations/tender-profile", rule: nav("ws-bids") },
  { pattern: "/product-content", rule: nav("growth-product-content") },
  { pattern: "/reports", rule: nav("growth-reports") },

  // ── 企业管理 ──
  {
    pattern: "/organizations=",
    rule: { kind: "nav", navKeys: ["mgmt-orgs"], allowWithoutMembership: true },
  },
  { pattern: "/organizations", rule: nav("mgmt-orgs") },
  { pattern: "/knowledge", rule: nav("mgmt-knowledge") },
  { pattern: "/memory", rule: nav("mgmt-memory") },

  // ── 平台 ──
  { pattern: "/admin/users", rule: nav("plat-users") },
  { pattern: "/admin/invite-codes", rule: nav("plat-invites") },
  { pattern: "/admin/onboarding", rule: nav("plat-onboarding") },
  { pattern: "/admin/audit-logs", rule: nav("plat-audit") },
  { pattern: "/admin/project-intake", rule: nav("plat-intake") },
  { pattern: "/agent-trace", rule: nav("route-platform-admin") },
  { pattern: "/ai-activity", rule: nav("route-platform-admin") },
];

type CompiledEntry = { entry: RouteGateEntry; segs: string[]; exact: boolean };

function splitPath(pathname: string): string[] {
  return pathname.split("?")[0].split("/").filter(Boolean);
}

const COMPILED: CompiledEntry[] = ROUTE_GATE_TABLE.map((entry) => {
  const exact = entry.pattern.endsWith("=");
  const base = exact ? entry.pattern.slice(0, -1) : entry.pattern;
  return { entry, segs: splitPath(base), exact: exact || base === "/" };
});

/** 门表里出现的一级路径（= 已登录区一级目录；public/ 一级名不得与之重名，测试断言） */
export const GATED_TOP_SEGMENTS: ReadonlySet<string> = new Set(
  COMPILED.map((c) => c.segs[0]).filter((s): s is string => Boolean(s)),
);

/** 最具体的条目：字面段 2 分、`*` 1 分，同分时精确条目优先；未命中返回 null */
export function matchRouteGateEntry(pathname: string): RouteGateEntry | null {
  const segs = splitPath(pathname);
  let best: RouteGateEntry | null = null;
  let bestScore = -1;
  for (const c of COMPILED) {
    if (c.segs.length > segs.length) continue;
    if (c.exact && c.segs.length !== segs.length) continue;
    let score = 0;
    let matched = true;
    for (let i = 0; i < c.segs.length; i++) {
      if (c.segs[i] === "*") score += 1;
      else if (c.segs[i] === segs[i]) score += 2;
      else {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const ranked = score * 2 + (c.exact ? 1 : 0);
    if (ranked > bestScore) {
      best = c.entry;
      bestScore = ranked;
    }
  }
  return best;
}

// ─────────────────────────────── 判定 ───────────────────────────────

/** 导航项 key → 自身及全部父项（侧栏里子项可见要求父项可见） */
const NAV_CHAINS: ReadonlyMap<string, readonly NavigationItem[]> = (() => {
  const out = new Map<string, NavigationItem[]>();
  const walk = (items: NavigationItem[], chain: NavigationItem[]) => {
    for (const item of items) {
      const next = [...chain, item];
      out.set(item.key, next);
      if (item.children?.length) walk(item.children, next);
    }
  };
  walk([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS, ...ROUTE_ONLY_NAV_ITEMS], []);
  return out;
})();

export function routeGateNavKeyExists(key: string): boolean {
  return NAV_CHAINS.has(key);
}

function navChainVisible(key: string, ctx: NavigationFilterContext): boolean {
  const chain = NAV_CHAINS.get(key);
  if (!chain) return false;
  return chain.every((item) => isNavItemVisible(item, ctx));
}

/** 该路径对当前判定输入是否放行（不含 super_admin 旁路，旁路在请求处理函数里） */
export function isRouteAllowed(pathname: string, ctx: NavigationFilterContext): boolean {
  const entry = matchRouteGateEntry(pathname);
  if (!entry) return false;
  const rule = entry.rule;
  if (rule.kind === "login_only") return true;
  if (rule.allowWithoutMembership && !ctx.hasMembership) return true;
  if (rule.allowProjectMember && ctx.hasMembership && ctx.hasBidCapability) return true;
  const c: NavigationFilterContext = { ...ctx, pathname };
  return rule.navKeys.some((k) => navChainVisible(k, c));
}

/** 不放行时的目标：进入首页后最终停留的页面；目标不放行或与请求同路径时落 /tasks */
export function gateRedirectTarget(pathname: string, ctx: NavigationFilterContext): string {
  const target = resolveHomeRedirect(workspaceContextFromNav(ctx)) ?? "/";
  const same = splitPath(target).join("/") === splitPath(pathname).join("/");
  if (same || !isRouteAllowed(target, ctx)) return "/tasks";
  return target;
}

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

/** public/ 图片：在登录检查之前放行（与改动前 matcher 排除图片一致） */
export function isStaticImagePath(pathname: string): boolean {
  return isStaticFilePath(pathname) && IMAGE_EXTENSION.test(pathname);
}

export type RouteRequestKind = "api" | "static_file" | "outside" | "login_only" | "gated";

function underAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** 已登录请求的分类（中间件免登录路径在此之前已放行） */
export function classifyPageRequest(pathname: string): RouteRequestKind {
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

export type RouteGateContext = Omit<NavigationFilterContext, "pathname" | "search">;

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

  const decision = resolveRouteGate(pathname, { ...ctx, pathname });
  return decision.allowed ? null : redirectTo(request, decision.redirect);
}
