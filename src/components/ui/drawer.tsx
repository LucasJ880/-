"use client";

import {
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
  /** 默认右侧抽屉；移动端可选底部或全屏。 */
  side?: "right" | "bottom" | "full";
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  closeOnOverlayClick?: boolean;
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = "w-[480px]",
  side = "right",
  footer,
  className,
  contentClassName,
  closeOnOverlayClick = true,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const elements = focusableElements(panelRef.current);
      if (elements.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.addEventListener("keydown", handleEsc);
    const unlock = lockAppScroll("ui-drawer");
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleEsc);
      unlock();
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, handleEsc]);

  const panelLayout =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[min(90dvh,42rem)] rounded-t-[var(--radius-xl)] border-t"
      : side === "full"
        ? "inset-0 h-[100dvh] rounded-none"
        : `right-0 top-0 h-full max-h-dvh max-w-[calc(100vw-1rem)] border-l ${width}`;

  return (
    <>
      {/* backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[var(--ui-z-drawer-overlay)] bg-black/50 transition-opacity duration-250",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={closeOnOverlayClick ? onClose : undefined}
      />

      {/* panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={open ? "true" : undefined}
        aria-hidden={!open}
        aria-label={title || "侧栏"}
        tabIndex={-1}
        inert={!open}
        onKeyDown={handleKeyDown}
        className={cn(
          "fixed z-[var(--ui-z-drawer-panel)] flex flex-col border-border bg-[var(--card-bg)] shadow-[var(--shadow-float)] transition-transform duration-300 ease-out",
          panelLayout,
          side === "bottom"
            ? (open ? "translate-y-0" : "pointer-events-none translate-y-full")
            : side === "full"
              ? (open ? "opacity-100" : "pointer-events-none opacity-0")
              : (open ? "translate-x-0" : "pointer-events-none translate-x-full"),
          className,
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
        <div className={cn(
          "flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]",
          contentClassName,
        )}>
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-card-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
            {footer}
          </div>
        ) : null}
      </aside>
    </>
  );
}
