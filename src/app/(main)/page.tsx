import { redirect } from "next/navigation";
import { OrgCockpitHome } from "@/components/cockpit/org-cockpit-home";
import { loadPageNavigationContext } from "@/lib/navigation/page-context-server";
import { resolveLandingPage } from "@/lib/navigation/landing";

/**
 * 管理总览 `/` — 岗位视图（组织驾驶舱 A-3）
 * — 仅管理工作区用户可停留
 * — 非管理层服务端重定向到默认工作区（避免客户端先泄露再跳转）
 * — VIS-1b：落地页与路由门同一函数（resolveLandingPage，内沿用 resolveHomeRedirect）、同一份判定输入
 *   （loadPageNavigationContext = session cookie + ROUTE_GATE_LOADER，30 秒缓存）；
 *   管理层一张可见岗位卡都没有时落 /tasks（spec cockpit/home-view）
 */
export default async function HomePage() {
  const ctx = await loadPageNavigationContext();
  if (!ctx) redirect("/login");

  const dest = resolveLandingPage(ctx);
  if (dest !== "/") redirect(dest);

  return <OrgCockpitHome />;
}
