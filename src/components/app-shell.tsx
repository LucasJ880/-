"use client";

import {
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
  Suspense,
} from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { ActiveOrgHydrator } from "./active-org-hydrator";
import {
  WorkspaceShellProvider,
  useWorkspaceShell,
} from "./workspace-shell-context";
import { Drawer } from "./ui/drawer";
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
  return (
    <LocaleProvider>
      <WorkspaceShellProvider>
        <AppShellContents>{children}</AppShellContents>
      </WorkspaceShellProvider>
    </LocaleProvider>
  );
}

function AppShellContents({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { context, panelOpen, setPanelOpen } = useWorkspaceShell();

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  // 路由变化时关闭移动导航，避免遮罩/打开态残留
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // AI 对话页：手机端全屏沉浸（隐藏全局顶栏、去内边距），页面自管滚动
  const isChatRoute = pathname === "/assistant";

  const hasContextPanel = Boolean(context?.panel);

  return (
    <AppShellContext.Provider
      value={{ mobileOpen, openMobileSidebar, closeMobileSidebar }}
    >
      <ActiveOrgHydrator />
      <div className="flex h-screen-safe overflow-hidden bg-background bg-app-mesh pwa-safe-top">
        {/* Desktop sidebar — hidden on mobile；Suspense 包裹 useSearchParams */}
        <div className="hidden h-full min-h-0 md:flex">
          <Suspense
            fallback={
              <aside className="h-full w-60 border-r border-white/[0.06] bg-sidebar-bg" />
            }
          >
            <Sidebar />
          </Suspense>
        </div>

        {/* Mobile：一级分类 → 二级菜单（不用超长桌面侧栏） */}
        <Suspense fallback={null}>
          <MobileNavDrawer open={mobileOpen} onClose={closeMobileSidebar} />
        </Suspense>

        {/* Main workspace: current context lives in Header; right panel is opt-in per entity page. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-[color:var(--shell-divider)] bg-[color:var(--shell-main-bg)] backdrop-blur-md">
          {/* 对话页手机端隐藏全局顶栏，桌面保留 */}
          <div className={cn(isChatRoute && "hidden md:block")}>
            <Header />
          </div>
          <div className="flex min-h-0 flex-1">
            <main
              className={cn(
                "min-w-0 flex-1 pb-tabbar md:pb-0",
                isChatRoute ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              <div
                className={cn(
                  "mx-auto w-full max-w-7xl",
                  isChatRoute
                    ? "flex h-full flex-col p-0 md:px-6 md:py-5"
                    : "px-4 py-4 md:px-6 md:py-5",
                )}
              >
                {children}
              </div>
            </main>

            {/* >=1280 使用并列的上下文面板；不会为未接入的页面压缩工作区。 */}
            {hasContextPanel && panelOpen ? (
              <aside
                className="hidden min-[1280px]:flex min-[1280px]:w-[360px] min-[1280px]:shrink-0 min-[1280px]:flex-col min-[1280px]:border-l min-[1280px]:border-border min-[1280px]:bg-card-bg"
                aria-label={context?.panelTitle ?? "当前上下文"}
              >
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                  {context?.panel}
                </div>
              </aside>
            ) : null}
          </div>
        </div>

        {/* 768–1279px 使用既有可访问 Drawer，不挤压主工作区。 */}
        {hasContextPanel ? (
          <div className="hidden md:block min-[1280px]:hidden">
            <Drawer
              open={panelOpen}
              onClose={() => setPanelOpen(false)}
              title={context?.panelTitle ?? "当前上下文"}
              width="w-[min(420px,calc(100vw-2rem))]"
            >
              {context?.panel}
            </Drawer>
          </div>
        ) : null}

        <MobileTabBar onMore={openMobileSidebar} />
      </div>
    </AppShellContext.Provider>
  );
}
