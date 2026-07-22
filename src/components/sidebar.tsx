"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Building2,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect, useRef, useSyncExternalStore, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations, type OrgSummary } from "@/lib/hooks/use-organizations";
import {
  readStoredOrgId,
  selectActiveOrganization,
} from "@/lib/org-selection";
import { usePendingApprovalsBadge } from "@/lib/hooks/use-pending-approvals-badge";
import { orgRoleLabel } from "@/lib/permissions-client";
import { useLocale } from "@/lib/i18n/context";
import { CoBrand } from "@/components/co-brand";
import type { MessageKey } from "@/lib/i18n/messages";
import { apiFetch } from "@/lib/api-fetch";
import type { OrgModulesConfig } from "@/lib/tenancy/modules";
import {
  NAVIGATION_REGISTRY,
  SYSTEM_NAV_ITEMS,
  NAV_GROUP_META,
  NAV_SECTION_LABEL,
  resolveNavigationTree,
  type NavigationFilterContext,
  type NavigationGroup,
  type ResolvedNavItem,
} from "@/lib/navigation";

function subscribeOrgStorage(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener("qingyan-org-storage", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("qingyan-org-storage", cb);
  };
}

function itemLabel(
  item: ResolvedNavItem,
  m: Record<string, string>,
): string {
  if (item.labelKey && m[item.labelKey]) return m[item.labelKey];
  return item.label;
}

