"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, ListTodo, Menu, MessagesSquare, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();

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

  // 底栏只保留 4 + 更多，去掉与工作台重复的任务位
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
