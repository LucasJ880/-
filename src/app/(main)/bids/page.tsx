import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { BidsWorkspaceShell } from "@/components/bids/bids-workspace-shell";

// VIS-1a：工作区可见性由路由门判定（src/proxy.ts → route-gate），这里只保留未登录跳转
export default async function BidsWorkspacePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  return <BidsWorkspaceShell />;
}
