"use client";

import { useState, useCallback, createContext, useContext, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { ActiveOrgHydrator } from "./active-org-hydrator";
import { LocaleProvider } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

interface AppShellContextValue {
  mobileOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

const AppShellContext = createContext<AppShellContextValue>({
  mobileOpen: false,
  openMobileSidebar: () => {},
  closeMobileSidebar: () => {},
});

export function useAppShell() {
  return useContext(AppShellContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  // 路由变化时关闭移动导航，避免遮罩/打开态残留
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // AI 对话页：手机端全屏沉浸（隐藏全局顶栏、去内边距），页面自管滚动
  const isChatRoute = pathname === "/assistant";
  // 首页 Workbench：避免 AppShell 与页面双重滚动
  const isHomeRoute = pathname === "/";
  const containScroll = isChatRoute || isHomeRoute;

  return (
    <LocaleProvider>
    <AppShellContext.Provider
      value={{ mobileOpen, openMobileSidebar, closeMobileSidebar }}
    >
      <ActiveOrgHydrator />
      <div className="flex h-screen-safe overflow-hidden bg-background bg-app-mesh pwa-safe-top">
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden h-full min-h-0 md:flex">
          <Sidebar />
        </div>

        {/* Mobile：一级分类 → 二级菜单（不用超长桌面侧栏） */}
        <MobileNavDrawer open={mobileOpen} onClose={closeMobileSidebar} />

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-[color:var(--shell-divider)] bg-[color:var(--shell-main-bg)] backdrop-blur-md">
          {/* 对话页手机端隐藏全局顶栏，桌面保留 */}
          <div className={cn(isChatRoute && "hidden md:block")}>
            <Header />
          </div>
          <main
            className={cn(
              "flex min-h-0 flex-1 pb-tabbar md:pb-0",
              containScroll ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            <div
              className={cn(
                "mx-auto w-full",
                isHomeRoute
                  ? "flex h-full min-h-0 max-w-none flex-col p-0"
                  : isChatRoute
                    ? "flex h-full max-w-7xl flex-col p-0 md:px-6 md:py-5"
                    : "max-w-7xl px-4 py-4 md:px-6 md:py-5"
              )}
            >
              {children}
            </div>
          </main>
        </div>

        <MobileTabBar onMore={openMobileSidebar} />
      </div>
    </AppShellContext.Provider>
    </LocaleProvider>
  );
}
