/**
 * VIS-1b：手机底栏页签（spec navigation/position-based-visibility「岗位模式的底栏」「手机底栏的招投标入口与招投标中心同口径」；
 * design D8）——纯函数，组件只负责图标与渲染。
 *
 * 布局判定不变：岗位模式按默认落地（落 /sales/home 用销售布局），旧模式按平台角色 sales。
 * 每个页签另要求目标经路由门放行（canOpenHref，与侧栏同一判定输入；平台 super_admin 一律放行）。
 */

import { getDefaultWorkspace, workspaceContextFromNav } from "@/lib/rbac/workspace-policy";
import type { RouteGateContext } from "./filter-context";
import { canOpenHref, resolveLandingPage } from "./landing";

export type MobileTabKey =
  | "sales-home"
  | "sales-customers"
  | "sales-quotes"
  | "sales-calendar"
  | "install"
  | "ops"
  | "bids"
  | "overview"
  | "tasks"
  | "accounting"
  | "ai"
  | "assistant";

export type MobileTab = {
  key: MobileTabKey;
  href: string;
  label: string;
  /** 销售布局：新增按钮左侧 / 右侧 */
  slot?: "left" | "right";
};

export type MobileTabLayout = { layout: "sales" | "general"; tabs: MobileTab[] };

/** 通用布局最多显示的页签数（第 5 格是「更多」） */
export const MOBILE_GENERAL_TAB_LIMIT = 4;

export function isSalesTabLayout(ctx: RouteGateContext): boolean {
  const wsCtx = workspaceContextFromNav(ctx);
  // PERM-4c2：岗位模式下销售底栏 = 默认落地为销售首页；旧模式按平台角色 sales
  return ctx.positionMode ? getDefaultWorkspace(wsCtx) === "/sales/home" : ctx.platformRole === "sales";
}

/**
 * VIS-1c：通用布局首格（默认工作区不是安装 / 运营 / 招投标时）指向落地页（spec navigation/entry-visibility「底栏首格指向落地页」）：
 * 落地页为 /tasks →「任务」，为 /accounting →「会计」，其余仍为「总览」→ /。两种模式相同。
 */
function firstCellForLanding(landing: string): MobileTab {
  if (landing === "/tasks") return { key: "tasks", href: "/tasks", label: "任务" };
  if (landing === "/accounting") return { key: "accounting", href: "/accounting", label: "会计" };
  return { key: "overview", href: "/", label: "总览" };
}

export function computeMobileTabs(ctx: RouteGateContext): MobileTabLayout {
  const open = (tab: MobileTab) => canOpenHref(tab.href, ctx);

  if (isSalesTabLayout(ctx)) {
    const tabs: MobileTab[] = [
      { key: "sales-home", href: "/sales/home", label: "首页", slot: "left" },
      { key: "sales-customers", href: "/sales?view=customers", label: "客户", slot: "left" },
      { key: "sales-quotes", href: "/sales/quote-sheet", label: "报价", slot: "right" },
      { key: "sales-calendar", href: "/sales/calendar", label: "日历", slot: "right" },
    ];
    return { layout: "sales", tabs: tabs.filter(open) };
  }

  const defaultHref = getDefaultWorkspace(workspaceContextFromNav(ctx));
  const candidates: MobileTab[] = [];
  if (defaultHref === "/install") candidates.push({ key: "install", href: "/install", label: "安装" });
  else if (defaultHref === "/ops") candidates.push({ key: "ops", href: "/ops", label: "运营" });
  else if (defaultHref === "/bids") candidates.push({ key: "bids", href: "/bids", label: "招投标" });
  else candidates.push(firstCellForLanding(resolveLandingPage(ctx)));

  if (defaultHref !== "/ops") candidates.push({ key: "ops", href: "/ops", label: "运营" });
  // 「招投标」与侧栏「招投标中心」同口径：/bids 的门规则就是 ws-bids
  if (defaultHref !== "/bids") candidates.push({ key: "bids", href: "/bids", label: "招投标" });
  if (defaultHref !== "/install") candidates.push({ key: "install", href: "/install", label: "安装" });
  // 「AI」只给默认落地在总览的人（布局判定不变），且 AI 工作中心放行
  if (defaultHref === "/") candidates.push({ key: "ai", href: "/capabilities", label: "AI" });
  candidates.push({ key: "assistant", href: "/assistant", label: "助手" });

  return { layout: "general", tabs: candidates.filter(open).slice(0, MOBILE_GENERAL_TAB_LIMIT) };
}
