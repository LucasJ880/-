/**
 * VIS-1b：岗位卡可见、落地页与路由门的 302 目标（spec cockpit/post-registry「岗位卡片的可见条件」、
 * navigation/route-gate「不放行时 302 到落地页」；design D1 / D3）
 *
 * 纯模块（不导入 next/server），首页、岗位总览、路由门与客户端钩子共用：
 * - 岗位卡可见 ⇔ 跳转页经路由门放行（平台 super_admin 视为放行）；「客服」另要求微信入口开关；
 * - 落地页：非管理层按既有首页落地规则；管理层有可见卡为 `/`，零卡为 `/tasks`——首页与路由门一次跳到位。
 */

import { POST_REGISTRY, type PostRegistryEntry } from "@/lib/cockpit/posts";
import { resolveHomeRedirect, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";
import { isRouteAllowed, splitPath } from "./route-gate-core";
import type { RouteGateContext } from "./filter-context";

export function isPostVisible(post: PostRegistryEntry, ctx: RouteGateContext): boolean {
  if ("requiresWechatEntry" in post && post.requiresWechatEntry && ctx.wechatEntryEnabled !== true) return false;
  if (ctx.isPlatformAdmin) return true;
  return isRouteAllowed(post.nav, { ...ctx, pathname: post.nav });
}

/** 可见岗位，按注册表顺序 */
export function visiblePosts(ctx: RouteGateContext): PostRegistryEntry[] {
  return POST_REGISTRY.filter((post) => isPostVisible(post, ctx));
}

/** 进入首页后最终停留的页面 */
export function resolveLandingPage(ctx: RouteGateContext): string {
  const dest = resolveHomeRedirect(workspaceContextFromNav(ctx));
  if (dest) return dest;
  return visiblePosts(ctx).length > 0 ? "/" : "/tasks";
}

/** 不放行时的目标：落地页；落地页不放行或与请求同路径时落 /tasks */
export function gateRedirectTarget(pathname: string, ctx: RouteGateContext): string {
  const target = resolveLandingPage(ctx);
  const same = splitPath(target).join("/") === splitPath(pathname).join("/");
  if (same || !isRouteAllowed(target, { ...ctx, pathname: target })) return "/tasks";
  return target;
}

/**
 * 入口判定（spec navigation/entry-visibility「入口判定与路由门同源」）：输入未就绪一律 false；平台 super_admin 一律 true；
 * 其余按路由门门表判定 href 的路径部分（去查询串与锚点）。
 */
export function canOpenHref(href: string, ctx: RouteGateContext | null): boolean {
  if (!ctx) return false;
  if (ctx.isPlatformAdmin) return true;
  const path = href.split(/[?#]/)[0] || "/";
  return isRouteAllowed(path, { ...ctx, pathname: path });
}
