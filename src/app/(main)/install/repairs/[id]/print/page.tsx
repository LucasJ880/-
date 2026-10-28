import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import {
  canAccessInstallWorkspace,
  isManagementWorkspaceUser,
} from "@/lib/rbac/workspace-policy";
import { RepairPrint } from "@/components/install/repair-pages";

/** INSTALL-2d：维修单打印版 /install/repairs/[id]/print（接口再按 install.task.read ORG 判定） */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  if (!canAccessInstallWorkspace(session.ctx) && !isManagementWorkspaceUser(session.ctx)) {
    redirect("/");
  }
  const { id } = await params;
  return <RepairPrint id={id} />;
}
