import { redirect } from "next/navigation";
import { OrgCockpitHome } from "@/components/cockpit/org-cockpit-home";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { ROUTE_GATE_LOADER } from "@/lib/navigation/context-server";
import { resolveLandingPage } from "@/lib/navigation/landing";

/**
 * 管理总览 `/` — 岗位视图（组织驾驶舱 A-3）
 * — 仅管理工作区用户可停留
 * — 非管理层服务端重定向到默认工作区（避免客户端先泄露再跳转）
 * — VIS-1b：落地页与路由门同一函数（resolveLandingPage，内沿用 resolveHomeRedirect）、同一份判定输入
 *   （ROUTE_GATE_LOADER，30 秒缓存）；管理层一张可见岗位卡都没有时落 /tasks（spec cockpit/home-view）
 */
export default async function HomePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  const user = await ROUTE_GATE_LOADER.loadUser(session.userId);
  if (!user || user.status !== "active") redirect("/login");
  const ctx = await ROUTE_GATE_LOADER.loadContext(user);

  const dest = resolveLandingPage(ctx);
  if (dest !== "/") redirect(dest);

  return <OrgCockpitHome />;
}
