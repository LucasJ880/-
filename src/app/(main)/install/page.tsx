import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：安装工作区可见性由路由门判定（src/middleware.ts → route-gate），这里只保留未登录跳转
import { InstallTaskList } from "@/components/install/install-task-list";

/**
 * INSTALL-1：安装工作区 `/install`
 * — 持 install.task.read（任一范围）可进；其余由路由门 302（VIS-1a）
 */
export default async function InstallWorkspacePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  return <InstallTaskList />;
}
