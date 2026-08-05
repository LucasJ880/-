"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import {
  useState,
  useEffect,
  useSyncExternalStore,
  useMemo,
  useRef,
} from "react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { readStoredOrgId } from "@/lib/org-selection";
import { usePendingApprovalsBadge } from "@/lib/hooks/use-pending-approvals-badge";
import { useLocale } from "@/lib/i18n/context";
import { CoBrand } from "@/components/co-brand";
import type { MessageKey } from "@/lib/i18n/messages";
import { isPlatformAdmin as checkPlatformAdmin } from "@/lib/permissions-client";
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
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (item.active && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [item.active, item.href]);

  return (
    <Link
      ref={ref}
      href={item.href || "#"}
      onClick={onNavigate}
      data-nav-active={item.active ? "true" : undefined}
      aria-current={item.active ? "page" : undefined}
      className={cn(
        "flex min-h-9 items-center gap-2.5 rounded-md text-[13px] transition-colors duration-150",
        nested
          ? "min-h-8 px-2.5 py-1.5 text-[12px]"
          : "px-2.5 py-2 font-medium",
        nested && "ml-3 border-l border-white/10 pl-3",
        item.active
          ? "bg-sidebar-active text-[color:var(--sidebar-active-fg)]"
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
            <span className="ml-auto shrink-0 rounded-full border border-accent/25 bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-[color:var(--sidebar-active-fg)] opacity-70">
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
  const hasActiveDescendant =
    item.children?.some(
      (c) => c.active || c.children?.some((gc) => gc.active),
    ) ?? false;

  if (collapsed) {
    return (
      <Link
        href={item.href || "/capabilities"}
        onClick={onNavigate}
        className={cn(
          "flex min-h-9 items-center justify-center rounded-md px-0 py-2 transition-colors",
          // 折叠态父级：有活跃后代时仅中性强调，不用叶子绿色
          hasActiveDescendant
            ? "text-white/85 hover:bg-sidebar-hover"
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
            // 父级分组：永不使用叶子绿色 active；仅中性色 + chevron 展开
            hasActiveDescendant
              ? "text-white/75 hover:bg-sidebar-hover hover:text-white/85"
              : "text-white/60 hover:bg-sidebar-hover hover:text-white/85",
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
          aria-expanded={expanded}
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
  "PROJECTS",
  "PROJECT_INTEL",
  "SUPPLIERS",
  "GROWTH",
  "MANAGEMENT",
  "PLATFORM",
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { m } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString()
    ? `?${searchParams.toString()}`
    : "";
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
  const [hasBidCapability, setHasBidCapability] = useState(false);
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
  const isPlatformAdmin = checkPlatformAdmin(platformRole);

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
          hasBidCapability?: boolean;
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
          setHasBidCapability(Boolean(data.hasBidCapability));
        }
      } catch {
        if (!cancelled) {
          setOrgModules(null);
          setWorkspaceIds([]);
          setApiOrgRole(null);
          setApiHasMembership(null);
          setHasBidCapability(false);
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
      search,
      platformRole,
      orgRole,
      hasMembership,
      workspaceIds,
      modules: orgModules,
      isPlatformAdmin,
      hasBidCapability,
    }),
    [
      pathname,
      search,
      platformRole,
      orgRole,
      hasMembership,
      workspaceIds,
      orgModules,
      isPlatformAdmin,
      hasBidCapability,
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

  const sections = useMemo(
    () =>
      grouped.map((g) => ({
        label: g.label,
        groups: [g],
      })),
    [grouped],
  );

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r border-white/[0.06] bg-sidebar-bg text-sidebar-text transition-all duration-200 ease-out",
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

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 py-1.5">
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
