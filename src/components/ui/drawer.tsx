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
    const unlock = lockAppScroll();
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
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-250",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      {/* panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full max-h-dvh flex-col border-l border-border bg-[var(--card-bg)] shadow-[var(--shadow-float)] transition-transform duration-300 ease-out",
          width,
          "max-w-[calc(100vw-1rem)]",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-[var(--radius-sm)] p-1.5 text-muted transition-colors hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}
