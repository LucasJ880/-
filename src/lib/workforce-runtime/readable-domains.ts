/**
 * VIS-1b：workforce 作业按「工作域 → 导航入口」判定可读（spec agents/workforce-job-scope；design D5 / D6）
 *
 * 纯模块（不连库、不导入 next/server）：
 * - 投标域：侧栏「招投标中心」（ws-bids）可见；
 * - 交付域：「运营中心」（ws-ops）或「项目列表」（nav-projects）任一可见；
 * - 销售域：「销售首页」（sales-home）或「外贸」（biz-trade）任一可见；
 * - 通用域与解析不出工作域：只对管理层；
 * - 平台 super_admin：全部可读。
 * 工作域本身沿用既有解析（work-domain.ts 的 resolveEffectiveWorkDomain），由调用方注入，这里不改解析规则。
 */

import { navEntryVisible } from "@/lib/navigation/route-gate-core";
import type { RouteGateContext } from "@/lib/navigation/filter-context";
import { isManagementWorkspaceUser, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";
import type { WorkDomain } from "./work-domain";

/** 工作域 → 使其可读的导航入口（任一可见即可读）；通用域不在表里（只对管理层） */
export const WORK_DOMAIN_NAV_ENTRIES: Readonly<Record<Exclude<WorkDomain, "general">, readonly string[]>> = {
  tender: ["ws-bids"],
  delivery: ["ws-ops", "nav-projects"],
  sales: ["sales-home", "biz-trade"],
};

const KNOWN_DOMAINS: readonly WorkDomain[] = ["tender", "delivery", "sales", "general"];

/** 与 work-domain.ts 的 normalizeWorkDomain 同口径（只认已知域字面量），但不连库，供纯模块（等你拍板）用 */
export function asWorkDomain(value: unknown): WorkDomain | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (KNOWN_DOMAINS as readonly string[]).includes(v) ? (v as WorkDomain) : null;
}

/** 读不出工作域的作业，在可读集合里用这个记号 */
export const UNRESOLVED_WORK_DOMAIN = "unresolved" as const;
export type ReadableWorkDomain = WorkDomain | typeof UNRESOLVED_WORK_DOMAIN;

function isManagement(ctx: RouteGateContext): boolean {
  return isManagementWorkspaceUser(workspaceContextFromNav(ctx));
}

/** 某工作域（null = 解析不出）对判定输入是否可读 */
/**
 * VIS-1c：只凭显式工作域（metadata.workDomain）判定作业可读，不逐条解析（首页时间线用）：
 * 有显式工作域按它判定；没有的（旧作业）只对可读全部工作域的人放行（否则详情页按有效工作域解析可能 404）。
 */
export function canReadJobByExplicitDomain(explicitDomain: unknown, ctx: RouteGateContext): boolean {
  const domain = asWorkDomain(explicitDomain);
  return domain ? canReadWorkDomain(domain, ctx) : readsEveryWorkDomain(ctx);
}

export function canReadWorkDomain(domain: WorkDomain | null, ctx: RouteGateContext): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (domain === null || domain === "general") return isManagement(ctx);
  const at = { ...ctx, pathname: "/workforce" };
  return WORK_DOMAIN_NAV_ENTRIES[domain].some((key) => navEntryVisible(key, at));
}

/** 判定输入可读的工作域集合（含「解析不出」）；测试与「AI 任务」入口等价断言用 */
export function readableWorkDomains(ctx: RouteGateContext): ReadableWorkDomain[] {
  const out: ReadableWorkDomain[] = [];
  for (const d of ["tender", "delivery", "sales", "general"] as const) {
    if (canReadWorkDomain(d, ctx)) out.push(d);
  }
  if (canReadWorkDomain(null, ctx)) out.push(UNRESOLVED_WORK_DOMAIN);
  return out;
}

/** 可读全部工作域（含解析不出）：调用方可跳过逐条解析 */
export function readsEveryWorkDomain(ctx: RouteGateContext): boolean {
  return ctx.isPlatformAdmin || readableWorkDomains(ctx).length === 5;
}

/** 作业行（AgentRun）的最小形状：解析工作域需要的字段 */
export type WorkforceRunForScope = {
  id: string;
  orgId: string;
  metadata: unknown;
};

/** 工作域解析器（生产用 resolveEffectiveWorkDomain；测试注入） */
export type WorkDomainResolver = (run: WorkforceRunForScope) => Promise<WorkDomain | null>;

/** 作业可读判定：先解析工作域，再按对照表判定；super_admin 不解析直接放行 */
export function createWorkforceJobReadFilter(
  ctx: RouteGateContext,
  resolveDomain: WorkDomainResolver,
): (run: WorkforceRunForScope) => Promise<boolean> {
  return async (run) => {
    if (ctx.isPlatformAdmin) return true;
    let domain: WorkDomain | null;
    try {
      domain = await resolveDomain(run);
    } catch {
      domain = null;
    }
    return canReadWorkDomain(domain, ctx);
  };
}
