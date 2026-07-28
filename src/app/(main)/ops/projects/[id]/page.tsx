import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { canAccessOperationsWorkspace } from "@/lib/rbac/workspace-policy";
import { DeliveryProjectDetailView } from "@/components/ops/delivery-project-detail";

export default async function OpsProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  if (!canAccessOperationsWorkspace(session.ctx)) {
    redirect("/");
  }

  const { id } = await params;
  return <DeliveryProjectDetailView projectId={id} />;
}
