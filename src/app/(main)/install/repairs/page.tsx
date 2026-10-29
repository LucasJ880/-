import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import {
  canAccessInstallWorkspace,
  isManagementWorkspaceUser,
} from "@/lib/rbac/workspace-policy";
import { RepairList } from "@/components/install/repair-pages";

/** INSTALL-2d：/install/repairs 维修单列表（接口再按 install.task.read ORG 判定） */
export default async function Page() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  if (!canAccessInstallWorkspace(session.ctx) && !isManagementWorkspaceUser(session.ctx)) {
    redirect("/");
  }
  return <RepairList />;
}
