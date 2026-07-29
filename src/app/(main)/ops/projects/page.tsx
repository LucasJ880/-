import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { canAccessOperationsWorkspace } from "@/lib/rbac/workspace-policy";
import { DeliveryProjectsList } from "@/components/ops/delivery-projects-list";

export default async function OpsProjectsPage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  if (!canAccessOperationsWorkspace(session.ctx)) {
    redirect("/");
  }

  return <DeliveryProjectsList />;
}