function OrgSwitcher({
  collapsed,
  organizations,
}: {
  collapsed: boolean;
  organizations: OrgSummary[];
}) {
  const { m } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );
  const currentOrg =
    organizations.find((o) => o.id === storedOrgId) ??
    organizations.find(
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

  if (organizations.length === 0) return null;

  const displayOrg = currentOrg ?? organizations[0];

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
    // 整页刷新：导航模块、中台数据、权限与缓存一并按新企业重建
    window.location.assign("/");
  }

  return (
    <div ref={ref} className="relative px-2 pb-1">
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
        <div className="absolute left-2 right-2 top-full z-50 mt-1 rounded-md border border-white/8 bg-[#1a2826] shadow-xl">
          <div className="px-2.5 pb-1 pt-2 text-[10px] text-white/35">
            切换后导航、模块与权限将按新企业刷新
          </div>
          <div className="p-1">
            {organizations.map((org) => (
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

function NavLink({
  item,
  collapsed,
  nested,
  onNavigate,
  pendingCount,
}: {
  item: ResolvedNavItem;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
  pendingCount: number;
}) {
  const { m } = useLocale();
  const label = itemLabel(item, m as unknown as Record<string, string>);
  const Icon = item.icon;

  return (
    <Link
      href={item.href || "#"}
      onClick={onNavigate}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-md text-[13px] transition-colors duration-150",
        nested
          ? "min-h-8 px-2.5 py-1.5 text-[12px]"
          : "px-2.5 py-2 font-medium",
        nested && "ml-3 border-l border-white/10 pl-3",
        item.active
          ? nested
            ? "bg-white/10 text-emerald-200"
            : "bg-sidebar-active text-white"
          : "text-white/60 hover:bg-sidebar-hover hover:text-white/85",
        collapsed && !nested && "justify-center px-0",
      )}
    >
      {!nested && Icon && (
        <span className="relative shrink-0">
          <Icon size={16} />
          {collapsed && item.href === "/assistant" && pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#c85a3a] px-0.5 text-[9px] font-semibold leading-none text-white">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </span>
      )}
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {item.href === "/assistant" && pendingCount > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-[#c85a3a] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
          {item.badgeKey && (
            <span className="ml-auto shrink-0 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300/60">
              {m[item.badgeKey as MessageKey]}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

function CollapsibleNav({
  item,
  collapsed,
  onNavigate,
  pendingCount,
  manualExpanded,
  onToggle,
}: {
  item: ResolvedNavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  pendingCount: number;
  manualExpanded: boolean | null;
  onToggle: () => void;
}) {
  const { m } = useLocale();
  const label = itemLabel(item, m as unknown as Record<string, string>);
  const Icon = item.icon;
  const expanded = manualExpanded ?? item.expanded;
  const childActive = item.children?.some((c) => c.active) ?? false;

  if (collapsed) {
    return (
      <Link
        href={item.href || "/capabilities"}
        onClick={onNavigate}
        className={cn(
          "flex min-h-9 items-center justify-center rounded-md px-0 py-2 transition-colors",
          childActive || item.active
            ? "bg-sidebar-active text-white"
            : "text-white/60 hover:bg-sidebar-hover hover:text-white/85",
        )}
        title={label}
      >
        {Icon && <Icon size={16} />}
      </Link>
    );
  }

  return (
    <div className="space-y-px">
      <div className="flex items-center gap-0.5">
        <Link
          href={item.href || "/capabilities"}
          onClick={onNavigate}
          className={cn(
            "flex min-h-9 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
            childActive || item.active
              ? "text-white/90"
              : "text-white/60 hover:bg-sidebar-hover hover:text-white/85",
            (childActive || item.active) && "bg-white/[0.04]",
          )}
        >
          {Icon && <Icon size={16} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1.5 text-white/35 hover:bg-sidebar-hover hover:text-white/70"
          aria-label={expanded ? "折叠" : "展开"}
        >
          <ChevronDown
            size={14}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>
      {expanded &&
        item.children?.map((child) => (
          <NavLink
            key={child.key}
            item={child}
            collapsed={false}
            nested
            onNavigate={onNavigate}
            pendingCount={pendingCount}
          />
        ))}
    </div>
  );
}

const GROUP_RENDER_ORDER: NavigationGroup[] = [
  "WORK",
  "OPERATIONS",
  "CAPABILITIES",
  "BUSINESS",
  "GROWTH",
  "MANAGEMENT",
  "PLATFORM",
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { m } = useLocale();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const { count: pendingCount } = usePendingApprovalsBadge();
  const [orgModules, setOrgModules] = useState<OrgModulesConfig | null>(null);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [apiOrgRole, setApiOrgRole] = useState<string | null>(null);
  const [apiHasMembership, setApiHasMembership] = useState<boolean | null>(
    null,
  );
  const [capExpanded, setCapExpanded] = useState<boolean | null>(null);

  const storedOrgId = useSyncExternalStore(
    subscribeOrgStorage,
    readStoredOrgId,
    () => "",
  );
  const activeOrg =
    organizations.find((o) => o.id === storedOrgId) ?? organizations[0];
  const orgRole = apiOrgRole ?? activeOrg?.myRole ?? null;
  const hasMembership =
    apiHasMembership !== null
      ? apiHasMembership
      : Boolean(activeOrg?.myRole);
  const platformRole = user?.role ?? "user";
  const isPlatformAdmin =
    platformRole === "admin" || platformRole === "super_admin";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/active-org");
        if (!res.ok) return;
        const data = (await res.json()) as {
          modules?: OrgModulesConfig | null;
          workspaceIds?: string[];
          orgRole?: string | null;
          hasMembership?: boolean;
        };
        if (!cancelled) {
          setOrgModules(data.modules ?? null);
          setWorkspaceIds(data.workspaceIds ?? []);
          setApiOrgRole(data.orgRole ?? null);
          setApiHasMembership(
            typeof data.hasMembership === "boolean"
              ? data.hasMembership
              : Boolean(data.orgRole),
          );
        }
      } catch {
        if (!cancelled) {
          setOrgModules(null);
          setWorkspaceIds([]);
          setApiOrgRole(null);
          setApiHasMembership(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedOrgId]);

  // 切换路径离开中台时，重置手动展开，恢复默认折叠策略
  useEffect(() => {
    if (!pathname.startsWith("/capabilities")) {
      setCapExpanded(null);
    }
  }, [pathname]);

  const filterCtx: NavigationFilterContext = useMemo(
    () => ({
      pathname,
      platformRole,
      orgRole,
      hasMembership,
      workspaceIds,
      modules: orgModules,
      isPlatformAdmin,
    }),
    [
      pathname,
      platformRole,
      orgRole,
      hasMembership,
      workspaceIds,
      orgModules,
      isPlatformAdmin,
    ],
  );

  const resolved = useMemo(
    () =>
      resolveNavigationTree(NAVIGATION_REGISTRY, filterCtx, {
        expandCapabilities: capExpanded === true,
      }),
    [filterCtx, capExpanded],
  );

  const systemResolved = useMemo(
    () => resolveNavigationTree(SYSTEM_NAV_ITEMS, filterCtx),
    [filterCtx],
  );

  const grouped = useMemo(() => {
    return GROUP_RENDER_ORDER.map((group) => ({
      group,
      items: resolved.filter((i) => i.group === group),
      label: NAV_SECTION_LABEL[group] ?? NAV_GROUP_META[group].label,
    })).filter((g) => g.items.length > 0);
  }, [resolved]);

  // 合并相邻相同 section 标题（经营与业务）
  const sections = useMemo(() => {
    const out: Array<{
      label: string;
      groups: typeof grouped;
    }> = [];
    for (const g of grouped) {
      const last = out[out.length - 1];
      if (last && last.label === g.label) {
        last.groups.push(g);
      } else {
        out.push({ label: g.label, groups: [g] });
      }
    }
    return out;
  }, [grouped]);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-white/[0.06] bg-[#111b1d] text-sidebar-text transition-all duration-200 ease-out",
        collapsed ? "w-[60px]" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-13 items-center border-b border-white/[0.06]",
          collapsed ? "flex-col justify-center gap-0.5 px-1" : "gap-2.5 px-4",
        )}
      >
        <CoBrand size="md" collapsed={collapsed} variant="sidebar" />
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "rounded-md p-1.5 transition-colors hover:bg-sidebar-hover",
            collapsed ? "" : "ml-auto",
          )}
          aria-label={collapsed ? m.sidebar_expand : m.sidebar_collapse}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <OrgSwitcher collapsed={collapsed} organizations={organizations} />

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-1.5">
        {sections.map((section, si) => (
          <div
            key={section.label + si}
            className={cn(
              "space-y-px",
              si > 0 &&
                (collapsed
                  ? "mt-2 border-t border-white/[0.06] pt-2"
                  : "mt-4"),
            )}
          >
            {!collapsed && (
              <p className="px-3 pb-1 pt-1 text-[10px] font-medium tracking-wide text-white/30">
                {section.label}
              </p>
            )}
            {section.groups.map((g) =>
              g.items.map((item) =>
                item.collapsible && item.children?.length ? (
                  <CollapsibleNav
                    key={item.key}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    pendingCount={pendingCount}
                    manualExpanded={
                      item.key === "capabilities" ? capExpanded : null
                    }
                    onToggle={() =>
                      setCapExpanded((prev) => {
                        const current = prev ?? item.expanded;
                        return !current;
                      })
                    }
                  />
                ) : (
                  <NavLink
                    key={item.key}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    pendingCount={pendingCount}
                  />
                ),
              ),
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] px-2 py-2">
        {!collapsed && (
          <p className="px-2.5 pb-1 text-[10px] font-medium text-white/25">
            {m.nav_group_system}
          </p>
        )}
        <div className="space-y-px">
          {systemResolved.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
              pendingCount={0}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
