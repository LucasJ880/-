"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FileText,
  Home,
  Layers,
  ListTodo,
  Menu,
  MessagesSquare,
  Plus,
  Users,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { SalesMobileCreateSheet } from "@/components/sales-command-center/sales-mobile-create-sheet";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const isSales = user?.role === "sales";
  const [createOpen, setCreateOpen] = useState(false);

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

  const items: TabItem[] = [
    {
      href: "/",
      label: "工作台",
      icon: Home,
      match: (p) =>
        p === "/" ||
        p.startsWith("/tasks") ||
        p.startsWith("/notifications") ||
        p.startsWith("/service-inbox"),
    },
    {
      href: "/operations/center",
      label: "经营",
      icon: BarChart3,
      match: (p) => p.startsWith("/operations/center"),
    },
    {
      href: "/capabilities",
      label: "中台",
      icon: Layers,
      match: (p) => p.startsWith("/capabilities"),
    },
    {
      href: "/assistant",
      label: "助手",
      icon: MessagesSquare,
      match: (p) => p.startsWith("/assistant"),
    },
    {
      href: "/tasks",
      label: "任务",
      icon: ListTodo,
      match: (p) => p.startsWith("/tasks"),
    },
  ];

  const tabs = items.filter((i) => i.label !== "任务");

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
