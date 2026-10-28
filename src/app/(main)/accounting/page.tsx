import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { canAccessAccountingWorkspace } from "@/lib/rbac/workspace-policy";
import { Suspense } from "react";
import { AccountingView } from "@/components/accounting/accounting-view";

/**
 * PERM-5a：会计视图 `/accounting`
 * — 持 accounting.read 或 project.finance.read 可进；其余服务端重定向
 * — 页签按接口权限显示（403 的不显示）：成交与提成 / 报价过程 / 项目结算 / 待收尾款（INSTALL-2b）
 */
export default async function AccountingPage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");
  if (!canAccessAccountingWorkspace(session.ctx)) redirect("/");
  // INSTALL-2b：AccountingView 读 URL 页签（useSearchParams）
  return (
    <Suspense fallback={null}>
      <AccountingView />
    </Suspense>
  );
}
