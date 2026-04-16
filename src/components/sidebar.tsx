"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Bot,
  Bell,
  CalendarDays,
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
  Package,
  Package2,
  FileText,
  Activity,
  BarChart3,
  Handshake,
  BookOpen,
  Upload,
  MessageSquare,
  MessageCircle,
  Brain,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useOrganizations, type OrgSummary } from "@/lib/hooks/use-organizations";
import { canViewAdminPages, canAccessModule, orgRoleLabel } from "@/lib/permissions-client";
import { useLocale } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";

interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  disabled?: boolean;
  badgeKey?: MessageKey;
  adminOnly?: boolean;
  roles?: string[];
}

interface NavGroup {
  titleKey: MessageKey;
  items: NavItem[];
  adminOnly?: boolean;
  roles?: string[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "nav_group_workspace",
    items: [
      { href: "/", labelKey: "nav_dashboard", icon: LayoutDashboard },
      { href: "/notifications", labelKey: "nav_notifications", icon: Bell },
      { href: "/tasks", labelKey: "nav_tasks", icon: CheckSquare },
    ],
  },
  {
    titleKey: "nav_group_sales",
    roles: ["admin", "super_admin", "sales"],
    items: [
      { href: "/sales", labelKey: "nav_sales_pipeline", icon: Handshake, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/quote-tool", labelKey: "nav_quote_tool", icon: Calculator, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/quote-sheet", labelKey: "nav_quote_sheet", icon: FileText, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/quotes", labelKey: "nav_all_quotes", icon: ScrollText, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/calendar", labelKey: "nav_appointment_calendar", icon: CalendarDays, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/measure", labelKey: "nav_field_measure", icon: ClipboardList, roles: ["admin", "super_admin", "sales"] },
      { href: "/sales/cockpit", labelKey: "nav_cockpit", icon: BarChart3, roles: ["admin", "super_admin", "sales"] },
      { href: "/blinds-orders", labelKey: "nav_work_orders", icon: ClipboardList, roles: ["admin", "super_admin", "sales"], badgeKey: "sidebar_badge_industry" },
      { href: "/inventory", labelKey: "nav_fabric_inventory", icon: Package, roles: ["admin", "super_admin"] },
      { href: "/sales/knowledge", labelKey: "nav_sales_knowledge", icon: BookOpen, roles: ["admin", "super_admin", "sales"] },
    ],
  },
  {
    titleKey: "nav_group_trade",
    roles: ["admin", "super_admin", "trade"],
    items: [
      { href: "/trade", labelKey: "nav_trade_dashboard", icon: Handshake, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/cockpit", labelKey: "nav_trade_cockpit", icon: Activity, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/chat", labelKey: "nav_ai_assistant", icon: Bot, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/quotes", labelKey: "nav_trade_quotes", icon: ScrollText, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/import", labelKey: "nav_trade_import", icon: Upload, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/templates", labelKey: "nav_email_templates", icon: FileText, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/channels", labelKey: "nav_message_channels", icon: MessageSquare, roles: ["admin", "super_admin", "trade"] },
      { href: "/trade/knowledge", labelKey: "nav_trade_knowledge", icon: BookOpen, roles: ["admin", "super_admin", "trade"] },
    ],
  },
  {
    titleKey: "nav_group_collaboration",
    roles: ["admin", "super_admin", "user"],
    items: [
      { href: "/organizations", labelKey: "nav_organizations", icon: Building2, roles: ["admin", "super_admin", "user"] },
      { href: "/projects", labelKey: "nav_projects", icon: FolderKanban, roles: ["admin", "super_admin", "user"] },
      { href: "/suppliers", labelKey: "nav_suppliers", icon: Package2, roles: ["admin", "super_admin", "user"] },
    ],
  },
  {
    titleKey: "nav_group_intelligence",
    items: [
      { href: "/assistant", labelKey: "nav_ai_assistant", icon: Bot, badgeKey: "sidebar_badge_beta" },
      { href: "/wechat", labelKey: "nav_wechat_messages", icon: MessageCircle },
      { href: "/memory", labelKey: "nav_ai_memory", icon: Brain },
      { href: "/ai-activity", labelKey: "nav_ai_activity", icon: Activity },
      { href: "/reports", labelKey: "nav_weekly_reports", icon: FileText, roles: ["admin", "super_admin", "user"] },
    ],
  },
  {
    titleKey: "nav_group_admin",
    adminOnly: true,
    roles: ["admin", "super_admin"],
    items: [
      { href: "/admin/project-intake", labelKey: "nav_project_intake", icon: ClipboardList, adminOnly: true },
      { href: "/admin/users", labelKey: "nav_user_management", icon: Users, adminOnly: true },
      { href: "/admin/invite-codes", labelKey: "nav_invite_codes", icon: Shield, adminOnly: true },
      { href: "/admin/audit-logs", labelKey: "nav_audit_logs", icon: ScrollText, adminOnly: true },
      { href: "/blinds-orders", labelKey: "nav_orders_admin", icon: ClipboardList, adminOnly: true },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/help", labelKey: "nav_help", icon: CircleHelp },
  { href: "/settings", labelKey: "nav_settings", icon: Settings },
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
  const { m } = useLocale();
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
                    {org.memberCount} {m.sidebar_org_members} · {org.projectCount} {m.sidebar_org_projects}
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
              {m.sidebar_manage_orgs}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { m } = useLocale();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useCurrentUser();
  const { organizations } = useOrganizations();
  const isAdmin = canViewAdminPages(user?.role);
  const userRole = user?.role || "user";

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-white/[0.06] bg-sidebar-gradient text-sidebar-text transition-all duration-200 ease-out",
        collapsed ? "w-[60px]" : "w-56"
      )}
    >
      {/* Brand */}
      <div className="flex h-13 items-center gap-2.5 border-b border-white/[0.06] px-4">
        {!collapsed && (
          <>
            <span className="text-[15px] font-semibold tracking-[0.08em] text-brand-gradient">
              {m.app_name}
            </span>
            <span
              className="ml-0.5 rounded-full border border-[rgba(80,160,140,0.2)] bg-[rgba(43,96,85,0.15)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-emerald-300/60"
              title="当前为早期版本，欢迎反馈"
            >
              Beta
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded-md p-1.5 transition-colors hover:bg-sidebar-hover"
          aria-label={collapsed ? m.sidebar_expand : m.sidebar_collapse}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      <OrgSwitcher collapsed={collapsed} organizations={organizations} />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-1.5">
        {NAV_GROUPS.map((group, gi) => {
          if (group.adminOnly && !isAdmin) return null;
          if (group.roles && userRole && !group.roles.includes(userRole)) return null;
          return (
            <div
              key={group.titleKey}
              className={cn("space-y-px", gi > 0 && (collapsed ? "mt-2 border-t border-white/[0.06] pt-2" : "mt-3"))}
            >
              {!collapsed && (
                <p className="flex items-center gap-1 px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">
                  {m[group.titleKey]}
                  {group.adminOnly && <Shield size={9} className="text-emerald-400/35" />}
                </p>
              )}
              {group.items.map((item) => {
                if (item.adminOnly && !isAdmin) return null;
                if (item.roles && userRole && !item.roles.includes(userRole)) return null;
                const isActive = isItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href + item.labelKey}
                    href={item.disabled ? "#" : item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[13px] font-medium transition-all duration-150",
                      isActive
                        ? "bg-sidebar-active text-white shadow-[0_0_12px_-4px_var(--accent-glow)]"
                        : "text-white/60 hover:bg-sidebar-hover hover:text-white/85",
                      item.disabled && "cursor-not-allowed opacity-30",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <item.icon size={16} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{m[item.labelKey]}</span>
                        {item.badgeKey && (
                          <span className="ml-auto shrink-0 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300/60">
                            {m[item.badgeKey]}
                          </span>
                        )}
                        {item.disabled && (
                          <span className="ml-auto rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/30">
                            {m.sidebar_coming_soon}
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
      <div className="border-t border-white/[0.06] px-2 py-2">
        {!collapsed && (
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-white/25">
            {m.nav_group_system}
          </p>
        )}
        <div className="space-y-px">
          {BOTTOM_ITEMS.map((item) => {
            const isActive = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.labelKey}
                href={item.disabled ? "#" : item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[7px] text-[13px] font-medium transition-all duration-150",
                  isActive
                    ? "bg-sidebar-active text-white shadow-[0_0_12px_-4px_var(--accent-glow)]"
                    : "text-white/50 hover:bg-sidebar-hover hover:text-white/80",
                  item.disabled && "cursor-not-allowed opacity-30",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon size={16} />
                {!collapsed && <span>{m[item.labelKey]}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
