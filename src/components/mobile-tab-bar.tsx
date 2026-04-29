"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, CalendarDays, FileText, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppShell } from "./app-shell";

interface TabItem {
  href?: string;
  label: string;
  icon: typeof Home;
  match?: (pathname: string) => boolean;
  onClick?: () => void;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { openMobileSidebar } = useAppShell();

  const items: TabItem[] = [
    {
      href: "/",
      label: "首页",
      icon: Home,
      match: (p) => p === "/",
    },
    {
      href: "/sales/customers",
      label: "客户",
      icon: Users,
      match: (p) => p.startsWith("/sales/customers"),
    },
    {
      href: "/sales/calendar",
      label: "日程",
      icon: CalendarDays,
      match: (p) => p.startsWith("/sales/calendar"),
    },
    {
      href: "/sales/quote-sheet",
      label: "报价",
      icon: FileText,
      match: (p) =>
        p.startsWith("/sales/quote-sheet") || p.startsWith("/sales/quotes"),
    },
    {
      label: "更多",
      icon: Menu,
      onClick: openMobileSidebar,
    },
  ];

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
        "border-t border-black/[0.06] bg-[rgba(250,248,244,0.92)] backdrop-blur-xl",
        "pb-safe"
      )}
      style={{ height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom, 0))" }}
    >
      {items.map((item) => {
        const isActive = item.href
          ? item.match
            ? item.match(pathname)
            : pathname.startsWith(item.href)
          : false;

        const inner = (
          <div
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors",
              isActive ? "text-[var(--accent)]" : "text-[var(--muted)]",
              "active:opacity-70"
            )}
          >
            <item.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="text-[10px] font-medium tracking-wide">
              {item.label}
            </span>
          </div>
        );

        if (item.href) {
          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex flex-1 items-stretch"
            >
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="flex flex-1 items-stretch"
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
