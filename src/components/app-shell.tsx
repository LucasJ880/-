"use client";

import { useState, useCallback, createContext, useContext } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { X } from "lucide-react";
import { LocaleProvider } from "@/lib/i18n/context";

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

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  return (
    <LocaleProvider>
    <AppShellContext.Provider
      value={{ mobileOpen, openMobileSidebar, closeMobileSidebar }}
    >
      <div className="flex h-screen overflow-hidden bg-app-mesh pwa-safe-top pwa-safe-bottom">
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={closeMobileSidebar}
            />
            {/* Drawer */}
            <div className="relative z-10 flex w-[280px] animate-in slide-in-from-left duration-200">
              <Sidebar onNavigate={closeMobileSidebar} />
              <button
                onClick={closeMobileSidebar}
                className="absolute right-2 top-3 z-20 rounded-full bg-white/10 p-1.5 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="关闭菜单"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-white/[0.08] bg-[rgba(250,248,244,0.35)] backdrop-blur-sm">
          <Header />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-5">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AppShellContext.Provider>
    </LocaleProvider>
  );
}
