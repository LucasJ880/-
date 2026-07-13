"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, CalendarDays, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
  /** 中央凸起的 AI 对话主按钮 */
  center?: boolean;
}

export function MobileTabBar() {
  const pathname = usePathname();

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
      href: "/assistant",
      label: "青砚",
      icon: Sparkles,
      match: (p) => p.startsWith("/assistant"),
      center: true,
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
        const isActive = item.match(pathname);

        if (item.center) {
          return (
            <Link
              key={item.label}
              href={item.href}
              className="relative flex flex-1 items-stretch"
              aria-label="青砚 AI 对话"
            >
              <div className="flex h-full w-full flex-col items-center justify-end gap-0.5 pb-1">
                {/* 凸起圆钮 */}
                <div
                  className={cn(
                    "absolute -top-4 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95",
                    isActive
                      ? "bg-gradient-to-br from-teal-600 to-emerald-500 shadow-teal-600/30"
                      : "bg-gradient-to-br from-teal-700 to-emerald-600 shadow-teal-700/25"
                  )}
                >
                  <Sparkles size={22} className="text-white" strokeWidth={2} />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium tracking-wide",
                    isActive ? "text-[var(--accent)]" : "text-[var(--muted)]"
                  )}
                >
                  {item.label}
                </span>
              </div>
            </Link>
          );
        }

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
                "active:opacity-70"
              )}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium tracking-wide">
                {item.label}
              </span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
