"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Bot,
  Bell,
  Settings,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Building2,
  Users,
  ScrollText,
  Shield,
  ChevronsUpDown,
  Package2,
  FileText,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations, type OrgSummary } from "@/lib/hooks/use-organizations";
import { canViewAdminPages, orgRoleLabel } from "@/lib/permissions-client";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
  adminOnly?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "工作台",
    items: [
      { href: "/", label: "工作台", icon: LayoutDashboard },
      { href: "/notifications", label: "通知中心", icon: Bell },
      { href: "/tasks", label: "任务管理", icon: CheckSquare },
    ],
  },
  {
    title: "协作",
    items: [
      { href: "/organizations", label: "组织", icon: Building2 },
      { href: "/projects", label: "项目", icon: FolderKanban },
      { href: "/suppliers", label: "供应商", icon: Package2 },
    ],
  },
  {
    title: "智能",
    items: [
      { href: "/assistant", label: "AI 助手", icon: Bot, badge: "Beta" },
      { href: "/ai-activity", label: "AI 活动", icon: Activity },
      { href: "/reports", label: "项目周报", icon: FileText },
    ],
  },
  {
    title: "管理",
    adminOnly: true,
    items: [
      { href: "/admin/project-intake", label: "待分发项目", icon: ClipboardList, adminOnly: true },
      { href: "/admin/users", label: "用户管理", icon: Users, adminOnly: true },
      { href: "/admin/audit-logs", label: "审计日志", icon: ScrollText, adminOnly: true },
      { href: "/blinds-orders", label: "工艺单", icon: ClipboardList, adminOnly: true, badge: "行业" },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/help", label: "使用说明", icon: CircleHelp },
  { href: "/settings", label: "设置", icon: Settings },
];

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function OrgSwitcher({
  collapsed,
  organizations,
}: {
  collapsed: boolean;
  organizations: OrgSummary[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const currentOrgId = pathname.match(/\/organizations\/([^/]+)/)?.[1];
  const currentOrg = organizations.find((o) => o.id === currentOrgId);

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

  return (
    <div ref={ref} className="relative px-2 pb-1">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors hover:bg-sidebar-hover",
          collapsed && "justify-center"
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
                {displayOrg.myRole ? orgRoleLabel(displayOrg.myRole) : displayOrg.code}
              </p>
            </div>
            <ChevronsUpDown size={14} className="shrink-0 text-white/30" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 rounded-[var(--radius-md)] border border-white/8 bg-[#1a2826] shadow-xl">
          <div className="p-1">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  router.push(`/organizations/${org.id}`);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-white/8",
                  org.id === displayOrg.id && "bg-white/5"
                )}
              >
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[rgba(43,96,85,0.2)] text-[10px] font-bold text-emerald-200/80">
                  {org.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-white/85">{org.name}</p>
                  <p className="truncate text-[10px] text-white/35">
                    {org.memberCount} 人 · {org.projectCount} 项目
                  </p>
                </div>
                {org.myRole && (
                  <span className="shrink-0 text-[9px] text-white/35">
                    {orgRoleLabel(org.myRole)}
                  </span>
                )}
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
              管理所有组织
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const isAdmin = canViewAdminPages(user?.role);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-white/5 bg-sidebar-gradient text-sidebar-text transition-all duration-250 ease-out",
        collapsed ? "w-[60px]" : "w-56"
      )}
    >
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b border-white/8 px-4">
        {!collapsed && (
          <>
            <span className="text-lg font-bold tracking-widest text-brand-gradient">
              青砚
            </span>
            <span className="ml-0.5 rounded-md border border-[rgba(80,160,140,0.2)] bg-[rgba(43,96,85,0.15)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-emerald-300/70">
              MVP
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded-lg p-1 transition-colors hover:bg-sidebar-hover"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <OrgSwitcher collapsed={collapsed} organizations={organizations} />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-1">
        {NAV_GROUPS.map((group, gi) => {
          if (group.adminOnly && !isAdmin) return null;
          return (
            <div
              key={group.title}
              className={cn("space-y-0.5", gi > 0 && (collapsed ? "mt-2 border-t border-white/8 pt-2" : "mt-3.5"))}
            >
              {!collapsed && (
                <p className="flex items-center gap-1 px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                  {group.title}
                  {group.adminOnly && <Shield size={9} className="text-emerald-400/40" />}
                </p>
              )}
              {group.items.map((item) => {
                if (item.adminOnly && !isAdmin) return null;
                const isActive = isItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.disabled ? "#" : item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-medium transition-all duration-200 ease-out",
                      isActive
                        ? "bg-sidebar-active text-white shadow-[0_0_16px_-4px_var(--accent-glow)]"
                        : "text-sidebar-text hover:bg-sidebar-hover hover:text-white/90",
                      item.disabled && "cursor-not-allowed opacity-35",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <item.icon size={17} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className="ml-auto shrink-0 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300/70">
                            {item.badge}
                          </span>
                        )}
                        {item.disabled && (
                          <span className="ml-auto rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] text-white/35">
                            即将推出
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-white/8 px-2 py-2.5">
        {!collapsed && (
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
            系统
          </p>
        )}
        <div className="space-y-0.5">
          {BOTTOM_ITEMS.map((item) => {
            const isActive = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.label}
                href={item.disabled ? "#" : item.href}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] font-medium transition-all duration-200 ease-out",
                  isActive
                    ? "bg-sidebar-active text-white shadow-[0_0_16px_-4px_var(--accent-glow)]"
                    : "text-sidebar-text hover:bg-sidebar-hover hover:text-white/90",
                  item.disabled && "cursor-not-allowed opacity-35",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon size={17} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
