import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import {
  canAccessInstallWorkspace,
  isManagementWorkspaceUser,
} from "@/lib/rbac/workspace-policy";
import { InstallTaskList } from "@/components/install/install-task-list";

/**
 * INSTALL-1：安装工作区 `/install`
 * — 持 install.task.read（任一范围）或管理层可进；其余服务端重定向
 */
export default async function InstallWorkspacePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  if (!canAccessInstallWorkspace(session.ctx) && !isManagementWorkspaceUser(session.ctx)) {
    redirect("/");
  }
  return <InstallTaskList />;
}
