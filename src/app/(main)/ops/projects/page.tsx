import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：运营工作区可见性由路由门判定（src/proxy.ts → route-gate），这里只保留未登录跳转
import { DeliveryProjectsList } from "@/components/ops/delivery-projects-list";

export default async function OpsProjectsPage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  return <DeliveryProjectsList />;
}
