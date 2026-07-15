"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  FolderKanban,
  Globe2,
  Home,
  ListTodo,
  Menu,
  MessagesSquare,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const role = user?.role ?? "user";

  const primary: TabItem =
    role === "sales"
      ? {
          href: "/sales",
          label: "商机",
          icon: BriefcaseBusiness,
          match: (p) => p.startsWith("/sales"),
        }
      : role === "trade"
        ? {
            href: "/trade",
            label: "海外",
            icon: Globe2,
            match: (p) => p.startsWith("/trade"),
          }
        : role === "admin" || role === "super_admin" || role === "manager"
          ? {
              href: "/operations/intelligence",
              label: "市场",
              icon: Radar,
              match: (p) => p.startsWith("/operations/intelligence"),
            }
          : {
              href: "/projects",
              label: "项目",
              icon: FolderKanban,
              match: (p) => p.startsWith("/projects"),
            };

  const items: TabItem[] = [
    {
      href: "/",
      label: "首页",
      icon: Home,
      match: (p) => p === "/",
    },
    primary,
    {
      href: "/assistant",
      label: "协同",
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
              <span className="text-[10px] font-medium">
                {item.label}
              </span>
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
