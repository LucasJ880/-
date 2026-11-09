/**
 * VIS-1b：路由门的纯判定部分（从 route-gate.ts 拆出；spec navigation/route-gate、navigation/entry-visibility）
 *
 * 不导入 next/server，客户端组件（底栏、站内链接）与服务端（中间件、首页、索引页）共用同一张门表与同一个判定。
 * 门表口径：
 * - 侧栏入口：路由对应的导航项连同全部父项在侧栏可见 ⇔ 放行；
 * - 无侧栏入口：指向 registry.ts 的 ROUTE_ONLY_NAV_ITEMS（只做门、不渲染）；
 * - 登录即可：login_only；
 * - 门表之外：不放行（fail-closed）。
 */

import { isNavItemVisible } from "./filter";
import { NAVIGATION_REGISTRY, ROUTE_ONLY_NAV_ITEMS, SYSTEM_NAV_ITEMS } from "./registry";
import type { NavigationFilterContext, NavigationItem } from "./types";

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
  // PROC-1：资料申请台账 / 申请详情属于「采购情报」（与候选项目、设置同一入口）
  { pattern: "/projects/intelligence/records", rule: nav("nav-intel-monitor") },
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

/** 路径按段拆分（去查询串与空段）；落地页与请求处理共用 */
export function splitPath(pathname: string): string[] {
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

/** 导航入口（连父链）对判定输入可见——与侧栏同一个 isNavItemVisible（VIS-1b：workforce 可读域按入口判定） */
export function navEntryVisible(key: string, ctx: NavigationFilterContext): boolean {
  return navChainVisible(key, ctx);
}

/** 该路径对当前判定输入是否放行（不含 super_admin 旁路，旁路在请求处理函数里） */
export function isRouteAllowed(pathname: string, ctx: NavigationFilterContext): boolean {
  const entry = matchRouteGateEntry(pathname);
  if (!entry) return false;
  const rule = entry.rule;
  if (rule.kind === "login_only") return true;
  if (rule.allowWithoutMembership && !ctx.hasMembership) return true;
  const c: NavigationFilterContext = { ...ctx, pathname };
  // 项目成员：仍要求企业启用 bids / projects 模块（route-project-member 只带模块与成员身份条件）
  if (rule.allowProjectMember && ctx.hasBidCapability && navChainVisible("route-project-member", c)) return true;
  return rule.navKeys.some((k) => navChainVisible(k, c));
}

// ─────────────────────────────── 路径变体 ───────────────────────────────

/**
 * 框架内部的 RSC / 预取路径变体还原为页面路径（Vercel 可能把 `/x.rsc`、`/x.prefetch.rsc`、`/x.segments/…`
 * 交给中间件；按页面路径判定，避免被当成静态文件放过）。
 */
export function rscPagePath(pathname: string): string {
  let p = pathname;
  const seg = p.indexOf(".segments/");
  if (seg >= 0) p = p.slice(0, seg);
  else if (p.endsWith(".segments")) p = p.slice(0, -".segments".length);
  if (p.endsWith(".rsc")) p = p.slice(0, -".rsc".length);
  if (p.endsWith(".prefetch")) p = p.slice(0, -".prefetch".length);
  if (p !== pathname && (p === "/index" || p === "")) return "/";
  return p;
}

/**
 * 判定要看的路径：还原 RSC 变体后的原样路径，以及解码一次后的路径（Next 生产环境按解码后的路径查静态路由，
 * 编码过的段不能绕过门表）。解码失败返回 null（按不放行处理）。
 */
export function gatePathVariants(pathname: string): string[] | null {
  const raw = rscPagePath(pathname);
  let decoded: string;
  try {
    decoded = rscPagePath(decodeURIComponent(raw));
  } catch {
    return null;
  }
  return decoded === raw ? [raw] : [raw, decoded];
}
