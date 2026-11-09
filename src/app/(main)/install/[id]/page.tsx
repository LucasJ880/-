import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：安装工作区可见性由路由门判定（src/proxy.ts → route-gate），这里只保留未登录跳转
import { InstallTaskDetail } from "@/components/install/install-task-detail";

/** INSTALL-1：安装任务页 `/install/[id]`（逐窗拍照收口） */
export default async function InstallTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  const { id } = await params;
  return <InstallTaskDetail id={id} />;
}
