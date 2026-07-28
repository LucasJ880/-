import { redirect } from "next/navigation";
import { resolveWorkspaceContextFromCookies } from "@/lib/rbac/resolve-workspace-context";
import { canAccessBidWorkspace } from "@/lib/rbac/workspace-policy";
import { BidsWorkspaceShell } from "@/components/bids/bids-workspace-shell";

export default async function BidsWorkspacePage() {
  const session = await resolveWorkspaceContextFromCookies();
  if (!session) redirect("/login");

  if (!canAccessBidWorkspace(session.ctx)) {
    redirect("/");
  }

  return <BidsWorkspaceShell />;
}
