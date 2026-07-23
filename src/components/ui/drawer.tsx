"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}

export function Drawer({ open, onClose, title, children, width = "w-[480px]" }: DrawerProps) {
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEsc);
    const unlock = lockAppScroll("ui-drawer");
    return () => {
      document.removeEventListener("keydown", handleEsc);
      unlock();
    };
  }, [open, handleEsc]);

  return (
    <>
      {/* backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[var(--ui-z-drawer-overlay)] bg-black/50 transition-opacity duration-250",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      {/* panel */}
      <aside
        role="dialog"
        aria-modal={open ? "true" : undefined}
        aria-label={title || "侧栏"}
        className={cn(
          "fixed right-0 top-0 z-[var(--ui-z-drawer-panel)] flex h-full max-h-dvh flex-col border-l border-border bg-[var(--card-bg)] shadow-[var(--shadow-float)] transition-transform duration-300 ease-out",
          width,
          "max-w-[calc(100vw-1rem)]",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="min-w-0 break-words text-base font-semibold text-foreground [overflow-wrap:anywhere]">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">
          {children}
        </div>
      </aside>
    </>
  );
}
