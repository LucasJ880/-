import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：运营工作区可见性由路由门判定（src/middleware.ts → route-gate），这里只保留未登录跳转
import { DeliveryProjectDetailView } from "@/components/ops/delivery-project-detail";

export default async function OpsProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  const { id } = await params;
  return <DeliveryProjectDetailView projectId={id} />;
}
