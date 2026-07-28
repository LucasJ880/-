"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Home,
  Layers,
  Menu,
  MessagesSquare,
  PackageCheck,
  Plus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { apiFetch } from "@/lib/api-fetch";
import type { OrgModulesConfig } from "@/lib/tenancy/modules";
import {
  canAccessBidWorkspace,
  canAccessOperationsWorkspace,
  getDefaultWorkspace,
  workspaceContextFromNav,
} from "@/lib/rbac/workspace-policy";
import { SalesMobileCreateSheet } from "@/components/sales-command-center/sales-mobile-create-sheet";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const [createOpen, setCreateOpen] = useState(false);
  const [orgModules, setOrgModules] = useState<OrgModulesConfig | null>(null);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [hasBidCapability, setHasBidCapability] = useState(false);

  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/active-org");
        if (!res.ok) return;
        const data = (await res.json()) as {
          modules?: OrgModulesConfig | null;
          orgRole?: string | null;
          hasMembership?: boolean;
          hasBidCapability?: boolean;
        };
        if (!cancelled) {
          setOrgModules(data.modules ?? null);
          setOrgRole(data.orgRole ?? null);
          setHasMembership(Boolean(data.hasMembership ?? data.orgRole));
          setHasBidCapability(Boolean(data.hasBidCapability));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedOrgId]);

  const isSales = user?.role === "sales";

  const wsCtx = useMemo(
    () =>
      workspaceContextFromNav({
        platformRole: user?.role ?? "user",
        orgRole:
          orgRole ??
          organizations.find((o) => o.id === storedOrgId)?.myRole ??
          null,
        modules: orgModules,
        hasMembership:
          hasMembership ||
          Boolean(organizations.find((o) => o.id === storedOrgId)?.myRole),
        hasBidCapability,
      }),
    [
      user?.role,
      orgRole,
      orgModules,
      hasMembership,
      hasBidCapability,
      organizations,
      storedOrgId,
    ],
  );

  if (isSales) {
    const salesTabs: TabItem[] = [
      {
        href: "/sales/home",
        label: "首页",
        icon: Home,
        match: (p) => p === "/sales/home" || p === "/sales/performance",
      },
      {
        href: "/sales?view=customers",
        label: "客户",
        icon: Users,
        match: (p) =>
          p.startsWith("/sales/customers") ||
          (p === "/sales" && typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("view") ===
              "customers"
            : false),
      },
      {
        href: "/sales/quote-sheet",
        label: "报价",
        icon: FileText,
        match: (p) =>
          p.startsWith("/sales/quote-sheet") || p.startsWith("/sales/quotes"),
      },
      {
        href: "/sales/calendar",
        label: "日历",
        icon: CalendarDays,
        match: (p) => p.startsWith("/sales/calendar"),
      },
    ];

    return (
      <>
        <nav
          className={cn(
            "fixed inset-x-0 bottom-0 z-[var(--ui-z-tabbar)] flex md:hidden",
            "border-t border-black/[0.06] bg-[rgba(250,248,244,0.92)] backdrop-blur-xl",
            "pb-safe",
          )}
          style={{
            height:
              "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom, 0))",
          }}
        >
          {salesTabs.slice(0, 2).map((item) => {
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex flex-1 items-stretch"
              >
                <div
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors",
                    isActive ? "text-[var(--accent)]" : "text-[var(--muted)]",
                    "active:opacity-70",
                  )}
                >
                  <item.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex flex-1 items-stretch text-[var(--accent)] active:opacity-70"
            aria-label="新增"
          >
            <span className="flex h-full w-full flex-col items-center justify-center gap-0.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]">
                <Plus size={20} strokeWidth={2.2} />
              </span>
              <span className="text-[10px] font-medium">新增</span>
            </span>
          </button>

          {salesTabs.slice(2).map((item) => {
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex flex-1 items-stretch"
              >
                <div
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors",
                    isActive ? "text-[var(--accent)]" : "text-[var(--muted)]",
                    "active:opacity-70",
                  )}
                >
                  <item.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
        <SalesMobileCreateSheet
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      </>
    );
  }

  const defaultHref = getDefaultWorkspace(wsCtx);
  const showOps = canAccessOperationsWorkspace(wsCtx);
  const showBids = canAccessBidWorkspace(wsCtx);

  const items: TabItem[] = [];

  if (defaultHref === "/ops") {
    items.push({
      href: "/ops",
      label: "运营",
      icon: PackageCheck,
      match: (p) => p.startsWith("/ops") || p.startsWith("/tasks"),
    });
  } else if (defaultHref === "/bids") {
    items.push({
      href: "/bids",
      label: "招投标",
      icon: FolderKanban,
      match: (p) => p.startsWith("/bids") || p.startsWith("/projects"),
    });
  } else {
    items.push({
      href: "/",
      label: "总览",
      icon: Home,
      match: (p) =>
        p === "/" ||
        p.startsWith("/tasks") ||
        p.startsWith("/notifications") ||
        p.startsWith("/service-inbox"),
    });
  }

  if (showOps && defaultHref !== "/ops") {
    items.push({
      href: "/ops",
      label: "运营",
      icon: PackageCheck,
      match: (p) => p.startsWith("/ops"),
    });
  }

  if (showBids && defaultHref !== "/bids") {
    items.push({
      href: "/bids",
      label: "招投标",
      icon: FolderKanban,
      match: (p) => p.startsWith("/bids"),
    });
  }

  if (defaultHref === "/") {
    items.push({
      href: "/capabilities",
      label: "AI",
      icon: Layers,
      match: (p) => p.startsWith("/capabilities"),
    });
  }

  items.push({
    href: "/assistant",
    label: "助手",
    icon: MessagesSquare,
    match: (p) => p.startsWith("/assistant"),
  });

  const tabs = items.slice(0, 4);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-[var(--ui-z-tabbar)] flex md:hidden",
        "border-t border-black/[0.06] bg-[rgba(250,248,244,0.92)] backdrop-blur-xl",
        "pb-safe",
      )}
      style={{
        height:
          "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom, 0))",
      }}
    >
      {tabs.map((item) => {
        const isActive = item.match(pathname);
        return (
          <Link key={item.label} href={item.href} className="flex flex-1 items-stretch">
            <div
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors",
                isActive ? "text-[var(--accent)]" : "text-[var(--muted)]",
                "active:opacity-70",
              )}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </div>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 items-stretch text-[var(--muted)] active:opacity-70"
        aria-label="打开完整导航"
      >
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5">
          <Menu size={22} strokeWidth={1.8} />
          <span className="text-[10px] font-medium">更多</span>
        </span>
      </button>
    </nav>
  );
}
