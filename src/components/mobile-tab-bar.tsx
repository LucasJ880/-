"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  Home,
  Layers,
  Menu,
  MessagesSquare,
  PackageCheck,
  Plus,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigationAccess } from "@/lib/navigation/use-navigation-access";
import { computeMobileTabs, type MobileTab, type MobileTabKey } from "@/lib/navigation/mobile-tabs";
import { SalesMobileCreateSheet } from "@/components/sales-command-center/sales-mobile-create-sheet";

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (pathname: string) => boolean;
}

const TAB_ICONS: Record<MobileTabKey, typeof Home> = {
  "sales-home": Home,
  "sales-customers": Users,
  "sales-quotes": FileText,
  "sales-calendar": CalendarDays,
  install: Wrench,
  ops: PackageCheck,
  bids: FolderKanban,
  overview: Home,
  ai: Layers,
  assistant: MessagesSquare,
};

/** 高亮规则；首格（默认落地）比后面同名页签多认几个前缀 */
function tabMatch(key: MobileTabKey, first: boolean): (p: string) => boolean {
  switch (key) {
    case "sales-home":
      return (p) => p === "/sales/home" || p === "/sales/performance";
    case "sales-customers":
      return (p) =>
        p.startsWith("/sales/customers") ||
        (p === "/sales" && typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("view") === "customers"
          : false);
    case "sales-quotes":
      return (p) => p.startsWith("/sales/quote-sheet") || p.startsWith("/sales/quotes");
    case "sales-calendar":
      return (p) => p.startsWith("/sales/calendar");
    case "install":
      return (p) => p.startsWith("/install");
    case "ops":
      return first ? (p) => p.startsWith("/ops") || p.startsWith("/tasks") : (p) => p.startsWith("/ops");
    case "bids":
      return first ? (p) => p.startsWith("/bids") || p.startsWith("/projects") : (p) => p.startsWith("/bids");
    case "overview":
      return (p) => p === "/" || p.startsWith("/tasks") || p.startsWith("/notifications") || p.startsWith("/service-inbox");
    case "ai":
      return (p) => p.startsWith("/capabilities");
    case "assistant":
      return (p) => p.startsWith("/assistant");
  }
}

const toItem = (tab: MobileTab, first: boolean): TabItem => ({
  href: tab.href,
  label: tab.label,
  icon: TAB_ICONS[tab.key],
  match: tabMatch(tab.key, first),
});

/**
 * VIS-1b：每个页签只在目标经路由门放行时出现（useNavigationAccess + computeMobileTabs）；布局判定不变。
 * 判定输入未就绪时只显示「更多」，页签不先显示后消失。
 */
export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const { ctx } = useNavigationAccess();
  const computed = useMemo(() => (ctx ? computeMobileTabs(ctx) : null), [ctx]);

  if (computed?.layout === "sales") {
    const left = computed.tabs.filter((t) => t.slot === "left").map((t) => toItem(t, false));
    const right = computed.tabs.filter((t) => t.slot === "right").map((t) => toItem(t, false));
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
          {left.map((item) => {
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

          {right.map((item) => {
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

  const tabs = (computed?.tabs ?? []).map((t, i) => toItem(t, i === 0));

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
