import type { ReactNode } from "react";
import { guardMarketingWorkspacePage } from "@/lib/marketing/workspace-gate";

/** PERM-4c5：营销工作区服务端门槛（岗位模式企业按岗位拦销售） */
export default async function MarketingWorkspaceLayout({ children }: { children: ReactNode }) {
  await guardMarketingWorkspacePage();
  return children;
}
