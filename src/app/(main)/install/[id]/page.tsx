import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import {
  canAccessInstallWorkspace,
  isManagementWorkspaceUser,
} from "@/lib/rbac/workspace-policy";
import { InstallTaskDetail } from "@/components/install/install-task-detail";

/** INSTALL-1：安装任务页 `/install/[id]`（逐窗拍照收口） */
export default async function InstallTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  if (!canAccessInstallWorkspace(session.ctx) && !isManagementWorkspaceUser(session.ctx)) {
    redirect("/");
  }
  const { id } = await params;
  return <InstallTaskDetail id={id} />;
}
