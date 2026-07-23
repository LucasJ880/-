"use client";

/**
 * Security-1：侧栏企业身份只读展示（无下拉切换）
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { useOrganizations, type OrgSummary } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { orgRoleLabel } from "@/lib/permissions-client";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export function OrgIdentityBadge({
  collapsed,
  organizations,
  compact,
  workspaceLabel,
}: {
  collapsed?: boolean;
  organizations?: OrgSummary[];
  compact?: boolean;
  /** 可选：当前 Workspace 名称 */
  workspaceLabel?: string | null;
}) {
  const { organizations: orgHook } = useOrganizations();
  const orgs = organizations ?? orgHook;
  const pathname = usePathname();

  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );
  const currentOrg =
    orgs.find((o) => o.id === storedOrgId) ??
    orgs.find(
      (o) => o.id === pathname.match(/\/organizations\/([^/]+)/)?.[1],
    ) ??
    orgs[0];

  if (!currentOrg) return null;

  const subtitle = [
    currentOrg.myRole ? orgRoleLabel(currentOrg.myRole) : null,
    workspaceLabel?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("relative", compact ? "px-2 pb-2" : "px-2 pb-1")}>
      <Link
        href="/"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-sidebar-hover",
          collapsed && "justify-center",
        )}
        title={`${currentOrg.name}（当前企业，点击回首页）`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgba(43,96,85,0.25)] text-xs font-bold text-emerald-200">
          {currentOrg.name[0]?.toUpperCase()}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-xs font-medium text-white/90",
                compact
                  ? "break-words leading-snug [overflow-wrap:anywhere] line-clamp-2"
                  : "truncate",
              )}
            >
              青砚 × {currentOrg.name}
            </p>
            <p
              className={cn(
                "text-[10px] text-white/40",
                compact
                  ? "break-words [overflow-wrap:anywhere] line-clamp-2"
                  : "truncate",
              )}
            >
              {subtitle || "当前企业"}
            </p>
          </div>
        )}
      </Link>
    </div>
  );
}
