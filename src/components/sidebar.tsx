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
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Building2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "工作台", icon: LayoutDashboard },
  { href: "/inbox", label: "收件箱", icon: Inbox },
  { href: "/tasks", label: "任务管理", icon: CheckSquare },
  { href: "/organizations", label: "组织", icon: Building2 },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/assistant", label: "AI 助手", icon: Bot },
  { href: "/blinds-orders", label: "工艺单", icon: ClipboardList },
];

const BOTTOM_ITEMS: NavItem[] = [
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar-bg text-sidebar-text transition-all duration-200 ease-in-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        {!collapsed && (
          <span className="text-lg font-bold tracking-wide">青砚</span>
        )}
        {!collapsed && (
          <span className="ml-1 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
            MVP
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded p-1 transition-colors hover:bg-sidebar-hover"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href + item.label}
              href={item.disabled ? "#" : item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-active text-white"
                  : "text-sidebar-text hover:bg-sidebar-hover",
                item.disabled && "cursor-not-allowed opacity-40",
                collapsed && "justify-center px-0"
              )}
            >
              <item.icon size={18} />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.disabled && (
                <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px]">
                  即将推出
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-2 py-3">
        {BOTTOM_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.disabled ? "#" : item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "text-sidebar-text hover:bg-sidebar-hover",
              item.disabled && "cursor-not-allowed opacity-40",
              collapsed && "justify-center px-0"
            )}
          >
            <item.icon size={18} />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </div>
    </aside>
  );
}
