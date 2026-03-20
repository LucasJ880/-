"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Bot,
  Inbox,
  Settings,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** 侧栏小角标，如 Beta / 行业 */
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "工作台",
    items: [
      { href: "/", label: "工作台", icon: LayoutDashboard },
      { href: "/inbox", label: "收件箱", icon: Inbox },
      { href: "/tasks", label: "任务管理", icon: CheckSquare },
    ],
  },
  {
    title: "协作",
    items: [
      { href: "/organizations", label: "组织", icon: Building2 },
      { href: "/projects", label: "项目", icon: FolderKanban },
    ],
  },
  {
    title: "智能",
    items: [{ href: "/assistant", label: "AI 助手", icon: Bot, badge: "Beta" }],
  },
  {
    title: "业务",
    items: [
      { href: "/blinds-orders", label: "工艺单", icon: ClipboardList, badge: "行业" },
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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-white/5 bg-sidebar-gradient text-sidebar-text transition-all duration-200 ease-in-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        {!collapsed && (
          <>
            <span className="text-lg font-bold tracking-wide text-brand-gradient">
              青砚
            </span>
            <span className="ml-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-sky-200/90 backdrop-blur-sm">
              MVP
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded p-1 transition-colors hover:bg-sidebar-hover"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div
            key={group.title}
            className={cn("space-y-1", gi > 0 && (collapsed ? "mt-2 border-t border-white/10 pt-2" : "mt-4"))}
          >
            {!collapsed && (
              <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                {group.title}
              </p>
            )}
            {group.items.map((item) => {
              const isActive = isItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href + item.label}
                  href={item.disabled ? "#" : item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all duration-200 ease-out",
                    isActive
                      ? "bg-sidebar-active text-white shadow-[0_0_20px_-6px_var(--accent-glow)]"
                      : "text-sidebar-text hover:bg-sidebar-hover",
                    item.disabled && "cursor-not-allowed opacity-40",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <item.icon size={18} className="shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto shrink-0 rounded border border-sky-400/35 bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-medium text-sky-200">
                          {item.badge}
                        </span>
                      )}
                      {item.disabled && (
                        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px]">
                          即将推出
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-2 py-3">
        {!collapsed && (
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
            系统
          </p>
        )}
        <div className="space-y-1">
          {BOTTOM_ITEMS.map((item) => {
            const isActive = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.label}
                href={item.disabled ? "#" : item.href}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-all duration-200 ease-out",
                  isActive
                    ? "bg-sidebar-active text-white shadow-[0_0_20px_-6px_var(--accent-glow)]"
                    : "text-sidebar-text hover:bg-sidebar-hover",
                  item.disabled && "cursor-not-allowed opacity-40",
                  collapsed && "justify-center px-0"
                )}
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
