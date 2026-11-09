import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
// VIS-1a：安装工作区可见性由路由门判定（src/proxy.ts → route-gate），这里只保留未登录跳转
import { Suspense } from "react";
import { RepairList } from "@/components/install/repair-pages";

/** INSTALL-2d：/install/repairs 维修单列表（接口再按 install.task.read ORG 判定）；INSTALL-2i：栏 / 搜索 / 页码在地址里（useSearchParams） */
export default async function Page() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  return (
    <Suspense fallback={null}>
      <RepairList />
    </Suspense>
  );
}
