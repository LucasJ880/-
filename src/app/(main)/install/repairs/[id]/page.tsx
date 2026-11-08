import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：安装工作区可见性由路由门判定（src/middleware.ts → route-gate），这里只保留未登录跳转
import { RepairDetail } from "@/components/install/repair-pages";

/** INSTALL-2d：维修单详情 /install/repairs/[id]（接口再按 install.task.read ORG 判定） */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  const { id } = await params;
  return <RepairDetail id={id} />;
}
