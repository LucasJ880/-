"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { useOrganizations, type OrgSummary } from "@/lib/hooks/use-organizations";
import {
  readStoredOrgId,
  selectActiveOrganization,
} from "@/lib/org-selection";
import { orgRoleLabel } from "@/lib/permissions-client";
import { useLocale } from "@/lib/i18n/context";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export function OrgSwitcher({
  collapsed,
  organizations,
  compact,
}: {
  collapsed?: boolean;
  organizations?: OrgSummary[];
  /** 移动抽屉内更紧凑 */
  compact?: boolean;
}) {
  const { m } = useLocale();
  const { organizations: orgHook } = useOrganizations();
  const orgs = organizations ?? orgHook;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
    );
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (orgs.length === 0) return null;

  const displayOrg = currentOrg ?? orgs[0];

  async function switchOrg(orgId: string) {
    if (orgId === displayOrg.id) {
      setOpen(false);
      return;
    }
    setSwitchingId(orgId);
    const r = await selectActiveOrganization(orgId);
    if (!r.ok) {
      setSwitchingId(null);
      alert(r.error || "切换组织失败");
      return;
    }
    setOpen(false);
    window.location.assign("/");
  }

  return (
    <div ref={ref} className={cn("relative", compact ? "px-2 pb-2" : "px-2 pb-1")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-sidebar-hover",
          collapsed && "justify-center",
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgba(43,96,85,0.25)] text-xs font-bold text-emerald-200">
          {displayOrg.name[0]?.toUpperCase()}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white/90">
                {displayOrg.name}
              </p>
              <p className="truncate text-[10px] text-white/40">
                {displayOrg.myRole
                  ? orgRoleLabel(displayOrg.myRole)
                  : displayOrg.code}
                <span className="text-white/25"> · 当前企业</span>
              </p>
            </div>
            <ChevronsUpDown size={14} className="shrink-0 text-white/30" />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "z-50 mt-1 rounded-md border border-white/8 bg-[#1a2826] shadow-xl",
            compact
              ? "relative left-0 right-0"
              : "absolute left-2 right-2 top-full",
          )}
        >
          <div className="px-2.5 pb-1 pt-2 text-[10px] text-white/35">
            切换后导航、模块与权限将按新企业刷新
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                disabled={Boolean(switchingId)}
                onClick={() => void switchOrg(org.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/8 disabled:opacity-50",
                  org.id === displayOrg.id && "bg-white/5",
                )}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[rgba(43,96,85,0.2)] text-[10px] font-bold text-emerald-200/80">
                  {org.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-white/85">{org.name}</p>
                  <p className="truncate text-[10px] text-white/35">
                    {org.memberCount} {m.sidebar_org_members} · {org.projectCount}{" "}
                    {m.sidebar_org_projects}
                  </p>
                </div>
                {switchingId === org.id ? (
                  <span className="shrink-0 text-[9px] text-white/45">
                    切换中…
                  </span>
                ) : org.myRole ? (
                  <span className="shrink-0 text-[9px] text-white/35">
                    {orgRoleLabel(org.myRole)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="border-t border-white/8 p-1">
            <Link
              href="/organizations"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/8 hover:text-white/80"
            >
              <Building2 size={12} />
              {m.sidebar_manage_orgs}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
