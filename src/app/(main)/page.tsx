import { redirect } from "next/navigation";
import { ManagementDashboardClient } from "@/components/dashboard/management-dashboard-client";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { resolveHomeRedirect } from "@/lib/rbac/workspace-policy";

/**
 * 管理总览 `/`
 * — 仅管理工作区用户可停留
 * — 非管理层服务端重定向到默认工作区（避免客户端先泄露再跳转）
 */
export default async function HomePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  const dest = resolveHomeRedirect(session.ctx);
  if (dest) redirect(dest);

  return <ManagementDashboardClient />;
}
