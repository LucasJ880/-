import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { canAccessOperationsWorkspace } from "@/lib/rbac/workspace-policy";
import { OpsWorkspaceShell } from "@/components/ops/ops-workspace-shell";

export default async function OpsWorkspacePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  if (!canAccessOperationsWorkspace(session.ctx)) {
    redirect("/");
  }

  return <OpsWorkspaceShell />;
}
